import {
  browserAgentRuntimeConfig,
  callBrowserAgentPlanner,
  callBrowserAgentReviewer,
  callBrowserAgentExecutor,
  callBrowserAgentResultReviewer,
  callBrowserAgentMainHandoff,
  emptyBrowserAgentTokenUsage,
} from "./browser-llm-runtime.js";
import {
  capturePlaywrightMcpSnapshot,
  compactSnapshotForModel,
  executePlaywrightMcpBrowserCommand,
  snapshotImagesForModel,
} from "./browser-playwright-mcp-bridge.js";
import {
  browserPipelineSchemaSummary,
  normalizePlannerProposal,
  normalizeReviewerDecision,
  normalizeExecutorDryRun,
  normalizeResultReview,
  normalizeMainHandoff,
} from "./browser-agent-schemas.js";

function safeText(value = "", limit = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function nowMs() {
  return performance.now();
}

function roundMs(value = 0) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function redactValue(value, path = []) {
  if (Array.isArray(value)) return value.map((entry, index) => redactValue(entry, [...path, String(index)]));
  if (!value || typeof value !== "object") {
    const keyPath = path.join(".");
    if (typeof value === "string" && /\b(password|pass|pwd|otp|code|pin|secret|token)\b/i.test(keyPath)) return "[redacted]";
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (typeof entry === "string" && /\b(password|pass|pwd|otp|code|pin|secret|token)\b/i.test(key)) return [key, "[redacted]"];
    return [key, redactValue(entry, [...path, key])];
  }));
}

function compactState(state = {}) {
  const observation = state.lastValidObservation || state.lastObservation || null;
  return {
    sessionId: state.sessionId || "",
    currentUrl: state.currentUrl || observation?.url || "",
    currentTitle: state.currentTitle || observation?.title || "",
    activeEngine: state.activeEngine || "",
    lastObservation: observation
      ? {
          url: observation.url || "",
          title: observation.title || "",
          textPreview: safeText(observation.textPreview || observation.text || "", 1600),
          buttons: Array.isArray(observation.buttons) ? observation.buttons.slice(0, 20) : [],
          links: Array.isArray(observation.links) ? observation.links.slice(0, 20) : [],
          inputs: Array.isArray(observation.inputs) ? observation.inputs.slice(0, 20) : [],
          forms: Array.isArray(observation.forms) ? observation.forms.slice(0, 6) : [],
          interactiveElements: Array.isArray(observation.interactiveElements) ? observation.interactiveElements.slice(0, 40) : [],
        }
      : null,
  };
}

function plannerContext(args = {}, state = {}, visual = null) {
  return {
    userInstruction: safeText(args.instruction || "", 3000),
    currentUrl: args.currentUrl || state.currentUrl || state.lastValidObservation?.url || "",
    currentTitle: args.currentTitle || state.currentTitle || state.lastValidObservation?.title || "",
    currentState: compactState(state),
    visualSnapshot: visual ? compactSnapshotForModel(visual.snapshot) : null,
    schemas: browserPipelineSchemaSummary(),
    architecture: {
      version: "multi_agent_browser_pipeline_v3_playwright_mcp_multimodal",
      mainChatModelIsNotBrowserAgent: true,
      browserSubstrate: "playwright_mcp",
      reviewerUsesSnapshotImage: true,
      resultReviewerUsesBeforeAfterImages: true,
      note: "Use Playwright MCP snapshot refs when choosing click/type targets.",
    },
  };
}

function reviewerSystemPrompt() {
  return `You are the Browser Command Reviewer Agent.

You are multimodal. Use the attached Playwright MCP screenshot plus the Playwright snapshot text.
You are not the user-facing chat model.
You are not the browser executor.

Return ONLY strict JSON. Do not use markdown.

Your job:
- Crosscheck user instruction, Playwright snapshot text, screenshot, and planner proposal.
- If Playwright snapshot includes refs, preserve the correct ref in approvedCommand.args.ref.
- If the planner picked the wrong target based on the screenshot or snapshot refs, repair it.
- Do not use hardcoded action-name lists.
- Approval means the Playwright MCP controller may execute the approved browser command.

Return exactly this JSON contract:
{
  "status": "approved|repaired|rejected|needs_user",
  "approved": true,
  "messageToPlanner": "understandable feedback to the planner agent",
  "messageToExecutor": "clear instruction for the executor agent",
  "approvedCommand": {
    "intent": "navigate|observe|click_or_open|fill_form|submit_form|fill_and_submit|scrape|show_actions|reset|status|unknown",
    "tool": "browserNavigate|browserObserve|browserClickByText|browserFillFields|browserSubmitForm|browserFillAndSubmit|browserScrape|browserShowActions|browserReset|browserStatus|unknown",
    "args": {},
    "notes": ""
  },
  "messageToMain": "what the normal chat model should tell the user",
  "reason": "",
  "confidence": 0.0
}`;
}

function executorSystemPrompt() {
  return `You are the Browser Executor Agent.

You receive reviewer-approved browser commands.
Use the screenshot and Playwright snapshot refs as confirmation before controller execution.

Return ONLY strict JSON. Do not use markdown.

Return exactly this JSON contract:
{
  "status": "dry_run",
  "executed": false,
  "wouldExecute": "short description",
  "toolPlan": [
    { "tool": "browserObserve|browserNavigate|browserClickByText|browserFillFields|browserSubmitForm|browserFillAndSubmit|browserScrape", "args": {}, "purpose": "" }
  ],
  "result": "waiting for Playwright MCP controller execution",
  "messageToResultReviewer": "what the result reviewer should verify"
}`;
}

function resultReviewerSystemPrompt() {
  return `You are the Browser Result Reviewer Agent.

You are multimodal. You receive Playwright MCP before/after screenshots and snapshot text.
Return ONLY strict JSON. Do not use markdown.

Your job:
- Compare before screenshot, after screenshot, snapshot text, user instruction, reviewer command, executor plan, and Playwright MCP result.
- Confirm whether the visible result matches the approved command.
- If the after screenshot does not prove success, say so.
- Do not claim success if Playwright MCP failed or the visual evidence does not support it.

Return exactly this JSON contract:
{
  "status": "normalized|failed",
  "success": false,
  "normalizedResult": "clear result",
  "messageToPlanner": "message for the planner agent",
  "messageToMain": "message for the normal chat model",
  "reason": ""
}`;
}

function mainHandoffSystemPrompt() {
  return `You are the Main Chat Handoff Agent.

You represent the normal user-facing chat model.
You are not a browser executor.

Return ONLY strict JSON. Do not use markdown.

Return exactly this JSON contract:
{
  "summary": "compact user-facing response",
  "nextSafeAction": "what should happen next",
  "needsUser": false
}`;
}

function safePlanPreview(value = {}) {
  try {
    return JSON.stringify(value, null, 2).slice(0, 1200);
  } catch {
    return String(value || "").slice(0, 1200);
  }
}

async function safeRoleCall(label, fn) {
  try {
    return { ok: true, call: await fn() };
  } catch (err) {
    return {
      ok: false,
      call: null,
      error: err.message || String(err),
      usage: err.usage || null,
      contentPreview: err.contentPreview || "",
      label,
    };
  }
}

function usageFromRoleCall(roleCall) {
  return roleCall?.call?.usage || roleCall?.usage || null;
}

function combinePipelineTokenUsage(calls = {}) {
  const stages = {
    planner: usageFromRoleCall(calls.plannerResult),
    reviewer: usageFromRoleCall(calls.reviewerResult),
    executor: usageFromRoleCall(calls.executorResult),
    resultReviewer: usageFromRoleCall(calls.resultReviewerResult),
    mainHandoff: usageFromRoleCall(calls.mainResult),
  };

  const totalTokens = Object.values(stages)
    .reduce((sum, usage) => sum + Number(usage?.totalTokens || 0), 0);

  return {
    totalTokens,
    planner: stages.planner,
    reporter: stages.mainHandoff || stages.resultReviewer,
    reviewer: stages.reviewer,
    executor: stages.executor,
    resultReviewer: stages.resultReviewer,
    mainHandoff: stages.mainHandoff,
  };
}

function syntheticExecutorFromReviewer(reviewer = {}) {
  const command = reviewer.approvedCommand || {};
  return {
    status: "controller_prepared",
    executed: false,
    wouldExecute: command.tool ? `Controller will execute ${command.tool} through Playwright MCP.` : "Controller will execute the reviewer-approved command.",
    toolPlan: [
      {
        tool: command.tool || "unknown",
        args: command.args || {},
        purpose: reviewer.messageToExecutor || "Execute reviewer-approved browser command.",
      },
    ],
    result: "waiting for Playwright MCP controller execution",
    messageToResultReviewer: "Verify the actual Playwright MCP result against the approved command and screenshots.",
  };
}

function syntheticMainHandoff({ resultReviewer = null, reviewer = null, browserExecution = null, approved = false } = {}) {
  const fallback = resultReviewer?.messageToMain ||
    reviewer?.messageToMain ||
    browserExecution?.error ||
    browserExecution?.actionResult?.text ||
    "Browser pipeline completed.";

  return normalizeMainHandoff({
    summary: fallback,
    nextSafeAction: approved
      ? "Continue with the next browser instruction."
      : reviewer?.messageToPlanner || "Clarify the browser instruction.",
    needsUser: !approved,
  }, fallback);
}

function browserObservationControls(observation = null) {
  if (!observation || typeof observation !== "object") {
    return { forms: 0, inputs: [], buttons: [], links: [] };
  }

  return {
    forms: Array.isArray(observation.forms) ? observation.forms.length : Number(observation.stats?.forms || 0),
    inputs: Array.isArray(observation.inputs) ? observation.inputs.slice(0, 20) : [],
    buttons: Array.isArray(observation.buttons) ? observation.buttons.slice(0, 30) : [],
    links: Array.isArray(observation.links) ? observation.links.slice(0, 30) : [],
  };
}

function browserWhatFound(observation = null) {
  if (!observation || typeof observation !== "object") return null;
  return {
    ok: Boolean(observation.ok),
    url: observation.url || "",
    title: observation.title || "",
    textPreview: safeText(observation.textPreview || observation.text || "", 1800),
    engine: observation.engine || "playwright_mcp",
  };
}

async function safeCaptureBeforeSnapshot(args, state) {
  try {
    return await capturePlaywrightMcpSnapshot({ ...args, label: "review_before" }, state);
  } catch (err) {
    return {
      ok: false,
      status: "snapshot_failed",
      error: err instanceof Error ? err.message : String(err),
      snapshot: null,
      observation: null,
    };
  }
}

export async function runBrowserAgentPipeline(args = {}) {
  const startedAt = nowMs();
  const instruction = String(args.instruction || "").trim();
  const state = args.state || {};
  const runtime = browserAgentRuntimeConfig({ display: true });

  if (!instruction) {
    return {
      ok: false,
      status: "needs_user",
      instruction,
      summary: "Browser instruction is empty.",
      requiresUser: true,
      blockedReason: "empty_instruction",
      nextSafeAction: "Tell me what browser task you want.",
      runtime,
      tokenUsage: emptyBrowserAgentTokenUsage(),
      runtimeTiming: { totalMs: roundMs(nowMs() - startedAt), pipelineMs: roundMs(nowMs() - startedAt), mainModelMs: 0 },
    };
  }

  const beforeReviewSnapshot = await safeCaptureBeforeSnapshot(args, state);
  const beforeImages = snapshotImagesForModel(beforeReviewSnapshot?.snapshot);
  const context = plannerContext(args, state, beforeReviewSnapshot);

  const plannerResult = await safeRoleCall("planner", () => callBrowserAgentPlanner(context, { images: beforeImages }));
  const planner = normalizePlannerProposal(plannerResult.call?.plan, plannerResult.error || "Planner failed.");

  const reviewerResult = await safeRoleCall("reviewer", () => callBrowserAgentReviewer({
    instruction,
    currentState: redactValue(compactState(state)),
    visualSnapshot: compactSnapshotForModel(beforeReviewSnapshot?.snapshot),
    planner,
    schemas: browserPipelineSchemaSummary(),
  }, reviewerSystemPrompt(), { images: beforeImages }));

  let reviewer = normalizeReviewerDecision(reviewerResult.call?.data, reviewerResult.error || "Reviewer failed.");

  let revision = null;
  if (reviewer.status === "rejected" && reviewer.messageToPlanner) {
    const revisionPlannerResult = await safeRoleCall("planner_revision", () => callBrowserAgentPlanner({
      ...context,
      reviewerFeedback: reviewer,
    }, { images: beforeImages }));

    const revisedPlanner = normalizePlannerProposal(revisionPlannerResult.call?.plan, revisionPlannerResult.error || "Planner revision failed.");

    const revisionReviewerResult = await safeRoleCall("reviewer_revision", () => callBrowserAgentReviewer({
      instruction,
      currentState: redactValue(compactState(state)),
      visualSnapshot: compactSnapshotForModel(beforeReviewSnapshot?.snapshot),
      planner: revisedPlanner,
      previousReviewerFeedback: reviewer,
      schemas: browserPipelineSchemaSummary(),
    }, reviewerSystemPrompt(), { images: beforeImages }));

    const revisedReviewer = normalizeReviewerDecision(revisionReviewerResult.call?.data, revisionReviewerResult.error || "Reviewer revision failed.");

    revision = {
      planner: revisedPlanner,
      reviewer: revisedReviewer,
      calls: {
        planner: { ok: revisionPlannerResult.ok, error: revisionPlannerResult.error || "", usage: usageFromRoleCall(revisionPlannerResult) },
        reviewer: { ok: revisionReviewerResult.ok, error: revisionReviewerResult.error || "", usage: usageFromRoleCall(revisionReviewerResult) },
      },
    };

    reviewer = revisedReviewer;
  }

  const approved = reviewer.approved === true;

  let executor = null;
  let executorResult = null;
  let browserExecution = null;
  let resultReviewer = null;
  let resultReviewerResult = null;

  if (approved) {
    if (envFlag("BROWSER_AGENT_EXECUTOR_LLM_ENABLED", false)) {
      executorResult = await safeRoleCall("executor", () => callBrowserAgentExecutor({
        instruction,
        currentState: redactValue(compactState(state)),
        visualSnapshot: compactSnapshotForModel(beforeReviewSnapshot?.snapshot),
        reviewer,
        approvedCommand: reviewer.approvedCommand,
        schemas: browserPipelineSchemaSummary(),
      }, executorSystemPrompt(), { images: beforeImages }));

      executor = normalizeExecutorDryRun(executorResult.call?.data, executorResult.error || "Executor failed.");
    } else {
      executor = syntheticExecutorFromReviewer(reviewer);
    }

    browserExecution = await executePlaywrightMcpBrowserCommand({
      command: reviewer.approvedCommand,
      args,
      state,
      beforeSnapshot: beforeReviewSnapshot?.snapshot || null,
    });

    const resultImages = snapshotImagesForModel(
      browserExecution?.beforeSnapshot || beforeReviewSnapshot?.snapshot,
      browserExecution?.afterSnapshot,
    );

    resultReviewerResult = await safeRoleCall("result_reviewer", () => callBrowserAgentResultReviewer({
      instruction,
      currentState: redactValue(compactState(state)),
      reviewer,
      executor,
      beforeSnapshot: compactSnapshotForModel(browserExecution?.beforeSnapshot || beforeReviewSnapshot?.snapshot),
      afterSnapshot: compactSnapshotForModel(browserExecution?.afterSnapshot),
      browserExecution: redactValue({
        ...browserExecution,
        beforeSnapshot: undefined,
        afterSnapshot: undefined,
      }),
      schemas: browserPipelineSchemaSummary(),
    }, resultReviewerSystemPrompt(), { images: resultImages }));

    resultReviewer = normalizeResultReview(resultReviewerResult.call?.data, resultReviewerResult.error || "Result reviewer failed.");
  }

  const pipeline = {
    architecture: "multi_agent_browser_pipeline_v3_playwright_mcp_multimodal",
    step: 3,
    dryRun: false,
    runtime,
    schemas: browserPipelineSchemaSummary(),
    visualCrosscheck: {
      substrate: "playwright_mcp",
      reviewerImageCount: beforeImages.length,
      resultReviewerImageCount: browserExecution
        ? snapshotImagesForModel(browserExecution.beforeSnapshot, browserExecution.afterSnapshot).length
        : 0,
      beforeReviewSnapshot: compactSnapshotForModel(beforeReviewSnapshot?.snapshot),
    },
    planner,
    reviewer,
    revision,
    executor,
    browserExecution: browserExecution
      ? {
          ok: browserExecution.ok,
          status: browserExecution.status,
          executed: browserExecution.ok === true,
          tool: browserExecution.tool || "",
          engine: browserExecution.engine || "playwright_mcp",
          summary: browserExecution.error || browserExecution.actionResult?.text || browserExecution.actionResult?.tool || "",
          observation: browserExecution.observation || null,
          beforeSnapshot: compactSnapshotForModel(browserExecution.beforeSnapshot),
          afterSnapshot: compactSnapshotForModel(browserExecution.afterSnapshot),
        }
      : null,
    resultReviewer,
    calls: {
      planner: { ok: plannerResult.ok, error: plannerResult.error || "", usage: usageFromRoleCall(plannerResult) },
      reviewer: { ok: reviewerResult.ok, error: reviewerResult.error || "", usage: usageFromRoleCall(reviewerResult) },
      executor: executorResult ? { ok: executorResult.ok, error: executorResult.error || "", usage: usageFromRoleCall(executorResult) } : null,
      resultReviewer: resultReviewerResult ? { ok: resultReviewerResult.ok, error: resultReviewerResult.error || "", usage: usageFromRoleCall(resultReviewerResult) } : null,
    },
  };

  let mainResult = null;
  let main = null;

  if (envFlag("BROWSER_AGENT_MAIN_HANDOFF_ENABLED", false)) {
    mainResult = await safeRoleCall("main_handoff", () => callBrowserAgentMainHandoff({
      instruction,
      pipeline: redactValue(pipeline),
      schemas: browserPipelineSchemaSummary(),
    }, mainHandoffSystemPrompt()));

    main = normalizeMainHandoff(
      mainResult.call?.data,
      resultReviewer?.messageToMain || reviewer.messageToMain || browserExecution?.error || "Browser pipeline completed.",
    );
  } else {
    main = syntheticMainHandoff({ resultReviewer, reviewer, browserExecution, approved });
  }

  pipeline.calls.mainHandoff = mainResult
    ? { ok: mainResult.ok, error: mainResult.error || "", usage: usageFromRoleCall(mainResult) }
    : null;

  const timing = {
    totalMs: roundMs(nowMs() - startedAt),
    pipelineMs: roundMs(nowMs() - startedAt),
    mainModelMs: 0,
  };

  const executionOk = approved && browserExecution?.ok === true;
  const tokenUsage = combinePipelineTokenUsage({
    plannerResult,
    reviewerResult,
    executorResult,
    resultReviewerResult,
    mainResult,
  });

  return {
    ok: executionOk,
    status: approved
      ? browserExecution?.ok
        ? "success"
        : browserExecution?.status || "failed"
      : "needs_user",
    instruction,
    currentUrl: browserExecution?.observation?.url || state.currentUrl || state.lastValidObservation?.url || "",
    currentTitle: browserExecution?.observation?.title || state.currentTitle || state.lastValidObservation?.title || "",
    summary: main.summary,
    requiresUser: main.needsUser === true || !approved || browserExecution?.status === "needs_user",
    blockedReason: approved ? browserExecution?.error || "" : "browser_command_not_approved",
    nextSafeAction: main.nextSafeAction,
    steps: [
      {
        type: "agent_pipeline",
        tool: "browserAgentPipeline",
        ok: approved && browserExecution?.ok === true,
        resultPreview: safePlanPreview({
          step: 3,
          substrate: "playwright_mcp",
          planner: planner.status,
          reviewer: reviewer.status,
          approved,
          executor: executor?.status || "not_run",
          browserExecution: browserExecution?.status || "not_run",
          resultReviewer: resultReviewer?.status || "not_run",
          images: pipeline.visualCrosscheck,
        }),
      },
    ],
    whatFound: browserWhatFound(browserExecution?.observation),
    observedControls: browserObservationControls(browserExecution?.observation),
    possibleNextActions: [],
    planner,
    reporter: {
      summary: main.summary,
      whatHappened: resultReviewer?.normalizedResult || browserExecution?.summary || "",
      success: executionOk,
      currentPage: browserExecution?.observation?.title || browserExecution?.observation?.url || "",
      nextSafeAction: main.nextSafeAction,
      failureDiagnosis: executionOk ? "" : browserExecution?.error || reviewer.reason || "",
      role: envFlag("BROWSER_AGENT_MAIN_HANDOFF_ENABLED", false) ? "main_handoff" : "synthetic_handoff",
    },
    pipeline,
    runtime,
    runtimeTiming: timing,
    tokenUsage,
  };
}
