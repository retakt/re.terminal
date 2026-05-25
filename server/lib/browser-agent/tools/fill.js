import { safeText, extractKeyValuePairs } from "../shared.js";

export function buildFillCommand(step = {}, route = "") {
  const fields = Array.isArray(step.fields) && step.fields.length
    ? step.fields
    : extractKeyValuePairs(step.text || "");

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
        fields: fields.map((field) => ({
          label: safeText(field.label || field.name || field.id || "", 120),
          value: safeText(field.value || "", 500),
          secret: Boolean(field.secret || /\b(password|pass|pwd|otp|code|pin)\b/i.test(String(field.label || ""))),
        })),
      },
      notes: safeText(step.notes || step.text || "", 300),
    },
  };
}

