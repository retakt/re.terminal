/**
 * re.Term — Persistent Terminal Server
 *
 * Sessions are GLOBAL — they survive client disconnects.
 * Reconnecting clients get their existing PTY sessions back.
 *
 * Flow:
 *   connect → server sends "ready" + "session-list" (all live sessions)
 *   client sends "attach" to subscribe to a session's output
 *   client sends "create" to spawn a new session
 *   client sends "close" to kill a session permanently
 *   disconnect → sessions keep running, output is buffered
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
import { saveCommand, saveError, saveFix, savePreference, searchMemory } from "./lib/memory-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Env ──────────────────────────────────────────────────────────────────────

for (const p of [path.join(__dirname, ".env"), path.join(__dirname, "..", ".env")]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); console.log(`[re.Term] env: ${p}`); break; }
}

// ─── Logging ──────────────────────────────────────────────────────────────────

const LOG_FILE = process.env.LOG_FILE || path.join(__dirname, "re-term.log");
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

function log(level, category, message, meta = {}) {
  const ts   = new Date().toISOString();
  const line = JSON.stringify({ ts, level, category, message, ...meta });
  // Console with color
  const colors = { INFO: "\x1b[36m", WARN: "\x1b[33m", ERROR: "\x1b[31m", EVENT: "\x1b[32m" };
  const reset  = "\x1b[0m";
  console.log(`${colors[level] || ""}[${ts.slice(11,19)}] [${level}] [${category}] ${message}${reset}`, Object.keys(meta).length ? meta : "");
  // File (JSON lines)
  logStream.write(line + "\n");
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
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL || "llama3.1";

log("INFO", "startup", "re.Term server starting", { port: PORT, shell: SHELL, maxSessions: MAX_SESSIONS, logFile: LOG_FILE });
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

// Subscribers: sessionId → Set of WebSocket connections watching it
/** @type {Map<string, Set<WebSocket>>} */
const subscribers = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

// ─── Session lifecycle ────────────────────────────────────────────────────────

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
  });

  ptyProc.onExit(({ exitCode }) => {
    const msg = `\r\n\x1b[33m[process exited with code ${exitCode}]\x1b[0m\r\n`;
    session.history.push(msg);
    broadcast(id, { type: "output", sessionId: id, data: msg });
    broadcast(id, { type: "session-exit", sessionId: id, exitCode });
    log("EVENT", "session", "PTY process exited", { sessionId: id, title, exitCode });
    // Keep session in map so user can see the exit message — they must close manually
  });

  log("EVENT", "session", "session created", { sessionId: id, title, cols, rows, total: globalSessions.size });
  return session;
}

function destroySession(id) {
  const session = globalSessions.get(id);
  if (!session) return;
  try { session.pty.kill(); } catch (_) {}
  globalSessions.delete(id);
  subscribers.delete(id);
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

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Password");
  if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    status:   "ok",
    uptime:   process.uptime(),
    sessions: globalSessions.size,
    stats,
  });
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
  });
});

// ─── File API ─────────────────────────────────────────────────────────────────
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

// Ollama proxy for the local AI chat page.
app.get("/api/ollama/tags", async (_req, res) => {
  try {
    const upstream = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    log("WARN", "ollama", "failed to list models", { error: err.message });
    res.status(502).json({ error: "ollama is not reachable", models: [] });
  }
});

app.post("/api/ollama/chat", async (req, res) => {
  try {
    const model = String(req.body?.model || OLLAMA_MODEL);
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    const upstream = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: messages.map(message => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: String(message.content || ""),
        })),
        stream: false,
      }),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    log("WARN", "ollama", "chat request failed", { error: err.message });
    res.status(502).json({ error: "ollama chat failed" });
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

// ─── WebSocket ────────────────────────────────────────────────────────────────

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

      // ── Create new persistent session ─────────────────────────────────────
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

      // ── Attach to existing session (subscribe to output) ──────────────────
      case "attach": {
        const session = globalSessions.get(sessionId);
        if (!session) {
          send(ws, { type: "error", code: "NOT_FOUND", message: `session ${sessionId} not found` });
          return;
        }
        subscribe(ws, sessionId);
        // Send history replay
        send(ws, {
          type:      "history",
          sessionId: session.id,
          data:      session.history.join(""),
        });
        break;
      }

      // ── Detach from session (stop receiving output) ────────────────────────
      case "detach": {
        unsubscribe(ws, sessionId);
        break;
      }

      // ── Send input ────────────────────────────────────────────────────────
      case "input": {
        const session = globalSessions.get(sessionId);
        if (!session || typeof data !== "string") return;
        try { session.pty.write(data); } catch (_) {}
        break;
      }

      // ── Resize ────────────────────────────────────────────────────────────
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
        break;
      }

      // ── Close (kill) session permanently ──────────────────────────────────
      case "close": {
        destroySession(sessionId);
        // Notify all clients
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            send(client, { type: "session-closed", sessionId });
          }
        }
        break;
      }

      // ── Rename ────────────────────────────────────────────────────────────
      case "rename": {
        const session = globalSessions.get(sessionId);
        if (!session) return;
        session.title = String(data?.title || session.title).slice(0, 64);
        // Notify all clients
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            send(client, { type: "session-renamed", sessionId, title: session.title });
          }
        }
        break;
      }

      // ── History replay ────────────────────────────────────────────────────
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

      // ── Ping ──────────────────────────────────────────────────────────────
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

// ─── Memory API Routes ────────────────────────────────────────────────────────

app.post("/api/memory/command", async (req, res) => {
  try {
    const { projectId, command, output } = req.body;
    if (!projectId || !command) return res.status(400).json({ error: "projectId and command required" });
    await saveCommand(projectId, command, output);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memory/error", async (req, res) => {
  try {
    const { projectId, error, context } = req.body;
    if (!projectId || !error) return res.status(400).json({ error: "projectId and error required" });
    await saveError(projectId, error, context);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memory/fix", async (req, res) => {
  try {
    const { projectId, error, fix } = req.body;
    if (!projectId || !error || !fix) return res.status(400).json({ error: "projectId, error, and fix required" });
    await saveFix(projectId, error, fix);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memory/preference", async (req, res) => {
  try {
    const { projectId, key, value } = req.body;
    if (!projectId || !key || !value) return res.status(400).json({ error: "projectId, key, and value required" });
    await savePreference(projectId, key, value);
    res.json({ success: true });
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

// ─── Start ────────────────────────────────────────────────────────────────────

/** Auto-detect Tailscale IP */
function getTailscaleIP() {
  // Try tailscale CLI first
  try {
    const { execSync } = require('child_process');
    const ip = execSync('tailscale ip -4 2>/dev/null', { encoding: 'utf8' }).trim();
    if (ip) return ip;
  } catch (_) {}

  // Fallback: check network interfaces for 100.x.x.x
  try {
    const os = require('os');
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
  });
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal) {
  log("INFO", "shutdown", `${signal} received — shutting down`, { sessions: globalSessions.size });
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
