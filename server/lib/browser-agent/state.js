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
