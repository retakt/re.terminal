const ROUTE_TOOLS = {
  playwright: new Set([
    "browserNavigate",
    "browserObserve",
    "browserClickByText",
    "browserFillFields",
    "browserSubmitForm",
    "browserFillAndSubmit",
    "browserScrape",
    "browserExtract",
    "browserScreenshot",
    "browserVerify",
    "browserShowActions",
    "browserStatus",
  ]),
  lightpanda: new Set([
    "browserNavigate",
    "browserObserve",
    "browserClickByText",
    "browserFillFields",
    "browserSubmitForm",
    "browserFillAndSubmit",
    "browserScrape",
    "browserExtract",
    "browserVerify",
    "browserShowActions",
    "browserStatus",
  ]),
};

function safeText(value = "", limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function toolAllowedForRoute(route = "", tool = "") {
  const allowed = ROUTE_TOOLS[String(route || "").toLowerCase()];
  if (!allowed) return false;
  return allowed.has(String(tool || ""));
}

export function checkCommandAuthority({
  route = "",
  command = {},
  step = {},
} = {}) {
  const tool = String(command?.tool || "").trim();
  if (!tool) {
    return {
      approved: false,
      blocked: true,
      reason: "The command builder did not produce a tool.",
      messageToPlanner: "Build exactly one executable command for the selected route.",
    };
  }

  if (!toolAllowedForRoute(route, tool)) {
    return {
      approved: false,
      blocked: true,
      reason: `Tool ${tool} is not allowed on the ${route || "unknown"} route.`,
      messageToPlanner: `Reject the command and rebuild it for the ${route || "selected"} route only.`,
    };
  }

  if (Array.isArray(command.tools) && command.tools.length > 1) {
    return {
      approved: false,
      blocked: true,
      reason: "A single command may only use one tool.",
      messageToPlanner: "Collapse the request into one executable command.",
    };
  }

  if (String(step.kind || "").toLowerCase() === "screenshot" && String(route || "").toLowerCase() === "lightpanda") {
    return {
      approved: false,
      blocked: true,
      reason: "Lightpanda does not own screenshot execution in this architecture.",
      messageToPlanner: "Use the Playwright route for screenshot tasks.",
    };
  }

  return {
    approved: true,
    blocked: false,
    reason: "",
    messageToPlanner: "",
  };
}

export function commandSummary(command = {}) {
  return {
    tool: safeText(command?.tool || "", 80),
    route: safeText(command?.route || "", 80),
    kind: safeText(command?.kind || "", 80),
  };
}

