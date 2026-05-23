const DEFAULT_CAPABILITIES = {
  lightpanda_cdp: {
    engine: "lightpanda_cdp",
    role: "read_only_state_engine",
    canRead: true,
    canScrape: true,
    canNavigateForRead: true,
    canClick: false,
    canFill: false,
    canSubmit: false,
    canScreenshot: false,
    canVerifyDom: true,
    preferredFor: ["scrape", "read", "dom_state", "links", "forms", "tables", "markdown"],
    rules: [
      "Lightpanda is read-only in browser-agent mode.",
      "Do not click, fill, type, submit, or mutate page state through Lightpanda.",
      "Use Lightpanda output as page intelligence for agents and Playwright."
    ],
  },
  static_fetch: {
    engine: "static_fetch",
    role: "read_only_static_fallback",
    canRead: true,
    canScrape: true,
    canNavigateForRead: true,
    canClick: false,
    canFill: false,
    canSubmit: false,
    canScreenshot: false,
    canVerifyDom: false,
    preferredFor: ["static_html", "links", "basic_forms"],
    rules: [
      "Use only as a fallback when browser DOM read is unavailable.",
      "Never use for logged-in or interactive browser state."
    ],
  },
  playwright_mcp: {
    engine: "playwright_mcp",
    role: "primary_action_engine",
    canRead: true,
    canScrape: false,
    canNavigate: true,
    canClick: true,
    canFill: true,
    canType: true,
    canSubmit: true,
    canScreenshot: true,
    canVerifyDom: true,
    preferredFor: ["clicks", "forms", "login", "submit", "interactive_browser", "verification"],
    rules: [
      "Playwright is the only default browser-agent action engine.",
      "Verify target existence before actions.",
      "For forms, verify values before submit.",
      "Use screenshot/snapshot only for failure, ambiguity, critical validation, or visual tasks."
    ],
  },
};

export function browserEngineCapabilities(engine = "lightpanda_cdp") {
  return DEFAULT_CAPABILITIES[engine] || {
    engine,
    role: "unknown",
    canRead: false,
    canScrape: false,
    canClick: false,
    canFill: false,
    canSubmit: false,
    canScreenshot: false,
    canVerifyDom: false,
    preferredFor: [],
    rules: ["Unknown engine; do not use for browser actions without explicit support."],
  };
}

export function allBrowserEngineCapabilities() {
  return {
    ...DEFAULT_CAPABILITIES,
  };
}

export function browserAgentEnginePolicy() {
  return {
    readEngines: ["lightpanda_cdp", "static_fetch"],
    actionEngines: ["playwright_mcp"],
    defaultReadEngine: "lightpanda_cdp",
    defaultActionEngine: "playwright_mcp",
    lightpandaReadOnly: true,
  };
}
