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
  compactBrowserStateForModel,
  getBrowserState,
} from "./browser-state-provider.js";

import {
  BROWSER_AGENT_ARCHITECTURE,
  runCheckerAgent,
  runFinalVerifierAgent,
  runOrchestratorAgent,
  runStepAgent,
  runWatcherAgent,
  resolveBrowserAgentProfile,
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

function isInvalidJsonCheckerError(callResult = null) {
  return Boolean(
    callResult &&
    callResult.ok === false &&
    /invalid JSON|BROWSER_AGENT_LLM_INVALID_JSON/i.test(String(callResult.error || ""))
  );
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

function isVisualStep(step = {}) {
  return /\b(visual|visually|screenshot|screen|image|picture|photo|see|look|appearance|layout|color|canvas|chart|graph|map|modal|popup|captcha|qr)\b/i
    .test(String(step?.instruction || ""));
}

function shouldCapturePlaywrightBeforeSnapshot({ step = {}, beforeState = null } = {}) {
  const policy = String(process.env.BROWSER_AGENT_BEFORE_SNAPSHOT_POLICY || "on_demand").trim().toLowerCase();

  if (policy === "always") return true;
  if (policy === "never") return false;
  if (envFlag("BROWSER_AGENT_FORCE_PLAYWRIGHT_BEFORE_SNAPSHOT", false)) return true;

  if (!beforeState || beforeState.ok !== true) return true;
  if (isSensitiveStep(step)) return true;
  if (isVisualStep(step)) return true;

  // Fast snapshot checker depends on Playwright MCP snapshot refs.
  if (envFlag("BROWSER_AGENT_FAST_SNAPSHOT_CHECKER", false)) return true;

  return false;
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

function observationFromPageState(pageState = null) {
  if (!pageState || pageState.ok !== true) return null;
  return {
    ok: true,
    url: pageState.url || "",
    title: pageState.title || "",
    text: pageState.text || pageState.textPreview || "",
    textPreview: pageState.textPreview || pageState.text || "",
    markdown: pageState.markdown || "",
    links: Array.isArray(pageState.links) ? pageState.links : [],
    buttons: Array.isArray(pageState.buttons) ? pageState.buttons : [],
    inputs: Array.isArray(pageState.inputs) ? pageState.inputs : [],
    forms: Array.isArray(pageState.forms) ? pageState.forms : [],
    interactiveElements: Array.isArray(pageState.interactiveElements) ? pageState.interactiveElements : [],
    stats: pageState.stats || {},
    engine: pageState.engine || "lightpanda_cdp",
    source: pageState.source || "lightpanda_read_only",
    extractionPath: pageState.extractionPath || "",
    extractionSources: Array.isArray(pageState.extractionSources) ? pageState.extractionSources : [],
    extractionCapabilities: pageState.extractionCapabilities || {},
  };
}

function pageStateTraceSummary(pageState = null) {
  if (!pageState) return "No Lightpanda page state was captured.";
  if (pageState.ok !== true) return pageState.error || "Lightpanda page state was unavailable.";
  const counts = pageState.stats || {};
  return [
    "Lightpanda read-only state",
    pageState.title || pageState.url || "",
    `links=${Number(counts.links || 0)}`,
    `buttons=${Number(counts.buttons || 0)}`,
    `inputs=${Number(counts.inputs || 0)}`,
    `forms=${Number(counts.forms || 0)}`,
  ].filter(Boolean).join(" — ");
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

function agentTraceLabel(role = "", title = "") {
  const labels = {
    main_orchestrator: "Orchestrator",
    gemma_step_agent: "Step Agent",
    gemma_step_agent_repair: "Step Agent Repair",
    gemma_checker: "Checker",
    playwright_controller: "Browser",
    gemma_result_checker: "Watcher",
    gemma_result_checker_repair: "Watcher Repair",
    report_step_observe: "Reporter",
    repair_loop: "Repair Loop",
    final_verifier: "Main Response",
  };

  return labels[role] || title || role || "Agent";
}

function agentTraceKind(role = "") {
  if (role === "main_orchestrator") return "orchestrator";
  if (role.includes("step_agent")) return "step_agent";
  if (role.includes("checker") && !role.includes("result")) return "checker";
  if (role === "playwright_controller") return "browser";
  if (role.includes("result_checker")) return "watcher";
  if (role === "final_verifier") return "main_response";
  if (role === "report_step_observe") return "reporter";
  if (role === "repair_loop") return "repair";
  return "agent";
}

function shortModelLabel(model = "") {
  const raw = safeText(model, 180);
  if (!raw) return "";

  return raw
    .replace(/^joe-speedboat\//i, "")
    .replace(/Gemma-4-Uncensored-HauhauCS-Aggressive/i, "Gemma-4")
    .replace(/:latest$/i, "")
    .replace(/qwen3\.5:(\d+b)/i, "qwen3.5:$1");
}

function agentTraceProfileId(role = "") {
  const map = {
    main_orchestrator: "orchestrator",
    gemma_step_agent: "stepAgent",
    gemma_step_agent_repair: "stepAgent",
    gemma_checker: "checker",
    playwright_controller: "",
    gemma_result_checker: "watcher",
    gemma_result_checker_repair: "watcher",
    report_step_observe: "reporter",
    final_verifier: "finalVerifier",
  };

  return map[role] || "";
}

function agentTraceProfile(role = "") {
  const id = agentTraceProfileId(role);
  if (!id) return null;
  return resolveBrowserAgentProfile(id);
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
  const modelValue = model || usage?.model || "";
  const label = agentTraceLabel(role, title);
  const profile = agentTraceProfile(role);

  return {
    role,
    title: label,
    roleLabel: label,
    agentName: label,
    agentKind: agentTraceKind(role),
    agentProfile: profile,
    personality: profile?.personality || "",
    skills: profile?.skills || [],
    settings: profile?.settings || {},
    model: modelValue,
    modelLabel: shortModelLabel(modelValue),
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
function commandHasFields(command = {}) {
  return Array.isArray(command.args?.fields) && command.args.fields.length > 0;
}

function isSubmitLikeClickCommand(command = {}) {
  if (!command || command.tool !== "browserClickByText") return false;
  const text = safeText(command.args?.text || command.args?.label || command.args?.buttonText || "", 120).toLowerCase();
  return /login|log in|sign in|submit|continue|next/.test(text);
}

function commandWithFreshFillBeforeSubmit(clickCommand = {}, lastFillCommand = null) {
  if (!lastFillCommand || !commandHasFields(lastFillCommand) || !isSubmitLikeClickCommand(clickCommand)) return clickCommand;
  return {
    ...clickCommand,
    intent: "fill_and_submit",
    tool: "browserFillAndSubmit",
    args: {
      ...(clickCommand.args || {}),
      fields: lastFillCommand.args.fields,
      text: clickCommand.args?.text || clickCommand.args?.label || clickCommand.args?.buttonText || "Login",
    },
    notes: "Re-filled verified fields immediately before submit.",
  };
}

function redactedBrowserFieldValue(field = {}) {
  const haystack = [field.label, field.name, field.id, field.placeholder, field.selector, field.type].map((item) => String(item || "")).join(" ").toLowerCase();
  if (/password|passcode|pin|otp|token|secret/.test(haystack) || field.secret === true) return "[redacted]";
  const value = String(field.value ?? "");
  return value.length > 120 ? value.slice(0, 117) + "..." : value;
}

function browserCommandFieldsForTrace(command = {}) {
  const fields = Array.isArray(command.args?.fields) ? command.args.fields : [];
  return fields.map((field) => ({
    label: safeText(field.label || field.name || field.id || field.placeholder || "field", 120),
    target: safeText(field.ref || field.selector || field.target || "", 120),
    type: safeText(field.type || "textbox", 80),
    valuePreview: redactedBrowserFieldValue(field),
  }));
}

function browserExecutionUiDetails(command = {}, execution = {}) {
  const action = execution.actionResult || {};
  const tool = command.tool || "";
  if (tool === "browserFillFields" || tool === "browserFillAndSubmit") {
    const formFillOk = action.formFill?.ok === true;
    const domFallbackOk = action.domFallback?.ok === true;
    const typeOk = Array.isArray(action.results) && action.results.length > 0 && action.results.every((result) => result?.ok === true);
    const verifyOk = action.verify?.ok === true;
    return { kind: "fill", strategy: verifyOk ? "verified_fill" : domFallbackOk ? "dom_fill_fallback" : typeOk ? "browser_type" : formFillOk ? "browser_fill_form" : "fill_failed", formFillOk, typeOk, domFallbackOk, verifyOk, fields: browserCommandFieldsForTrace(command) };
  }
  if (tool === "browserClickByText" || tool === "browserSubmitForm") return { kind: "click", strategy: "browser_click", target: safeText(command.args?.text || command.args?.label || command.args?.buttonText || "", 160), ref: safeText(command.args?.ref || command.args?.selector || command.args?.target || "", 160) };
  if (tool === "browserNavigate") return { kind: "navigate", strategy: "browser_navigate", url: safeText(command.args?.url || "", 260) };
  return null;
}

function browserExecutionTraceSummary(command = {}, execution = {}) {
  const details = browserExecutionUiDetails(command, execution);
  const page = cleanBrowserAgentTraceSummary({ summary: execution.actionResult?.text || "", url: execution.observation?.url || "", title: execution.observation?.title || "" });
  if (!details) return execution.error || page;
  if (details.kind === "fill") {
    const fields = (details.fields || []).map((field) => field.label + (field.target ? " [" + field.target + "]" : "") + (field.valuePreview ? "=" + field.valuePreview : "")).join(", ");
    return ["action=fill via=" + details.strategy + (fields ? " fields: " + fields : ""), page, execution.error || ""].filter(Boolean).join(" — ");
  }
  if (details.kind === "click") return ["action=click target=" + (details.target || "") + (details.ref ? " [" + details.ref + "]" : ""), page, execution.error || ""].filter(Boolean).join(" — ");
  if (details.kind === "navigate") return ["action=navigate " + (details.url || ""), page, execution.error || ""].filter(Boolean).join(" — ");
  return execution.error || page;
}

function watcherResultOrFallback({ resultCheck = {}, resultCheckCall = null, execution = {}, step = {}, command = {} } = {}) {
  const hasData = resultCheck && typeof resultCheck === "object" && Object.keys(resultCheck).length > 0;
  if (hasData) return resultCheck;
  const actionSummary = browserExecutionTraceSummary(command, execution);
  const callError = safeText(resultCheckCall?.error || "", 500);
  const stepName = safeText(step?.instruction || "browser step", 240);
  return { status: execution.ok === true ? "needs_repair" : "failed", success: false, summary: "Watcher returned no valid decision for: " + stepName + ". " + (actionSummary || callError || "Verification was inconclusive."), evidence: actionSummary || callError || "No watcher JSON was available.", repairInstruction: command.tool === "browserFillFields" || command.tool === "browserFillAndSubmit" ? "Re-fill the fields with verified typing, then submit only after values are confirmed." : "Retry the step with a more specific target and verify the result.", messageToUser: "", confidence: 0.1 };
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
    status: steps.length && orchestratorPlan.status === "needs_user" ? "ready" : (orchestratorPlan.status || (orchestratorCall.ok ? "ready" : "failed")),
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
  let lastSuccessfulFillCommand = null;

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

    let beforeState = null;
    try {
      beforeState = await getBrowserState({
        ...args,
        state: currentState,
        currentUrl,
        navigate: false,
        waitMs: args.waitMs || "700",
      });
    } catch (err) {
      beforeState = {
        ok: false,
        status: "failed",
        source: "lightpanda_read_only",
        engine: "lightpanda_cdp",
        url: currentUrl || "",
        title: currentTitle || "",
        error: err instanceof Error ? err.message : String(err),
        links: [],
        buttons: [],
        inputs: [],
        forms: [],
        interactiveElements: [],
        candidates: [],
        stats: {},
      };
    }

    trace.push(traceEntry({
      role: "lightpanda_state_provider",
      title: "Lightpanda state provider",
      step: stepNumber,
      status: beforeState?.ok === true ? "observed" : "unavailable",
      input: {
        currentUrl,
        readOnly: true,
      },
      output: compactBrowserStateForModel(beforeState, {
        textLimit: 900,
        markdownLimit: 900,
        linkLimit: 12,
        buttonLimit: 12,
        inputLimit: 12,
        formLimit: 4,
        candidateLimit: 24,
      }),
      summary: pageStateTraceSummary(beforeState),
      tool: "browserObserve",
      ok: beforeState?.ok === true,
    }));

    const captureBeforeSnapshot = shouldCapturePlaywrightBeforeSnapshot({ step, beforeState });
    let before = null;

    if (captureBeforeSnapshot) {
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
    } else {
      before = {
        ok: true,
        status: "skipped",
        skipped: true,
        reason: "Skipped Playwright before snapshot because Lightpanda read-only page state is available.",
        snapshot: null,
        observation: observationFromPageState(beforeState),
        error: "",
      };
    }

    const beforeImages = snapshotImagesForModel(before?.snapshot);
    const compactBeforeState = compactBrowserStateForModel(beforeState);

    if (envFlag("BROWSER_AGENT_REPORT_STEP_FAST_PATH", true) && isReportOnlyStep(step)) {
      const observation = observationFromPageState(beforeState) || before?.observation || observationFromExecution(null, before);
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
          pageState: compactBeforeState,
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
          pageState: compactBeforeState,
          snapshot: compactSnapshotForModel(before?.snapshot),
          proposedCommand: stepPlan.command || null,
        },
      }));

      if (isInvalidJsonCheckerError(checkerCall) && envFlag("BROWSER_AGENT_CHECKER_RETRY_ON_INVALID_JSON", true)) {
        checkerCall = await safeRole("gemma_checker_retry", () => runCheckerAgent({
          schemaName: "gemma_checker_retry",
          images: [],
          context: {
            originalInstruction: instruction,
            fullPlan: { ...orchestratorPlan, steps },
            stepNumber,
            step,
            currentUrl,
            currentTitle,
            pageState: compactBeforeState,
            snapshot: compactSnapshotForModel(before?.snapshot),
            proposedCommand: stepPlan.command || null,
            retryReason: "Previous checker call returned invalid JSON. Return only strict JSON matching the checker schema.",
          },
        }));
      }


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

    const executionCommand = commandWithFreshFillBeforeSubmit(normalized.command, lastSuccessfulFillCommand);

    if (executionCommand !== normalized.command) {
      trace.push(traceEntry({
        role: "playwright_controller",
        title: "Playwright browser controller",
        step: stepNumber,
        status: "prepared",
        input: normalized.command,
        output: executionCommand,
        summary: "Re-filling verified form fields immediately before submit.",
        tool: executionCommand.tool,
        ok: null,
      }));
    }

    let execution = await executePlaywrightMcpBrowserCommand({
      command: executionCommand,
      args: { ...args, currentUrl },
      state: currentState,
      beforeSnapshot: before?.snapshot || null,
      beforeObservation: observationFromPageState(beforeState),
      skipBeforeSnapshot: !captureBeforeSnapshot && beforeState?.ok === true,
    });

    trace.push(traceEntry({
      role: "playwright_controller",
      title: "Playwright browser controller",
      step: stepNumber,
      status: execution.status || "executed",
      input: executionCommand,
      output: {
        url: execution.observation?.url || "",
        title: execution.observation?.title || "",
        error: execution.error || "",
        summary: execution.actionResult?.text || "",
        actionDetails: browserExecutionUiDetails(executionCommand, execution),
      },
      summary: browserExecutionTraceSummary(executionCommand, execution),
      tool: executionCommand.tool,
      ok: execution.ok === true,
    }));

    let resultCheckCall = null;
    let resultCheck = null;

    if (
      (envFlag("BROWSER_AGENT_SKIP_LOW_RISK_RESULT_CHECKER", true) && isLowRiskAutoCheckCommand(normalized.command, step)) ||
      (envFlag("BROWSER_AGENT_SNAPSHOT_RESULT_FAST_PATH", true) && isSnapshotResultAutoPassCommand(normalized.command, step, execution))
    ) {
      resultCheck = syntheticPassedResult({ execution, step, command: executionCommand });
      trace.push(traceEntry({
        role: "gemma_result_checker",
        title: "Gemma result checker",
        step: stepNumber,
        status: "auto_passed",
        input: {
          step,
          command: executionCommand,
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
          beforeState: compactBeforeState,
          beforeSnapshot: compactSnapshotForModel(execution.beforeSnapshot || before?.snapshot),
          afterSnapshot: compactSnapshotForModel(execution.afterSnapshot),
        },
      }));


      resultCheck = watcherResultOrFallback({
        resultCheck: resultCheckCall.call?.data || {},
        resultCheckCall,
        execution,
        step,
        command: executionCommand,
      });
      trace.push(traceEntry({
        role: "gemma_result_checker",
        title: "Gemma result checker",
        step: stepNumber,
        status: resultCheck.status || (resultCheckCall.ok ? "checked" : "failed"),
        input: {
          step,
          command: executionCommand,
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
      resultCheck = watcherResultOrFallback({
        resultCheck: repairCheckCall.call?.data || {},
        resultCheckCall: repairCheckCall,
        execution,
        step,
        command: repairCommand.command,
      });

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
      command: executionCommand,
    });

    if (stepOk && commandHasFields(executionCommand)) {
      lastSuccessfulFillCommand = {
        ...executionCommand,
        tool: "browserFillFields",
      };
    }

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
          output: entry.output && typeof entry.output === "object" ? {
            error: entry.output.error || "",
            actionDetails: entry.output.actionDetails || null,
          } : null,
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

  if (!passedAllSteps && final?.success === true) {
    final = {
      ...final,
      success: false,
      needsUser: true,
      summary: stoppedReason || final.summary || "Browser task incomplete.",
      reason: stoppedReason || final.reason || "Not all browser steps passed.",
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
