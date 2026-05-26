import { safeText } from "../shared.js";

function expectedTextFromStep(step = {}) {
  const direct = safeText(step.expectedText || step.targetText || step.target || "", 240);
  if (direct) return direct;
  const text = safeText(step.text || step.notes || "", 500);
  return safeText(
    text.match(/\b(?:page\s+says|verify(?:\s+that)?(?:\s+the\s+page)?\s+says)\s+(.+?)(?:[.!?]\s*$|$)/i)?.[1] || "",
    240
  );
}

export function buildVerifyCommand(step = {}, route = "") {
  return {
    ok: true,
    command: {
      route,
      kind: "verify",
      tool: "browserVerify",
      args: {
        expectedText: expectedTextFromStep(step),
        expectedUrl: safeText(step.expectedUrl || step.url || "", 500),
        expectedTitle: safeText(step.expectedTitle || "", 240),
      },
      notes: safeText(step.notes || step.text || "", 300),
    },
  };
}
