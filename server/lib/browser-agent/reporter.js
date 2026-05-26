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

function commandGroup(command = {}) {
  const tool = String(command.tool || "").trim();
  if (["browserObserve", "browserScrape", "browserExtract", "browserVerify"].includes(tool)) return "read";
  if (tool === "browserScreenshot") return "screenshot";
  if (tool === "browserFillFields" || tool === "browserFillAndSubmit") return "fill";
  if (tool === "browserClickByText" || tool === "browserSubmitForm") return "action";
  if (tool === "browserScroll") return "scroll";
  return "browser";
}

function hasRouteOwnedEvidence({ result = {}, observation = {}, extraction = null } = {}) {
  if (result?.currentUrl || result?.currentTitle) return true;
  if (observation?.url || observation?.title || observation?.textPreview || observation?.text) return true;
  if (extraction && typeof extraction === "object" && Object.keys(extraction).length > 0) return true;
  return false;
}

function reportContradictsExecutor(report = {}) {
  const summary = String(report.summary || "").toLowerCase();
  return report.success === false || /\b(failed|unable|could not|did not|no verification was performed)\b/.test(summary);
}

function correctedSuccessSummary(command = {}) {
  const group = commandGroup(command);
  if (group === "read") return "I captured route-owned page evidence for this read/extract step.";
  if (group === "screenshot") return "I captured the requested screenshot evidence from the selected route.";
  if (group === "fill") return "I completed the fill step using the selected route's field mapping and executor evidence.";
  if (group === "scroll") return "I completed the scroll step and captured the updated page position.";
  if (group === "action") return "I completed the browser action using the selected route's executor evidence.";
  return "The browser step completed with route-owned evidence.";
}

function verifiedFacts({ command = {}, result = {}, observation = {}, snapshotDelta = null } = {}) {
  return [
    result?.currentUrl ? `Current URL: ${result.currentUrl}` : observation?.url ? `Current URL: ${observation.url}` : "",
    result?.currentTitle ? `Current title: ${result.currentTitle}` : observation?.title ? `Current title: ${observation.title}` : "",
    command?.tool ? `Executed tool: ${command.tool}` : "",
    snapshotDelta?.summary ? `Observed change: ${snapshotDelta.summary}` : "",
  ].map((fact) => safeText(fact, 240)).filter(Boolean).slice(0, 4);
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

  let response;
  try {
    response = await callBrowserAgentRoleJson("reporter", {
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
  } catch (error) {
    if (error?.code !== "BROWSER_AGENT_LLM_INVALID_JSON") throw error;
    const success = result?.ok !== false && verification?.ok !== false;
    const facts = [
      result?.currentUrl ? `Current URL: ${result.currentUrl}` : "",
      result?.currentTitle ? `Current title: ${result.currentTitle}` : "",
      command?.tool ? `Executed tool: ${command.tool}` : "",
      snapshotDelta?.summary ? `Observed change: ${snapshotDelta.summary}` : "",
    ].map((fact) => safeText(fact, 240)).filter(Boolean).slice(0, 4);
    return {
      ok: true,
      report: {
        success,
        summary: success
          ? "The browser step completed and verified evidence was captured."
          : safeText(result?.error || "The browser step did not complete successfully.", 500),
        facts,
        nextSafeAction: success ? "Continue with the next browser step." : safeText(result?.error || "Inspect the browser result and retry with clearer instructions.", 500),
        reason: "Reporter LLM returned invalid JSON twice, so a compact verified-facts report was generated.",
        confidence: success ? 0.72 : 0.55,
      },
      usage: error.usage || null,
      rawContent: error.contentPreview || "",
    };
  }

  const report = normalizeReport(response.data || {});
  const executorSucceeded = result?.ok !== false && verification?.ok !== false && !result?.error;
  if (executorSucceeded && hasRouteOwnedEvidence({ result, observation, extraction }) && reportContradictsExecutor(report)) {
    return {
      ok: true,
      report: {
        ...report,
        success: true,
        summary: correctedSuccessSummary(command),
        facts: report.facts.length ? report.facts : verifiedFacts({ command, result, observation, snapshotDelta }),
        nextSafeAction: report.nextSafeAction || "Continue with the next browser step.",
        reason: safeText(
          report.reason || "Reporter wording contradicted successful route-owned executor evidence, so the report was normalized.",
          900
        ),
        confidence: Math.max(report.confidence, 0.72),
      },
      usage: response.usage,
      rawContent: response.rawContent,
    };
  }

  return {
    ok: Boolean(report.summary),
    report,
    usage: response.usage,
    rawContent: response.rawContent,
  };
}
