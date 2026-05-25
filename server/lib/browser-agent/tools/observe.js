import { safeText } from "../shared.js";

export function buildObserveCommand(step = {}, route = "") {
  const text = String(step.text || "");
  const tool = /(\bshow\s+actions\b|\bactions?\b|\bbuttons?\b|\blinks?\b)/i.test(text) && /show actions/i.test(text)
    ? "browserShowActions"
    : "browserObserve";
  return {
    ok: true,
    command: {
      route,
      kind: "observe",
      tool,
      args: {
        focus: safeText(step.focus || step.target || "", 80),
      },
      notes: safeText(step.notes || step.text || "", 300),
    },
  };
}
