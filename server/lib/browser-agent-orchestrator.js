import {
  browserAgentRuntimeConfig,
  callBrowserAgentRoleJson,
  emptyBrowserAgentTokenUsage,
} from "./browser-llm-runtime.js";
import {
  capturePlaywrightMcpSnapshot,
  compactSnapshotForModel,
  executePlaywrightMcpBrowserCommand,
  snapshotImagesForModel,
} from "./browser-playwright-mcp-bridge.js";

import {
  BROWSER_AGENT_ARCHITECTURE,
  runCheckerAgent,
  runFinalVerifierAgent,
  runOrchestratorAgent,
  runStepAgent,
  runWatcherAgent,
} from "./browser-agents/index.js";
import {
  buildWatcherSpyReport,
  cleanBrowserAgentTraceSummary,
  finalBrowserAgentUserSummary,
  pageSummaryFromObservation,
} from "./browser-agent-watcher-spy.js";

const SUPPORTED_TOOLS = new Set([
  "browserNavigate",
  "browserObserve",
  "browserClickByText",
  "browserFillFields",
  "browserSubmitForm",
  "browserFillAndSubmit",
  "browserScrape",
  "browserShowActions",
  "browserReset",
  "browserStatus",
]);

function safeText(value = "", limit = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function nowMs() {
  return performance.now();
}

function roundMs(value = 0) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function envInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function isReportOnlyStep(step = {}) {
  const action = String(step.expectedAction || "").toLowerCase();
  const text = String(step.instruction || "").toLowerCase();
  return action === "report" || /\b(report|tell me|summarize|final state|final url|final title)\b/.test(text);
}

function isLowRiskAutoCheckCommand(command = {}, step = {}) {
  const tool = String(command?.tool || "");
  const text = String(step?.instruction || "");
  if (/\b(submit|pay|payment|delete|remove|approve|reject|password|otp|login|sign in|checkout)\b/i.test(text)) return false;
  return ["browserNavigate", "browserObserve", "browserStatus", "browserShowActions"].includes(tool);
}

function syntheticApprovedChecker(stepPlan = {}) {
  return {
    status: "approved",
    approved: true,
    command: stepPlan.command || null,
    reason: "Low-risk browser command auto-approved to avoid redundant checker call.",
    repairInstruction: "",
    messageToUser: "",
    confidence: Number(stepPlan.confidence || 0.9),
  };
}


function strictSnapshotLineForRef(snapshot = null, ref = "") {
  const raw = String(snapshot?.text || snapshot?.dom?.rawText || snapshot?.dom?.textPreview || "");
  if (!raw || !ref) return "";
  const needle = "[ref=" + ref + "]";
  return raw.split(/\r?\n/).find((line) => String(line || "").includes(needle)) || "";
}

function strictVisibleTextFromSnapshotLine(line = "") {
  const quoted = String(line || "").match(/"([^"]+)"/);
  if (quoted?.[1]) return safeText(quoted[1], 240);
  return safeText(String(line || "").replace(/\[ref=[^\]]+\]/g, "").replace(/^[-\s]+/, ""), 240);
}

function strictSnapshotClickApproval({ command = {}, before = null } = {}) {
  const args = command.args || {};
  const ref = safeText(args.ref || args.selector || "", 180);
  const text = safeText(args.text || args.label || args.buttonText || "", 240);

  if (!ref || !text) {
    return {
      ok: false,
      reason: "Click fallback blocked: command needs both snapshot ref and visible text.",
    };
  }

  const line = strictSnapshotLineForRef(before?.snapshot || null, ref);
  if (!line) {
    return {
      ok: false,
      reason: "Click fallback blocked: ref was not found in the current snapshot.",
    };
  }

  if (!/\b(link|button|menuitem|option|checkbox|radio|tab)\b/i.test(line)) {
    return {
      ok: false,
      reason: "Click fallback blocked: ref exists but is not clearly clickable in the snapshot.",
    };
  }

  const visible = strictVisibleTextFromSnapshotLine(line);
  if (!visible || visible.toLowerCase() !== text.toLowerCase()) {
    return {
      ok: false,
      reason: "Click fallback blocked: command text does not exactly match snapshot visible text.",
      visible,
      requested: text,
    };
  }

  return {
    ok: true,
    visible,
    line: safeText(line, 500),
  };
}




function checkerFallbackAfterModelError({ checkerCall = null } = {}) {
  if (!checkerCall || checkerCall.ok !== false) return null;

  const error = String(checkerCall.error || "");
  if (!/invalid JSON|BROWSER_AGENT_LLM_INVALID_JSON/i.test(error)) return null;

  return {
    status: "blocked_checker_invalid_json",
    approved: false,
    command: null,
    reason: "Checker returned invalid JSON. Browser action blocked so the agent does not click without valid checker approval.",
    repairInstruction: "Retry the checker or ask the step agent to produce a simpler command.",
    messageToUser: "",
    confidence: 0.2,
  };
}

function syntheticPassedResult({ execution = {}, step = {}, command = {} } = {}) {
  const observation = observationFromExecution(execution);
  const where = [observation.title, observation.url].filter(Boolean).join(" — ");
  return {
    status: "passed",
    success: execution?.ok === true,
    summary: execution?.ok === true
      ? `Low-risk step passed. ${where}`.trim()
      : execution?.error || "Low-risk step failed.",
    evidence: where || execution?.actionResult?.text || "",
    repairInstruction: "",
    messageToUser: "",
    confidence: execution?.ok === true ? 0.95 : 0.4,
    command,
    step,
  };
}

function isSensitiveStep(step = {}) {
  return /\b(submit|pay|payment|delete|remove|approve|reject|password|otp|login|sign in|checkout|profile update|attendance|payroll)\b/i
    .test(String(step?.instruction || ""));
}

function snapshotTextForFastChecker(snapshot = null) {
  return String(snapshot?.text || snapshot?.dom?.rawText || snapshot?.dom?.textPreview || "");
}

function snapshotLineForRef(snapshot = null, ref = "") {
  const raw = snapshotTextForFastChecker(snapshot);
  if (!raw || !ref) return "";
  const needle = "[ref=" + ref + "]";
  return raw.split(/\r?\n/).find((line) => String(line || "").includes(needle)) || "";
}

function visibleTextFromSnapshotLine(line = "") {
  const quoted = String(line || "").match(/"([^"]+)"/);
  if (quoted?.[1]) return safeText(quoted[1], 240);
  return safeText(String(line || "").replace(/\[ref=[^\]]+\]/g, "").replace(/^[-\s]+/, ""), 240);
}

function fastSnapshotCheckerForStep({ stepPlan = {}, step = {}, before = null } = {}) {
  if (!envFlag("BROWSER_AGENT_FAST_SNAPSHOT_CHECKER", false)) return null;
  if (isSensitiveStep(step)) return null;

  const command = stepPlan?.command || null;
  if (!command || typeof command !== "object") return null;

  const tool = String(command.tool || "");
  if (tool !== "browserClickByText") return null;

  const snapshot = before?.snapshot || null;
  const raw = snapshotTextForFastChecker(snapshot);
  if (!raw.trim()) return null;

  const args = command.args || {};
  const ref = safeText(args.ref || args.selector || "", 180);
  const text = safeText(args.text || args.label || args.buttonText || "", 240);
  if (!ref && !text) return null;

  let visible = "";
  let status = "auto_approved_snapshot_crosscheck";
  let reason = "Snapshot checker confirmed the non-sensitive click target before model checker was needed.";

  if (ref) {
    const line = snapshotLineForRef(snapshot, ref);
    if (!line) return null;
    visible = visibleTextFromSnapshotLine(line);
  } else if (text && raw.toLowerCase().includes(text.toLowerCase())) {
    visible = text;
  } else {
    return null;
  }

  const nextArgs = { ...args };
  if (visible) nextArgs.text = visible;

  if (visible && text && visible.toLowerCase() !== text.toLowerCase()) {
    status = "auto_repaired_snapshot_crosscheck";
    reason = "Snapshot checker replaced the command text with the visible page text for the same target/ref.";
  }

  return {
    status,
    approved: true,
    command: {
      ...command,
      args: nextArgs,
      notes: safeText([
        command.notes,
        visible ? "Snapshot-confirmed visible target: " + visible : "",
      ].filter(Boolean).join(" "), 500),
    },
    reason,
    repairInstruction: "",
    messageToUser: "",
    confidence: Math.max(0.85, Number(stepPlan.confidence || 0.85)),
  };
}

function isSnapshotResultAutoPassCommand(command = {}, step = {}, execution = {}) {
  const tool = String(command?.tool || "");
  if (isSensitiveStep(step)) return false;
  if (execution?.ok !== true) return false;
  if (execution?.error) return false;
  if (/###\\s*Error|invalid_type|expected .* received/i.test(String(execution?.actionResult?.text || ""))) return false;

  const observation = observationFromExecution(execution);
  const hasSnapshotEvidence = Boolean(observation?.url || observation?.title || observation?.textPreview);

  if (["browserNavigate", "browserObserve", "browserStatus", "browserShowActions"].includes(tool)) {
    return hasSnapshotEvidence;
  }

  if (tool === "browserClickByText") {
    const beforeUrl = String(command?.args?.currentUrl || "");
    const afterUrl = String(observation?.url || "");
    return hasSnapshotEvidence && Boolean(afterUrl && beforeUrl && afterUrl !== beforeUrl);
  }

  return false;
}

function extractHttpUrl(text = "") {
  const raw = String(text || "");
  const match = raw.match(/https?:\/\/[^\s"'<>)}\]]+/i)?.[0] || "";
  return match.replace(/[.,;:!?]+$/g, "");
}

function syntheticStepPlanForLowRisk(step = {}, currentUrl = "", originalInstruction = "") {
  const action = String(step.expectedAction || "").toLowerCase();
  const instruction = String(step.instruction || "");

  if (action === "navigate" || /\b(open|navigate|visit|go to)\b/i.test(instruction)) {
    const url = extractHttpUrl(instruction) || extractHttpUrl(originalInstruction);
    if (url) {
      return {
        status: "ready",
        command: {
          intent: "navigate",
          tool: "browserNavigate",
          args: { url },
          notes: "Synthetic low-risk navigation command from orchestrator step.",
        },
        reason: "Navigation step can be executed directly without another model call.",
        messageToChecker: "",
        messageToUser: "",
        confidence: 1,
      };
    }
  }

  if (action === "observe" || /\b(verify|confirm|observe|inspect|check|look)\b/i.test(instruction)) {
    return {
      status: "ready",
      command: {
        intent: "observe",
        tool: "browserObserve",
        args: { currentUrl, focus: "page" },
        notes: "Synthetic low-risk observation command from orchestrator step.",
      },
      reason: "Observation step can be executed directly without another model call.",
      messageToChecker: "",
      messageToUser: "",
      confidence: 1,
    };
  }

  return null;
}

function stageLog(stage = "", data = {}) {
  if (!["1", "true", "yes", "on"].includes(String(process.env.BROWSER_AGENT_TRACE_STDOUT || "").toLowerCase())) return;
  const safe = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (typeof value === "string") safe[key] = value.slice(0, 600);
    else safe[key] = value;
  }
  console.log("[browser-orchestrator]", stage, JSON.stringify(safe));
}

function compactState(state = {}) {
  const observation = state.lastValidObservation || state.lastObservation || null;
  return {
    sessionId: state.sessionId || "",
    currentUrl: state.currentUrl || observation?.url || "",
    currentTitle: state.currentTitle || observation?.title || "",
    lastObservation: observation
      ? {
          url: observation.url || "",
          title: observation.title || "",
          textPreview: safeText(observation.textPreview || observation.text || "", 1800),
        }
      : null,
  };
}

function usageOf(callResult) {
  return callResult?.call?.usage || callResult?.usage || null;
}

function thinkingOf(callResult) {
  return safeText(callResult?.call?.thinking || "", 1200);
}

function traceValueSummary(value = "") {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => traceValueSummary(item)).filter(Boolean).join(" | ");

  if (typeof value === "object") {
    const command = value.command || value.approvedCommand || null;
    const args = command?.args || value.args || {};

    const direct = [
      value.summary,
      value.reason,
      value.messageToChecker,
      value.messageToUser,
      value.evidence,
      value.repairInstruction,
      value.notes,
      command?.notes,
    ].find((item) => typeof item === "string" && item.trim());

    if (direct) return direct;

    if (command?.tool) {
      const target = args.text || args.label || args.buttonText || args.url || args.currentUrl || "";
      const ref = args.ref ? " ref=" + args.ref : "";
      return [command.tool, target ? "target=" + target : "", ref].filter(Boolean).join(" ");
    }

    if (value.url || value.title) {
      return [value.title, value.url].filter(Boolean).join(" — ");
    }

    try {
      return safeText(JSON.stringify(value), 700);
    } catch {
      return "";
    }
  }

  return String(value || "");
}

function checkerDecisionForExecution(checker = {}, checkerCall = null) {
  if (checkerCall && checkerCall.ok === false) {
    return { ok: false, reason: checkerCall.error || "Checker model call failed." };
  }

  const status = String(checker?.status || "").toLowerCase();
  const hasCommand = Boolean(checker?.command && typeof checker.command === "object" && checker.command.tool);

  if (status === "rejected" || status === "needs_user") {
    return { ok: false, reason: checker.reason || checker.messageToUser || "Step was not approved." };
  }

  if (status === "repaired") {
    return hasCommand
      ? { ok: true, repaired: true, reason: checker.reason || checker.repairInstruction || "" }
      : { ok: false, reason: checker.reason || "Checker said repaired but returned no command." };
  }

  if (checker?.approved === false) {
    return { ok: false, reason: checker.reason || checker.messageToUser || "Step was not approved." };
  }

  return { ok: true, repaired: false, reason: checker.reason || "" };
}

function traceEntry({
  role = "",
  title = "",
  model = "",
  status = "",
  step = null,
  input = "",
  output = "",
  summary = "",
  tool = "",
  ok = null,
  usage = null,
  reasoning = "",
} = {}) {
  return {
    role,
    title: title || role,
    model: model || usage?.model || "",
    status,
    step,
    tool,
    ok,
    durationMs: usage?.totalDurationMs || null,
    tokens: usage?.totalTokens || null,
    input,
    output,
    summary: safeText(summary || cleanBrowserAgentTraceSummary(output), 1000),
    reasoning: safeText(reasoning, 1200),
  };
}

async function safeRole(label, fn) {
  const started = Date.now();
  stageLog(`${label}:start`);
  try {
    const call = await fn();
    stageLog(`${label}:done`, {
      ms: Date.now() - started,
      model: call?.usage?.model || "",
      tokens: call?.usage?.totalTokens || 0,
      preview: call?.rawContent || call?.data || "",
    });
    return { ok: true, call, label };
  } catch (err) {
    stageLog(`${label}:error`, {
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      preview: err?.contentPreview || "",
    });
    return {
      ok: false,
      call: null,
      label,
      error: err instanceof Error ? err.message : String(err),
      usage: err?.usage || null,
      contentPreview: err?.contentPreview || "",
    };
  }
}

function orchestratorSystemPrompt() {
  return `You are the Main Browser Orchestrator.

You read the user's full browser instruction and break it into ordered browser intents.
You do not execute browser actions.
You must preserve the user's complete goal.

Return ONLY strict JSON. No markdown.

Rules:
- Split multi-operation requests into separate steps.
- Do not merge navigation, verification, click, fill, submit, and final report into one step.
- Each step must be executable/checkable before the next step starts.
- If the user asks "open X and click Y", create at least:
  1. open/navigate to X
  2. verify page loaded
  3. click Y
  4. verify/report final result
- Keep steps short and direct.

Return schema:
{
  "status": "ready|needs_user",
  "userIntent": "short intent",
  "steps": [
    {
      "instruction": "one browser step",
      "expectedAction": "navigate|observe|click|fill|submit|report|unknown",
      "successCriteria": "what proves this step passed"
    }
  ],
  "messageToUser": "",
  "confidence": 0.0
}`;
}

function stepAgentSystemPrompt() {
  return `You are a Gemma Browser Step Agent.

You receive exactly one browser step from the main orchestrator.
You inspect the current Playwright snapshot/screenshot and propose one browser command.

Return ONLY strict JSON. No markdown.

Allowed tools:
- browserNavigate: { "url": "https://..." }
- browserObserve: { "currentUrl": "...", "focus": "page|links|forms|actions" }
- browserClickByText: { "currentUrl": "...", "text": "visible text", "ref": "optional snapshot ref" }
- browserFillFields: { "currentUrl": "...", "fields": [{ "label": "...", "value": "...", "secret": false, "ref": "optional" }] }
- browserSubmitForm: { "currentUrl": "...", "explicitSubmit": true, "text": "optional submit text", "ref": "optional" }
- browserFillAndSubmit: { "currentUrl": "...", "explicitSubmit": true, "fields": [...] }
- browserScrape: { "currentUrl": "...", "focus": "..." }
- browserShowActions: { "currentUrl": "...", "instruction": "..." }

Use Playwright snapshot refs when available.
If the step cannot be done, return status "needs_user".

Return schema:
{
  "status": "ready|needs_user",
  "command": {
    "intent": "navigate|observe|click_or_open|fill_form|submit_form|fill_and_submit|scrape|show_actions|unknown",
    "tool": "browserNavigate|browserObserve|browserClickByText|browserFillFields|browserSubmitForm|browserFillAndSubmit|browserScrape|browserShowActions",
    "args": {},
    "notes": ""
  },
  "reason": "",
  "messageToChecker": "",
  "messageToUser": "",
  "confidence": 0.0
}`;
}

function checkerSystemPrompt() {
  return `You are a Gemma Browser Command Checker.

You crosscheck:
- original user request
- full orchestrator plan
- current step
- current Playwright snapshot/screenshot
- proposed command

Return ONLY strict JSON. No markdown.

Your job:
- approve the command if it matches the current step
- repair the command if target/ref/text is wrong
- reject or needs_user if unsafe/impossible
- do not execute anything

Return schema:
{
  "status": "approved|repaired|rejected|needs_user",
  "approved": true,
  "command": {
    "intent": "navigate|observe|click_or_open|fill_form|submit_form|fill_and_submit|scrape|show_actions|unknown",
    "tool": "browserNavigate|browserObserve|browserClickByText|browserFillFields|browserSubmitForm|browserFillAndSubmit|browserScrape|browserShowActions",
    "args": {},
    "notes": ""
  },
  "reason": "",
  "repairInstruction": "",
  "messageToUser": "",
  "confidence": 0.0
}`;
}

function resultCheckerSystemPrompt() {
  return `You are a Gemma Browser Result Checker.

You verify one completed browser step using before/after Playwright snapshots and screenshots.

Return ONLY strict JSON. No markdown.

Return schema:
{
  "status": "passed|failed|needs_repair",
  "success": true,
  "summary": "what happened",
  "evidence": "visible/snapshot evidence",
  "repairInstruction": "",
  "messageToUser": "",
  "confidence": 0.0
}`;
}

function finalVerifierSystemPrompt() {
  return `You are the Final Browser Verifier.

You compare the original user request against the full browser-agent trace.
You decide whether the user's original intent was satisfied.
You write the final user-facing answer.

Return ONLY strict JSON. No markdown.

Return schema:
{
  "success": true,
  "summary": "final answer to user",
  "needsUser": false,
  "nextSafeAction": "next safe action",
  "missingSteps": [],
  "reason": ""
}`;
}

function normalizeSteps(plan = {}, fallbackInstruction = "") {
  const rawSteps = Array.isArray(plan?.steps) ? plan.steps : [];
  const steps = rawSteps
    .map((step) => {
      if (typeof step === "string") {
        return { instruction: safeText(step, 700), expectedAction: "unknown", successCriteria: "" };
      }
      return {
        instruction: safeText(step?.instruction || step?.step || step?.text || "", 700),
        expectedAction: safeText(step?.expectedAction || step?.action || "unknown", 80),
        successCriteria: safeText(step?.successCriteria || step?.criteria || "", 500),
      };
    })
    .filter((step) => step.instruction);

  return steps.length
    ? steps
    : [{ instruction: fallbackInstruction, expectedAction: "unknown", successCriteria: "The requested browser task is completed." }];
}

function normalizeCommand(value = {}, currentUrl = "") {
  const command = value?.command || value?.approvedCommand || value || {};
  const tool = String(command.tool || "").trim();

  if (!SUPPORTED_TOOLS.has(tool)) {
    return {
      ok: false,
      command: null,
      error: `Unsupported or missing tool: ${tool || "<missing>"}`,
    };
  }

  return {
    ok: true,
    command: {
      intent: safeText(command.intent || "unknown", 80),
      tool,
      args: {
        ...(command.args && typeof command.args === "object" && !Array.isArray(command.args) ? command.args : {}),
        ...(currentUrl && tool !== "browserNavigate" ? { currentUrl } : {}),
      },
      notes: safeText(command.notes || "", 500),
    },
    error: "",
  };
}

function observationFromExecution(execution = null, fallback = {}) {
  return execution?.observation || {
    ok: Boolean(fallback?.snapshot),
    url: fallback?.snapshot?.url || "",
    title: fallback?.snapshot?.title || "",
    textPreview: fallback?.snapshot?.text || fallback?.snapshot?.dom?.textPreview || "",
    engine: "playwright_mcp",
    links: [],
    buttons: [],
    inputs: [],
    forms: [],
    interactiveElements: [],
    stats: {},
  };
}

function tokenUsageFromTrace(trace = []) {
  const totalTokens = trace.reduce((sum, entry) => sum + Number(entry.tokens || 0), 0);
  return {
    totalTokens,
    planner: trace.find((entry) => entry.role === "main_orchestrator") || null,
    reporter: trace.find((entry) => entry.role === "final_verifier") || null,
  };
}

export async function runBrowserAgentOrchestrator(args = {}) {
  const startedAt = nowMs();
  const instruction = String(args.instruction || "").trim();
  const state = args.state || {};
  const runtime = browserAgentRuntimeConfig({ display: true });
  const maxSteps = Math.max(1, Math.min(envInt("BROWSER_AGENT_MAX_SEQUENCE_STEPS", 8), 12));
  const maxRepairAttempts = Math.max(0, Math.min(envInt("BROWSER_AGENT_REPAIR_ATTEMPTS", 1), 3));

  const trace = [];
  const stepResults = [];

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
      runtimeTiming: { totalMs: roundMs(nowMs() - startedAt), pipelineMs: roundMs(nowMs() - startedAt), mainModelMs: 0 },
      tokenUsage: emptyBrowserAgentTokenUsage(),
      agentTrace: trace,
    };
  }

  const orchestratorCall = await safeRole("main_orchestrator", () => runOrchestratorAgent({
    originalInstruction: instruction,
    currentState: compactState(state),
  }));


  const orchestratorPlan = orchestratorCall.call?.data || {
    status: "ready",
    userIntent: instruction,
    steps: [{ instruction, expectedAction: "unknown", successCriteria: "" }],
    confidence: 0.5,
  };

  const steps = normalizeSteps(orchestratorPlan, instruction).slice(0, maxSteps);

  trace.push(traceEntry({
    role: "main_orchestrator",
    title: "Main model intent orchestrator",
    status: orchestratorPlan.status || (orchestratorCall.ok ? "ready" : "failed"),
    input: instruction,
    output: { ...orchestratorPlan, steps },
    summary: orchestratorPlan.userIntent || "",
    ok: orchestratorCall.ok,
    usage: usageOf(orchestratorCall),
    reasoning: thinkingOf(orchestratorCall),
  }));

  let currentState = state;
  let currentUrl = args.currentUrl || state.currentUrl || state.lastValidObservation?.url || "";
  let currentTitle = args.currentTitle || state.currentTitle || state.lastValidObservation?.title || "";
  let finalObservation = null;
  let stoppedReason = "";

  for (let index = 0; index < steps.length; index += 1) {
    const stepNumber = index + 1;
    const step = steps[index];

    trace.push(traceEntry({
      role: "sequence_step",
      title: `Step ${stepNumber}`,
      status: "started",
      step: stepNumber,
      input: step.instruction,
      summary: step.successCriteria || step.expectedAction || "",
      ok: null,
    }));

    let before = null;
    try {
      before = await capturePlaywrightMcpSnapshot({
        ...args,
        currentUrl,
        label: `step_${stepNumber}_before`,
        navigate: Boolean(currentUrl),
      }, currentState);
    } catch (err) {
      before = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        snapshot: null,
        observation: null,
      };
    }

    const beforeImages = snapshotImagesForModel(before?.snapshot);

    if (envFlag("BROWSER_AGENT_REPORT_STEP_FAST_PATH", true) && isReportOnlyStep(step)) {
      const observation = before?.observation || observationFromExecution(null, before);
      currentUrl = observation.url || currentUrl;
      currentTitle = observation.title || currentTitle;
      finalObservation = observation;

      const summary = pageSummaryFromObservation(observation);

      trace.push(traceEntry({
        role: "report_step_observe",
        title: "Report step observer",
        step: stepNumber,
        status: "passed",
        input: step,
        output: {
          url: observation.url || "",
          title: observation.title || "",
          textPreview: safeText(observation.textPreview || observation.text || "", 900),
        },
        summary,
        tool: "browserObserve",
        ok: true,
      }));

      stepResults.push({
        stepNumber,
        step,
        ok: true,
        repaired: false,
        status: "passed",
        summary,
        url: currentUrl,
        title: currentTitle,
        command: { intent: "observe", tool: "browserObserve", args: { currentUrl } },
      });

      continue;
    }

    let stepAgentCall = null;
    let stepPlan = envFlag("BROWSER_AGENT_SYNTHETIC_LOW_RISK_STEPS", true)
      ? syntheticStepPlanForLowRisk(step, currentUrl, instruction)
      : null;

    if (stepPlan) {
      trace.push(traceEntry({
        role: "gemma_step_agent",
        title: "Gemma step agent",
        step: stepNumber,
        status: "synthetic_ready",
        input: step,
        output: stepPlan,
        summary: stepPlan.reason || "",
        tool: stepPlan.command?.tool || "",
        ok: true,
      }));
    } else {
      stepAgentCall = await safeRole(`gemma_step_agent_step_${stepNumber}`, () => runStepAgent({
        schemaName: "gemma_step_agent",
        images: beforeImages,
        context: {
          originalInstruction: instruction,
          fullPlan: { ...orchestratorPlan, steps },
          stepNumber,
          step,
          currentUrl,
          currentTitle,
          currentState: compactState(currentState),
          snapshot: compactSnapshotForModel(before?.snapshot),
        },
      }));


      stepPlan = stepAgentCall.call?.data || {};
      trace.push(traceEntry({
        role: "gemma_step_agent",
        title: "Gemma step agent",
        step: stepNumber,
        status: stepPlan.status || (stepAgentCall.ok ? "ready" : "failed"),
        input: step,
        output: stepPlan,
        summary: stepPlan.reason || stepPlan.messageToChecker || "",
        tool: stepPlan.command?.tool || "",
        ok: stepAgentCall.ok,
        usage: usageOf(stepAgentCall),
        reasoning: thinkingOf(stepAgentCall),
      }));
    }

    let checkerCall = null;
    let checker = null;

    const snapshotChecker = fastSnapshotCheckerForStep({ stepPlan, step, before });

    if (envFlag("BROWSER_AGENT_SKIP_LOW_RISK_CHECKER", true) && isLowRiskAutoCheckCommand(stepPlan.command, step)) {
      checker = syntheticApprovedChecker(stepPlan);
      trace.push(traceEntry({
        role: "gemma_checker",
        title: "Gemma command checker",
        step: stepNumber,
        status: "auto_approved",
        input: stepPlan,
        output: checker,
        summary: checker.reason,
        tool: checker.command?.tool || stepPlan.command?.tool || "",
        ok: true,
      }));
    } else if (snapshotChecker) {
      checker = snapshotChecker;
      trace.push(traceEntry({
        role: "gemma_checker",
        title: "Snapshot command checker",
        step: stepNumber,
        status: checker.status,
        input: stepPlan,
        output: checker,
        summary: checker.reason || checker.repairInstruction || checker.messageToUser || "",
        tool: checker.command?.tool || stepPlan.command?.tool || "",
        ok: true,
      }));
    } else {
      checkerCall = await safeRole("gemma_checker", () => runCheckerAgent({
        schemaName: "gemma_checker",
        images: beforeImages,
        context: {
          originalInstruction: instruction,
          fullPlan: { ...orchestratorPlan, steps },
          stepNumber,
          step,
          currentUrl,
          currentTitle,
          snapshot: compactSnapshotForModel(before?.snapshot),
          proposedCommand: stepPlan.command || null,
        },
      }));


      checker = checkerCall.call?.data || {};
      const checkerFallback = checkerFallbackAfterModelError({ checkerCall, stepPlan, step, before });
      if (checkerFallback) {
        checker = checkerFallback;
        checkerCall = {
          ...checkerCall,
          ok: true,
          error: "",
        };
      }
      trace.push(traceEntry({
        role: "gemma_checker",
        title: "Gemma command checker",
        step: stepNumber,
        status: checker.status || (checkerCall.ok ? "checked" : "failed"),
        input: stepPlan,
        output: checker,
        summary: checker.reason || checker.repairInstruction || checker.messageToUser || "",
        tool: checker.command?.tool || stepPlan.command?.tool || "",
        ok: checkerDecisionForExecution(checker, checkerCall).ok,
        usage: usageOf(checkerCall),
        reasoning: thinkingOf(checkerCall),
      }));
    }

    const checkerDecision = checkerDecisionForExecution(checker, checkerCall);
    if (!checkerDecision.ok) {
      stoppedReason = checkerDecision.reason || "Step was not approved.";
      stepResults.push({ stepNumber, step, ok: false, status: "not_approved", summary: stoppedReason });
      break;
    }

    const normalized = normalizeCommand(checker.command || stepPlan.command, currentUrl);
    if (!normalized.ok) {
      stoppedReason = normalized.error;
      stepResults.push({ stepNumber, step, ok: false, status: "bad_command", summary: normalized.error });
      break;
    }

    let execution = await executePlaywrightMcpBrowserCommand({
      command: normalized.command,
      args: { ...args, currentUrl },
      state: currentState,
      beforeSnapshot: before?.snapshot || null,
    });

    trace.push(traceEntry({
      role: "playwright_controller",
      title: "Playwright browser controller",
      step: stepNumber,
      status: execution.status || "executed",
      input: normalized.command,
      output: {
        url: execution.observation?.url || "",
        title: execution.observation?.title || "",
        error: execution.error || "",
        summary: execution.actionResult?.text || "",
      },
      summary: execution.error || cleanBrowserAgentTraceSummary({ summary: execution.actionResult?.text || "", url: execution.observation?.url || "", title: execution.observation?.title || "" }),
      tool: normalized.command.tool,
      ok: execution.ok === true,
    }));

    let resultCheckCall = null;
    let resultCheck = null;

    if (
      (envFlag("BROWSER_AGENT_SKIP_LOW_RISK_RESULT_CHECKER", true) && isLowRiskAutoCheckCommand(normalized.command, step)) ||
      (envFlag("BROWSER_AGENT_SNAPSHOT_RESULT_FAST_PATH", true) && isSnapshotResultAutoPassCommand(normalized.command, step, execution))
    ) {
      resultCheck = syntheticPassedResult({ execution, step, command: normalized.command });
      trace.push(traceEntry({
        role: "gemma_result_checker",
        title: "Gemma result checker",
        step: stepNumber,
        status: "auto_passed",
        input: {
          step,
          command: normalized.command,
          executionStatus: execution.status,
        },
        output: resultCheck,
        summary: resultCheck.summary || resultCheck.evidence || "",
        ok: resultCheck.success === true,
      }));
    } else {
      const resultImages = snapshotImagesForModel(execution.beforeSnapshot || before?.snapshot, execution.afterSnapshot);

      resultCheckCall = await safeRole("gemma_result_checker", () => runWatcherAgent({
        schemaName: "gemma_result_checker",
        images: resultImages,
        context: {
          originalInstruction: instruction,
          fullPlan: { ...orchestratorPlan, steps },
          stepNumber,
          step,
          command: normalized.command,
          browserExecution: {
            ok: execution.ok,
            status: execution.status,
            error: execution.error || "",
            observation: observationFromExecution(execution),
          },
          beforeSnapshot: compactSnapshotForModel(execution.beforeSnapshot || before?.snapshot),
          afterSnapshot: compactSnapshotForModel(execution.afterSnapshot),
        },
      }));


      resultCheck = resultCheckCall.call?.data || {};
      trace.push(traceEntry({
        role: "gemma_result_checker",
        title: "Gemma result checker",
        step: stepNumber,
        status: resultCheck.status || (resultCheckCall.ok ? "checked" : "failed"),
        input: {
          step,
          command: normalized.command,
          executionStatus: execution.status,
        },
        output: resultCheck,
        summary: resultCheck.summary || resultCheck.evidence || resultCheck.repairInstruction || "",
        ok: resultCheck.success === true,
        usage: usageOf(resultCheckCall),
        reasoning: thinkingOf(resultCheckCall),
      }));
    }

    let repaired = false;
    for (let repairAttempt = 0; repairAttempt < maxRepairAttempts; repairAttempt += 1) {
      if (resultCheck.success === true) break;
      if (!resultCheck.repairInstruction) break;

      repaired = true;
      trace.push(traceEntry({
        role: "repair_loop",
        title: `Repair attempt ${repairAttempt + 1}`,
        step: stepNumber,
        status: "started",
        input: resultCheck.repairInstruction,
        summary: resultCheck.repairInstruction,
        ok: null,
      }));

      const repairAgentCall = await safeRole("gemma_step_agent_repair", () => runStepAgent({
        schemaName: "gemma_step_agent_repair",
        images: snapshotImagesForModel(execution.afterSnapshot),
        context: {
          originalInstruction: instruction,
          stepNumber,
          step,
          previousCommand: normalized.command,
          failure: resultCheck,
          repairInstruction: resultCheck.repairInstruction,
          currentUrl: execution.observation?.url || currentUrl,
          currentTitle: execution.observation?.title || currentTitle,
          snapshot: compactSnapshotForModel(execution.afterSnapshot),
        },
      }));


      const repairPlan = repairAgentCall.call?.data || {};
      const repairCommand = normalizeCommand(repairPlan.command, execution.observation?.url || currentUrl);

      trace.push(traceEntry({
        role: "gemma_step_agent_repair",
        title: "Gemma repair agent",
        step: stepNumber,
        status: repairPlan.status || (repairAgentCall.ok ? "ready" : "failed"),
        input: resultCheck.repairInstruction,
        output: repairPlan,
        summary: repairPlan.reason || "",
        tool: repairPlan.command?.tool || "",
        ok: repairAgentCall.ok && repairCommand.ok,
        usage: usageOf(repairAgentCall),
        reasoning: thinkingOf(repairAgentCall),
      }));

      if (!repairCommand.ok) break;

      execution = await executePlaywrightMcpBrowserCommand({
        command: repairCommand.command,
        args: { ...args, currentUrl: execution.observation?.url || currentUrl },
        state: currentState,
        beforeSnapshot: execution.afterSnapshot || null,
      });

      const repairCheckCall = await safeRole("gemma_result_checker_repair", () => runWatcherAgent({
        schemaName: "gemma_result_checker_repair",
        images: snapshotImagesForModel(execution.beforeSnapshot, execution.afterSnapshot),
        context: {
          originalInstruction: instruction,
          stepNumber,
          step,
          command: repairCommand.command,
          browserExecution: {
            ok: execution.ok,
            status: execution.status,
            error: execution.error || "",
            observation: observationFromExecution(execution),
          },
          beforeSnapshot: compactSnapshotForModel(execution.beforeSnapshot),
          afterSnapshot: compactSnapshotForModel(execution.afterSnapshot),
        },
      }));


      resultCheckCall = repairCheckCall;
      resultCheck = repairCheckCall.call?.data || {};

      trace.push(traceEntry({
        role: "gemma_result_checker_repair",
        title: "Gemma repair result checker",
        step: stepNumber,
        status: resultCheck.status || (repairCheckCall.ok ? "checked" : "failed"),
        input: repairCommand.command,
        output: resultCheck,
        summary: resultCheck.summary || resultCheck.evidence || "",
        ok: resultCheck.success === true,
        usage: usageOf(repairCheckCall),
        reasoning: thinkingOf(repairCheckCall),
      }));
    }

    const observation = observationFromExecution(execution);
    currentUrl = observation.url || currentUrl;
    currentTitle = observation.title || currentTitle;
    finalObservation = observation;

    const stepOk = execution.ok === true && resultCheck.success === true;
    stepResults.push({
      stepNumber,
      step,
      ok: stepOk,
      repaired,
      status: stepOk ? "passed" : "failed",
      summary: resultCheck.summary || execution.error || execution.actionResult?.text || "",
      url: currentUrl,
      title: currentTitle,
      command: normalized.command,
    });

    if (!stepOk) {
      stoppedReason = resultCheck.repairInstruction || resultCheck.summary || execution.error || "Step failed verification.";
      break;
    }
  }

  const passedAllSteps = stepResults.length === steps.length && stepResults.every((step) => step.ok);
  const watcherSideReport = buildWatcherSpyReport({
    instruction,
    stepResults,
    trace,
    finalObservation,
    stoppedReason,
    args,
    passedAllSteps,
  });
  let finalCall = null;
  let final = null;

  if (envFlag("BROWSER_AGENT_FINAL_VERIFIER_ENABLED", false)) {
    finalCall = await safeRole("final_verifier", () => runFinalVerifierAgent({
      schemaName: "final_verifier",
      context: {
        originalInstruction: instruction,
        orchestratorPlan: { ...orchestratorPlan, steps },
        stepResults,
        stoppedReason,
        finalObservation,
        watcherSideReport,
        userBehavior: watcherSideReport.userBehavior,
        responseGuidanceForMain: watcherSideReport.responseGuidanceForMain,
        trace: trace.map((entry) => ({
          role: entry.role,
          step: entry.step,
          status: entry.status,
          ok: entry.ok,
          summary: entry.summary,
          tool: entry.tool,
        })),
      },
    }));


    final = finalCall.call?.data || {
      success: passedAllSteps,
      summary: finalBrowserAgentUserSummary({ passedAllSteps, stoppedReason, finalObservation, lastStep: stepResults.at(-1) }),
      needsUser: Boolean(stoppedReason),
      nextSafeAction: stoppedReason || "Continue with the next browser instruction.",
      missingSteps: [],
      reason: stoppedReason || "",
    };
  } else {
    const lastStep = stepResults.at(-1) || {};
    final = {
      success: passedAllSteps,
      summary: finalBrowserAgentUserSummary({ passedAllSteps, stoppedReason, finalObservation, lastStep }),
      needsUser: Boolean(stoppedReason) || !passedAllSteps,
      nextSafeAction: stoppedReason || "Continue with the next browser instruction.",
      missingSteps: passedAllSteps ? [] : steps.slice(stepResults.length).map((step) => step.instruction),
      reason: stoppedReason || "",
    };
  }

  trace.push(traceEntry({
    role: "final_verifier",
    title: "Final verifier",
    status: final.success ? (finalCall ? "verified" : "synthetic_verified") : "incomplete",
    input: {
      originalInstruction: instruction,
      stepResults,
    },
    output: final,
    summary: final.summary || final.reason || "",
    ok: final.success === true,
    usage: usageOf(finalCall),
    reasoning: thinkingOf(finalCall),
  }));

  const ok = final.success === true && stepResults.length === steps.length && stepResults.every((step) => step.ok);
  const timing = {
    totalMs: roundMs(nowMs() - startedAt),
    pipelineMs: roundMs(nowMs() - startedAt),
    mainModelMs: 0,
  };

  return {
    ok,
    status: ok ? "success" : stoppedReason ? "partial" : "failed",
    instruction,
    currentUrl,
    currentTitle,
    extensionId: "",
    pageKey: "",
    engine: "playwright_mcp",
    summary: final.summary || stoppedReason || "Browser task finished.",
    browserSummary: final.summary || stoppedReason || "Browser task finished.",
    whatFound: finalObservation
      ? {
          ok: Boolean(finalObservation.ok),
          url: finalObservation.url || "",
          title: finalObservation.title || "",
          textPreview: safeText(finalObservation.textPreview || finalObservation.text || "", 1800),
          engine: finalObservation.engine || "playwright_mcp",
        }
      : null,
    observedControls: {
      forms: Array.isArray(finalObservation?.forms) ? finalObservation.forms.length : 0,
      inputs: Array.isArray(finalObservation?.inputs) ? finalObservation.inputs.slice(0, 20) : [],
      buttons: Array.isArray(finalObservation?.buttons) ? finalObservation.buttons.slice(0, 20) : [],
      links: Array.isArray(finalObservation?.links) ? finalObservation.links.slice(0, 20) : [],
    },
    possibleNextActions: [],
    requiresUser: final.needsUser === true || !ok,
    blockedReason: ok ? "" : (stoppedReason || final.reason || ""),
    nextSafeAction: final.nextSafeAction || "Continue with the next browser instruction.",
    watcher: watcherSideReport,
    planner: orchestratorPlan,
    reporter: final,
    filledFields: [],
    missingFields: [],
    submitStatus: "",
    runtime,
    runtimeTiming: timing,
    tokenUsage: tokenUsageFromTrace(trace),
    agentTrace: trace,
    sequence: {
      completed: stepResults.filter((step) => step.ok).length,
      total: steps.length,
      stoppedAt: ok ? null : stepResults.length,
      items: stepResults.map((step) => ({
        index: step.stepNumber - 1,
        instruction: step.step.instruction,
        ok: step.ok,
        status: step.status,
        summary: step.summary,
        currentUrl: step.url || "",
        currentTitle: step.title || "",
        blockedReason: step.ok ? "" : stoppedReason,
      })),
    },
    pipeline: {
      architecture: BROWSER_AGENT_ARCHITECTURE,
      dryRun: false,
      runtime,
      agentTrace: trace,
      browserExecution: finalObservation
        ? {
            ok,
            status: ok ? "executed" : "partial",
            executed: true,
            tool: stepResults.at(-1)?.command?.tool || "",
            engine: "playwright_mcp",
            observation: finalObservation,
            summary: final.summary || "",
          }
        : null,
    },
  };
}
