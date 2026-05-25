import { safeText } from "../shared.js";

export function buildScreenshotCommand(step = {}, route = "") {
  if (String(route || "").toLowerCase() === "lightpanda") {
    return {
      ok: false,
      needsUser: false,
      reason: "Screenshots are routed through Playwright only.",
      command: null,
    };
  }

  return {
    ok: true,
    command: {
      route,
      kind: "screenshot",
      tool: "browserScreenshot",
      args: {
        fullPage: step.fullPage !== false,
      },
      notes: safeText(step.notes || step.text || "", 300),
    },
  };
}

