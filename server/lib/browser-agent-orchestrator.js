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
    summary: safeText(summary || output, 1000),
    reasoning: safeText(reasoning, 1200),
  };
}

async function safeRole(label, fn) {
  try {
    return { ok: true, call: await fn(), label };
  } catch (err) {
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

  const orchestratorCall = await safeRole("main_orchestrator", () => callBrowserAgentRoleJson("main", {
    system: orchestratorSystemPrompt(),
    schemaName: "main_orchestrator",
    context: {
      originalInstruction: instruction,
      currentState: compactState(state),
    },
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

    const stepAgentCall = await safeRole("gemma_step_agent", () => callBrowserAgentRoleJson("planner", {
      system: stepAgentSystemPrompt(),
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

    const stepPlan = stepAgentCall.call?.data || {};
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

    const checkerCall = await safeRole("gemma_checker", () => callBrowserAgentRoleJson("reviewer", {
      system: checkerSystemPrompt(),
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

    const checker = checkerCall.call?.data || {};
    trace.push(traceEntry({
      role: "gemma_checker",
      title: "Gemma command checker",
      step: stepNumber,
      status: checker.status || (checkerCall.ok ? "checked" : "failed"),
      input: stepPlan,
      output: checker,
      summary: checker.reason || checker.repairInstruction || checker.messageToUser || "",
      tool: checker.command?.tool || stepPlan.command?.tool || "",
      ok: checkerCall.ok && checker.approved !== false,
      usage: usageOf(checkerCall),
      reasoning: thinkingOf(checkerCall),
    }));

    if (!checkerCall.ok || checker.approved === false || ["rejected", "needs_user"].includes(String(checker.status || ""))) {
      stoppedReason = checker.reason || checker.messageToUser || checkerCall.error || "Step was not approved.";
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
      summary: execution.error || execution.actionResult?.text || execution.observation?.title || execution.observation?.url || "",
      tool: normalized.command.tool,
      ok: execution.ok === true,
    }));

    const resultImages = snapshotImagesForModel(execution.beforeSnapshot || before?.snapshot, execution.afterSnapshot);

    let resultCheckCall = await safeRole("gemma_result_checker", () => callBrowserAgentRoleJson("resultReviewer", {
      system: resultCheckerSystemPrompt(),
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

    let resultCheck = resultCheckCall.call?.data || {};
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

      const repairAgentCall = await safeRole("gemma_step_agent_repair", () => callBrowserAgentRoleJson("planner", {
        system: stepAgentSystemPrompt(),
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

      const repairCheckCall = await safeRole("gemma_result_checker_repair", () => callBrowserAgentRoleJson("resultReviewer", {
        system: resultCheckerSystemPrompt(),
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

  const finalCall = await safeRole("final_verifier", () => callBrowserAgentRoleJson("main", {
    system: finalVerifierSystemPrompt(),
    schemaName: "final_verifier",
    context: {
      originalInstruction: instruction,
      orchestratorPlan: { ...orchestratorPlan, steps },
      stepResults,
      stoppedReason,
      finalObservation,
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

  const final = finalCall.call?.data || {
    success: stepResults.length === steps.length && stepResults.every((step) => step.ok),
    summary: stoppedReason || stepResults.at(-1)?.summary || "Browser task finished.",
    needsUser: Boolean(stoppedReason),
    nextSafeAction: stoppedReason || "Continue with the next browser instruction.",
    missingSteps: [],
    reason: stoppedReason || "",
  };

  trace.push(traceEntry({
    role: "final_verifier",
    title: "Final verifier",
    status: final.success ? "verified" : "incomplete",
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
    blockedReason: stoppedReason || final.reason || "",
    nextSafeAction: final.nextSafeAction || "Continue with the next browser instruction.",
    watcher: null,
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
      architecture: "main_orchestrator_step_agent_checker_repair_final_verifier_v1",
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
