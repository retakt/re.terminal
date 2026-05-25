import { callBrowserAgentRoleJson } from "../browser-llm-runtime.js";
import { safeText } from "./shared.js";
import { reporterSystemPrompt } from "./prompts/roles.js";

function normalizeReport(data = {}) {
  return {
    success: Boolean(data.success),
    summary: safeText(data.summary || "", 1200),
    facts: Array.isArray(data.facts) ? data.facts.map((fact) => safeText(fact, 400)).filter(Boolean) : [],
    nextSafeAction: safeText(data.nextSafeAction || "", 900),
    reason: safeText(data.reason || "", 900),
    confidence: Math.max(0, Math.min(Number(data.confidence ?? 0.7) || 0, 1)),
  };
}

export async function reportBrowserResult({
  route = "",
  step = {},
  command = {},
  result = {},
  observation = {},
  verification = null,
  extraction = null,
  images = [],
  resultImages = [],
  beforeSnapshot = null,
  afterSnapshot = null,
  snapshotDelta = null,
  currentState = {},
} = {}) {
  const modelImages = [
    ...(Array.isArray(images) ? images : []),
    ...(Array.isArray(resultImages) ? resultImages : []),
  ].filter(Boolean);

  const response = await callBrowserAgentRoleJson("reporter", {
    system: reporterSystemPrompt(),
    context: {
      route,
      step,
      command,
      result,
      observation,
      verification,
      extraction,
      beforeSnapshot,
      afterSnapshot,
      snapshotDelta,
      currentState,
    },
    schemaName: "browser_agent_reporter",
    images: modelImages,
    route,
  });

  const report = normalizeReport(response.data || {});

  return {
    ok: Boolean(report.summary),
    report,
    usage: response.usage,
    rawContent: response.rawContent,
  };
}
