function safeText(value = "", limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function key(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function extractAfter(source = "", patterns = []) {
  const text = String(source || "");
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return safeText(match[1], 240).replace(/[.;,]+$/g, "").trim();
  }
  return "";
}

export function formValueHintsFromInstruction(instruction = "") {
  const source = String(instruction || "");

  const hints = [
    { label: "ContactName", value: extractAfter(source, [/contact name\s+([^,.;]+)/i]), type: "text" },
    { label: "contactnumber", value: extractAfter(source, [/contact number\s+([^,.;]+)/i]), type: "tel" },
    { label: "pickupdate", value: extractAfter(source, [/pick\s*up date\s+(\d{4}-\d{2}-\d{2})/i, /pickup date\s+(\d{4}-\d{2}-\d{2})/i]), type: "date" },
    { label: "payment", value: extractAfter(source, [/payment method\s+([^,.;]+)/i, /payment\s+([^,.;]+)/i]), type: "select" },

    { label: "text input", value: extractAfter(source, [/text input\s+([^,.;]+)/i]), type: "text" },
    { label: "password", value: extractAfter(source, [/password\s+([^,.;]+)/i]), type: "password", secret: true },
    { label: "textarea", value: extractAfter(source, [/textarea\s+([^,.;]+)/i]), type: "textarea" },
    { label: "date", value: extractAfter(source, [/\bdate\s+(\d{4}-\d{2}-\d{2})/i]), type: "date" },
    { label: "color", value: extractAfter(source, [/\bcolor\s+(#[0-9a-f]{6})/i]), type: "color" },
    { label: "range", value: extractAfter(source, [/\brange\s+(\d+(?:\.\d+)?)/i]), type: "range" },
  ];

  return hints.filter((hint) => hint.value);
}

function hintValue(hints = [], matcher) {
  const found = hints.find((hint) => matcher(key(hint.label), String(hint.type || "").toLowerCase()));
  return found?.value || "";
}

function selectValue(action = {}, wanted = "") {
  const options = Array.isArray(action.options) ? action.options : [];
  const wantedKey = key(wanted);

  const exact = options
    .filter((option) => !option.disabled)
    .find((option) => {
      const optionValue = key(option.value);
      const optionText = key(option.text);
      return wantedKey &&
        [optionValue, optionText].filter(Boolean).some((candidate) =>
          candidate === wantedKey || candidate.includes(wantedKey) || wantedKey.includes(candidate)
        );
    });

  if (exact) return String(exact.value || exact.text || wanted);

  const fallback = options.find((option) =>
    !option.disabled &&
    String(option.value || "").trim() &&
    !/choose|select|open this/i.test(String(option.text || ""))
  );

  return String(fallback?.value || fallback?.text || wanted || "option");
}

function valueForAction(action = {}, hints = []) {
  const text = [
    action.actionId,
    action.label,
    action.name,
    action.id,
    action.type,
    action.tag,
  ].map((value) => String(value || "")).join(" ").toLowerCase();

  const tag = String(action.tag || "").toLowerCase();
  const type = String(action.type || "").toLowerCase();

  if (tag === "select" || /payment|method/.test(text)) {
    const wanted = hintValue(hints, (label) => /payment/.test(label)) || "cash";
    return selectValue(action, wanted);
  }

  if (type === "password" || /password/.test(text)) {
    return hintValue(hints, (label, hintType) => label.includes("password") || hintType === "password") || "Pass12345";
  }

  if (type === "date" || /pickup|date/.test(text)) {
    return hintValue(hints, (label, hintType) => label.includes("pickupdate") || label === "date" || hintType === "date") || "2026-01-15";
  }

  if (type === "color" || /color/.test(text)) {
    return hintValue(hints, (label, hintType) => label.includes("color") || hintType === "color") || "#3366ff";
  }

  if (type === "range" || /range/.test(text)) {
    return hintValue(hints, (label, hintType) => label.includes("range") || hintType === "range") || "5";
  }

  if (tag === "textarea" || /textarea|message|comment/.test(text)) {
    return hintValue(hints, (label, hintType) => label.includes("textarea") || hintType === "textarea") || "hello from registry test";
  }

  if (type === "tel" || /contactnumber|contact no|phone|mobile|telephone|tel/.test(text)) {
    return hintValue(hints, (label, hintType) =>
      label.includes("contactnumber") || label.includes("phone") || hintType === "tel"
    ) || "012-3456789";
  }

  if (/contactname|full name|firstname|lastname|\bname\b/.test(text)) {
    return hintValue(hints, (label) => label.includes("contactname") || label.includes("textinput")) || "Alex Morgan";
  }

  if (type === "email" || /email/.test(text)) return "alex.morgan@example.com";
  if (type === "url" || /url|website/.test(text)) return "https://example.com";
  if (type === "number") return "5";

  return hintValue(hints, (label) => label.includes("textinput")) || "Alex Morgan";
}

function shouldSkipAction(action = {}) {
  const tag = String(action.tag || "").toLowerCase();
  const type = String(action.type || "").toLowerCase();

  if (action.disabled || action.readonly) return true;
  if (tag !== "input" && tag !== "textarea" && tag !== "select") return true;
  if (["hidden", "file", "submit", "button", "reset", "checkbox", "radio"].includes(type)) return true;

  return false;
}

export function buildRegistryFormFillCommandFromInstruction({
  instruction = "",
  step = {},
  actionRegistry = {},
  currentUrl = "",
} = {}) {
  const text = [
    instruction,
    step.instruction,
    step.expectedAction,
    step.successCriteria,
  ].map((value) => String(value || "")).join(" ");

  if (!/\b(fill|form|field|fields|editable|visible|test data|fake data)\b/i.test(text)) {
    return null;
  }

  const actions = Array.isArray(actionRegistry?.actions) ? actionRegistry.actions : [];
  const fields = actions
    .filter((action) => action.kind === "field")
    .filter((action) => !shouldSkipAction(action));

  if (!fields.length) return null;

  const hints = formValueHintsFromInstruction(instruction);

  const commandFields = fields.map((action) => ({
    actionId: action.actionId || "",
    label: action.label || action.name || action.id || action.type || "field",
    value: valueForAction(action, hints),
    secret: String(action.type || "").toLowerCase() === "password",
    selector: action.selector || "",
    name: action.name || "",
    id: action.id || "",
    type: action.type || "",
  })).filter((field) => field.actionId && String(field.value || "").trim());

  if (!commandFields.length) return null;

  const hasNegativeSubmitIntent =
    /\b(do\s+not\s+submit|don't\s+submit|dont\s+submit|without\s+submitting|not\s+submit|not\s+submitted|has\s+not\s+been\s+submitted|must\s+not\s+submit|avoid\s+submitting|do\s+not\s+send|don't\s+send|dont\s+send)\b/i.test(text);

  const wantsSubmit =
    !hasNegativeSubmitIntent &&
    /\b(fill\s+.*submit|submit\s+.*form|then submit|register)\b/i.test(text);

  return {
    intent: wantsSubmit ? "fill_and_submit" : "fill_form",
    tool: wantsSubmit ? "browserFillAndSubmit" : "browserFillFields",
    args: {
      currentUrl,
      fields: commandFields,
      ...(wantsSubmit ? { explicitSubmit: true, text: "Submit" } : {}),
    },
    notes: "Pipeline generated safe default form values from Playwright action registry and user prompt hints.",
  };
}
