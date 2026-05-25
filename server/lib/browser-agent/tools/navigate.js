import { normalizeUrl, safeText } from "../shared.js";

export function buildNavigateCommand(step = {}, route = "") {
  const url = normalizeUrl(step.url || step.target || "");
  if (!url) {
    return {
      ok: false,
      needsUser: true,
      reason: "Navigation needs a valid URL.",
      command: null,
    };
  }

  return {
    ok: true,
    command: {
      route,
      kind: "navigate",
      tool: "browserNavigate",
      args: { url },
      notes: safeText(step.notes || step.text || "", 300),
    },
  };
}

