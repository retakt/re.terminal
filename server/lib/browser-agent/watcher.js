import { callBrowserAgentRoleJson } from "../browser-llm-runtime.js";
import { safeText } from "./shared.js";
import { watcherSystemPrompt } from "./prompts/roles.js";

function normalizeWatch(data = {}) {
  const passed = String(data.status || "").toLowerCase() === "passed" || data.success === true;
  return {
    status: passed ? "passed" : "failed",
    success: passed,
    summary: safeText(data.summary || "", 1200),
    evidence: safeText(data.evidence || "", 1200),
    reason: safeText(data.reason || "", 900),
    nextSafeAction: safeText(data.nextSafeAction || "", 900),
    confidence: Math.max(0, Math.min(Number(data.confidence ?? (passed ? 0.8 : 0.6)) || 0, 1)),
  };
}

export async function watchBrowserResult({
  route = "",
  step = {},
  command = {},
  result = {},
  beforeObservation = null,
  afterObservation = null,
  beforeSnapshot = null,
  afterSnapshot = null,
  snapshotDelta = null,
  images = [],
  resultImages = [],
  currentState = {},
} = {}) {
  const modelImages = [
    ...(Array.isArray(images) ? images : []),
    ...(Array.isArray(resultImages) ? resultImages : []),
  ].filter(Boolean);

  let response;
  try {
    response = await callBrowserAgentRoleJson("resultReviewer", {
      system: watcherSystemPrompt(),
      context: {
        route,
        step,
        command,
        result,
        beforeObservation,
        afterObservation,
        beforeSnapshot,
        afterSnapshot,
        snapshotDelta,
        currentState,
      },
      schemaName: "browser_agent_watcher",
      images: modelImages,
      route,
    });
  } catch (error) {
    if (error?.code !== "BROWSER_AGENT_LLM_INVALID_JSON") throw error;
    const success = result?.ok !== false;
    return {
      ok: true,
      watch: {
        status: success ? "passed" : "failed",
        success,
        summary: success ? "The browser command completed and produced route-owned evidence." : safeText(result?.error || "The browser command failed.", 900),
        evidence: safeText(snapshotDelta?.summary || result?.summary || result?.error || "", 1200),
        reason: "Watcher LLM returned invalid JSON twice, so route-owned executor evidence was used.",
        nextSafeAction: success ? "Continue with the next step." : safeText(result?.error || "Inspect the browser result before retrying.", 900),
        confidence: success ? 0.72 : 0.55,
      },
      usage: error.usage || null,
      rawContent: error.contentPreview || "",
    };
  }

  const watch = normalizeWatch(response.data || {});

  return {
    ok: true,
    watch,
    usage: response.usage,
    rawContent: response.rawContent,
  };
}
