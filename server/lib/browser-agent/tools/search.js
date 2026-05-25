import { buildSearchUrl, safeText } from "../shared.js";

export function buildSearchCommand(step = {}, route = "") {
  const query = safeText(step.query || step.text || "", 500);
  const url = buildSearchUrl(query);

  if (!url) {
    return {
      ok: false,
      needsUser: true,
      reason: "Search needs a query.",
      command: null,
    };
  }

  return {
    ok: true,
    command: {
      route,
      kind: "search",
      tool: "browserNavigate",
      args: { url },
      notes: `Search query: ${query}`,
    },
  };
}

