function safeText(value = "", limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function key(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cleanFieldValue(value = "") {
  return String(value || "")
    .replace(/,?\s+but\s+do\s+not\s+submit.*$/i, "")
    .replace(/,?\s+do\s+not\s+submit.*$/i, "")
    .replace(/\.\s+after.*$/i, "")
    .replace(/\.\s+submit.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unsupportedFillType(type = "") {
  return ["hidden", "file", "submit", "button", "reset", "checkbox", "radio"]
    .includes(String(type || "").toLowerCase());
}

function shouldSkipRegistryFillAction(action = {}) {
  const tag = String(action.tag || "").toLowerCase();
  const type = String(action.type || "").toLowerCase();

  if (action.disabled || action.readonly) return true;
  if (!["input", "textarea", "select"].includes(tag)) return true;
  if (unsupportedFillType(type)) return true;

  return false;
}

const LIGHTPANDA_REF_RE = /^lp_(input|button|link|form)_\d+$/i;

function isLightpandaRef(value = "") {
  return LIGHTPANDA_REF_RE.test(String(value || "").trim());
}

function fieldContainsLightpandaRef(field = {}) {
  return [field.ref, field.actionId, field.target, field.id].some(isLightpandaRef);
}

function stripLightpandaIdentity(field = {}) {
  const clean = { ...field };
  for (const key of ["ref", "actionId", "target", "id"]) {
    if (isLightpandaRef(clean[key])) clean[key] = "";
  }
  return clean;
}

function compactFieldForWarning(field = {}) {
  return {
    ref: field.ref || "",
    actionId: field.actionId || "",
    label: field.label || field.name || field.field || "",
    selector: field.selector || "",
    type: field.type || "",
    valuePreview: safeText(field.value || "", 120),
  };
}

function compactActionForWarning(action = {}) {
  return {
    actionId: action.actionId || "",
    label: action.label || "",
    selector: action.selector || "",
    type: action.type || "",
    tag: action.tag || "",
  };
}

function looseFieldLooksUnsupported(field = {}) {
  const text = [
    field.actionId,
    field.label,
    field.name,
    field.id,
    field.selector,
    field.type,
  ].map((value) => String(value || "")).join(" ").toLowerCase();

  return /disabled|read.?only|file|checkbox|radio/.test(text) ||
    unsupportedFillType(field.type);
}

function fieldsFromArgs(args = {}) {
  if (Array.isArray(args.fields)) return args.fields;
  if (Array.isArray(args.requestedValues)) return args.requestedValues;
  if (Array.isArray(args.values)) return args.values;

  const reserved = new Set([
    "currentUrl",
    "formIntent",
    "stepInstruction",
    "explicitSubmit",
    "submit",
    "text",
    "submitText",
    "buttonText",
    "ref",
    "selector",
    "target",
    "formSelector",
    "notes",
  ]);

  const objectFields = Object.entries(args)
    .filter(([name, value]) =>
      !reserved.has(name) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (
        value.value !== undefined ||
        value.label ||
        value.name ||
        value.field
      )
    )
    .map(([fallbackLabel, value]) => ({
      ...value,
      label: value.label || value.name || value.field || fallbackLabel,
      value: String(value.value ?? ""),
      secret: Boolean(value.secret),
    }))
    .filter((field) => field.label && String(field.value || "").trim());

  const scalarFields = Object.entries(args)
    .filter(([name, value]) =>
      !reserved.has(name) &&
      value !== undefined &&
      value !== null &&
      typeof value !== "object" &&
      String(value).trim()
    )
    .map(([label, value]) => ({
      label,
      value: String(value),
      secret: false,
    }));

  return [...objectFields, ...scalarFields];
}

function fieldLooksLike(field = {}, pattern) {
  const text = [
    field.actionId,
    field.label,
    field.name,
    field.id,
    field.selector,
    field.type,
    field.value,
  ].map((value) => String(value || "")).join(" ").toLowerCase();

  return pattern.test(text);
}

function scoreFieldMatch(field = {}, action = {}) {
  if (!action || action.kind !== "field") return 0;

  const fieldKeys = [
    field.actionId,
    field.label,
    field.name,
    field.id,
    field.selector,
    field.type,
  ].map(key).filter(Boolean);

  const actionKeys = [
    action.actionId,
    action.label,
    action.name,
    action.id,
    action.selector,
    action.type,
  ].map(key).filter(Boolean);

  let score = 0;

  for (const left of fieldKeys) {
    for (const right of actionKeys) {
      if (left === right) score = Math.max(score, 240);
      else if (left.includes(right) || right.includes(left)) score = Math.max(score, 140);
    }
  }

  const actionText = actionKeys.join(" ");
  const actionType = String(action.type || "").toLowerCase();
  const actionTag = String(action.tag || "").toLowerCase();

  if (fieldLooksLike(field, /pickup|pickupdate|date|\d{4}-\d{2}-\d{2}/)) {
    if (actionType === "date" || /pickup|pickupdate|date/.test(actionText)) score += 220;
    if (/contact|phone|tel|payment/.test(actionText)) score -= 240;
  }

  if (fieldLooksLike(field, /contactnumber|contact no|phone|mobile|tel|telephone/)) {
    if (actionType === "tel" || /contactnumber|contactno|phone|mobile|tel|telephone/.test(actionText)) score += 260;
    if (/contactname|fullname|firstname|lastname|\bname\b|pickup|date|payment/.test(actionText)) score -= 260;
  }

  if (fieldLooksLike(field, /payment|method|card|cash/)) {
    if (actionTag === "select" || /payment|method/.test(actionText)) score += 220;
    if (/pickup|date|contact|phone|tel/.test(actionText)) score -= 240;
  }

  return score;
}

function findRegistryField(field = {}, registry = {}) {
  const actions = Array.isArray(registry?.actions)
    ? registry.actions.filter((action) => action.kind === "field")
    : [];

  if (!actions.length) return null;

  const requestedActionId = String(field.actionId || "").trim();
  if (requestedActionId) {
    const exact = actions.find((action) => String(action.actionId || "") === requestedActionId);
    if (exact) return exact;

    const requestedKey = key(requestedActionId);
    const identityCandidates = actions.filter((action) =>
      [action.id, action.name, action.selector, action.label]
        .map(key)
        .some((candidate) =>
          candidate &&
          requestedKey &&
          (candidate === requestedKey || candidate.includes(requestedKey) || requestedKey.includes(candidate))
        )
    );

    if (identityCandidates.length === 1) return identityCandidates[0];

    // Duplicate DOM ids are common on test pages. If multiple controls share the
    // same id/name/selector identity, do not pick the first one blindly. Score
    // them by semantic field intent, type, label, and value.
    if (identityCandidates.length > 1) {
      const bestIdentity = identityCandidates
        .map((action) => ({ action, score: scoreFieldMatch(field, action) }))
        .sort((a, b) => b.score - a.score)[0];

      if (bestIdentity?.score >= 120) return bestIdentity.action;
    }
  }

  const best = actions
    .map((action) => ({ action, score: scoreFieldMatch(field, action) }))
    .sort((a, b) => b.score - a.score)[0];

  return best && best.score >= 120 ? best.action : null;
}

function looksLikePlaceholderOption(option = {}) {
  const text = String(option.text || option.value || "").trim();
  return !String(option.value || "").trim() ||
    /^(choose|select|open this|open this select menu|select an option|please select)$/i.test(text);
}

function normalizeValueForAction(field = {}, action = {}) {
  const value = cleanFieldValue(field.value ?? "");

  if (String(action.tag || "").toLowerCase() !== "select") {
    return value;
  }

  const options = Array.isArray(action.options) ? action.options : [];
  const wanted = key(value);
  const wantedIsPlaceholder = /choose|select|openthis|menu|placeholder/.test(wanted);

  const usableOptions = options.filter((option) =>
    !option.disabled &&
    !looksLikePlaceholderOption(option)
  );

  const match = usableOptions.find((option) => {
    const optionValue = key(option.value);
    const optionText = key(option.text);
    const candidates = [optionValue, optionText].filter(Boolean);

    return wanted &&
      !wantedIsPlaceholder &&
      candidates.some((candidate) =>
        candidate === wanted ||
        candidate.includes(wanted) ||
        wanted.includes(candidate)
      );
  });

  const fallback = usableOptions[0] || options.find((option) => !option.disabled) || null;

  return String(
    match?.value ||
    match?.text ||
    fallback?.value ||
    fallback?.text ||
    value ||
    ""
  );
}

export function withActionRegistryFieldTargets(command = {}, registry = {}) {
  const tool = String(command?.tool || "");

  if (!["browserFillFields", "browserFillAndSubmit", "browserPrepareFormSubmission"].includes(tool)) {
    return command;
  }

  const args = command.args && typeof command.args === "object" && !Array.isArray(command.args)
    ? command.args
    : {};

  const fields = fieldsFromArgs(args);
  if (!fields.length) return command;

  const resolutionWarnings = [];

  const resolvedFields = fields.map((field) => {
    const hadLightpandaRef = fieldContainsLightpandaRef(field);
    const registryOnlyField = stripLightpandaIdentity(field);
    const match = findRegistryField(registryOnlyField, registry);

    if (match && shouldSkipRegistryFillAction(match)) {
      resolutionWarnings.push({
        code: "playwright_registry_target_unsupported",
        severity: "blocked",
        reason: "Matched Playwright registry target is disabled, readonly, or not fillable by the current text-fill tool.",
        field: compactFieldForWarning(field),
        matchedAction: compactActionForWarning(match),
      });
      return null;
    }

    if (!match) {
      resolutionWarnings.push({
        code: hadLightpandaRef ? "lightpanda_ref_not_executable" : "no_playwright_registry_match",
        severity: "blocked",
        reason: hadLightpandaRef
          ? "Lightpanda refs are observe-only. Playwright execution requires a Playwright action registry actionId or selector."
          : "No matching Playwright registry field was found, so the field was not executed.",
        field: compactFieldForWarning(field),
        hint: "Use Lightpanda only for observation. Use Playwright registry actions for execution.",
      });
      return null;
    }

    return {
      ...registryOnlyField,
      actionId: match.actionId || registryOnlyField.actionId || "",
      label: field.label || match.label || field.name || field.field || "",
      value: normalizeValueForAction(field, match),
      selector: match.selector || field.selector || "",
      name: match.name || field.name || "",
      id: match.id || field.id || "",
      type: match.type || field.type || "",
      options: Array.isArray(match.options) ? match.options : field.options,
      registryMatched: true,
    };
  }).filter(Boolean);

  return {
    ...command,
    args: {
      ...args,
      fields: resolvedFields,
      registryResolution: {
        ok: resolutionWarnings.length === 0,
        resolvedCount: resolvedFields.length,
        rejectedCount: resolutionWarnings.length,
        warnings: resolutionWarnings,
      },
    },
    notes: [
      command.notes || "",
      "Resolved form fields against Playwright action registry before execution.",
      resolutionWarnings.length
        ? `Registry resolver blocked ${resolutionWarnings.length} field(s): ${
            resolutionWarnings.map((warning) => warning.code).join(", ")
          }.`
        : "",
    ].filter(Boolean).join(" "),
  };
}
