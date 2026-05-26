import { chooseBrowserRoute } from "./route-selector.js";
import { planBrowserTask } from "./planner.js";
import { buildExecutableCommand } from "./command-builder.js";
import { checkBrowserCommand } from "./checker.js";
import { watchBrowserResult } from "./watcher.js";
import { reportBrowserResult } from "./reporter.js";
import { createPlaywrightRoute } from "./routes/playwright-route.js";
import { createLightpandaRoute } from "./routes/lightpanda-route.js";
import {
  defaultBrowserAgentState,
  loadBrowserAgentState,
  mergeBrowserAgentObservation,
  resetBrowserAgentState,
  saveBrowserAgentState,
} from "./state.js";
import { assertRouteIsolation, sanitizeRoutePayload } from "./guards/route-isolation.js";
import { checkCommandAuthority } from "./guards/command-authority.js";
import {
  compareBrowserSnapshots,
  compactBrowserSnapshot,
  safeText,
} from "./shared.js";

const ROUTES = {
  playwright: createPlaywrightRoute(),
  lightpanda: createLightpandaRoute(),
};

function nowMs() {
  return performance.now();
}

function roundMs(value = 0) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function debugTrace(message = "", details = {}) {
  const flag = String(process.env.BROWSER_AGENT_DEBUG_TRACE || "").trim().toLowerCase();
  if (!["1", "true", "yes", "on"].includes(flag)) return;
  const suffix = details && Object.keys(details).length ? ` ${JSON.stringify(details)}` : "";
  console.log(`[browser-agent] ${message}${suffix}`);
}

function usageCalls(entries = []) {
  return entries
    .filter((entry) => entry?.usage && typeof entry.usage === "object")
    .map((entry) => ({
      role: entry.stage || entry.usage.stage || "",
      route: entry.route || entry.usage.route || "",
      model: entry.usage.model || "",
      provider: entry.usage.provider || "",
      promptTokens: Number(entry.usage.promptTokens || 0),
      completionTokens: Number(entry.usage.completionTokens || 0),
      totalTokens: Number(entry.usage.totalTokens || 0),
      totalDurationMs: Number(entry.usage.totalDurationMs || 0),
    }));
}

function summarizeUsage(calls = []) {
  const models = [...new Set(calls.map((call) => call.model).filter(Boolean))];
  return {
    calls: calls.length,
    models,
    promptTokens: calls.reduce((sum, call) => sum + call.promptTokens, 0),
    completionTokens: calls.reduce((sum, call) => sum + call.completionTokens, 0),
    totalTokens: calls.reduce((sum, call) => sum + call.totalTokens, 0),
    totalDurationMs: calls.reduce((sum, call) => sum + call.totalDurationMs, 0),
  };
}

function summarizeBy(calls = [], key = "role") {
  const out = {};
  for (const call of calls) {
    const value = call[key] || "unscoped";
    if (!out[value]) out[value] = [];
    out[value].push(call);
  }
  return Object.fromEntries(
    Object.entries(out).map(([name, scopedCalls]) => [name, summarizeUsage(scopedCalls)])
  );
}

function combineTokenUsage(entries = [], selectedRoute = "") {
  const calls = usageCalls(entries);
  const roles = summarizeBy(calls, "role");
  const routes = summarizeBy(calls, "route");
  const legacyFirst = (stage) => entries.find((entry) => entry.stage === stage)?.usage || null;

  return {
    ...summarizeUsage(calls),
    selectedRoute,
    roles,
    routes,
    callsDetail: calls,
    planner: legacyFirst("planner"),
    routeSelector: legacyFirst("routeSelector"),
    commandBuilder: roles.commandBuilder || null,
    checker: roles.checker || null,
    watcher: roles.watcher || null,
    reporter: roles.reporter || null,
  };
}

function traceEntry({
  role = "",
  title = "",
  status = "",
  step = null,
  tool = "",
  ok = null,
  input = "",
  output = "",
  summary = "",
  reason = "",
  durationMs = null,
  tokens = null,
} = {}) {
  return {
    role,
    title: title || role,
    status,
    step,
    tool,
    ok,
    input: safeText(typeof input === "string" ? input : JSON.stringify(input ?? null, null, 2), 1200),
    output: safeText(typeof output === "string" ? output : JSON.stringify(output ?? null, null, 2), 1400),
    summary: safeText(summary || output || reason || "", 900),
    reason: safeText(reason || "", 900),
    durationMs,
    tokens,
  };
}

function executorVerifiedSuccess(result = {}) {
  if (!result || result.ok === false) return false;
  const actionResult = result.actionResult || {};
  const fillResult = actionResult.fillResult || actionResult.domFallback?.fillResult || null;

  if (
    fillResult?.ok === true &&
    Array.isArray(fillResult.missing) &&
    fillResult.missing.length === 0
  ) {
    return true;
  }

  if (result.tool === "browserScreenshot" && (result.snapshot?.imageBase64 || result.images?.length)) return true;
  if (result.tool === "browserVerify" && result.verification?.ok === true) return true;
  return result.ok === true || result.status === "executed";
}

function normalizeRouteValue(value = "") {
  const route = String(value || "").trim().toLowerCase();
  return ["playwright", "lightpanda"].includes(route) ? route : "";
}

function firstText(...values) {
  for (const value of values) {
    const text = safeText(value || "", 1000);
    if (text) return text;
  }
  return "";
}

function routeFromName(route = "") {
  const normalized = normalizeRouteValue(route);
  return ROUTES[normalized] || null;
}

function stateForRouteSelection(state = {}, route = "") {
  const selected = normalizeRouteValue(route);
  if (!selected) return state;
  if (!state?.route) return state;
  if (state.route === selected) return state;
  return defaultBrowserAgentState(state.sessionId || "default-browser-session");
}

function needsUserConversationResult({
  sessionId = "",
  instruction = "",
  plannerResult = {},
  routeSelection = {},
  routeName = "",
  state = {},
  startedAt = 0,
} = {}) {
  const reason = safeText(plannerResult.plan?.reason || "I need one more detail before I can safely browse for you.", 900);
  const nextSafeAction = safeText(
    plannerResult.plan?.userIntent
      ? `Please clarify the missing detail for: ${plannerResult.plan.userIntent}`
      : "Please share the page, target, or value you want me to use. If you are not sure, tell me your goal and I can suggest a safe next step.",
    900
  );

  return {
    ok: false,
    status: "needs_user",
    route: routeName || routeSelection.route || "",
    summary: reason,
    nextSafeAction,
    requiredUserInput: true,
    currentUrl: state.currentUrl || "",
    currentTitle: state.currentTitle || "",
    state,
    plan: plannerResult.plan,
    routeSelection: routeSelection.decision,
    stepResults: [],
    agentTrace: [
      traceEntry({
        role: "planner",
        title: "Planner",
        status: "needs_user",
        ok: false,
        input: instruction,
        output: plannerResult.plan,
        summary: reason,
        tokens: plannerResult.usage?.totalTokens || null,
      }),
    ],
    pipeline: {
      architecture: "ai_agent_browser_route_isolated_v1",
      route: routeName || routeSelection.route || "",
      planner: plannerResult.plan,
      routeSelection: routeSelection.decision,
      isolation: { ok: true },
    },
    runtimeTiming: {
      totalMs: roundMs(nowMs() - startedAt),
    },
    tokenUsage: combineTokenUsage([
      { stage: "planner", route: "planning", usage: plannerResult.usage },
      { stage: "routeSelector", route: "planning", usage: routeSelection.usage },
    ], routeName || routeSelection.route || ""),
  };
}

async function runSingleStep({
  routeName = "",
  route = null,
  step = {},
  state = {},
  plan = null,
  instruction = "",
  images = [],
  currentUrl = "",
  currentTitle = "",
  cdpUrl = "",
} = {}) {
  const stepStartedAt = nowMs();
  const beforeObservation = state.lastValidObservation || state.lastObservation || null;
  const beforeSnapshot = compactBrowserSnapshot(beforeObservation);
  debugTrace("step:start", { route: routeName, index: step.index, kind: step.kind || "" });
  const commandBuild = await buildExecutableCommand({
    step,
    route: routeName,
    context: {
      instruction,
      state,
      currentUrl,
      currentTitle,
      cdpUrl,
      plan,
      currentObservation: beforeSnapshot || beforeObservation || null,
    },
    images,
  });

  if (commandBuild.needsUser || !commandBuild.command) {
    debugTrace("step:needs_user", { route: routeName, index: step.index, kind: step.kind || "" });
    return {
      ok: false,
      status: "needs_user",
      route: routeName,
      step,
      command: null,
      summary: commandBuild.reason || "The command builder needs more information.",
      nextSafeAction: commandBuild.reason || "Provide the missing URL, target, or value.",
      requiredUserInput: true,
      runtimeMs: roundMs(nowMs() - stepStartedAt),
      agentTrace: [
        traceEntry({
          role: "command_builder",
          title: "Command Builder",
          status: "needs_user",
          step: step.index,
          summary: commandBuild.reason,
          reason: commandBuild.reason,
          ok: false,
          input: step,
          output: commandBuild.command || {},
          tokens: commandBuild.usage?.totalTokens || null,
          durationMs: roundMs(nowMs() - stepStartedAt),
        }),
      ],
      usage: commandBuild.usage || null,
    };
  }

  let command = commandBuild.command;
  let registryEvidence = null;
  if (typeof route.prepare === "function") {
    const prepared = await route.prepare(command, {
      state,
      currentUrl: currentUrl || state.currentUrl || "",
      currentTitle: currentTitle || state.currentTitle || "",
      currentObservation: beforeObservation || null,
      cdpUrl,
    }).catch(() => null);

    if (prepared?.command && typeof prepared.command === "object") {
      command = prepared.command;
    }
    if (prepared?.registryEvidence && typeof prepared.registryEvidence === "object") {
      registryEvidence = prepared.registryEvidence;
    }
  }
  const checkerRegistryEvidence = registryEvidence?.status === "skipped" ? null : registryEvidence;
  debugTrace("step:checker:start", { route: routeName, index: step.index, tool: command.tool || "" });
  const checker = await checkBrowserCommand({
    route: routeName,
    step,
    command,
    currentState: state,
    currentObservation: state.lastValidObservation || state.lastObservation || null,
    registryEvidence: checkerRegistryEvidence,
    plan,
    images,
  });
  const authority = checkCommandAuthority({ route: routeName, command, step });

  if (!checker.check?.approved || !authority.approved) {
    debugTrace("step:checker:blocked", { route: routeName, index: step.index, tool: command.tool || "" });
    const reason = checker.check?.reason || authority.reason || "The checker blocked the command.";
    return {
      ok: false,
      status: "blocked",
      route: routeName,
      step,
      command,
      summary: reason,
      nextSafeAction: checker.check?.messageToPlanner || authority.messageToPlanner || "Replan the step.",
      requiredUserInput: false,
      runtimeMs: roundMs(nowMs() - stepStartedAt),
      agentTrace: [
        traceEntry({
          role: "command_builder",
          title: "Command Builder",
          status: "ready",
          step: step.index,
          tool: command.tool,
          ok: true,
          input: step,
          output: command,
          reason: commandBuild.reason,
          tokens: commandBuild.usage?.totalTokens || null,
          durationMs: roundMs(nowMs() - stepStartedAt),
        }),
        traceEntry({
          role: "checker",
          title: "Checker",
          status: "blocked",
          step: step.index,
          tool: command.tool,
          ok: false,
          input: { step, command, state, registryEvidence: checkerRegistryEvidence },
          output: checker.check,
          summary: reason,
          reason,
          tokens: checker.usage?.totalTokens || null,
          durationMs: roundMs(nowMs() - stepStartedAt),
        }),
      ],
      usage: checker.usage || commandBuild.usage || null,
    };
  }

  debugTrace("step:executor:start", { route: routeName, index: step.index, tool: command.tool || "" });
  const runResult = await route.run(command, {
    state,
    currentUrl: currentUrl || state.currentUrl || "",
    currentTitle: currentTitle || state.currentTitle || "",
    cdpUrl,
    currentObservation: beforeObservation,
  });

  const afterObservation = runResult?.observation || runResult?.snapshot || null;
  const afterSnapshot = compactBrowserSnapshot(afterObservation);
  const snapshotDelta = compareBrowserSnapshots(beforeSnapshot, afterSnapshot);
  const resultImages = Array.isArray(runResult?.images) ? runResult.images : [];
  const reviewResult = {
    ok: runResult?.ok !== false,
    route: runResult?.route || routeName,
    backend: runResult?.backend || "",
    tool: runResult?.tool || command.tool || "",
    error: safeText(runResult?.error || "", 900),
    summary: safeText(runResult?.summary || "", 1200),
    verification: runResult?.verification || null,
    extracted: runResult?.extracted || null,
    pageKey: runResult?.pageKey || "",
    currentUrl: firstText(
      afterSnapshot?.url,
      afterObservation?.url,
      state.currentUrl,
      state.lastValidObservation?.url,
      currentUrl
    ),
    currentTitle: firstText(
      afterSnapshot?.title,
      afterObservation?.title,
      state.currentTitle,
      state.lastValidObservation?.title,
      currentTitle
    ),
    beforeSnapshot,
    afterSnapshot,
    snapshotDelta,
  };
  debugTrace("step:watcher:start", { route: routeName, index: step.index, tool: command.tool || "" });
  const watch = await watchBrowserResult({
    route: routeName,
    step,
    command,
    result: reviewResult,
    beforeSnapshot,
    afterSnapshot,
    snapshotDelta,
    currentState: state,
    images,
    resultImages,
  });

  const verificationResult = command.tool === "browserVerify"
    ? runResult?.verification || watch.watch
    : watch.watch;

  debugTrace("step:reporter:start", { route: routeName, index: step.index, tool: command.tool || "" });
  const report = await reportBrowserResult({
    route: routeName,
    step,
    command,
    result: reviewResult,
    observation: afterSnapshot || beforeSnapshot || {},
    verification: verificationResult,
    extraction: runResult?.extracted || null,
    images,
    resultImages,
    beforeSnapshot,
    afterSnapshot,
    snapshotDelta,
    currentState: state,
  });

  const nextState = mergeBrowserAgentObservation(
    state,
    afterObservation || beforeObservation || null,
    routeName,
    {
      result: runResult,
      command,
      plan,
      instruction,
      pageKey: runResult?.pageKey || "",
      routeEngine: routeName === "playwright" ? "playwright_mcp" : "lightpanda_cdp",
    }
  );

  const sanitizedResult = sanitizeRoutePayload(routeName, {
    ...runResult,
    watch: watch.watch,
    report: report.report,
  });
  const isolation = assertRouteIsolation(routeName, sanitizedResult);

  const authoritativeSuccess = executorVerifiedSuccess(runResult);
  const ok = Boolean(runResult?.ok !== false && authoritativeSuccess && isolation.ok);
  debugTrace("step:done", { route: routeName, index: step.index, tool: command.tool || "", ok });

  return {
    ok,
    status: ok ? "success" : "failed",
    route: routeName,
    step,
    command,
    result: sanitizedResult,
    watch: watch.watch,
    report: report.report,
    beforeSnapshot,
    afterSnapshot,
    snapshotDelta,
    summary: report.report?.summary || runResult?.error || watch.watch?.summary || "Browser step completed.",
    nextSafeAction: report.report?.nextSafeAction || watch.watch?.nextSafeAction || "Continue with the next browser step.",
    currentUrl: firstText(
      afterObservation?.url,
      afterSnapshot?.url,
      nextState.currentUrl,
      nextState.lastValidObservation?.url,
      state.currentUrl,
      currentUrl
    ),
    currentTitle: firstText(
      afterObservation?.title,
      afterSnapshot?.title,
      nextState.currentTitle,
      nextState.lastValidObservation?.title,
      state.currentTitle,
      currentTitle
    ),
    state: nextState,
    isolation,
    runtimeMs: roundMs(nowMs() - stepStartedAt),
    agentTrace: [
      traceEntry({
        role: "command_builder",
        title: "Command Builder",
        status: "ready",
        step: step.index,
        tool: command.tool,
        ok: true,
        input: step,
        output: command,
        reason: commandBuild.reason,
        tokens: commandBuild.usage?.totalTokens || null,
      }),
      traceEntry({
        role: "checker",
        title: "Checker",
        status: "approved",
        step: step.index,
        tool: command.tool,
        ok: true,
        input: { step, command, state, registryEvidence: checkerRegistryEvidence },
        output: checker.check,
        summary: checker.check?.reason || "Approved",
        reason: checker.check?.reason || "",
        tokens: checker.usage?.totalTokens || null,
      }),
      traceEntry({
        role: "executor",
        title: `${routeName === "playwright" ? "Playwright" : "Lightpanda"} Executor`,
        status: runResult?.ok === false ? "failed" : "executed",
        step: step.index,
        tool: command.tool,
        ok: runResult?.ok !== false,
        input: command,
        output: sanitizedResult,
        summary: runResult?.error || "",
      }),
      traceEntry({
        role: "watcher",
        title: "Watcher",
        status: watch.watch?.success ? "passed" : "failed",
        step: step.index,
        tool: command.tool,
        ok: watch.watch?.success,
        input: { beforeSnapshot, afterSnapshot, snapshotDelta, result: reviewResult },
        output: watch.watch,
        summary: watch.watch?.summary || "",
        reason: watch.watch?.reason || "",
        tokens: watch.usage?.totalTokens || null,
      }),
      traceEntry({
        role: "reporter",
        title: "Reporter",
        status: report.report?.success ? "success" : "failed",
        step: step.index,
        tool: command.tool,
        ok: report.report?.success,
        input: { route: routeName, step, command, result: reviewResult, beforeSnapshot, afterSnapshot, snapshotDelta },
        output: report.report,
        summary: report.report?.summary || "",
        reason: report.report?.reason || "",
        tokens: report.usage?.totalTokens || null,
      }),
    ],
    usage: {
      planner: null,
      routeSelector: null,
      commandBuilder: commandBuild.usage || null,
      checker: checker.usage || null,
      watcher: watch.usage || null,
      reporter: report.usage || null,
    },
  };
}

export async function runBrowserAgentOrchestrator({
  sessionId = "default-browser-session",
  instruction = "",
  currentUrl = "",
  currentTitle = "",
  currentState = null,
  route: explicitRoute = "",
  useExtensions = true,
  cdpUrl = "",
  images = [],
} = {}) {
  const startedAt = nowMs();
  debugTrace("task:start", { instruction: safeText(instruction, 120) });
  const baseState = currentState && typeof currentState === "object"
    ? currentState
    : loadBrowserAgentState(sessionId);

  debugTrace("task:planner:start", { sessionId });
  const plannerResult = await planBrowserTask({
    instruction,
    currentUrl,
    currentTitle,
    currentState: baseState,
    images,
  });
  debugTrace("task:planner:done", { status: plannerResult.plan?.status || "" });

  debugTrace("task:route_selector:start", { explicitRoute: explicitRoute || "" });
  const routeSelection = await chooseBrowserRoute({
    instruction,
    plan: plannerResult.plan,
    currentState: baseState,
    explicitRoute: explicitRoute || plannerResult.plan?.routeHint || "",
    images,
  });
  debugTrace("task:route_selector:done", { route: routeSelection.route || "" });

  const routeName = normalizeRouteValue(routeSelection.route) || "playwright";
  const route = routeFromName(routeName);
  const routeState = stateForRouteSelection(baseState, routeName);
  const plannedSteps = Array.isArray(plannerResult.plan?.steps) ? plannerResult.plan.steps : [];

  if (plannerResult.plan?.status === "needs_user" && plannedSteps.length === 0) {
    return needsUserConversationResult({
      sessionId,
      instruction,
      plannerResult,
      routeSelection,
      routeName,
      state: routeState,
      startedAt,
    });
  }

  if (!route) {
    return {
      ok: false,
      status: "failed",
      route: routeName,
      summary: `Selected route ${routeName} is unavailable.`,
      nextSafeAction: "Fix the route selector or route registration.",
      currentUrl: routeState.currentUrl || "",
      currentTitle: routeState.currentTitle || "",
      state: routeState,
      agentTrace: [],
      pipeline: {
        architecture: "ai_agent_browser_route_isolated_v1",
        route: routeName,
        planner: plannerResult.plan,
        routeSelection: routeSelection.decision,
      },
      runtimeTiming: {
        totalMs: roundMs(nowMs() - startedAt),
      },
    };
  }

  if (routeName === "lightpanda" && plannerResult.plan?.needsLightpandaWarmup) {
    debugTrace("task:warm:start", { route: routeName });
    await route.warm({
      state: routeState,
      currentUrl: routeState.currentUrl || currentUrl || "",
      currentTitle: routeState.currentTitle || currentTitle || "",
      cdpUrl,
    }).catch(() => null);
    debugTrace("task:warm:done", { route: routeName });
  }

  const stepResults = [];
  let workingState = routeState;
  let lastResult = null;

  for (const step of plannedSteps) {
    debugTrace("task:step:dispatch", { index: step.index, kind: step.kind || "" });
    const result = await runSingleStep({
      routeName,
      route,
      step,
      state: workingState,
      plan: plannerResult.plan,
      instruction,
      currentUrl: workingState.currentUrl || currentUrl || "",
      currentTitle: workingState.currentTitle || currentTitle || "",
      cdpUrl,
      images,
    });

    stepResults.push(result);
    workingState = result.state || workingState;
    lastResult = result;
    debugTrace("task:step:complete", { index: step.index, status: result.status || "", ok: Boolean(result.ok) });

    if (!result.ok || result.status === "needs_user" || result.status === "blocked" || result.status === "failed") {
      break;
    }
  }

  const completed = stepResults.filter((item) => item.ok).length;
  const total = plannedSteps.length;
  const final = lastResult || {};
  const success = completed === total && total > 0 && final.ok !== false;

  const report = final.report || null;
  const bestCurrentUrl = firstText(
    final.currentUrl,
    workingState.currentUrl,
    workingState.lastValidObservation?.url,
    workingState.lastObservation?.url,
    currentUrl
  );
  const bestCurrentTitle = firstText(
    final.currentTitle,
    workingState.currentTitle,
    workingState.lastValidObservation?.title,
    workingState.lastObservation?.title,
    currentTitle
  );

  const result = {
    ok: success,
    status: success ? "success" : final.status || (plannerResult.plan?.status === "needs_user" ? "needs_user" : "failed"),
    route: routeName,
    summary: report?.summary || final.summary || plannerResult.plan?.reason || "Browser task completed.",
    nextSafeAction: final.nextSafeAction || report?.nextSafeAction || "Continue with the next browser instruction.",
    currentUrl: bestCurrentUrl,
    currentTitle: bestCurrentTitle,
    state: workingState,
    plan: plannerResult.plan,
    routeSelection: routeSelection.decision,
    stepResults,
    agentTrace: [
      traceEntry({
        role: "planner",
        title: "Planner",
        status: plannerResult.plan?.status || "ready",
        step: null,
        ok: plannerResult.ok,
        input: instruction,
        output: plannerResult.plan,
        summary: plannerResult.plan?.reason || plannerResult.plan?.userIntent || "",
        tokens: plannerResult.usage?.totalTokens || null,
      }),
      traceEntry({
        role: "route_selector",
        title: "Route Selector",
        status: routeSelection.route ? "selected" : "needs_user",
        ok: Boolean(routeSelection.route),
        input: { instruction, plan: plannerResult.plan },
        output: routeSelection.decision,
        summary: routeSelection.decision?.reason || "",
        tokens: routeSelection.usage?.totalTokens || null,
      }),
      ...stepResults.flatMap((entry, index) => [
        traceEntry({
          role: "step",
          title: `Step ${index + 1}`,
          status: entry.status,
          step: index + 1,
          ok: entry.ok,
          input: entry.step,
          output: entry.summary || "",
          summary: entry.summary || "",
        }),
        ...(Array.isArray(entry.agentTrace) ? entry.agentTrace.map((trace) => ({ ...trace, step: index + 1 })) : []),
      ]),
    ],
    pipeline: {
      architecture: "ai_agent_browser_route_isolated_v1",
      route: routeName,
      planner: plannerResult.plan,
      routeSelection: routeSelection.decision,
      stepResults,
      isolation: {
        ok: true,
      },
    },
    runtimeTiming: {
      totalMs: roundMs(nowMs() - startedAt),
    },
    tokenUsage: combineTokenUsage([
      { stage: "planner", route: "planning", usage: plannerResult.usage },
      { stage: "routeSelector", route: "planning", usage: routeSelection.usage },
      ...stepResults.flatMap((entry) => [
        { stage: "commandBuilder", route: routeName, usage: entry.usage?.commandBuilder || null },
        { stage: "checker", route: routeName, usage: entry.usage?.checker || null },
        { stage: "watcher", route: routeName, usage: entry.usage?.watcher || null },
        { stage: "reporter", route: routeName, usage: entry.usage?.reporter || null },
      ]),
    ], routeName),
  };

  saveBrowserAgentState({
    ...workingState,
    sessionId,
    route: routeName,
    routeEngine: route === ROUTES.playwright ? "playwright_mcp" : "lightpanda_cdp",
    lastInstruction: instruction,
    lastPlan: plannerResult.plan,
  });
  debugTrace("task:done", { route: routeName, status: result.status || "" });

  return result;
}

export async function runBrowserAgentRouteOnly(args = {}) {
  return runBrowserAgentOrchestrator(args);
}
