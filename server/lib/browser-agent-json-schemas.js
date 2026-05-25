export const browserAgentJsonSchemas = {
  planner: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["ready", "needs_user"] },
      userIntent: { type: "string" },
      routeHint: { type: "string", enum: ["playwright", "lightpanda", "auto"] },
      needsLightpandaWarmup: { type: "boolean" },
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: [
                "navigate",
                "search",
                "observe",
                "click",
                "fill",
                "fill_and_submit",
                "submit",
                "screenshot",
                "scrape",
                "extract",
                "verify",
                "report",
              ],
            },
            text: { type: "string" },
            url: { type: "string" },
            query: { type: "string" },
            targetText: { type: "string" },
            fields: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                  secret: { type: "boolean" },
                },
                required: ["label", "value", "secret"],
              },
            },
            notes: { type: "string" },
            shouldVerify: { type: "boolean" },
            shouldScreenshot: { type: "boolean" },
          },
          required: [
            "kind",
            "text",
            "url",
            "query",
            "targetText",
            "fields",
            "notes",
            "shouldVerify",
            "shouldScreenshot",
          ],
        },
      },
      reason: { type: "string" },
      confidence: { type: "number" },
    },
    required: [
      "status",
      "userIntent",
      "routeHint",
      "needsLightpandaWarmup",
      "steps",
      "reason",
      "confidence",
    ],
  },
  routeSelector: {
    type: "object",
    additionalProperties: false,
    properties: {
      route: { type: "string", enum: ["playwright", "lightpanda"] },
      reason: { type: "string" },
      confidence: { type: "number" },
      warmLightpanda: { type: "boolean" },
    },
    required: ["route", "reason", "confidence", "warmLightpanda"],
  },
  commandBuilder: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["ready", "needs_user"] },
      command: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: [
              "navigate",
              "search",
              "observe",
              "click",
              "fill",
              "fill_and_submit",
              "submit",
              "screenshot",
              "scrape",
              "extract",
              "verify",
              "show_actions",
            ],
          },
          tool: {
            type: "string",
            enum: [
              "browserNavigate",
              "browserObserve",
              "browserShowActions",
              "browserClickByText",
              "browserFillFields",
              "browserSubmitForm",
              "browserFillAndSubmit",
              "browserScrape",
              "browserExtract",
              "browserScreenshot",
              "browserVerify",
            ],
          },
          args: { type: "object" },
          notes: { type: "string" },
        },
        required: ["kind", "tool", "args", "notes"],
      },
      reason: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["status", "command", "reason", "confidence"],
  },
  checker: {
    type: "object",
    additionalProperties: false,
    properties: {
      approved: { type: "boolean" },
      status: { type: "string", enum: ["approved", "blocked"] },
      reason: { type: "string" },
      messageToPlanner: { type: "string" },
      messageToUser: { type: "string" },
      confidence: { type: "number" },
    },
    required: [
      "approved",
      "status",
      "reason",
      "messageToPlanner",
      "messageToUser",
      "confidence",
    ],
  },
  watcher: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["passed", "failed"] },
      success: { type: "boolean" },
      summary: { type: "string" },
      evidence: { type: "string" },
      reason: { type: "string" },
      nextSafeAction: { type: "string" },
      confidence: { type: "number" },
    },
    required: [
      "status",
      "success",
      "summary",
      "evidence",
      "reason",
      "nextSafeAction",
      "confidence",
    ],
  },
  reporter: {
    type: "object",
    additionalProperties: false,
    properties: {
      success: { type: "boolean" },
      summary: { type: "string" },
      facts: {
        type: "array",
        items: { type: "string" },
      },
      nextSafeAction: { type: "string" },
      reason: { type: "string" },
      confidence: { type: "number" },
    },
    required: [
      "success",
      "summary",
      "facts",
      "nextSafeAction",
      "reason",
      "confidence",
    ],
  },
};

function cloneSchema(schema) {
  return schema ? JSON.parse(JSON.stringify(schema)) : null;
}

export function browserAgentJsonSchemaFor(name = "") {
  const key = String(name || "").trim().toLowerCase();

  if (key.includes("planner") || key.includes("browser_agent_planner")) {
    return cloneSchema(browserAgentJsonSchemas.planner);
  }

  if (
    key.includes("route_selector") ||
    key.includes("route-selector") ||
    key === "main" ||
    key.includes("browser_agent_route_selector")
  ) {
    return cloneSchema(browserAgentJsonSchemas.routeSelector);
  }

  if (
    key.includes("command_builder") ||
    key.includes("command-builder") ||
    key.includes("executor") ||
    key.includes("browser_agent_command_builder")
  ) {
    return cloneSchema(browserAgentJsonSchemas.commandBuilder);
  }

  if (
    key.includes("resultreviewer") ||
    key.includes("result_reviewer") ||
    key.includes("watcher") ||
    key.includes("browser_agent_watcher")
  ) {
    return cloneSchema(browserAgentJsonSchemas.watcher);
  }

  if (
    key.includes("checker") ||
    key.includes("reviewer") ||
    key.includes("browser_agent_checker")
  ) {
    return cloneSchema(browserAgentJsonSchemas.checker);
  }

  if (
    key.includes("reporter") ||
    key.includes("browser_agent_reporter")
  ) {
    return cloneSchema(browserAgentJsonSchemas.reporter);
  }

  return null;
}
