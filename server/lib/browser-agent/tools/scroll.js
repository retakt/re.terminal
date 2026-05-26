import { safeText } from "../shared.js";

export function buildScrollCommand(step = {}, route = "") {
  const text = safeText([step.text, step.notes, step.targetText].filter(Boolean).join(" "), 500).toLowerCase();
  const direction = /top|start|beginning/.test(text)
    ? "top"
    : /bottom|end/.test(text)
      ? "bottom"
      : /up|previous/.test(text)
        ? "up"
        : "down";

  return {
    ok: true,
    command: {
      route,
      kind: "scroll",
      tool: "browserScroll",
      args: {
        direction,
        amount: "viewport",
      },
      notes: safeText(step.notes || step.text || "", 300),
    },
  };
}
