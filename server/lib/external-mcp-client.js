import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(SERVER_ROOT, "config", "mcp-servers.json");
const DEFAULT_TIMEOUT_MS = 30000;
const START_TIMEOUT_MS = 45000;
const MAX_STDERR_CHARS = 12000;
const clients = new Map();

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function safeError(err) {
  if (!err) return "";
  return err instanceof Error ? err.message : String(err);
}

function trustedConfigDir() {
  return path.join(SERVER_ROOT, "config");
}

function normalizeServerConfig(id, raw = {}) {
  const serverId = String(raw.id || id || "").trim();
  if (!serverId) return null;
  return {
    id: serverId,
    title: String(raw.title || serverId).trim(),
    source: raw.source || "external",
    type: raw.type || "external",
    transport: raw.transport || "stdio",
    protocol: raw.protocol || "mcp",
    enabled: raw.enabled !== false,
    command: String(raw.command || "").trim(),
    args: Array.isArray(raw.args) ? raw.args.map(String) : [],
    env: raw.env && typeof raw.env === "object" && !Array.isArray(raw.env) ? raw.env : {},
    cwd: raw.cwd ? path.resolve(SERVER_ROOT, String(raw.cwd)) : SERVER_ROOT,
    description: String(raw.description || "").trim(),
    autostart: raw.autostart === true,
  };
}

function loadConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch (err) {
    return {
      _configError: `Failed to parse ${CONFIG_PATH}: ${safeError(err)}`,
    };
  }
}

export function listExternalMcpServerConfigs() {
  const config = loadConfigFile();
  const servers = new Map();
  const rawServers = config.servers && typeof config.servers === "object" && !Array.isArray(config.servers)
    ? config.servers
    : {};

  for (const [id, raw] of Object.entries(rawServers)) {
    const normalized = normalizeServerConfig(id, raw);
    if (normalized) servers.set(normalized.id, normalized);
  }

  if (boolEnv("PLAYWRIGHT_MCP_ENABLED", false) && !servers.has("playwright")) {
    servers.set("playwright", normalizeServerConfig("playwright", {
      id: "playwright",
      title: "Playwright MCP",
      source: "external",
      type: "external",
      transport: "stdio",
      protocol: "mcp",
      enabled: true,
      command: "npx",
      args: ["-y", "@playwright/mcp@latest", "--isolated"],
      description: "Official Microsoft Playwright MCP server for browser automation.",
    }));
  }

  const values = [...servers.values()];
  if (config._configError) {
    values.push({
      id: "config_error",
      title: "External MCP Config Error",
      source: "external",
      type: "external",
      transport: "stdio",
      protocol: "mcp",
      enabled: false,
      command: "",
      args: [],
      description: config._configError,
      configError: config._configError,
    });
  }
  return values;
}

export function getExternalMcpServerConfig(serverId) {
  const id = String(serverId || "").trim();
  return listExternalMcpServerConfigs().find((server) => server.id === id) || null;
}

function commandForPlatform(command) {
  return command;
}

function sanitizeStdioConfig(config) {
  if (!config || config.source !== "external" || config.type !== "external") {
    throw new Error(`external MCP server is not external type: ${config?.id || "<missing>"}`);
  }
  if (config.transport !== "stdio" || config.protocol !== "mcp") {
    throw new Error(`external MCP server ${config.id} must use stdio MCP transport`);
  }
  if (!config.enabled) {
    throw new Error(`external MCP server ${config.id} is disabled`);
  }
  if (!config.command) {
    throw new Error(`external MCP server ${config.id} is missing command`);
  }
  const cwd = path.resolve(config.cwd || SERVER_ROOT);
  const trusted = trustedConfigDir();
  const configPath = path.resolve(CONFIG_PATH);
  if (!configPath.startsWith(trusted)) {
    throw new Error("external MCP config path is not trusted");
  }
  return {
    ...config,
    cwd,
    command: commandForPlatform(config.command),
  };
}

class ExternalMcpClient {
  constructor(config) {
    this.config = sanitizeStdioConfig(config);
    this.process = null;
    this.stdoutBuffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.initialized = false;
    this.starting = null;
    this.tools = null;
    this.lastError = "";
    this.stderr = "";
    this.startedAt = null;
    this.exitedAt = null;
    this.exitCode = null;
  }

  status() {
    const running = Boolean(this.process && !this.process.killed && this.process.exitCode == null);
    return {
      id: this.config.id,
      title: this.config.title,
      source: "external",
      type: "external",
      transport: this.config.transport,
      protocol: this.config.protocol,
      enabled: this.config.enabled,
      configured: Boolean(this.config.command),
      command: this.config.command,
      args: this.config.args,
      running,
      initialized: this.initialized,
      status: this.lastError ? "error" : running && this.initialized ? "ready" : this.config.enabled ? "configured" : "disabled",
      error: this.lastError,
      stderrPreview: this.stderr.slice(-1200),
      startedAt: this.startedAt,
      exitedAt: this.exitedAt,
      exitCode: this.exitCode,
      toolCount: Array.isArray(this.tools) ? this.tools.length : 0,
    };
  }

  async ensureStarted() {
    if (this.initialized && this.process && this.process.exitCode == null) return this;
    if (this.starting) return this.starting;
    this.starting = this.start();
    try {
      await this.starting;
      return this;
    } finally {
      this.starting = null;
    }
  }

  async start() {
    this.lastError = "";
    this.stderr = "";
    this.exitCode = null;
    this.exitedAt = null;
    this.startedAt = new Date().toISOString();
    this.process = spawn(this.config.command, this.config.args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
    });

    this.process.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.process.stdin.on("error", (err) => {
      this.lastError = safeError(err);
    });
    this.process.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-MAX_STDERR_CHARS);
    });
    this.process.once("error", (err) => this.handleExit(err));
    this.process.once("exit", (code, signal) => this.handleExit(new Error(`external MCP server exited: code=${code ?? ""} signal=${signal ?? ""}`), code));

    try {
      const initialize = await this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "re.terminal",
          version: "1.0.0",
        },
      }, START_TIMEOUT_MS);
      this.notify("notifications/initialized", {});
      this.initialized = true;
      this.serverInfo = initialize?.serverInfo || null;
      return initialize;
    } catch (err) {
      this.lastError = safeError(err);
      await this.stop();
      throw err;
    }
  }

  handleExit(err, code = null) {
    this.exitCode = code;
    this.exitedAt = new Date().toISOString();
    this.initialized = false;
    this.lastError = safeError(err);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(this.lastError || "external MCP server exited"));
    }
    this.pending.clear();
  }

  onStdout(chunk) {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    while (true) {
      const textStart = this.stdoutBuffer.slice(0, Math.min(this.stdoutBuffer.length, 32)).toString("utf8").toLowerCase();
      if (textStart.startsWith("content-length:")) {
        const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = this.stdoutBuffer.slice(0, headerEnd).toString("utf8");
        const lengthMatch = header.match(/content-length:\s*(\d+)/i);
        if (!lengthMatch) {
          this.lastError = "external MCP response missing Content-Length";
          this.stdoutBuffer = Buffer.alloc(0);
          return;
        }
        const contentLength = Number(lengthMatch[1]);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;
        if (this.stdoutBuffer.length < bodyEnd) return;
        const raw = this.stdoutBuffer.slice(bodyStart, bodyEnd).toString("utf8");
        this.stdoutBuffer = this.stdoutBuffer.slice(bodyEnd);
        this.handleMessage(raw);
        continue;
      }

      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) return;
      const raw = this.stdoutBuffer.slice(0, newline).toString("utf8").trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!raw) {
        continue;
      }
      if (!raw.startsWith("{")) {
        this.stderr = `${this.stderr}${raw}\n`.slice(-MAX_STDERR_CHARS);
        return;
      }
      this.handleMessage(raw);
    }
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      this.lastError = `external MCP returned invalid JSON: ${safeError(err)}`;
      return;
    }
    if (message.id == null) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      const error = new Error(message.error.message || "external MCP JSON-RPC error");
      error.code = message.error.code;
      error.data = message.error.data;
      pending.reject(error);
      return;
    }
    pending.resolve(message.result);
  }

  send(message) {
    if (!this.process || !this.process.stdin.writable) {
      throw new Error(`external MCP server ${this.config.id} is not running`);
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = this.nextId++;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`external MCP ${this.config.id} timeout calling ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send(message);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  notify(method, params = {}) {
    this.send({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  async listTools({ refresh = false } = {}) {
    await this.ensureStarted();
    if (this.tools && !refresh) return this.tools;
    const tools = [];
    let cursor = undefined;
    do {
      const result = await this.request("tools/list", cursor ? { cursor } : {}, DEFAULT_TIMEOUT_MS);
      tools.push(...(Array.isArray(result?.tools) ? result.tools : []));
      cursor = result?.nextCursor;
    } while (cursor);
    this.tools = tools;
    this.lastError = "";
    return tools;
  }

  async callTool(toolName, args = {}) {
    await this.ensureStarted();
    const result = await this.request("tools/call", {
      name: toolName,
      arguments: args && typeof args === "object" && !Array.isArray(args) ? args : {},
    }, Number(process.env.EXTERNAL_MCP_CALL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
    this.lastError = "";
    return result;
  }

  async stop() {
    this.initialized = false;
    if (!this.process) return;
    const child = this.process;
    this.process = null;
    try {
      if (child.stdin.writable) child.stdin.end();
    } catch {}
    try {
      if (child.exitCode == null) child.kill();
    } catch {}
  }
}

export async function getExternalMcpClient(serverId) {
  const id = String(serverId || "").trim();
  const config = getExternalMcpServerConfig(id);
  if (!config) throw new Error(`external MCP server not configured: ${id}`);
  if (!config.enabled) throw new Error(`external MCP server disabled: ${id}`);
  let client = clients.get(id);
  if (!client || client.config.command !== commandForPlatform(config.command) || JSON.stringify(client.config.args) !== JSON.stringify(config.args)) {
    if (client) await client.stop();
    client = new ExternalMcpClient(config);
    clients.set(id, client);
  }
  await client.ensureStarted();
  return client;
}

export async function listExternalMcpTools(serverId) {
  const client = await getExternalMcpClient(serverId);
  return client.listTools();
}

export function getExternalMcpCachedTools(serverId) {
  const client = clients.get(String(serverId || "").trim());
  return Array.isArray(client?.tools) ? client.tools : [];
}

export async function refreshExternalMcpTools(serverId) {
  const client = await getExternalMcpClient(serverId);
  return client.listTools({ refresh: true });
}

export async function callExternalMcpTool(serverId, toolName, args = {}) {
  const client = await getExternalMcpClient(serverId);
  return client.callTool(toolName, args);
}

export async function getExternalMcpServerStatus(serverId) {
  const id = String(serverId || "").trim();
  const config = getExternalMcpServerConfig(id);
  if (!config) {
    return {
      id,
      source: "external",
      type: "external",
      enabled: false,
      configured: false,
      status: "not_configured",
      error: `external MCP server not configured: ${id}`,
    };
  }
  const cached = clients.get(id);
  if (cached) return cached.status();
  return {
    id: config.id,
    title: config.title,
    source: "external",
    type: "external",
    transport: config.transport,
    protocol: config.protocol,
    enabled: config.enabled,
    configured: Boolean(config.command),
    command: config.command,
    args: config.args,
    running: false,
    initialized: false,
    status: config.enabled ? "configured" : "disabled",
    error: config.configError || "",
    toolCount: 0,
  };
}

export async function listExternalMcpStatuses() {
  return Promise.all(listExternalMcpServerConfigs().map((server) => getExternalMcpServerStatus(server.id)));
}

export async function stopExternalMcpClient(serverId) {
  const id = String(serverId || "").trim();
  const client = clients.get(id);
  if (!client) return { ok: true, stopped: false, id };
  await client.stop();
  clients.delete(id);
  return { ok: true, stopped: true, id };
}
