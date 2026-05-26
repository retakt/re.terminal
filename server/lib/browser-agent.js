import { browserAgentRuntimeConfig, withBrowserAgentRuntimeOverrides } from "./browser-llm-runtime.js";
import { runBrowserAgentOrchestrator } from "./browser-agent/orchestrator.js";
import {
  defaultBrowserAgentState,
  loadBrowserAgentState,
  mergeBrowserAgentObservation,
  resetBrowserAgentState,
  saveBrowserAgentState,
  listBrowserAgentSessions,
} from "./browser-agent/state.js";
import {
  buildBrowserAgentMarkdownReport,
  buildBrowserAgentStatusReport,
  buildBrowserAgentUiReport,
} from "./browser-agent/report-exporter.js";

const DEFAULT_SESSION_ID = "default-browser-session";

function safeSessionId(value = DEFAULT_SESSION_ID) {
  return String(value || DEFAULT_SESSION_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || DEFAULT_SESSION_ID;
}

function safeText(value = "", limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function withUiReport(result = {}, args = {}) {
  return {
    ...result,
    uiReport: buildBrowserAgentUiReport(result, { includeImages: args.includeImages === true }),
  };
}

function runtimeOverridesFromArgs(args = {}) {
  return {
    // `model` is commonly the chat UI model. Browser-agent has its own
    // configured model stack, so only the explicit browser-agent override may
    // replace it.
    model: safeText(args.browserAgentModel || "", 240),
    baseUrl: safeText(args.baseUrl || args.browserAgentBaseUrl || "", 1000),
    models: args.models && typeof args.models === "object" ? args.models : {},
  };
}

// Kept as a no-op compatibility hook for the MCP gateway. The route-isolated
// browser agent now talks to Playwright through the external MCP client.
export function setBrowserAgentMcpCaller() {
  return null;
}

export async function browserAgentRun(args = {}) {
  return withBrowserAgentRuntimeOverrides(runtimeOverridesFromArgs(args), async () => {
    const sessionId = safeSessionId(args.sessionId || DEFAULT_SESSION_ID);
    const result = await runBrowserAgentOrchestrator({
      ...args,
      sessionId,
    });
    return withUiReport(result, args);
  });
}

export async function browserAgentObserve(args = {}) {
  return browserAgentRun({
    ...args,
    instruction: safeText(args.instruction || "Observe the current page and report what is visible.", 2000),
  });
}

export async function browserAgentReset(args = {}) {
  const sessionId = safeSessionId(args.sessionId || DEFAULT_SESSION_ID);
  resetBrowserAgentState(sessionId);
  const state = defaultBrowserAgentState(sessionId);
  const result = {
    ok: true,
    status: "success",
    sessionId,
    state,
    summary: "Browser session reset.",
  };
  return {
    ...result,
    uiReport: buildBrowserAgentStatusReport(result),
  };
}

export async function browserAgentCreateSession(args = {}) {
  const sessionId = safeSessionId(args.sessionId || DEFAULT_SESSION_ID);
  saveBrowserAgentState(defaultBrowserAgentState(sessionId));
  return browserAgentStatus({ ...args, sessionId });
}

export async function browserAgentStatus(args = {}) {
  return withBrowserAgentRuntimeOverrides(runtimeOverridesFromArgs(args), async () => {
    const sessionId = safeSessionId(args.sessionId || DEFAULT_SESSION_ID);
    const state = loadBrowserAgentState(sessionId);
    const status = {
      ok: true,
      status: "success",
      sessionId,
      state,
      runtime: browserAgentRuntimeConfig({ display: true }),
      browserHealth: {
        ok: true,
        status: "route-isolated",
        route: state.route || "",
        backend: state.routeEngine || "",
      },
    };
    return {
      ...status,
      uiReport: buildBrowserAgentStatusReport(status),
    };
  });
}

export async function browserAgentListSessions() {
  return listBrowserAgentSessions();
}

export async function browserAgentRecordNavigation(args = {}) {
  const sessionId = safeSessionId(args.sessionId || DEFAULT_SESSION_ID);
  const currentUrl = safeText(args.currentUrl || args.url || "", 1000);
  const currentTitle = safeText(args.currentTitle || args.title || "", 300);
  const instruction = safeText(
    args.instruction || "User manually changed the active browser page from the UI.",
    1000,
  );
  const state = loadBrowserAgentState(sessionId);
  mergeBrowserAgentObservation(
    state,
    {
      ok: true,
      status: "success",
      engine: "browser_ui",
      url: currentUrl,
      title: currentTitle,
      textPreview: safeText(args.textPreview || "", 3000),
      stats: args.stats && typeof args.stats === "object" ? args.stats : {},
    },
    "manual",
    {
      instruction,
      routeEngine: "browser_ui",
      command: {
        tool: "manualNavigation",
        backend: "browser_ui",
        args: {
          url: currentUrl,
          title: currentTitle,
        },
      },
      result: {
        ok: true,
        status: "manual_navigation",
        engine: "browser_ui",
        currentUrl,
        currentTitle,
        summary: instruction,
      },
    },
  );
  return browserAgentStatus({ ...args, sessionId });
}

export async function browserAgentLearn(args = {}) {
  return {
    ok: false,
    status: "unsupported",
    summary: "Learning legacy site actions was removed from the browser agent cleanup.",
    nextSafeAction: "Use normal browser-agent instructions, or add a dedicated route/tool module for reusable site skills.",
    instruction: safeText(args.instruction || "", 1000),
    requiredUserInput: false,
  };
}

export async function browserAgentDiagnose(args = {}) {
  const sessionId = safeSessionId(args.sessionId || DEFAULT_SESSION_ID);
  const state = loadBrowserAgentState(sessionId);
  const error = safeText(args.error || "", 1000);
  const diagnosis = error
    ? `The route-isolated browser agent reported: ${error}`
    : "No browser error was provided. Check the current route, backend, and latest step evidence.";

  return {
    ok: true,
    status: "success",
    sessionId,
    instruction: safeText(args.instruction || state.lastInstruction || "", 1000),
    currentUrl: state.currentUrl || state.lastValidObservation?.url || "",
    currentTitle: state.currentTitle || state.lastValidObservation?.title || "",
    diagnostics: {
      diagnosis,
      evidence: [
        error,
        state.lastResult?.error,
        state.lastFailedObservation?.error,
      ].map((entry) => safeText(entry, 400)).filter(Boolean),
      suggestedFixes: [
        "Inspect result.uiReport.steps for the exact blocked or failed step.",
        "If switching browser engines, restart the task from the beginning on the other route.",
        "Use includeImages=true only when screenshot data is needed by the UI.",
      ],
      route: state.route || "",
      backend: state.routeEngine || "",
    },
    state: {
      currentUrl: state.currentUrl || "",
      currentTitle: state.currentTitle || "",
      route: state.route || "",
      routeEngine: state.routeEngine || "",
      lastFailedObservation: state.lastFailedObservation || null,
    },
  };
}

export {
  buildBrowserAgentMarkdownReport,
  buildBrowserAgentStatusReport,
  buildBrowserAgentUiReport,
};
