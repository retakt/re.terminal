import { safeText } from "../shared.js";

export function buildExtractCommand(step = {}, route = "") {
  return {
    ok: true,
    command: {
      route,
      kind: "extract",
      tool: "browserExtract",
      args: {
        query: safeText(step.query || step.target || "", 240),
        format: safeText(step.format || "json", 80),
      },
      notes: safeText(step.notes || step.text || "", 300),
    },
  };
}

