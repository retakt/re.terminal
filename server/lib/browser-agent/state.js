import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_DIR = path.resolve(__dirname, "..", "config", "browser-agent");

function nowIso() {
  return new Date().toISOString();
}

function safeText(value = "", limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function meaningfulBrowserUrl(value = "") {
  const url = safeText(value, 1000);
  return /^https?:\/\//i.test(url) ? url : "";
}

function sessionFilePath(sessionId = "default-browser-session") {
  const safeId = String(sessionId || "default-browser-session")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "default-browser-session";
  return path.join(STATE_DIR, `${safeId}.json`);
}

function redactValue(value, pathParts = []) {
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactValue(entry, [...pathParts, String(index)]));
  }

  if (!value || typeof value !== "object") {
    return typeof value === "string" ? safeText(value, 4000) : value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const keyPath = [...pathParts, key].join(".");
    if (/\b(password|pass|pwd|otp|code|pin|secret|token)\b/i.test(keyPath) && typeof entry === "string") {
      return [key, "[redacted]"];
    }
    if (key === "value" && value.secret === true) {
      return [key, "[redacted]"];
    }
    return [key, redactValue(entry, [...pathParts, key])];
  }));
}

function isBrowserAgentStateRecord(value = {}) {
  if (!value || typeof value !== "object") return false;
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) return false;
  return Boolean(
    typeof value.updatedAt === "string" ||
    typeof value.currentUrl === "string" ||
    typeof value.currentTitle === "string" ||
    typeof value.lastInstruction === "string" ||
    Array.isArray(value.history)
  );
}

function summarizeBrowserAgentState(state = {}) {
  const currentUrl = meaningfulBrowserUrl(state.currentUrl || state.lastValidObservation?.url || state.lastObservation?.url || "");
  const currentTitle = safeText(state.currentTitle || state.lastValidObservation?.title || state.lastObservation?.title || "", 200);
  const lastInstruction = safeText(state.lastInstruction || "", 400);
  const summary = safeText(
    state.lastResult?.summary ||
      state.lastResult?.status ||
      lastInstruction ||
      currentTitle ||
      currentUrl ||
      "browser session",
    400
  );

  return {
    sessionId: safeText(state.sessionId || "default-browser-session", 120),
    currentUrl,
    currentTitle,
    route: safeText(state.route || "", 40),
    routeEngine: safeText(state.routeEngine || "", 40),
    lastInstruction,
    summary,
    status: safeText(state.lastResult?.status || state.status || "", 40),
    updatedAt: safeText(state.updatedAt || nowIso(), 40),
    historyCount: Array.isArray(state.history) ? state.history.length : 0,
  };
}

export function listBrowserAgentSessions() {
  try {
    if (!fs.existsSync(STATE_DIR)) return [];

    const sessions = fs
      .readdirSync(STATE_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try {
          const filePath = path.join(STATE_DIR, name);
          const loaded = JSON.parse(fs.readFileSync(filePath, "utf8"));
          if (!isBrowserAgentStateRecord(loaded)) return null;
          return summarizeBrowserAgentState(loaded);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return sessions.sort((left, right) => {
      const leftTime = Number(new Date(left.updatedAt || 0).getTime() || 0);
      const rightTime = Number(new Date(right.updatedAt || 0).getTime() || 0);
      return rightTime - leftTime;
    });
  } catch {
    return [];
  }
}

export function defaultBrowserAgentState(sessionId = "default-browser-session") {
  return {
    sessionId: String(sessionId || "default-browser-session"),
    route: "",
    routeEngine: "",
    currentUrl: "",
    currentTitle: "",
    currentPageKey: "",
    lastInstruction: "",
    lastPlan: null,
    lastCommand: null,
    lastResult: null,
    lastObservation: null,
    lastValidObservation: null,
    lastFailedObservation: null,
    engineFailures: {},
    history: [],
    updatedAt: nowIso(),
  };
}

export function loadBrowserAgentState(sessionId = "default-browser-session") {
  const file = sessionFilePath(sessionId);
  let loaded = {};

  try {
    loaded = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    loaded = {};
  }

  const state = {
    ...defaultBrowserAgentState(sessionId),
    ...(loaded && typeof loaded === "object" ? loaded : {}),
    sessionId: String(sessionId || loaded?.sessionId || "default-browser-session"),
  };

  return state;
}

export function saveBrowserAgentState(state = {}) {
  const next = {
    ...defaultBrowserAgentState(state.sessionId || "default-browser-session"),
    ...(state && typeof state === "object" ? state : {}),
    updatedAt: nowIso(),
  };

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(sessionFilePath(next.sessionId), JSON.stringify(redactValue(next), null, 2) + "\n", "utf8");
  return next;
}

export function resetBrowserAgentState(sessionId = "default-browser-session") {
  const file = sessionFilePath(sessionId);
  try {
    fs.unlinkSync(file);
  } catch {}
  return defaultBrowserAgentState(sessionId);
}

export function updateBrowserAgentState(state = {}, patch = {}) {
  return saveBrowserAgentState({
    ...state,
    ...patch,
    sessionId: state.sessionId || patch.sessionId || "default-browser-session",
  });
}

export function mergeBrowserAgentObservation(state = {}, observation = null, route = "", extras = {}) {
  const observedUrl = meaningfulBrowserUrl(observation?.url || "");
  const next = {
    ...state,
    route: route || state.route || "",
    routeEngine: extras.routeEngine || state.routeEngine || route || "",
    currentUrl: observedUrl || state.currentUrl || "",
    currentTitle: observation?.title || state.currentTitle || "",
    lastObservation: observation || state.lastObservation || null,
    lastResult: extras.result || state.lastResult || null,
    lastInstruction: extras.instruction ? safeText(extras.instruction, 3000) : state.lastInstruction || "",
  };

  if (observation && observation.ok !== false) {
    next.lastValidObservation = observation;
    next.lastFailedObservation = null;
  } else if (observation) {
    next.lastFailedObservation = observation;
  }

  if (extras.command) {
    next.lastCommand = extras.command;
  }

  if (extras.plan) {
    next.lastPlan = extras.plan;
  }

  if (extras.pageKey) {
    next.currentPageKey = extras.pageKey;
  }

  next.history = [
    ...(Array.isArray(state.history) ? state.history : []),
    {
      at: nowIso(),
      route: route || state.route || "",
      url: observedUrl || state.currentUrl || "",
      title: observation?.title || "",
      tool: extras.command?.tool || "",
      status: extras.result?.status || observation?.status || "",
    },
  ].slice(-40);

  return saveBrowserAgentState(next);
}
