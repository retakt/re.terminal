import { safeText } from "../shared.js";

export function buildVerifyCommand(step = {}, route = "") {
  return {
    ok: true,
    command: {
      route,
      kind: "verify",
      tool: "browserVerify",
      args: {
        expectedText: safeText(step.expectedText || step.targetText || step.target || "", 240),
        expectedUrl: safeText(step.expectedUrl || step.url || "", 500),
        expectedTitle: safeText(step.expectedTitle || "", 240),
      },
      notes: safeText(step.notes || step.text || "", 300),
    },
  };
}
