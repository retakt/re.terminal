import { safeText } from "../shared.js";

export function buildScrapeCommand(step = {}, route = "") {
  return {
    ok: true,
    command: {
      route,
      kind: "scrape",
      tool: "browserScrape",
      args: {
        focus: safeText(step.focus || step.target || "", 120),
        query: safeText(step.query || "", 240),
      },
      notes: safeText(step.notes || step.text || "", 300),
    },
  };
}

