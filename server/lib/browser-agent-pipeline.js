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

function redactValue(value, path = []) {
  if (Array.isArray(value)) return value.map((entry, index) => redactValue(entry, [...path, String(index)]));
  if (!value || typeof value !== "object") {
    const keyPath = path.join(".");
    if (typeof value === "string" && /\b(password|pass|pwd|otp|code|pin|secret|token)\b/i.test(keyPath)) {
      return "[redacted]";
    }
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (typeof entry === "string" && /\b(password|pass|pwd|otp|code|pin|secret|token)\b/i.test(key)) {
      return [key, "[redacted]"];
    }
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
    pendingInstruction: state.pendingInstruction || "",
    pendingAction: redactValue(state.pendingAction || null),
    lastCommand: redactValue(state.lastCommand || null),
    lastObservation: observation
      ? {
          url: observation.url || "",
          title: observation.title || "",
          textPreview: safeText(observation.textPreview || observation.text || "", 1600),
          buttons: Array.isArray(observation.buttons) ? observation.buttons.slice(0, 20) : [],
          links: Array.isArray(observation.links) ? observation.links.slice(0, 20) : [],
          inputs: Array.isArray(observation.inputs) ? observation.inputs.slice(0, 20) : [],
          forms: Array.isArray(observation.forms) ? observation.forms.slice(0, 6) : [],
          interactiveElements: Array.isArray(observation.interactiveElements)
            ? observation.interactiveElements.slice(0, 40)
            : [],
        }
      : null,
  };
}

function plannerContext(args = {}, state = {}) {
  return {
    userInstruction: safeText(args.instruction || "", 3000),
    currentUrl: args.currentUrl || state.currentUrl || state.lastValidObservation?.url || "",
    currentTitle: args.currentTitle || state.currentTitle || state.lastValidObservation?.title || "",
    currentState: compactState(state),
    schemas: browserPipelineSchemaSummary(),
    architecture: {
      version: "multi_agent_browser_pipeline_v1",
      mainChatModelIsNotBrowserAgent: true,
      plannerRole: "turn user browser request into proposed browser task",
      reviewerRole: "check, repair, reject, or send feedback to planner",
      executorRole: "dry-run only in Step 2",
      resultReviewerRole: "normalize executor output",
      mainHandoffRole: "format final user-facing message",
    },
  };
}

function reviewerSystemPrompt() {
  return `You are the Browser Command Reviewer Agent.

You are not the user-facing chat model.
You are not the browser executor.
You review the Browser Planner Agent output.

Return ONLY strict JSON. Do not use markdown.

Your job:
- Read the user instruction, page state, and planner proposal.
- Decide whether the proposal is structurally understandable.
- If it is fixable, repair the structure.
- If it is unclear, send an understandable message back to the planner.
- Do not use hardcoded action-name lists.
- Judge from semantics and context.
- Do not execute browser actions.
- Step 2 is dry-run only, so approval means "approved as a structured proposal", not "safe to click".

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

Step 2 is DRY RUN ONLY.
You must not claim that any real browser click, fill, submit, login, approval, deletion, or state change happened.

Return ONLY strict JSON. Do not use markdown.

Your job:
- Read the approved reviewer command.
- Translate it into the browser tool sequence you would perform later.
- Report that no execution happened yet.
- Do not invent browser results.

Return exactly this JSON contract:
{
  "status": "dry_run",
  "executed": false,
  "wouldExecute": "short description",
  "toolPlan": [
    { "tool": "browserObserve|browserNavigate|browserClickByText|browserFillFields|browserSubmitForm|browserFillAndSubmit|browserScrape", "args": {}, "purpose": "" }
  ],
  "result": "no browser action executed in Step 2",
  "messageToResultReviewer": "what the result reviewer should verify"
}`;
}

function resultReviewerSystemPrompt() {
  return `You are the Browser Result Reviewer Agent.

You review executor output.
Step 2 is dry-run only, so no real browser action should have happened.

Return ONLY strict JSON. Do not use markdown.

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
You must not claim real browser execution happened when the pipeline says dry_run or executed=false.

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
    return {
      ok: true,
      call: await fn(),
    };
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

  const context = plannerContext(args, state);

  const plannerResult = await safeRoleCall("planner", () => callBrowserAgentPlanner(context));
  const planner = normalizePlannerProposal(
    plannerResult.call?.plan,
    plannerResult.error || "Planner failed.",
  );

  const reviewerResult = await safeRoleCall("reviewer", () => callBrowserAgentReviewer({
    instruction,
    currentState: redactValue(compactState(state)),
    planner,
    schemas: browserPipelineSchemaSummary(),
  }, reviewerSystemPrompt()));

  let reviewer = normalizeReviewerDecision(
    reviewerResult.call?.data,
    reviewerResult.error || "Reviewer failed.",
  );

  let revision = null;
  if (reviewer.status === "rejected" && reviewer.messageToPlanner) {
    const revisionPlannerResult = await safeRoleCall("planner_revision", () => callBrowserAgentPlanner({
      ...context,
      reviewerFeedback: reviewer,
    }));

    const revisedPlanner = normalizePlannerProposal(
      revisionPlannerResult.call?.plan,
      revisionPlannerResult.error || "Planner revision failed.",
    );

    const revisionReviewerResult = await safeRoleCall("reviewer_revision", () => callBrowserAgentReviewer({
      instruction,
      currentState: redactValue(compactState(state)),
      planner: revisedPlanner,
      previousReviewerFeedback: reviewer,
      schemas: browserPipelineSchemaSummary(),
    }, reviewerSystemPrompt()));

    const revisedReviewer = normalizeReviewerDecision(
      revisionReviewerResult.call?.data,
      revisionReviewerResult.error || "Reviewer revision failed.",
    );

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
  let resultReviewer = null;
  let resultReviewerResult = null;

  if (approved) {
    executorResult = await safeRoleCall("executor", () => callBrowserAgentExecutor({
      instruction,
      currentState: redactValue(compactState(state)),
      reviewer,
      approvedCommand: reviewer.approvedCommand,
      dryRun: true,
      schemas: browserPipelineSchemaSummary(),
    }, executorSystemPrompt()));

    executor = normalizeExecutorDryRun(
      executorResult.call?.data,
      executorResult.error || "Executor failed.",
    );

    resultReviewerResult = await safeRoleCall("result_reviewer", () => callBrowserAgentResultReviewer({
      instruction,
      currentState: redactValue(compactState(state)),
      reviewer,
      executor,
      schemas: browserPipelineSchemaSummary(),
    }, resultReviewerSystemPrompt()));

    resultReviewer = normalizeResultReview(
      resultReviewerResult.call?.data,
      resultReviewerResult.error || "Result reviewer failed.",
    );
  }

  const pipeline = {
    architecture: "multi_agent_browser_pipeline_v1",
    step: 2,
    dryRun: true,
    runtime,
    schemas: browserPipelineSchemaSummary(),
    planner,
    reviewer,
    revision,
    executor,
    resultReviewer,
    calls: {
      planner: { ok: plannerResult.ok, error: plannerResult.error || "", usage: usageFromRoleCall(plannerResult) },
      reviewer: { ok: reviewerResult.ok, error: reviewerResult.error || "", usage: usageFromRoleCall(reviewerResult) },
      executor: executorResult ? { ok: executorResult.ok, error: executorResult.error || "", usage: usageFromRoleCall(executorResult) } : null,
      resultReviewer: resultReviewerResult ? { ok: resultReviewerResult.ok, error: resultReviewerResult.error || "", usage: usageFromRoleCall(resultReviewerResult) } : null,
    },
  };

  const mainResult = await safeRoleCall("main_handoff", () => callBrowserAgentMainHandoff({
    instruction,
    pipeline: redactValue(pipeline),
    schemas: browserPipelineSchemaSummary(),
  }, mainHandoffSystemPrompt()));

  const main = normalizeMainHandoff(
    mainResult.call?.data,
    resultReviewer?.messageToMain || reviewer.messageToMain || "Browser pipeline dry-run completed.",
  );

  const timing = {
    totalMs: roundMs(nowMs() - startedAt),
    pipelineMs: roundMs(nowMs() - startedAt),
    mainModelMs: 0,
  };

  return {
    ok: approved,
    status: approved ? "pipeline_dry_run" : "needs_user",
    instruction,
    currentUrl: state.currentUrl || state.lastValidObservation?.url || "",
    currentTitle: state.currentTitle || state.lastValidObservation?.title || "",
    summary: main.summary,
    requiresUser: main.needsUser === true || !approved,
    blockedReason: approved ? "execution_not_connected_step2" : "browser_command_not_approved",
    nextSafeAction: main.nextSafeAction,
    steps: [
      {
        type: "agent_pipeline",
        tool: "browserAgentPipeline",
        ok: approved,
        resultPreview: safePlanPreview({
          step: 2,
          planner: planner.status,
          reviewer: reviewer.status,
          approved,
          executor: executor?.status || "not_run",
          resultReviewer: resultReviewer?.status || "not_run",
        }),
      },
    ],
    pipeline,
    runtime,
    runtimeTiming: timing,
    tokenUsage: emptyBrowserAgentTokenUsage(),
  };
}
