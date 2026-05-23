export const browserAgentJsonSchemas = {
  watcher: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["passed", "failed", "needs_repair"] },
      success: { type: "boolean" },
      summary: { type: "string" },
      evidence: { type: "string" },
      repairInstruction: { type: "string" },
      messageToUser: { type: "string" },
      confidence: { type: "number" }
    },
    required: [
      "status",
      "success",
      "summary",
      "evidence",
      "repairInstruction",
      "messageToUser",
      "confidence"
    ]
  }
};

export function browserAgentJsonSchemaFor(name = "") {
  const key = String(name || "").trim().toLowerCase();

  if (
    key.includes("resultreviewer") ||
    key.includes("result_reviewer") ||
    key.includes("resultchecker") ||
    key.includes("result_checker") ||
    key.includes("watcher") ||
    key.includes("gemma_result_checker")
  ) {
    return JSON.parse(JSON.stringify(browserAgentJsonSchemas.watcher));
  }

  return null;
}
