import { safeText, extractQuotedText } from "../shared.js";

export function buildClickCommand(step = {}, route = "") {
  const text = safeText(step.targetText || step.text || extractQuotedText(step.text || ""), 240);
  const selector = safeText(step.selector || "", 500);
  const href = safeText(step.href || "", 500);

  if (!text && !selector && !href) {
    return {
      ok: false,
      needsUser: true,
      reason: "Click needs a visible label or selector.",
      command: null,
    };
  }

  return {
    ok: true,
    command: {
      route,
      kind: "click",
      tool: "browserClickByText",
      args: {
        text,
        selector,
        href,
      },
      notes: safeText(step.notes || step.text || "", 300),
    },
  };
}

