const FIELD_ALIASES = [
  { key: "employee id", canonical: "employee id", secret: false, patterns: ["employee id", "employee_id", "emp id", "staff id", "user id", "login id"] },
  { key: "username", canonical: "username", secret: false, patterns: ["username", "user name"] },
  { key: "email", canonical: "email", secret: false, patterns: ["email", "e-mail"] },
  { key: "phone", canonical: "phone", secret: false, patterns: ["phone", "mobile", "contact", "tel", "telephone", "whatsapp"] },
  { key: "password", canonical: "password", secret: true, patterns: ["password", "pass", "pwd"] },
  { key: "otp", canonical: "otp", secret: true, patterns: ["otp", "code", "pin"] },
  { key: "search", canonical: "search", secret: false, patterns: ["search", "query"] },
  { key: "name", canonical: "name", secret: false, patterns: ["name"] },
  { key: "date", canonical: "date", secret: false, patterns: ["date"] },
  { key: "amount", canonical: "amount", secret: false, patterns: ["amount"] },
];

const FIELD_PATTERN_ENTRIES = FIELD_ALIASES
  .flatMap((entry) => entry.patterns.map((pattern) => ({ ...entry, pattern })))
  .sort((a, b) => b.pattern.length - a.pattern.length);

function safeText(value = "", limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalize(value = "") {
  return safeText(value, 1000).toLowerCase().replace(/[_-]+/g, " ");
}

function isLikelyUrl(value = "") {
  const raw = safeText(value, 500);
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) return true;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) return false;
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#][^\s]*)?$/i.test(raw);
}

function normalizeUrlInput(value = "") {
  const raw = safeText(value, 500).replace(/[.,;]+$/, "");
  if (!isLikelyUrl(raw)) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function extractUrl(text = "") {
  const raw = String(text || "");
  const url = raw.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (url) return normalizeUrlInput(url);
  const domain = raw.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>]*)?/i)?.[0];
  return domain ? normalizeUrlInput(domain) : "";
}

function isValidCurrentUrl(value = "") {
  const url = normalizeUrlInput(value);
  return Boolean(url && !/^about:blank$/i.test(url));
}

function effectiveCurrentUrl(args = {}) {
  return normalizeUrlInput(
    args.currentUrl ||
    args.currentState?.currentUrl ||
    args.currentState?.lastValidObservation?.url ||
    args.lastValidObservation?.url ||
    ""
  );
}

function canonicalFieldLabel(label = "") {
  const raw = normalize(label);
  const match = FIELD_PATTERN_ENTRIES.find((entry) => {
    const pattern = normalize(entry.pattern);
    return raw === pattern || raw.includes(pattern);
  });
  return match?.canonical || safeText(label, 80);
}

function fieldSecret(label = "", explicitSecret = false) {
  const raw = normalize(label);
  return explicitSecret || /\b(password|pass|pwd|otp|code|pin)\b/.test(raw);
}

function redactField(field = {}) {
  const secret = fieldSecret(field.label || field.name || field.id || field.selector || "", field.secret);
  return {
    ...field,
    secret,
    value: secret ? "[redacted]" : field.value,
  };
}

function redactCommand(command = null) {
  if (!command?.args) return command;
  const fields = Array.isArray(command.args.fields)
    ? command.args.fields.map(redactField)
    : command.args.fields;
  return {
    ...command,
    args: {
      ...command.args,
      ...(Array.isArray(command.args.fields) ? { fields } : {}),
    },
  };
}

function allFieldLabels() {
  return FIELD_PATTERN_ENTRIES.map((entry) => entry.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function parseFormFieldsFromInstruction(instruction = "") {
  const raw = safeText(instruction, 4000)
    .replace(/\blogin\s+with\b/ig, " ")
    .replace(/\bfill(?:\s+the\s+form)?\s+with\b/ig, " ")
    .replace(/\bfill\b/ig, " ");
  const lower = raw.toLowerCase();
  const labelAlternation = allFieldLabels().join("|");
  const labelRe = new RegExp(`\\b(${labelAlternation})\\b\\s*(?::|=|\\bis\\b)?\\s*`, "ig");
  const matches = [];
  let match;

  while ((match = labelRe.exec(raw))) {
    matches.push({
      rawLabel: match[1],
      labelStart: match.index,
      valueStart: labelRe.lastIndex,
    });
  }

  const fields = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    let value = raw.slice(current.valueStart, next ? next.labelStart : raw.length);
    value = value
      .replace(/^\s*(?::|=|is)\s*/i, "")
      .replace(/\s+\b(?:and\s+)?(?:submit|login|sign\s*in|enter\s+those\s+details|click|press)\b[\s\S]*$/i, "")
      .replace(/\s+\band\s*$/i, "")
      .trim();

    if (!value) continue;
    const alias = FIELD_PATTERN_ENTRIES.find((entry) => normalize(entry.pattern) === normalize(current.rawLabel)) ||
      FIELD_PATTERN_ENTRIES.find((entry) => normalize(current.rawLabel).includes(normalize(entry.pattern)));
    const label = alias?.canonical || canonicalFieldLabel(current.rawLabel);
    const secret = fieldSecret(label, alias?.secret);
    fields.push({
      label,
      value,
      secret,
    });
  }

  const seen = new Set();
  return fields.filter((field) => {
    const key = normalize(field.label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function observationFields(observation = {}) {
  const forms = Array.isArray(observation?.forms) ? observation.forms : [];
  const inputs = [
    ...(Array.isArray(observation?.inputs) ? observation.inputs : []),
    ...forms.flatMap((form) => Array.isArray(form?.fields) ? form.fields : []),
    ...(Array.isArray(observation?.interactiveElements)
      ? observation.interactiveElements.filter((entry) => /input|textbox|password|select|textarea/i.test(`${entry?.role || ""} ${entry?.tag || ""} ${entry?.type || ""}`))
      : []),
  ];
  const seen = new Set();
  return inputs
    .map((field) => {
      const label = safeText([
        field.label,
        field.placeholder,
        field.ariaLabel,
        field.name,
        field.id,
        field.selector,
        field.type,
      ].filter(Boolean).join(" "), 240);
      return {
        ...field,
        label: canonicalFieldLabel(label) || label,
        haystack: normalize(label),
        secret: Boolean(field.secret || /password/i.test(`${field.type || ""} ${label}`)),
      };
    })
    .filter((field) => {
      const key = normalize(`${field.selector || ""} ${field.name || ""} ${field.id || ""} ${field.label || ""}`);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function fieldKind(field = {}) {
  const haystack = normalize(`${field.label || ""} ${field.name || ""} ${field.id || ""} ${field.placeholder || ""} ${field.ariaLabel || ""} ${field.type || ""} ${field.selector || ""}`);
  if (field.secret || /\bpassword\b/.test(haystack)) return "password";
  if (/\b(employee id|employee|emp id|staff id|user id|login id|username|user name)\b/.test(haystack)) return haystack.includes("username") ? "username" : "employee id";
  if (/\b(email|e mail)\b/.test(haystack)) return "email";
  if (/\b(phone|mobile|contact|tel|telephone|whatsapp)\b/.test(haystack)) return "phone";
  if (/\b(otp|code|pin)\b/.test(haystack)) return "otp";
  if (/\b(search|query)\b/.test(haystack)) return "search";
  if (/\b(amount)\b/.test(haystack)) return "amount";
  if (/\b(date)\b/.test(haystack)) return "date";
  if (/\b(name)\b/.test(haystack)) return "name";
  return "";
}

function valueKind(value = "") {
  const raw = safeText(value, 240);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return "email";
  if (/^\d{4,8}$/.test(raw)) return "otp_or_numeric";
  if (/^\+?\d[\d\s().-]{7,}$/.test(raw)) return "phone_or_numeric";
  if (/^\d+(?:\.\d+)?$/.test(raw)) return "numeric";
  return "";
}

function expectedFieldFromPending(pendingForm = {}) {
  const expected = canonicalFieldLabel(pendingForm.expectedField || "");
  return expected ? normalize(expected) : "";
}

function inferFieldsFromShortMessage({
  rawUserMessage = "",
  observation = null,
  state = null,
  pendingForm = null,
} = {}) {
  const raw = safeText(rawUserMessage, 240);
  const lower = raw.toLowerCase();

  if (!raw || /\s/.test(raw.trim()) && raw.trim().split(/\s+/).length > 3) {
    return { ok: false, confidence: 0, reason: "not a short field value" };
  }

  const pending = pendingForm || state?.pendingForm || {};
  const expected = expectedFieldFromPending(pending);
  const fields = observationFields(observation || state?.lastValidObservation || {});
  const kind = valueKind(raw);

  if (!fields.length) {
    return { ok: false, confidence: 0, reason: "no observable fields" };
  }

  if (expected) {
    const candidates = fields.filter((field) => normalize(fieldKind(field)) === expected || normalize(field.label).includes(expected));
    if (candidates.length) {
      const label = canonicalFieldLabel(candidates[0].label || expected);
      return {
        ok: true,
        intent: "fill_form",
        fields: [{ label, value: raw, secret: fieldSecret(label, candidates[0].secret), inferred: true }],
        confidence: expected === "password" ? 0.9 : 0.88,
        reason: `pending form expects ${label}`,
      };
    }
  }

  if (fields.some((field) => fieldKind(field) === "password") && !/\b(password|pass|pwd)\b/i.test(lower)) {
    const nonSecretFields = fields.filter((field) => fieldKind(field) !== "password");
    if (!nonSecretFields.length) {
      return {
        ok: false,
        needsUser: true,
        confidence: 0.6,
        reason: "bare values are not inferred as passwords",
      };
    }
  }

  const matchKinds = [];
  if (kind === "email") matchKinds.push("email");
  if (kind === "phone_or_numeric") matchKinds.push("phone");
  if (kind === "otp_or_numeric") matchKinds.push("otp");
  if (kind === "numeric") matchKinds.push("otp", "amount");

  if (!matchKinds.length) return { ok: false, confidence: 0, reason: "short value has no safe field type signal" };

  const candidates = fields.filter((field) => matchKinds.includes(fieldKind(field)));
  const numericSensitiveFields = fields.filter((field) =>
    ["employee id", "phone", "otp", "amount"].includes(fieldKind(field))
  );

  if ((kind === "phone_or_numeric" || kind === "otp_or_numeric" || kind === "numeric") && numericSensitiveFields.length > 1) {
    return {
      ok: false,
      needsUser: true,
      confidence: 0.5,
      reason: "multiple numeric-looking fields are visible; clarification is required",
    };
  }

  if (candidates.length !== 1) {
    return {
      ok: false,
      needsUser: candidates.length > 1,
      confidence: candidates.length > 1 ? 0.5 : 0,
      reason: candidates.length > 1 ? "multiple matching fields are visible" : "no matching field is visible",
    };
  }

  const label = canonicalFieldLabel(candidates[0].label || fieldKind(candidates[0]));
  return {
    ok: true,
    intent: "fill_form",
    fields: [{ label, value: raw, secret: fieldSecret(label, candidates[0].secret), inferred: true }],
    confidence: kind === "email" ? 0.9 : 0.85,
    reason: `inferred ${label} from current page fields`,
  };
}

function explicitSubmitIntent(message = "", args = {}) {
  return args.confirm === true || /\b(submit|login|log\s*in|sign\s*in|enter\s+those\s+details\s+and\s+submit|send|continue)\b/i.test(message);
}

function clickTargetFromInstruction(message = "") {
  const raw = safeText(message, 500);
  const quoted = raw.match(/["'`](.+?)["'`]/)?.[1];
  if (quoted) return safeText(quoted, 160);
  const match = raw.match(/(?:try\s+)?(?:click(?:ing)?|open|press|tap|select|choose|go\s+to)\s+(?:on\s+|the\s+)?(.+?)(?:\s+(?:and|then)\s+(?:read|observe|inspect|show|tell|summarize).*)?$/i);
  if (match?.[1]) {
    return safeText(match[1].replace(/\b(button|link|page|menu|section)\b/ig, " ").replace(/\s+/g, " "), 160);
  }
  return "";
}

function observeFocus(message = "") {
  const lower = normalize(message);
  if (/\blink|links\b/.test(lower)) return "links";
  if (/\bbutton|buttons|clickable|actions|elements|menu|menus|option|options|nav|navigation\b/.test(lower)) return "actions";
  if (/\bform|forms|input|inputs|field|fields\b/.test(lower)) return "forms";
  return "page";
}

function output({
  ok = true,
  intent = "observe",
  confidence = 0.8,
  risk = "low",
  needsUser = false,
  reason = "",
  command = null,
  normalizedInstruction = "",
} = {}) {
  return {
    ok,
    intent,
    confidence,
    risk,
    needsUser,
    reason,
    command,
    expectedTool: command?.tool || "",
    normalizedInstruction,
  };
}

function needsCurrentPage(intent, command) {
  return Boolean(command?.tool && !["browserNavigate"].includes(command.tool) && intent !== "show_actions");
}

function currentPageMissingResponse(intent, normalizedInstruction) {
  return output({
    ok: false,
    intent,
    confidence: 0.9,
    risk: "low",
    needsUser: true,
    reason: "No valid current browser page is loaded. Navigate to a URL first.",
    normalizedInstruction,
  });
}

export {
  inferFieldsFromShortMessage,
  parseFormFieldsFromInstruction,
  redactCommand,
};

export function watchBrowserInstruction(args = {}) {
  const raw = safeText(args.rawUserMessage || args.instruction || "", 4000);
  const lower = normalize(raw);
  const state = args.currentState || args.state || {};
  const observation = args.currentState?.lastValidObservation || args.lastValidObservation || {};
  const currentUrl = effectiveCurrentUrl(args);
  const normalizedInstruction = raw.trim();

  if (!raw) {
    return output({
      ok: false,
      intent: "observe",
      confidence: 0,
      needsUser: true,
      reason: "Instruction is empty.",
      normalizedInstruction,
    });
  }

  if (/\b(reset|clear)\b.*\b(browser agent|browser state|agent state)\b/i.test(raw)) {
    return output({ intent: "reset", confidence: 0.98, command: { tool: "browserReset", args: {} }, normalizedInstruction });
  }

  if (/\b(status)\b.*\b(browser agent|agent)\b/i.test(raw)) {
    return output({ intent: "status", confidence: 0.98, command: { tool: "browserStatus", args: {} }, normalizedInstruction });
  }

  const url = extractUrl(raw);
  if (url && (/\b(navigate|visit|open|go|goto|load|read|view|inspect)\b/i.test(raw) || /\bgo\s+to\b/i.test(raw) || raw === url || isLikelyUrl(raw))) {
    return output({
      intent: "navigate",
      confidence: 0.98,
      command: { tool: "browserNavigate", args: { url } },
      normalizedInstruction,
    });
  }

  if (/\b(learn|remember|save this action|save as action|call this|use this as)\b/i.test(raw)) {
    const command = { tool: "browserLearn", args: { instruction: raw, currentUrl } };
    return currentUrl || !needsCurrentPage("learn", command)
      ? output({ intent: "learn", confidence: 0.9, risk: "medium", command, normalizedInstruction })
      : currentPageMissingResponse("learn", normalizedInstruction);
  }

  if (/\b(show|list|what actions|available actions|known actions|extension actions|site actions)\b/i.test(raw)) {
    return output({
      intent: "show_actions",
      confidence: 0.9,
      command: { tool: "browserShowActions", args: { instruction: raw, currentUrl } },
      normalizedInstruction,
    });
  }

  const parsedFields = parseFormFieldsFromInstruction(raw);
  const hasFillIntent = /\b(fill|enter|type|login\s+with)\b/i.test(raw) || parsedFields.length > 0;
  const hasSubmit = explicitSubmitIntent(raw, args);

  if (hasFillIntent && parsedFields.length > 0) {
    const hasPassword = parsedFields.some((field) => fieldSecret(field.label, field.secret));
    if (hasPassword && hasSubmit && !explicitSubmitIntent(raw, args)) {
      return output({
        ok: false,
        intent: "fill_form",
        confidence: 0.9,
        risk: "high",
        needsUser: true,
        reason: "Submitting a password form requires explicit submit intent in the same instruction.",
        normalizedInstruction,
      });
    }

    const intent = hasSubmit ? "fill_and_submit" : "fill_form";
    const command = hasSubmit
      ? { tool: "browserFillAndSubmit", args: { currentUrl, explicitSubmit: true, confirm: true, fields: parsedFields } }
      : { tool: "browserFillFields", args: { currentUrl, fields: parsedFields } };

    if (!currentUrl) return currentPageMissingResponse(intent, normalizedInstruction);

    return output({
      intent,
      confidence: 0.96,
      risk: hasPassword || hasSubmit ? "medium" : "low",
      command,
      normalizedInstruction,
      reason: hasSubmit ? "parsed fields and explicit submit intent" : "parsed form fields",
    });
  }

  if (hasSubmit) {
    const command = { tool: "browserSubmitForm", args: { currentUrl, explicitSubmit: true, confirm: args.confirm === true } };
    if (!currentUrl) return currentPageMissingResponse("submit_form", normalizedInstruction);
    return output({
      intent: "submit_form",
      confidence: 0.9,
      risk: "medium",
      command,
      normalizedInstruction,
      reason: "explicit submit intent",
    });
  }

  const shortInference = inferFieldsFromShortMessage({
    rawUserMessage: raw,
    observation,
    state,
    pendingForm: state.pendingForm,
  });

  if (shortInference.ok) {
    const command = { tool: "browserFillFields", args: { currentUrl, fields: shortInference.fields } };
    if (!currentUrl) return currentPageMissingResponse("fill_form", normalizedInstruction);
    return output({
      intent: "fill_form",
      confidence: shortInference.confidence,
      risk: shortInference.fields.some((field) => field.secret) ? "medium" : "low",
      command,
      normalizedInstruction,
      reason: shortInference.reason,
    });
  }

  if (shortInference.needsUser) {
    return output({
      ok: false,
      intent: "fill_form",
      confidence: shortInference.confidence,
      risk: "medium",
      needsUser: true,
      reason: shortInference.reason,
      normalizedInstruction,
    });
  }

  if (/\b(scrape|extract table|extract cards|extract data|scraper)\b/i.test(raw)) {
    const command = { tool: "browserScrape", args: { currentUrl, instruction: raw } };
    if (!currentUrl) return currentPageMissingResponse("scrape", normalizedInstruction);
    return output({ intent: "scrape", confidence: 0.9, command, normalizedInstruction });
  }

  const targetText = clickTargetFromInstruction(raw);
  if (targetText || /\b(click|clicking|press|tap|select|choose|open|go to)\b/i.test(raw)) {
    const command = { tool: "browserClickByText", args: { currentUrl, text: targetText } };
    if (!currentUrl) return currentPageMissingResponse("click_or_open", normalizedInstruction);
    return output({
      intent: "click_or_open",
      confidence: targetText ? 0.88 : 0.65,
      risk: "low",
      needsUser: !targetText,
      reason: targetText ? "visible text click/open request" : "click request did not include visible text",
      command: targetText ? command : null,
      normalizedInstruction,
    });
  }

  if (
    /\b(what|which|show|list|tell me|visible|available|present)\b.*\b(button|buttons|link|links|clickable|elements|actions|forms|inputs|fields|menu|menus|option|options|nav|navigation)\b/i.test(raw) ||
    /\b(menu|menus|option|options|nav|navigation)\b.*\b(present|visible|available|there|on this page|on the page)\b/i.test(raw) ||
    /\b(observe|inspect|read|snapshot|current page)\b/i.test(raw)
  ) {
    const command = { tool: "browserObserve", args: { currentUrl, focus: observeFocus(raw) } };
    if (!currentUrl) return currentPageMissingResponse("observe", normalizedInstruction);
    return output({ intent: "observe", confidence: 0.9, command, normalizedInstruction });
  }

  const fallbackCommand = { tool: "browserObserve", args: { currentUrl, focus: "page" } };
  if (!currentUrl) return currentPageMissingResponse("observe", normalizedInstruction);
  return output({
    intent: "observe",
    confidence: 0.62,
    command: fallbackCommand,
    normalizedInstruction,
    reason: "defaulted to observing current page",
  });
}
