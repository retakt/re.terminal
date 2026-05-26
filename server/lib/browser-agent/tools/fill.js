import { safeText, extractKeyValuePairs } from "../shared.js";

function isSchemaPlaceholderField(field = {}) {
  const label = safeText(field.label || field.name || field.id || "", 120).toLowerCase();
  const value = safeText(field.value || "", 500).toLowerCase();
  const placeholderLabels = new Set(["string", "label", "field", "field label", "name", "value"]);
  if (!label && !value) return true;
  if (placeholderLabels.has(label)) return true;
  return label === "example" && value === "string";
}

function normalizeFillField(field = {}) {
  return {
    label: safeText(field.label || field.name || field.id || "", 120),
    value: safeText(field.value || "", 500),
    secret: Boolean(field.secret || /\b(password|pass|pwd|otp|code|pin)\b/i.test(String(field.label || ""))),
  };
}

export function buildFillCommand(step = {}, route = "") {
  const sourceFields = Array.isArray(step.fields) && step.fields.length
    ? step.fields
    : extractKeyValuePairs(step.text || "");
  const fields = sourceFields
    .map(normalizeFillField)
    .filter((field) => (field.label || field.value) && !isSchemaPlaceholderField(field));

  if (!fields.length) {
    return {
      ok: false,
      needsUser: true,
      reason: "Fill needs at least one explicit field value.",
      command: null,
    };
  }

  return {
    ok: true,
    command: {
      route,
      kind: step.kind === "fill_and_submit" ? "fill_and_submit" : "fill",
      tool: step.kind === "fill_and_submit" ? "browserFillAndSubmit" : "browserFillFields",
      args: {
        fields,
      },
      notes: safeText(step.notes || step.text || "", 300),
    },
  };
}
