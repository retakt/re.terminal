/**
 * re.Term â€” Persistent Terminal Server
 *
 * Sessions are GLOBAL â€” they survive client disconnects.
 * Reconnecting clients get their existing PTY sessions back.
 *
 * Flow:
 *   connect â†’ server sends "ready" + "session-list" (all live sessions)
 *   client sends "attach" to subscribe to a session's output
 *   client sends "create" to spawn a new session
 *   client sends "close" to kill a session permanently
 *   disconnect â†’ sessions keep running, output is buffered
 */

import dotenv from "dotenv";
import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { URL } from "url";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import {
  checkMemoryHealth,
  getMemoryStatus,
  saveCommand,
  saveError,
  saveFact,
  saveFix,
  savePreference,
  searchMemory,
  updateMemory,
  getGraphSnapshot,
} from "./lib/memory-client.js";
import {
  getHealthStatus,
  getReadinessStatus,
  validateServerEnvironment,
} from "./lib/readiness.js";
import {
  callMcpTool,
  getExtensionCatalog,
  getMcpLogs,
  getServiceStatus,
  lightpandaNavigate,
  lightpandaStatus,
  openHeadfulBrowser,
  listMcpServers,
  listMcpToolDefinitions,
  listMcpTools,
  routeMcpIntent,
} from "./lib/mcp-gateway.js";
import {
  compactBrowserStateForModel,
  getBrowserState,
} from "./lib/browser-state-provider.js";
import {
  browserAgentReset,
  browserAgentCreateSession,
  browserAgentListSessions,
  browserAgentRun,
  browserAgentStatus,
} from "./lib/browser-agent.js";
import { convertMcpLogsToAuditInputs } from "./lib/mcp-log-audit.js";
import { importEzhrmObservation } from "./lib/ezhrm-skill-importer.js";
import {
  getSiteSkill,
  listPublicSiteSkills,
  matchSiteSkillForUrl,
} from "./lib/site-skills.js";
import {
  getExtension,
  listExtensions,
  matchExtensionForUrl,
  planExtensionAction,
  setExtensionEnabled,
} from "./lib/extensions.js";
import {
  getCommunityServices,
  getCommunityStatus,
  listCommunityChats,
  listCommunityMessages,
  sendCommunityMessage,
  beginCommunityLogin,
  submitCommunityPhone,
  submitCommunityCode,
  submitCommunityPassword,
  logoutCommunityService,
} from "./lib/community/index.js";
import {
  appendAuditEvent,
  appendAuditEvents,
  getAuditLogFile,
  normalizeAuditUsage,
  queryAuditEvents,
} from "./lib/audit-log.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// â”€â”€â”€ Env â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

for (const p of [path.join(__dirname, ".env"), path.join(__dirname, "..", ".env")]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); console.log(`[re.Term] env: ${p}`); break; }
}

// â”€â”€â”€ Logging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const LOG_FILE = process.env.LOG_FILE || path.join(__dirname, "re-term.log");
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
const AUDIT_LOG_FILE = getAuditLogFile();

function auditSummary(value, limit = 240) {
  return String(value || "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function auditPreview(value, limit = 500) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return auditSummary(text, limit);
}

function auditStatusFromLevel(level) {
  switch (String(level || "").toUpperCase()) {
    case "ERROR":
      return "error";
    case "WARN":
      return "warn";
    case "EVENT":
      return "success";
    default:
      return "info";
  }
}

function auditUsageFromUnknown(value, defaults = {}) {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || !/^[\[{]/.test(trimmed)) return null;
    try {
      return auditUsageFromUnknown(JSON.parse(trimmed), defaults);
    } catch {
      return null;
    }
  }

  if (typeof value !== "object") return null;
  return normalizeAuditUsage(
    value.tokenUsage && typeof value.tokenUsage === "object" ? value.tokenUsage : value,
    defaults,
  );
}

function appendServerAudit(category, level, message, meta = {}) {
  appendAuditEvent({
    source: "server",
    category: "server",
    action: `${String(category || "app")}.${String(level || "info").toLowerCase()}`,
    status: auditStatusFromLevel(level),
    title: message,
    summary: auditPreview(meta, 360),
    refs: {
      serverCategory: String(category || "app"),
      level: String(level || "INFO").toUpperCase(),
    },
    payload: {
      serverCategory: category,
      level,
      message,
      meta,
    },
  });
}

function log(level, category, message, meta = {}) {
  const ts   = new Date().toISOString();
  const line = JSON.stringify({ ts, level, category, message, ...meta });
  // Console with color
  const colors = { INFO: "\x1b[36m", WARN: "\x1b[33m", ERROR: "\x1b[31m", EVENT: "\x1b[32m" };
  const reset  = "\x1b[0m";
  console.log(`${colors[level] || ""}[${ts.slice(11,19)}] [${level}] [${category}] ${message}${reset}`, Object.keys(meta).length ? meta : "");
  // File (JSON lines)
  logStream.write(line + "\n");
  appendServerAudit(category, level, message, meta);
}

// Stats tracked in memory
const stats = {
  totalConnections:  0,
  totalSessions:     0,
  totalFilesRead:    0,
  totalFilesWritten: 0,
  startedAt:         Date.now(),
};

const PORT        = parseInt(process.env.TERMINAL_PORT  || "3003", 10);
const PASSWORD    = process.env.TERMINAL_PASSWORD       || "admin123";
const CORS_ORIGIN = process.env.TERMINAL_CORS_ORIGIN    || "*";
const MAX_SESSIONS= parseInt(process.env.MAX_SESSIONS   || "10", 10);
const HISTORY_MAX = parseInt(process.env.HISTORY_MAX    || "2000", 10);
const SHELL       = process.platform === "win32" ? "powershell.exe" : (process.env.SHELL || "bash");
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "https://chat-api.retakt.cc").replace(/\/+$/, "").replace(/\/api$/, "");
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL || "llama3.1";
const MEMORY_EXTRACTION_MODEL = process.env.MEMORY_EXTRACTION_MODEL || "";
const MEMORY_AUTOSAVE = !["0", "false", "off", "no"].includes(String(process.env.MEMORY_AUTOSAVE || "true").toLowerCase());
const MODEL_WARMUP_ENABLED = !["0", "false", "off", "no"].includes(String(process.env.MODEL_WARMUP_ENABLED || "true").toLowerCase());
const MODEL_WARMUP_SCOPE = String(process.env.MODEL_WARMUP_SCOPE || "active").toLowerCase() === "all" ? "all" : "active";
const MODEL_WARMUP_KEEP_ALIVE = process.env.MODEL_WARMUP_KEEP_ALIVE || "10m";
const MODEL_WARMUP_TIMEOUT_MS = parseInt(process.env.MODEL_WARMUP_TIMEOUT_MS || "20000", 10);
const BROWSER_AGENT_BASE_URL = (process.env.BROWSER_AGENT_BASE_URL || "").replace(/\/+$/, "").replace(/\/api$/, "");
const BROWSER_AGENT_MODEL = process.env.BROWSER_AGENT_MODEL || "";

log("INFO", "startup", "re.Term server starting", {
  port: PORT,
  shell: SHELL,
  maxSessions: MAX_SESSIONS,
  logFile: LOG_FILE,
  auditLogFile: AUDIT_LOG_FILE,
});
// Sessions live here, independent of any WebSocket connection.

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   pty: import('node-pty').IPty,
 *   history: string[],
 *   cols: number,
 *   rows: number,
 *   createdAt: number,
 * }} GlobalSession
 */

/** @type {Map<string, GlobalSession>} */
const globalSessions = new Map();

// Subscribers: sessionId â†’ Set of WebSocket connections watching it
/** @type {Map<string, Set<WebSocket>>} */
const subscribers = new Map();
const terminalOutputAuditBuffers = new Map();

function flushTerminalAudit(sessionId) {
  const buffered = terminalOutputAuditBuffers.get(sessionId);
  if (!buffered || !buffered.data) return;
  if (buffered.timer) clearTimeout(buffered.timer);
  terminalOutputAuditBuffers.delete(sessionId);
  appendAuditEvent({
    source: "server.terminal",
    category: "terminal",
    action: "output",
    status: "info",
    title: buffered.title || sessionId,
    summary: auditSummary(buffered.data, 320),
    refs: {
      sessionId,
      direction: "out",
      bytes: buffered.bytes,
    },
    payload: {
      sessionId,
      title: buffered.title || sessionId,
      direction: "out",
      bytes: buffered.bytes,
      startedAt: buffered.startedAt,
      flushedAt: Date.now(),
      data: buffered.data,
    },
  });
}

function queueTerminalOutputAudit(sessionId, title, data) {
  if (!data) return;
  const existing = terminalOutputAuditBuffers.get(sessionId) || {
    title,
    data: "",
    bytes: 0,
    startedAt: Date.now(),
    timer: null,
  };

  existing.title = title || existing.title || sessionId;
  existing.data += data;
  existing.bytes += Buffer.byteLength(data, "utf8");
  if (existing.timer) clearTimeout(existing.timer);
  existing.timer = setTimeout(() => flushTerminalAudit(sessionId), 120);
  terminalOutputAuditBuffers.set(sessionId, existing);

  if (existing.bytes >= 16 * 1024) {
    flushTerminalAudit(sessionId);
  }
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ollamaUrl(pathname) {
  return `${OLLAMA_BASE_URL}${pathname}`;
}

function fetchWithTimeout(url, options = {}, timeoutMs = MODEL_WARMUP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function addWarmupTarget(targets, baseUrl, model, source) {
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const normalizedModel = String(model || "").trim();
  if (!normalizedBaseUrl || !normalizedModel) return;
  const key = `${normalizedBaseUrl}\n${normalizedModel}`;
  if (!targets.has(key)) {
    targets.set(key, { baseUrl: normalizedBaseUrl, model: normalizedModel, source });
  }
}

async function listWarmupModels(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "").replace(/\/api$/, "");
  if (!normalizedBaseUrl) return [];
  const upstream = await fetchWithTimeout(`${normalizedBaseUrl}/api/tags`, { method: "GET" }, Math.min(MODEL_WARMUP_TIMEOUT_MS, 15000));
  if (!upstream.ok) return [];
  const data = await upstream.json().catch(() => ({}));
  return (Array.isArray(data.models) ? data.models : [])
    .map((model) => String(model?.name || model?.model || "").trim())
    .filter(Boolean);
}

async function buildWarmupTargets({ chatModel, includeBrowserAgent, all }) {
  const targets = new Map();
  const scope = all ? "all" : MODEL_WARMUP_SCOPE;

  if (scope === "all") {
    const chatModels = await listWarmupModels(OLLAMA_BASE_URL).catch((err) => {
      log("WARN", "ollama", "warmup model listing failed", { source: "chat", error: err.message });
      return [];
    });
    for (const model of chatModels) addWarmupTarget(targets, OLLAMA_BASE_URL, model, "chat");
    if (chatModels.length === 0) addWarmupTarget(targets, OLLAMA_BASE_URL, chatModel || OLLAMA_MODEL, "chat");

  } else {
    addWarmupTarget(targets, OLLAMA_BASE_URL, chatModel || OLLAMA_MODEL, "chat");
  }

  if (includeBrowserAgent) {
    if (BROWSER_AGENT_BASE_URL && BROWSER_AGENT_MODEL) {
      addWarmupTarget(targets, BROWSER_AGENT_BASE_URL, BROWSER_AGENT_MODEL, "browser_agent");
    } else {
      log("WARN", "browser-agent", "browser agent model warmup skipped", {
        reason: "browser_agent is LLM-required but BROWSER_AGENT_BASE_URL or BROWSER_AGENT_MODEL is missing",
        configured: false,
      });
    }
  }

  return [...targets.values()];
}

async function warmupOneModel(target) {
  const startedAt = Date.now();
  const upstream = await fetchWithTimeout(`${target.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: target.model,
      messages: [{ role: "user", content: "warmup" }],
      stream: false,
      think: false,
      keep_alive: MODEL_WARMUP_KEEP_ALIVE,
      options: {
        num_predict: 1,
        temperature: 0,
      },
    }),
  });
  await upstream.text().catch(() => "");
  if (!upstream.ok) {
    throw new Error(`warmup failed with HTTP ${upstream.status}`);
  }
  return {
    ok: true,
    model: target.model,
    source: target.source,
    status: upstream.status,
    durationMs: Date.now() - startedAt,
  };
}

async function runModelWarmup({ chatModel, includeBrowserAgent, all }) {
  const targets = await buildWarmupTargets({ chatModel, includeBrowserAgent, all });
  const settled = await Promise.allSettled(targets.map(warmupOneModel));
  const results = settled.map((entry, index) => {
    const target = targets[index];
    if (entry.status === "fulfilled") return entry.value;
    return {
      ok: false,
      model: target?.model,
      source: target?.source,
      error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
    };
  });
  return {
    ok: results.every((result) => result.ok),
    scope: all ? "all" : MODEL_WARMUP_SCOPE,
    count: targets.length,
    results,
  };
}

function sanitizeOllamaMessage(message) {
  return {
    role: ["system", "assistant", "user", "tool"].includes(message?.role) ? message.role : "user",
    content: String(message?.content || ""),
    ...(Array.isArray(message?.images) ? { images: message.images } : {}),
    ...(message?.audio ? { audio: String(message.audio) } : {}),
    ...(message?.tool_name ? { tool_name: String(message.tool_name) } : {}),
    ...(Array.isArray(message?.tool_calls) ? { tool_calls: message.tool_calls } : {}),
  };
}

function parseMemoryExtraction(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const memories = Array.isArray(parsed) ? parsed : parsed.memories;
    if (!Array.isArray(memories)) return [];
    return memories
      .map((memory) => ({
        subject: String(memory?.subject || "user").slice(0, 120),
        predicate: String(memory?.predicate || "remembers").slice(0, 80),
        object: String(memory?.object || "").slice(0, 500),
        summary: String(memory?.summary || "").slice(0, 700),
        confidence: Number(memory?.confidence ?? 0.7),
        source: "chat.autonomous",
      }))
      .filter((memory) => {
        const combined = `${memory.subject} ${memory.predicate} ${memory.object} ${memory.summary}`.toLowerCase();
        if (!(memory.summary || memory.object)) return false;
        if (memory.confidence < 0.6) return false;
        if (/\b(asked|question|wanted to know|discussed|talked about|conversation)\b/.test(combined)
          && !/\b(prefer|preference|always|never|default|project|server|repo|api|endpoint|fix|fixed|error|decision|uses|using)\b/.test(combined)) {
          return false;
        }
        return true;
      });
  } catch {
    return [];
  }
}

function shouldAttemptAutonomousMemory(userMessage, assistantMessage) {
  const text = String(userMessage || "").trim();
  if (!MEMORY_AUTOSAVE || !text || !String(assistantMessage || "").trim()) return false;
  if (text.length < 18) return false;
  if (/^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great|gm|gn)[!.?\s]*$/i.test(text)) return false;
  const lower = text.toLowerCase();
  return [
    /\bi\s+(prefer|like|want|need|use|always|usually|never|don't|dont|do not|hate|love)\b/,
    /\bmy\s+(name|email|domain|website|repo|repository|project|server|vps|api|model|workflow|preference|style)\b/,
    /\bwe\s+(decided|use|are using|should use|will use|need to|prefer)\b/,
    /\b(from now on|going forward|default to|keep using|stop using)\b/,
    /\b(error|failed|failure|bug|fix|fixed|workaround|root cause|solution)\b/,
    /\b(config|setting|env|endpoint|token|port|database|falkor|graphiti|ollama|mcp)\b/,
  ].some((pattern) => pattern.test(lower));
}

async function extractDurableMemories({ projectId, model, userMessage, assistantMessage }) {
  if (!shouldAttemptAutonomousMemory(userMessage, assistantMessage)) {
    return { memories: [], usage: null };
  }

  const prompt = [
    "Extract only durable, useful long-term memories from this chat turn.",
    "Save preferences, stable user/project facts, recurring constraints, decisions, errors and fixes.",
    "CRITICAL: If a binary required a specific path (e.g., `./binary` instead of global), a specific flag, or had a unique local error/fix, save it as a 'fix' or 'preference'. This helps avoid repeating the same pathing/subcommand mistakes.",
    "Do not save one-off questions, greetings, filler, or facts that are likely temporary.",
    "Do not save that the user asked a question or discussed a topic.",
    "Return strict JSON only: {\"memories\":[{\"subject\":\"...\",\"predicate\":\"...\",\"object\":\"...\",\"summary\":\"...\",\"confidence\":0.0}]}",
    "If nothing should be saved, return {\"memories\":[]}.",
    "",
    `User: ${userMessage}`,
    `Assistant: ${assistantMessage}`,
  ].join("\n");

  try {
    const upstream = await fetch(ollamaUrl("/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MEMORY_EXTRACTION_MODEL || model,
        stream: false,
        format: "json",
        think: false,
        options: { temperature: 0, num_ctx: 4096 },
        messages: [
          { role: "system", content: "You are a precise memory extraction layer for an AI assistant." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!upstream.ok) {
      log("WARN", "memory", "memory extraction model call failed", { status: upstream.status });
      return { memories: [], usage: null };
    }

    const data = await upstream.json();
    const extracted = parseMemoryExtraction(data?.message?.content || data?.response || "");
    const saved = [];

    for (const memory of extracted.slice(0, 5)) {
      const result = await saveFact(projectId, memory);
      if (result?.success && result.memory) saved.push(result.memory);
    }

    return {
      memories: saved,
      usage: auditUsageFromUnknown(data, {
        stage: "memory.extract",
        model: MEMORY_EXTRACTION_MODEL || model,
      }),
    };
  } catch (err) {
    log("WARN", "memory", "memory extraction failed", { error: err.message });
    return { memories: [], usage: null };
  }
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(msg)); } catch (_) {}
  }
}

function broadcast(sessionId, msg) {
  const subs = subscribers.get(sessionId);
  if (!subs) return;
  const payload = JSON.stringify(msg);
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(payload); } catch (_) {}
    }
  }
}

function subscribe(ws, sessionId) {
  if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set());
  subscribers.get(sessionId).add(ws);
}

function unsubscribe(ws, sessionId) {
  subscribers.get(sessionId)?.delete(ws);
}

function unsubscribeAll(ws) {
  for (const [sid, subs] of subscribers) {
    subs.delete(ws);
    if (subs.size === 0) subscribers.delete(sid);
  }
}

// â”€â”€â”€ Session lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function createSession(opts = {}) {
  if (globalSessions.size >= MAX_SESSIONS) return null;

  const id    = opts.id    || uid();
  const cols  = Math.max(10, Math.min(500, opts.cols  || 80));
  const rows  = Math.max(5,  Math.min(200, opts.rows  || 24));
  const title = opts.title || `terminal ${globalSessions.size + 1}`;

  const bashrcPath = path.join(__dirname, ".bashrc");
  const shellArgs  = process.platform === "win32"
    ? ["-NoLogo", "-NoProfile"]
    : (fs.existsSync(bashrcPath) ? ["--rcfile", bashrcPath] : []);

  const ptyProc = pty.spawn(SHELL, shellArgs, {
    name: "xterm-256color",
    cols, rows,
    cwd: process.env.HOME || process.cwd(),
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "re.Term" },
  });

  /** @type {GlobalSession} */
  const session = { id, title, pty: ptyProc, history: [], cols, rows, createdAt: Date.now() };
  globalSessions.set(id, session);
  stats.totalSessions++;

  ptyProc.onData((data) => {
    session.history.push(data);
    if (session.history.length > HISTORY_MAX) session.history.shift();
    broadcast(id, { type: "output", sessionId: id, data });
    queueTerminalOutputAudit(id, title, data);
  });

  ptyProc.onExit(({ exitCode }) => {
    flushTerminalAudit(id);
    const msg = `\r\n\x1b[33m[process exited with code ${exitCode}]\x1b[0m\r\n`;
    session.history.push(msg);
    broadcast(id, { type: "output", sessionId: id, data: msg });
    queueTerminalOutputAudit(id, title, msg);
    broadcast(id, { type: "session-exit", sessionId: id, exitCode });
    appendAuditEvent({
      source: "server.terminal",
      category: "terminal",
      action: "session.exited",
      status: exitCode === 0 ? "success" : "error",
      title,
      summary: `session ${title} exited with code ${exitCode}`,
      refs: { sessionId: id, exitCode },
      payload: { sessionId: id, title, exitCode },
    });
    log("EVENT", "session", "PTY process exited", { sessionId: id, title, exitCode });
    // Keep session in map so user can see the exit message â€” they must close manually
  });

  appendAuditEvent({
    source: "server.terminal",
    category: "terminal",
    action: "session.created",
    status: "success",
    title,
    summary: `created ${title} (${cols}x${rows})`,
    refs: { sessionId: id, cols, rows },
    payload: { sessionId: id, title, cols, rows, createdAt: session.createdAt },
  });
  log("EVENT", "session", "session created", { sessionId: id, title, cols, rows, total: globalSessions.size });
  return session;
}

function destroySession(id) {
  const session = globalSessions.get(id);
  if (!session) return;
  flushTerminalAudit(id);
  try { session.pty.kill(); } catch (_) {}
  globalSessions.delete(id);
  subscribers.delete(id);
  terminalOutputAuditBuffers.delete(id);
  log("EVENT", "session", "session destroyed", { sessionId: id, title: session.title, remaining: globalSessions.size });
}

function sessionList() {
  return [...globalSessions.values()].map(s => ({
    id:        s.id,
    title:     s.title,
    cols:      s.cols,
    rows:      s.rows,
    createdAt: s.createdAt,
  }));
}

// â”€â”€â”€ Express â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const app = express();

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Password");
  if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

// Detailed stats endpoint
app.get("/api/stats", (_req, res) => {
  res.json({
    uptime:            Math.round(process.uptime()),
    uptimeHuman:       new Date(stats.startedAt).toISOString(),
    sessions:          sessionList(),
    sessionCount:      globalSessions.size,
    clientCount:       wss.clients.size,
    totalConnections:  stats.totalConnections,
    totalSessions:     stats.totalSessions,
    totalFilesRead:    stats.totalFilesRead,
    totalFilesWritten: stats.totalFilesWritten,
    logFile:           LOG_FILE,
    auditLogFile:      AUDIT_LOG_FILE,
  });
});

// â”€â”€â”€ File API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Operates on the server's own filesystem.
// All paths are validated to prevent directory traversal.

const FILE_ROOT = process.env.FILE_ROOT || process.env.HOME || process.cwd();

/** Resolve and validate a client path against FILE_ROOT */
function resolveSafe(clientPath) {
  const root = path.resolve(FILE_ROOT);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  const resolved = path.resolve(root, String(clientPath || "").replace(/^[\\/]+/, ""));
  const resolvedForCompare = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const rootForCompare = process.platform === "win32" ? root.toLowerCase() : root;
  const rootWithSepForCompare = process.platform === "win32" ? rootWithSep.toLowerCase() : rootWithSep;

  if (resolvedForCompare !== rootForCompare && !resolvedForCompare.startsWith(rootWithSepForCompare)) {
    throw new Error("path traversal denied");
  }
  return resolved;
}

app.use(express.json({ limit: "10mb" }));

app.post("/api/ezhrm-skill/import-observation", (req, res) => {
  try {
    const observation = req.body?.observation || req.body;
    const result = importEzhrmObservation(observation);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});


// Community API — generic service boundary. Telegram/TDLib is one adapter.
app.get("/api/community/services", async (_req, res) => {
  try {
    res.json(await getCommunityServices());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/community/:service/status", async (req, res) => {
  try {
    res.json(await getCommunityStatus(req.params.service));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/community/:service/chats", async (req, res) => {
  try {
    res.json(await listCommunityChats(req.params.service));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/community/:service/chats/:chatId/messages", async (req, res) => {
  try {
    res.json(await listCommunityMessages(req.params.service, req.params.chatId));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/community/:service/chats/:chatId/messages", async (req, res) => {
  try {
    res.json(await sendCommunityMessage(
      req.params.service,
      req.params.chatId,
      req.body?.text || "",
    ));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.post("/api/community/:service/auth/begin", async (req, res) => {
  try {
    res.json(await beginCommunityLogin(req.params.service));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/community/:service/auth/phone", async (req, res) => {
  try {
    res.json(await submitCommunityPhone(req.params.service, req.body?.phone || ""));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/community/:service/auth/code", async (req, res) => {
  try {
    res.json(await submitCommunityCode(req.params.service, req.body?.code || ""));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/community/:service/auth/password", async (req, res) => {
  try {
    res.json(await submitCommunityPassword(req.params.service, req.body?.password || ""));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/community/:service/logout", async (req, res) => {
  try {
    res.json(await logoutCommunityService(req.params.service));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// MCP gateway API


app.get("/api/mcp/servers", async (_req, res) => {
  try {
    res.json({ servers: await listMcpServers() });
  } catch (err) {
    log("WARN", "mcp", "servers failed", { error: err.message });
    res.status(500).json({ servers: [], error: err.message });
  }
});

app.get("/api/mcp/tools", async (_req, res) => {
  try {
    res.json({ tools: await listMcpTools() });
  } catch (err) {
    log("WARN", "mcp", "tools failed", { error: err.message });
    res.status(500).json({ tools: [], error: err.message });
  }
});

app.get("/api/mcp/tool-definitions", async (_req, res) => {
  try {
    res.json({ tools: await listMcpToolDefinitions() });
  } catch (err) {
    log("WARN", "mcp", "tool-definitions failed", { error: err.message });
    res.status(500).json({ tools: [], error: err.message });
  }
});

app.get("/api/logs/events", (req, res) => {
  try {
    res.json(queryAuditEvents({
      afterSeq: req.query.afterSeq,
      limit: req.query.limit,
      category: req.query.category,
      status: req.query.status,
      q: req.query.q,
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/logs/events", (req, res) => {
  try {
    const events = Array.isArray(req.body?.events)
      ? req.body.events
      : [req.body?.event ?? req.body];
    const appended = appendAuditEvents(events.filter((entry) => entry && typeof entry === "object"));
    res.json({
      ok: true,
      appended,
      count: appended.length,
      logFile: AUDIT_LOG_FILE,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/mcp/logs", (_req, res) => {
  res.json({ logs: getMcpLogs() });
});

app.post("/api/logs/import-mcp", (_req, res) => {
  try {
    const existingGatewayIds = new Set(
      queryAuditEvents({ category: "mcp", limit: 2000 }).events
        .map((event) => String(event?.refs?.gatewayLogId || ""))
        .filter(Boolean),
    );
    const missingLogs = getMcpLogs()
      .filter((entry) => !existingGatewayIds.has(String(entry?.id || "")));
    const appended = appendAuditEvents(
      convertMcpLogsToAuditInputs(missingLogs, {
        source: "server.mcp.import",
        action: "gateway.import",
        imported: true,
      }),
    );
    res.json({
      ok: true,
      imported: appended.length,
      totalGatewayLogs: getMcpLogs().length,
      logFile: AUDIT_LOG_FILE,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/services/status", async (_req, res) => {
  try {
    res.json(await getServiceStatus());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/browser/status", async (_req, res) => {
  res.json(await lightpandaStatus());
});

app.get("/api/browser-agent/status", async (req, res) => {
  try {
    res.json(await browserAgentStatus({
      sessionId: req.query?.sessionId || req.query?.session || "default-browser-session",
    }));
  } catch (err) {
    res.status(500).json({ ok: false, status: "failed", error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/browser-agent/sessions", async (_req, res) => {
  try {
    res.json(await browserAgentListSessions());
  } catch (err) {
    res.status(500).json({ ok: false, status: "failed", error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/browser-agent/sessions", async (req, res) => {
  try {
    res.json(await browserAgentCreateSession(req.body || {}));
  } catch (err) {
    res.status(500).json({ ok: false, status: "failed", error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/browser-agent/run", async (req, res) => {
  try {
    res.json(await browserAgentRun(req.body || {}));
  } catch (err) {
    res.status(500).json({ ok: false, status: "failed", error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/browser-agent/reset", async (req, res) => {
  try {
    res.json(await browserAgentReset(req.body || {}));
  } catch (err) {
    res.status(500).json({ ok: false, status: "failed", error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/browser/state", async (req, res) => {
  try {
    const state = await getBrowserState({
      ...(req.body || {}),
      includeScrape: req.body?.includeScrape === true,
    });

    if (req.body?.compact === false) {
      res.json(state);
      return;
    }

    res.json({
      ok: state.ok,
      status: state.status,
      source: state.source,
      engine: state.engine,
      url: state.url,
      title: state.title,
      stats: state.stats,
      state: compactBrowserStateForModel(state, {
        textLimit: Number(req.body?.textLimit || 1200),
        markdownLimit: Number(req.body?.markdownLimit || 1200),
        linkLimit: Number(req.body?.linkLimit || 30),
        buttonLimit: Number(req.body?.buttonLimit || 30),
        inputLimit: Number(req.body?.inputLimit || 30),
        formLimit: Number(req.body?.formLimit || 10),
        candidateLimit: Number(req.body?.candidateLimit || 60),
      }),
      scrape: state.scrape || null,
      error: state.error || "",
      extractionErrors: state.extractionErrors || [],
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      source: "lightpanda_read_only",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/browser/scrape", async (req, res) => {
  try {
    const state = await getBrowserState({
      ...(req.body || {}),
      includeScrape: true,
      stateMode: "scrape",
    });

    res.json({
      ok: state.ok,
      status: state.status,
      source: state.source,
      engine: state.engine,
      url: state.url,
      title: state.title,
      stats: state.stats,
      textPreview: state.textPreview || "",
      markdown: state.markdown || "",
      links: state.links || [],
      buttons: state.buttons || [],
      inputs: state.inputs || [],
      forms: state.forms || [],
      tables: state.tables || [],
      repeatedGroups: state.repeatedGroups || [],
      scrape: state.scrape || null,
      error: state.error || "",
      extractionErrors: state.extractionErrors || [],
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      source: "lightpanda_read_only",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/browser/navigate", async (req, res) => {
  try {
    res.json(await lightpandaNavigate(req.body || {}));
  } catch (err) {
    res.status(500).json({ ok: false, engine: "lightpanda", error: err.message });
  }
});

app.post("/api/browser/open-headful", async (req, res) => {
  try {
    res.json(await openHeadfulBrowser(req.body || {}));
  } catch (err) {
    res.status(500).json({ ok: false, engine: "chrome-headful", error: err.message });
  }
});

app.post("/api/mcp/route", async (req, res) => {
  res.json(await routeMcpIntent(req.body?.text || "", {
    projectId: req.body?.projectId || req.body?.userId,
    mode: req.body?.mode,
    currentUrl: req.body?.currentUrl,
    content: req.body?.content,
    find: req.body?.find,
    replace: req.body?.replace,
  }));
});

app.post("/api/mcp/call", async (req, res) => {
  const toolName = String(req.body?.name || "");
  const toolArgs = req.body?.args || {};
  try {
    const result = await callMcpTool(toolName, toolArgs);
    res.json({ ok: true, success: true, result });
  } catch (err) {
    log("WARN", "mcp", "tool call failed", { tool: toolName, error: err.message });
    res.status(500).json({ ok: false, success: false, error: err.message });
  }
});

app.get("/api/extensions/catalog", (_req, res) => {
  res.json({ items: getExtensionCatalog() });
});
app.get("/api/extensions", (_req, res) => {
  res.json({
    ok: true,
    extensions: listExtensions({ includeDisabled: true }),
  });
});

app.get("/api/extensions/:id", (req, res) => {
  const extension = getExtension(req.params.id, { includeDisabled: true });

  if (!extension) {
    res.status(404).json({
      ok: false,
      error: "extension not found",
    });
    return;
  }

  res.json({
    ok: true,
    extension,
  });
});

app.patch("/api/extensions/:id", (req, res) => {
  const enabled = req.body?.enabled !== false;
  const extension = setExtensionEnabled(req.params.id, enabled);

  if (!extension) {
    res.status(404).json({
      ok: false,
      error: "extension not found",
    });
    return;
  }

  res.json({
    ok: true,
    extension,
  });
});

app.post("/api/extensions/:id/enabled", (req, res) => {
  const enabled = req.body?.enabled !== false;
  const extension = setExtensionEnabled(req.params.id, enabled);

  if (!extension) {
    res.status(404).json({
      ok: false,
      error: "extension not found",
    });
    return;
  }

  res.json({
    ok: true,
    extension,
  });
});

app.post("/api/extensions/match", (req, res) => {
  const extension = matchExtensionForUrl(req.body?.url || "");

  res.json({
    ok: true,
    extension,
  });
});

app.post("/api/extensions/plan-action", (req, res) => {
  res.json(planExtensionAction(req.body || {}));
});

app.get("/api/site-skills", (_req, res) => {
  res.json({
    skills: listPublicSiteSkills(),
  });
});

app.get("/api/site-skills/:id", (req, res) => {
  const skill = getSiteSkill(req.params.id);

  if (!skill) {
    res.status(404).json({
      ok: false,
      error: "site skill not found",
    });
    return;
  }

  res.json({
    ok: true,
    skill,
  });
});

app.post("/api/site-skills/match", (req, res) => {
  const skill = matchSiteSkillForUrl(req.body?.url || "");

  res.json({
    ok: true,
    skill,
  });
});

// Memory Graph API
app.get("/api/memory/graph", async (req, res) => {
  try {
    const projectId = String(req.query.projectId || req.query.userId || "default-user");
    const snapshot = await getGraphSnapshot(projectId, {
      all: String(req.query.scope || "").toLowerCase() === "all",
    });
    res.json(snapshot);
  } catch (err) {
    log("WARN", "memory", "graph snapshot failed", { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// Ollama proxy for the local AI chat page.
app.get("/api/ollama/tags", async (_req, res) => {
  try {
    const upstream = await fetch(ollamaUrl("/api/tags"));
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    log("WARN", "ollama", "failed to list models", { error: err.message });
    res.status(502).json({ error: "ollama is not reachable", models: [] });
  }
});

app.post("/api/models/warmup", async (req, res) => {
  if (!MODEL_WARMUP_ENABLED) {
    res.json({ ok: true, skipped: true, reason: "model warmup disabled" });
    return;
  }

  const chatModel = String(req.body?.chatModel || req.body?.model || OLLAMA_MODEL);
  const includeBrowserAgent = req.body?.includeBrowserAgent === true || req.body?.includeRuntime === true;
  const all = req.body?.all === true;
  const wait = req.body?.wait === true;

  if (wait) {
    try {
      const result = await runModelWarmup({ chatModel, includeBrowserAgent, all });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  void runModelWarmup({ chatModel, includeBrowserAgent, all })
    .then((result) => {
      log(result.ok ? "INFO" : "WARN", "ollama", "model warmup finished", {
        scope: result.scope,
        count: result.count,
        ok: result.ok,
        models: result.results.map((entry) => ({ model: entry.model, source: entry.source, ok: entry.ok })),
      });
    })
    .catch((err) => {
      log("WARN", "ollama", "model warmup failed", { error: err instanceof Error ? err.message : String(err) });
    });

  res.json({
    ok: true,
    started: true,
    scope: all ? "all" : MODEL_WARMUP_SCOPE,
    chatModel,
    browserAgentModel: includeBrowserAgent ? BROWSER_AGENT_MODEL || null : null,
    browserAgentWarmupSkipped: includeBrowserAgent && !(BROWSER_AGENT_BASE_URL && BROWSER_AGENT_MODEL),
    browserAgentWarmupReason: includeBrowserAgent && !(BROWSER_AGENT_BASE_URL && BROWSER_AGENT_MODEL)
      ? "browser_agent is LLM-required but BROWSER_AGENT_BASE_URL or BROWSER_AGENT_MODEL is missing"
      : "",
  });
});

app.post("/api/ollama/chat", async (req, res) => {
  try {
    const model = String(req.body?.model || OLLAMA_MODEL);
    const messages = Array.isArray(req.body?.messages) ? [...req.body.messages] : [];
    const userId = String(req.body?.userId || req.body?.projectId || process.env.MEMORY_PROJECT_ID || "default-user");
    const lastUserMessage = [...messages].reverse().find(m => m?.role === "user")?.content;
    const stream = req.body?.stream !== false;

    let memories = [];
    if (lastUserMessage) {
      memories = await searchMemory(userId, String(lastUserMessage));
    }

    const memoryPrompt = memories.length > 0
      ? `Relevant long-term memory for this terminal user/project:\n${JSON.stringify(memories)}`
      : "";
    const existingSystemIndex = messages.findIndex(m => m?.role === "system");

    if (existingSystemIndex === -1) {
      messages.unshift({
        role: "system",
        content: ["You are an AI assistant for a terminal.", memoryPrompt].filter(Boolean).join("\n\n"),
      });
    } else if (memoryPrompt) {
      messages[existingSystemIndex] = {
        ...messages[existingSystemIndex],
        content: `${String(messages[existingSystemIndex]?.content || "")}\n\n${memoryPrompt}`.trim(),
      };
    }

    if (memories.length > 0) {
      log("INFO", "chat", "memory injected for user", { userId, count: memories.length });
    }

    const { projectId: _projectId, userId: _userId, signal: _signal, ...requestBody } = req.body || {};
    const body = {
      ...requestBody,
      model,
      messages: messages.map(sanitizeOllamaMessage),
      stream,
    };

    const upstream = await fetch(ollamaUrl("/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (stream) {
      res.status(upstream.status);
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/x-ndjson");
      res.setHeader("Cache-Control", "no-cache");
      if (!upstream.body) {
        res.end();
        return;
      }
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } finally {
        res.end();
      }
      return;
    }

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    log("WARN", "ollama", "chat request failed", { error: err.message });
    res.status(502).json({ error: "ollama chat failed" });
  }
});

app.post("/api/memory/extract", async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || req.body?.userId || process.env.MEMORY_PROJECT_ID || "default-user");
    const model = String(req.body?.model || OLLAMA_MODEL);
    const userMessage = String(req.body?.userMessage || "");
    const assistantMessage = String(req.body?.assistantMessage || "");
    const { memories, usage } = await extractDurableMemories({ projectId, model, userMessage, assistantMessage });

    if (memories.length > 0) {
      const payload = JSON.stringify({ type: "memory-update", projectId, timestamp: Date.now(), count: memories.length });
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          try { client.send(payload); } catch (_) {}
        }
      }
    }

    res.json({ success: true, memories, usage });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const BINARY_FILE_MAX = 25 * 1024 * 1024;
const MIME_BY_EXT = {
  ".bmp":  "image/bmp",
  ".csv":  "text/csv",
  ".doc":  "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif":  "image/gif",
  ".htm":  "text/html",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg":  "image/jpeg",
  ".json": "application/json",
  ".md":   "text/markdown",
  ".pdf":  "application/pdf",
  ".png":  "image/png",
  ".ppt":  "application/vnd.ms-powerpoint",
  ".pptx":  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".svg":  "image/svg+xml",
  ".txt":  "text/plain",
  ".webp": "image/webp",
  ".xls":  "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml":  "application/xml",
  ".yaml": "text/yaml",
  ".yml":  "text/yaml",
};

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

async function listFiles(clientPath) {
  const safeClientPath = clientPath || "/";
  const dir = resolveSafe(safeClientPath);
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const items = entries.map(e => ({
    name: e.name,
    type: e.isDirectory() ? "dir" : "file",
    path: path.posix.join(safeClientPath.replace(/\\/g, "/"), e.name),
  })).sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: safeClientPath, items };
}

async function readTextFile(clientPath) {
  const filePath = resolveSafe(clientPath || "");
  const stat = await fs.promises.stat(filePath);
  if (stat.size > 5 * 1024 * 1024) {
    const err = new Error("file too large (max 5MB)");
    err.status = 413;
    throw err;
  }
  const content = await fs.promises.readFile(filePath, "utf8");
  stats.totalFilesRead++;
  log("EVENT", "file", "file read", { path: clientPath, size: stat.size });
  return { path: clientPath, content };
}

async function readBinaryFile(clientPath) {
  const filePath = resolveSafe(clientPath || "");
  const stat = await fs.promises.stat(filePath);
  if (stat.size > BINARY_FILE_MAX) {
    const err = new Error("file too large (max 25MB)");
    err.status = 413;
    throw err;
  }
  const content = await fs.promises.readFile(filePath);
  stats.totalFilesRead++;
  log("EVENT", "file", "binary file read", { path: clientPath, size: stat.size });
  return {
    path: clientPath,
    mime: guessMimeType(filePath),
    size: stat.size,
    contentBase64: content.toString("base64"),
  };
}

async function writeTextFile(clientPath, content) {
  const filePath = resolveSafe(clientPath || "");
  const text = typeof content === "string" ? content : "";
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, text, "utf8");
  stats.totalFilesWritten++;
  log("EVENT", "file", "file written", { path: clientPath, bytes: Buffer.byteLength(text) });
  return { ok: true };
}

async function deletePath(clientPath) {
  const filePath = resolveSafe(clientPath || "");
  const stat = await fs.promises.stat(filePath);
  if (stat.isDirectory()) {
    await fs.promises.rm(filePath, { recursive: true, force: true });
  } else {
    await fs.promises.unlink(filePath);
  }
  return { ok: true };
}

async function makeDirectory(clientPath) {
  const dirPath = resolveSafe(clientPath || "");
  await fs.promises.mkdir(dirPath, { recursive: true });
  return { ok: true };
}

async function renamePath(fromPath, toPath) {
  const from = resolveSafe(fromPath || "");
  const to = resolveSafe(toPath || "");
  await fs.promises.rename(from, to);
  return { ok: true };
}

async function handleFileRequest(data = {}) {
  switch (data.action) {
    case "list":
      return listFiles(String(data.path || "/"));
    case "read":
      return readTextFile(String(data.path || ""));
    case "readBinary":
      return readBinaryFile(String(data.path || ""));
    case "write":
      return writeTextFile(String(data.path || ""), data.content);
    case "delete":
      return deletePath(String(data.path || ""));
    case "mkdir":
      return makeDirectory(String(data.path || ""));
    case "rename":
      return renamePath(String(data.from || ""), String(data.to || ""));
    default:
      throw new Error(`unknown file action: ${data.action || "missing"}`);
  }
}

// List directory
app.get("/api/files", async (req, res) => {
  try {
    res.json(await listFiles((req.query.path || "/") + ""));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Read file
app.get("/api/file", async (req, res) => {
  try {
    res.json(await readTextFile((req.query.path || "") + ""));
  } catch (err) {
    log("WARN", "file", "file read failed", { path: req.query.path, error: err.message });
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Read file as base64 for binary viewers
app.get("/api/file-binary", async (req, res) => {
  try {
    res.json(await readBinaryFile((req.query.path || "") + ""));
  } catch (err) {
    log("WARN", "file", "binary file read failed", { path: req.query.path, error: err.message });
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Write file
app.put("/api/file", async (req, res) => {
  try {
    const { path: clientPath, content } = req.body;
    res.json(await writeTextFile(clientPath, content));
  } catch (err) {
    log("WARN", "file", "file write failed", { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// Delete file or directory
app.delete("/api/file", async (req, res) => {
  try {
    res.json(await deletePath((req.query.path || "") + ""));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Create directory
app.post("/api/mkdir", async (req, res) => {
  try {
    res.json(await makeDirectory(req.body.path));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Rename / move
app.post("/api/rename", async (req, res) => {
  try {
    res.json(await renamePath(req.body.from, req.body.to));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const httpServer = createServer(app);

// â”€â”€â”€ WebSocket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  // Auth
  let authed = false;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.searchParams.get("password") === PASSWORD) authed = true;
  } catch (_) {}

  if (!authed) {
    send(ws, { type: "error", code: "AUTH_FAILED", message: "invalid password" });
    ws.close(4001, "Authentication failed");
    return;
  }

  stats.totalConnections++;
  const clientIp = req.socket.remoteAddress || "unknown";
  log("EVENT", "client", "client connected", {
    clients: wss.clients.size,
    sessions: globalSessions.size,
    ip: clientIp,
    totalConnections: stats.totalConnections,
  });

  // Send ready + current session list so client can restore tabs
  send(ws, { type: "ready" });
  send(ws, { type: "session-list", sessions: sessionList() });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const { type, sessionId, data } = msg;

    switch (type) {

      // â”€â”€ Create new persistent session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case "create": {
        if (globalSessions.size >= MAX_SESSIONS) {
          send(ws, { type: "error", code: "MAX_SESSIONS", message: `max ${MAX_SESSIONS} sessions` });
          return;
        }
        const session = createSession({
          cols:  data?.cols,
          rows:  data?.rows,
          title: data?.title,
        });
        if (!session) return;
        appendAuditEvent({
          source: "server.terminal",
          category: "terminal",
          action: "session.opened",
          status: "success",
          title: session.title,
          summary: `opened ${session.title}`,
          refs: { sessionId: session.id, clientIp },
          payload: { sessionId: session.id, title: session.title, cols: session.cols, rows: session.rows, clientIp },
        });
        // Auto-subscribe creator
        subscribe(ws, session.id);
        // Notify ALL clients about the new session
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            send(client, {
              type:      "session-created",
              sessionId: session.id,
              title:     session.title,
              cols:      session.cols,
              rows:      session.rows,
            });
          }
        }
        break;
      }

      // â”€â”€ Attach to existing session (subscribe to output) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case "attach": {
        const session = globalSessions.get(sessionId);
        if (!session) {
          send(ws, { type: "error", code: "NOT_FOUND", message: `session ${sessionId} not found` });
          return;
        }
        subscribe(ws, sessionId);
        appendAuditEvent({
          source: "server.terminal",
          category: "terminal",
          action: "session.attached",
          status: "success",
          title: session.title,
          summary: `attached to ${session.title}`,
          refs: { sessionId, clientIp },
          payload: { sessionId, title: session.title, clientIp },
        });
        // Send history replay
        send(ws, {
          type:      "history",
          sessionId: session.id,
          data:      session.history.join(""),
        });
        break;
      }

      // â”€â”€ Detach from session (stop receiving output) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case "detach": {
        unsubscribe(ws, sessionId);
        appendAuditEvent({
          source: "server.terminal",
          category: "terminal",
          action: "session.detached",
          status: "info",
          title: sessionId,
          summary: `detached ${sessionId}`,
          refs: { sessionId, clientIp },
          payload: { sessionId, clientIp },
        });
        break;
      }

      // â”€â”€ Send input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case "input": {
        const session = globalSessions.get(sessionId);
        if (!session || typeof data !== "string") return;
        appendAuditEvent({
          source: "server.terminal",
          category: "terminal",
          action: "input",
          status: "info",
          title: session.title,
          summary: auditSummary(data, 320),
          refs: {
            sessionId,
            direction: "in",
            bytes: Buffer.byteLength(data, "utf8"),
          },
          payload: {
            sessionId,
            title: session.title,
            direction: "in",
            bytes: Buffer.byteLength(data, "utf8"),
            data,
          },
        });
        try { session.pty.write(data); } catch (_) {}
        break;
      }

      // â”€â”€ Resize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case "resize": {
        const session = globalSessions.get(sessionId);
        if (!session) return;
        const cols = Math.max(10, Math.min(500, parseInt(data?.cols) || 80));
        const rows = Math.max(5,  Math.min(200, parseInt(data?.rows) || 24));
        try {
          session.pty.resize(cols, rows);
          session.cols = cols;
          session.rows = rows;
        } catch (_) {}
        // Notify all subscribers of the resize
        broadcast(sessionId, { type: "session-resized", sessionId, cols, rows });
        appendAuditEvent({
          source: "server.terminal",
          category: "terminal",
          action: "session.resized",
          status: "success",
          title: session.title,
          summary: `${session.title} resized to ${cols}x${rows}`,
          refs: { sessionId, cols, rows },
          payload: { sessionId, title: session.title, cols, rows },
        });
        break;
      }

      // â”€â”€ Close (kill) session permanently â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case "close": {
        const session = globalSessions.get(sessionId);
        if (session) {
          appendAuditEvent({
            source: "server.terminal",
            category: "terminal",
            action: "session.closed",
            status: "success",
            title: session.title,
            summary: `closed ${session.title}`,
            refs: { sessionId, clientIp },
            payload: { sessionId, title: session.title, clientIp },
          });
        }
        destroySession(sessionId);
        // Notify all clients
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            send(client, { type: "session-closed", sessionId });
          }
        }
        break;
      }

      // â”€â”€ Rename â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case "rename": {
        const session = globalSessions.get(sessionId);
        if (!session) return;
        const previousTitle = session.title;
        session.title = String(data?.title || session.title).slice(0, 64);
        appendAuditEvent({
          source: "server.terminal",
          category: "terminal",
          action: "session.renamed",
          status: "success",
          title: session.title,
          summary: `${previousTitle} renamed to ${session.title}`,
          refs: { sessionId },
          payload: { sessionId, previousTitle, title: session.title },
        });
        // Notify all clients
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            send(client, { type: "session-renamed", sessionId, title: session.title });
          }
        }
        break;
      }

      // â”€â”€ History replay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case "history": {
        const session = globalSessions.get(sessionId);
        if (!session) return;
        send(ws, { type: "history", sessionId, data: session.history.join("") });
        break;
      }

      case "file": {
        const requestId = msg.requestId;
        handleFileRequest(data)
          .then(result => send(ws, { type: "file-response", requestId, ok: true, result }))
          .catch(err => {
            log("WARN", "file", "websocket file request failed", {
              requestId,
              action: data?.action,
              path: data?.path,
              error: err.message,
            });
            send(ws, {
              type: "file-response",
              requestId,
              ok: false,
              error: err.message || "file request failed",
            });
          });
        break;
      }

      // â”€â”€ Ping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case "ping": {
        send(ws, { type: "pong" });
        break;
      }
    }
  });

  ws.on("close", () => {
    unsubscribeAll(ws);
    log("EVENT", "client", "client disconnected", {
      clients: wss.clients.size,
      sessionsAlive: globalSessions.size,
      uptime: Math.round(process.uptime()) + "s",
    });
  });

  ws.on("error", (err) => {
    log("ERROR", "client", "ws error", { error: err.message });
    unsubscribeAll(ws);
  });
});

// â”€â”€â”€ Memory API Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function sendMemoryWriteResult(res, result) {
  if (result?.ok) {
    res.json({ success: true, ...result });
    return;
  }

  res.status(503).json({
    success: false,
    skipped: true,
    reason: result?.reason || "memory is not available",
    status: getMemoryStatus(),
  });
}

app.get("/api/memory/status", async (_req, res) => {
  res.json(await checkMemoryHealth());
});

app.post("/api/memory/command", async (req, res) => {
  try {
    const { projectId, command, output } = req.body;
    if (!projectId || !command) return res.status(400).json({ error: "projectId and command required" });
    sendMemoryWriteResult(res, await saveCommand(projectId, command, output));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memory/error", async (req, res) => {
  try {
    const { projectId, error, context } = req.body;
    if (!projectId || !error) return res.status(400).json({ error: "projectId and error required" });
    sendMemoryWriteResult(res, await saveError(projectId, error, context));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memory/fix", async (req, res) => {
  try {
    const { projectId, error, fix } = req.body;
    if (!projectId || !error || !fix) return res.status(400).json({ error: "projectId, error, and fix required" });
    sendMemoryWriteResult(res, await saveFix(projectId, error, fix));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memory/preference", async (req, res) => {
  try {
    const { projectId, key, value } = req.body;
    if (!projectId || !key || value == null) return res.status(400).json({ error: "projectId, key, and value required" });
    sendMemoryWriteResult(res, await savePreference(projectId, key, value));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memory/fact", async (req, res) => {
  try {
    const { projectId, memory } = req.body;
    if (!projectId || !memory) return res.status(400).json({ error: "projectId and memory required" });
    sendMemoryWriteResult(res, await saveFact(projectId, memory));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/memory/search", async (req, res) => {
  try {
    const { projectId, q: query } = req.query;
    if (!projectId || !query) return res.status(400).json({ error: "projectId and q query params required" });
    const results = await searchMemory(projectId, query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/memory/:id", async (req, res) => {
  try {
    const { projectId, memory } = req.body;
    if (!projectId) return res.status(400).json({ error: "projectId required" });
    const id = String(req.params.id || "");
    sendMemoryWriteResult(res, await updateMemory(projectId, { ...(memory || {}), id }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Auto-detect Tailscale IP */
function getTailscaleIP() {
  // Try tailscale CLI first
  try {
    const ip = execSync('tailscale ip -4 2>/dev/null', { encoding: 'utf8' }).trim();
    if (ip) return ip;
  } catch (_) {}

  // Fallback: check network interfaces for 100.x.x.x
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && iface.address.startsWith('100.')) {
          return iface.address;
        }
      }
    }
  } catch (_) {}

  return 'unknown';
}

httpServer.listen(PORT, "0.0.0.0", () => {
  log("INFO", "startup", "server listening", {
    local:     `http://localhost:${PORT}`,
    tailscale: `http://${getTailscaleIP()}:${PORT}`,
    network:   `http://10.10.24.206:${PORT}`,
    logFile:   LOG_FILE,
    auditLogFile: AUDIT_LOG_FILE,
  });
});

// â”€â”€â”€ Graceful shutdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function shutdown(signal) {
  for (const sessionId of terminalOutputAuditBuffers.keys()) flushTerminalAudit(sessionId);
  log("INFO", "shutdown", `${signal} received â€” shutting down`, { sessions: globalSessions.size });
  for (const client of wss.clients) {
    try { client.close(1001, "Server shutting down"); } catch (_) {}
  }
  wss.close();
  for (const [id] of globalSessions) destroySession(id);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
