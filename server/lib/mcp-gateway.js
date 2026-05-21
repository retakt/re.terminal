import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import {
  loadExternalMcpConfigs,
  getMcpConfigPath,
  hasExternalMcpConfig,
} from "./external-mcp-config.js";
import {
  checkMemoryHealth,
  getGraphSnapshot,
  getMemoryStatus,
  saveFact,
  searchMemory,
} from "./memory-client.js";
import {
  getLightpandaConfig,
  lightpandaAction,
  lightpandaFetch,
  lightpandaInstantScrape,
  lightpandaNavigate,
  lightpandaStatus,
  openHeadfulBrowser,
} from "./lightpanda-client.js";
import {
  browserAgentLearn,
  browserAgentDiagnose,
  browserAgentObserve,
  browserAgentReset,
  browserAgentRun,
  browserAgentStatus,
  setBrowserAgentMcpCaller,
} from "./browser-agent.js";
import {
  getExtension,
  getExtensionSkill,
  listExtensions,
  matchExtensionForUrl,
  planExtensionAction,
} from "./extensions.js";
import { appendAuditEvent } from "./audit-log.js";
import { convertMcpLogToAuditInput } from "./mcp-log-audit.js";
import {
  callExternalMcpTool,
  getExternalMcpCachedTools,
  getExternalMcpClient,
  getExternalMcpServerConfig,
  getExternalMcpServerStatus,
  listExternalMcpServerConfigs,
  listExternalMcpTools,
  listExternalMcpStatuses,
  refreshExternalMcpTools,
} from "./external-mcp-client.js";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_WRITE_BYTES = 1024 * 1024;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || "https://chat-api.retakt.cc").replace(/\/+$/, "").replace(/\/api$/, "");
}

function serverRoot() {
  return path.resolve(__dirname, "..");
}

function normalizeSearxngBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    if (url.pathname.endsWith("/search")) {
      url.pathname = url.pathname.slice(0, -"/search".length) || "/";
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return raw.replace(/\/+$/, "").replace(/\/search$/, "");
  }
}

function configuredSearxngBase() {
  const envBase = normalizeSearxngBase(process.env.SEARXNG_URL);
  if (envBase) return envBase;

  try {
    const configPath = path.join(serverRoot(), "config", "services.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const services = Object.values(config.services || {}).flat();
    const searchService = services.find((service) =>
      /searxng/i.test(`${service.name || ""} ${service.url || ""}`)
    );
    return normalizeSearxngBase(searchService?.url);
  } catch {
    return "";
  }
}

function safeText(value, limit = 12000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function compactString(value = "", limit = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function compactUrl(value = "", limit = 220) {
  const raw = compactString(value, 2000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const base = `${url.origin}${url.pathname}`;
    if (!url.search && !url.hash) return compactString(base, limit);
    return compactString(`${base}?...`, limit);
  } catch {
    return compactString(raw, limit);
  }
}

function shortenUrlsInText(value = "", limit = 700) {
  return compactString(String(value || "").replace(/https?:\/\/[^\s"'<>]+/g, (url) => compactUrl(url, 160)), limit);
}

function browserAgentBrief(payload = {}) {
  const page = payload.currentTitle || payload.whatFound?.title || payload.currentUrl || payload.whatFound?.url || "current page";
  const action = shortenUrlsInText(payload.summary || (payload.ok ? "Browser action completed." : "Browser action was blocked."), 420);
  const filled = Array.isArray(payload.filledFields) && payload.filledFields.length
    ? ` Filled: ${payload.filledFields.map((field) => `${field.label || "field"}=${field.secret ? "[redacted]" : field.value || ""}`).join(", ")}.`
    : "";
  const next = payload.nextSafeAction ? ` Next: ${payload.nextSafeAction}` : "";
  return compactString(`${page}: ${action}.${filled}${next}`, 700);
}

function compactBrowserObservation(observation = null) {
  if (!observation || typeof observation !== "object") return null;
  const visibleFields = (fields = []) => fields
    .filter((field) => !/^hidden$/i.test(String(field?.type || "")))
    .slice(0, 8)
    .map((field) => ({
      name: compactString(field.name, 80),
      id: compactString(field.id, 80),
      type: field.secret ? "password" : compactString(field.type, 40),
      placeholder: compactString(field.placeholder, 120),
      ariaLabel: compactString(field.ariaLabel, 120),
      selector: compactString(field.selector, 120),
      secret: Boolean(field.secret),
    }));

  return {
    url: compactUrl(observation.url),
    title: compactString(observation.title, 160),
    textPreview: compactString(observation.textPreview || observation.text || "", 700),
    engine: compactString(observation.engine, 80),
    isLoginPage: Boolean(observation.isLoginPage),
    forms: Array.isArray(observation.forms) ? observation.forms.slice(0, 3).map((form) => ({
      index: form.index,
      action: compactUrl(form.action),
      method: compactString(form.method, 20),
      selector: compactString(form.selector, 120),
      fields: Array.isArray(form.fields) ? visibleFields(form.fields) : [],
      buttons: Array.isArray(form.buttons) ? form.buttons.slice(0, 6).map((button) => ({
        text: compactString(button.text || button.label, 120),
        selector: compactString(button.selector, 120),
        type: compactString(button.type, 40),
      })) : [],
    })) : [],
    inputs: Array.isArray(observation.inputs) ? visibleFields(observation.inputs) : [],
    buttons: Array.isArray(observation.buttons) ? observation.buttons.slice(0, 16).map((button) => ({
      text: compactString(button.text || button.label, 120),
      selector: compactString(button.selector, 120),
      type: compactString(button.type, 40),
      tag: compactString(button.tag, 40),
    })) : [],
    links: Array.isArray(observation.links) ? observation.links.slice(0, 6).map((link) => ({
      text: compactString(link.text || link.label, 160),
      href: compactUrl(link.href),
      selector: compactString(link.selector, 120),
    })) : [],
    interactiveElements: [],
  };
}

function compactBrowserAgentPayload(payload = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const whatFound = compactBrowserObservation(payload.whatFound);
  const observedControls = {
    forms: Array.isArray(whatFound?.forms) ? whatFound.forms.length : 0,
    inputs: Array.isArray(whatFound?.inputs) ? whatFound.inputs : [],
    buttons: Array.isArray(whatFound?.buttons) ? whatFound.buttons : [],
    links: Array.isArray(whatFound?.links) ? whatFound.links : [],
  };
  return {
    ok: Boolean(payload.ok),
    status: compactString(payload.status, 80),
    instruction: compactString(payload.instruction, 800),
    currentUrl: compactUrl(payload.currentUrl || payload.whatFound?.url || payload.state?.currentUrl || payload.state?.lastValidObservation?.url || ""),
    currentTitle: compactString(payload.currentTitle || payload.whatFound?.title || payload.state?.currentTitle || payload.state?.lastValidObservation?.title || "", 160),
    extensionId: compactString(payload.extensionId, 120),
    pageKey: compactString(payload.pageKey, 120),
    engine: compactString(payload.engine || payload.whatFound?.engine || payload.state?.activeEngine || "", 80),
    summary: shortenUrlsInText(payload.summary || "", 500),
    browserSummary: browserAgentBrief(payload),
    whatFound,
    observedControls,
    possibleNextActions: Array.isArray(payload.possibleNextActions) ? payload.possibleNextActions.slice(0, 10) : [],
    requiresUser: Boolean(payload.requiresUser),
    blockedReason: compactString(payload.blockedReason, 240),
    watcher: payload.watcher || null,
    planner: payload.planner || null,
    reporter: payload.reporter || null,
    filledFields: Array.isArray(payload.filledFields) ? payload.filledFields : [],
    missingFields: Array.isArray(payload.missingFields) ? payload.missingFields : [],
    submitStatus: compactString(payload.submitStatus, 160),
    nextSafeAction: compactString(payload.nextSafeAction, 260),
    runtimeTiming: payload.runtimeTiming || null,
    tokenUsage: payload.tokenUsage || null,
    runtime: payload.runtime || null,
    diagnostics: payload.diagnostics ? {
      diagnosis: compactString(payload.diagnostics.diagnosis, 400),
      evidence: Array.isArray(payload.diagnostics.evidence) ? payload.diagnostics.evidence.slice(0, 4).map((entry) => shortenUrlsInText(entry, 220)) : [],
      suggestedFixes: Array.isArray(payload.diagnostics.suggestedFixes) ? payload.diagnostics.suggestedFixes.slice(0, 4).map((entry) => shortenUrlsInText(entry, 220)) : [],
    } : null,
    sequence: payload.sequence ? {
      completed: payload.sequence.completed,
      total: payload.sequence.total,
      stoppedAt: payload.sequence.stoppedAt,
      items: Array.isArray(payload.sequence.items) ? payload.sequence.items.slice(0, 8).map((item) => ({
        index: item.index,
        instruction: compactString(item.instruction, 240),
        ok: Boolean(item.ok),
        status: compactString(item.status, 80),
        summary: compactString(item.summary, 240),
        currentUrl: compactUrl(item.currentUrl),
        blockedReason: compactString(item.blockedReason, 160),
      })) : [],
    } : null,
    lastFailedObservation: payload.lastFailedObservation ? {
      url: compactUrl(payload.lastFailedObservation.url),
      title: compactString(payload.lastFailedObservation.title, 160),
      textPreview: compactString(payload.lastFailedObservation.textPreview, 300),
      engine: compactString(payload.lastFailedObservation.engine, 80),
      error: compactString(payload.lastFailedObservation.error || payload.lastFailedObservation.snapshotError, 240),
    } : null,
    engineFailures: payload.engineFailures || {},
  };
}

function fileRoot() {
  const workspaceDefault = path.basename(process.cwd()).toLowerCase() === "server"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
  return path.resolve(process.env.FILE_ROOT || workspaceDefault);
}

function resolveSafe(clientPath = ".") {
  const root = fileRoot();
  const resolved = path.resolve(root, String(clientPath || ".").replace(/^[\\/]+/, ""));
  const rootCompare = process.platform === "win32" ? root.toLowerCase() : root;
  const resolvedCompare = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  if (resolvedCompare !== rootCompare && !resolvedCompare.startsWith(rootCompare + path.sep)) {
    throw new Error("path traversal denied");
  }
  return resolved;
}

function findGitRoot(start = process.cwd()) {
  let current = path.resolve(start || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

async function runGit(args, cwd = process.cwd()) {
  const repo = findGitRoot(cwd);
  if (!repo) throw new Error("git repository unavailable");
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: repo,
    timeout: DEFAULT_TIMEOUT_MS,
    windowsHide: true,
  });
  return safeText((stdout || stderr || "").trim() || "ok");
}

async function runCommand(command, args = [], options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd || process.cwd(),
    timeout: options.timeout || DEFAULT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return safeText((stdout || stderr || "").trim() || "ok");
}

async function dockerContainerNames() {
  const output = await runCommand("docker", ["ps", "-a", "--format", "{{.Names}}"], { timeout: 10000 });
  return output.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
}

async function resolveDockerContainerName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const names = await dockerContainerNames();
  if (names.includes(raw)) return raw;
  const normalized = raw.toLowerCase();
  const aliases = new Map([
    ["yt-worker", "retakt-yt-worker"],
    ["youtube-worker", "retakt-yt-worker"],
    ["yt worker", "retakt-yt-worker"],
    ["youtube worker", "retakt-yt-worker"],
    ["yt-api", "retakt-yt-api"],
    ["youtube-api", "retakt-yt-api"],
    ["redis", "retakt-redis"],
  ]);
  const alias = aliases.get(normalized);
  if (alias && names.includes(alias)) return alias;
  const exactSuffix = names.find((entry) => entry.toLowerCase().endsWith(`-${normalized}`));
  if (exactSuffix) return exactSuffix;
  const contains = names.filter((entry) => entry.toLowerCase().includes(normalized));
  if (contains.length === 1) return contains[0];
  throw new Error(`docker container not found: ${raw}. available containers: ${names.join(", ") || "none"}`);
}

async function readDirectory(args = {}) {
  const dir = resolveSafe(args.path || ".");
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  return safeText(entries.slice(0, 200).map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? "directory" : "file",
  })));
}

async function readTextFile(args = {}) {
  const file = resolveSafe(args.path || "");
  const stat = await fs.promises.stat(file);
  if (stat.isDirectory()) throw new Error("path is a directory");
  if (stat.size > 512 * 1024) throw new Error("file too large for MCP read");
  return safeText(await fs.promises.readFile(file, "utf8"));
}

async function writeTextFile(args = {}) {
  const relativePath = String(args.path || "").trim();
  const content = String(args.content ?? "");
  if (!relativePath) throw new Error("path is required");
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) throw new Error("content too large for MCP write");
  const file = resolveSafe(relativePath);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, content, "utf8");
  return safeText({
    ok: true,
    path: path.relative(fileRoot(), file),
    bytes: Buffer.byteLength(content, "utf8"),
  });
}

async function replaceInFile(args = {}) {
  const relativePath = String(args.path || "").trim();
  const find = String(args.find ?? "");
  const replace = String(args.replace ?? "");
  if (!relativePath) throw new Error("path is required");
  if (!find) throw new Error("find is required");
  const file = resolveSafe(relativePath);
  const stat = await fs.promises.stat(file);
  if (stat.isDirectory()) throw new Error("path is a directory");
  if (stat.size > MAX_WRITE_BYTES) throw new Error("file too large for MCP replace");
  const before = await fs.promises.readFile(file, "utf8");
  if (!before.includes(find)) throw new Error("find text not found");
  const after = before.split(find).join(replace);
  await fs.promises.writeFile(file, after, "utf8");
  return safeText({
    ok: true,
    path: path.relative(fileRoot(), file),
    replacements: before.split(find).length - 1,
    bytes: Buffer.byteLength(after, "utf8"),
  });
}

async function searchFiles(args = {}) {
  const query = String(args.query || "").toLowerCase();
  if (!query) throw new Error("query is required");
  const start = resolveSafe(args.path || ".");
  const matches = [];

  async function walk(dir, depth = 0) {
    if (depth > 4 || matches.length >= 80) return;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (matches.length >= 80) break;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.name.toLowerCase().includes(query)) {
        matches.push(path.relative(fileRoot(), full));
      }
      if (entry.isDirectory()) await walk(full, depth + 1);
    }
  }

  await walk(start);
  return safeText(matches);
}

async function searchWeb(args = {}) {
  const query = String(args.query || "").trim();
  if (!query) throw new Error("query is required");
  const base = configuredSearxngBase();
  if (!base) {
    throw new Error("SearXNG is not configured. Set SEARXNG_URL or add the SearXNG service URL to server/config/services.json.");
  }
  const params = new URLSearchParams({
    q: query,
    format: "json",
    pageno: "1",
    language: "en",
  });
  const url = `${base}/search?${params.toString()}`;
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`search failed for ${base}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) throw new Error(`search failed: ${response.status}`);
  const data = await response.json();
  const results = (data.results || []).slice(0, Math.min(Number(args.limit || 5), 8)).map((item) => ({
    title: item.title,
    url: item.url,
    content: String(item.content || "").slice(0, 420),
  }));
  return safeText({ query, results });
}

async function fetchUrl(args = {}) {
  const url = String(args.url || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("url must start with http:// or https://");
  const response = await fetch(url, {
    headers: { "User-Agent": "re.Term MCP fetch/1.0" },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  return safeText({ url, contentType, text: text.replace(/\s+/g, " ").slice(0, 8000) });
}

async function localDockerStatus() {
  return runCommand("docker", ["info", "--format", "{{json .}}"], { timeout: 10000 });
}

async function localDockerContainers() {
  return runCommand("docker", ["ps", "-a", "--format", "table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}"], { timeout: 10000 });
}

async function localDockerContainerStatus(args = {}) {
  const name = String(args.name || args.container || "").trim();
  if (!name) return localDockerContainers();
  const resolvedName = await resolveDockerContainerName(name);
  return runCommand("docker", [
    "ps",
    "-a",
    "--filter",
    `name=^/${resolvedName}$`,
    "--format",
    "table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}",
  ], { timeout: 10000 });
}

async function localDockerLogs(args = {}) {
  const name = String(args.name || args.container || "").trim();
  if (!name) throw new Error("container name is required");
  const resolvedName = await resolveDockerContainerName(name);
  const tail = String(Math.max(10, Math.min(Number(args.tail || 120), 500)));
  const logs = await runCommand("docker", ["logs", "--tail", tail, resolvedName], { timeout: 10000 });
  return safeText({
    container: resolvedName,
    requested: name,
    tail,
    logs,
  });
}

async function localDockerDiskUsage() {
  return runCommand("docker", ["system", "df"], { timeout: 10000 });
}

async function ollamaHealth() {
  const base = ollamaBaseUrl();
  const startedAt = Date.now();
  const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  const text = await response.text();
  return safeText({
    ok: response.ok,
    status: response.status,
    durationMs: Date.now() - startedAt,
    baseUrl: base,
    bodyPreview: text.slice(0, 1200),
  });
}

async function ollamaModels() {
  const base = ollamaBaseUrl();
  const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ollama models failed: ${response.status}`);
  return safeText({
    baseUrl: base,
    models: (data.models || []).map((model) => model.name).filter(Boolean),
  });
}

async function ollamaChatProbe(args = {}) {
  const base = ollamaBaseUrl();
  const model = String(args.model || process.env.OLLAMA_MODEL || "joe-speedboat/Gemma-4-Uncensored-HauhauCS-Aggressive:e4b");
  const startedAt = Date.now();
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      options: { temperature: 0, num_ctx: 1024 },
      messages: [
        { role: "system", content: "Return the word ok only." },
        { role: "user", content: "health probe" },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `ollama chat probe failed: ${response.status}`);
  return safeText({
    ok: true,
    status: response.status,
    durationMs: Date.now() - startedAt,
    baseUrl: base,
    model,
    response: data.message?.content || data.response || "",
  });
}

function monitorPaths() {
  const root = serverRoot();
  const logDir = process.env.MONITOR_LOG_DIR || path.join(root, "logs");
  return {
    log: process.env.MONITOR_LOG_FILE || path.join(logDir, "ai-monitor.log"),
    pid: process.env.MONITOR_PID_FILE || path.join(logDir, "ai-monitor.pid"),
    healthScript: path.join(root, "scripts", "system", "health-check.sh"),
    config: path.join(root, "config", "monitor.conf"),
  };
}

async function readTail(filePath, bytes = 12000) {
  const stat = await fs.promises.stat(filePath);
  const start = Math.max(0, stat.size - bytes);
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(stat.size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

async function monitorStatus() {
  const paths = monitorPaths();
  const [pid, logTail, config] = await Promise.all([
    fs.promises.readFile(paths.pid, "utf8").then((value) => value.trim()).catch((err) => `unavailable: ${err.message}`),
    readTail(paths.log).catch((err) => `unavailable: ${err.message}`),
    fs.promises.readFile(paths.config, "utf8").catch((err) => `unavailable: ${err.message}`),
  ]);
  return safeText({
    pidFile: paths.pid,
    logFile: paths.log,
    configFile: paths.config,
    pid,
    config,
    recentLogs: logTail,
  });
}

async function monitorRecentLogs(args = {}) {
  const paths = monitorPaths();
  const bytes = Math.max(1000, Math.min(Number(args.bytes || 12000), 64000));
  return safeText({
    logFile: paths.log,
    recentLogs: await readTail(paths.log, bytes),
  });
}

async function monitorHealthCheck() {
  const paths = monitorPaths();
  if (!fs.existsSync(paths.healthScript)) throw new Error(`health script not found: ${paths.healthScript}`);
  const shell = process.platform === "win32" ? "bash" : "bash";
  return runCommand(shell, [paths.healthScript], { cwd: serverRoot(), timeout: 15000 });
}

async function extensionListTool() {
  return safeText({
    ok: true,
    extensions: listExtensions(),
  });
}

async function extensionGetTool(args = {}) {
  const id = String(args.id || args.extensionId || "").trim();

  if (!id) {
    return safeText({
      ok: true,
      extensions: listExtensions(),
      message: "Pass id or extensionId to fetch one extension.",
    });
  }

  const extension = getExtension(id);

  if (!extension) {
    throw new Error(`extension not found: ${id}`);
  }

  return safeText({
    ok: true,
    extension,
  });
}

async function extensionMatchUrlTool(args = {}) {
  const url = String(args.url || args.currentUrl || "").trim();
  if (!url) throw new Error("url is required");

  return safeText({
    ok: true,
    url,
    extension: matchExtensionForUrl(url),
  });
}

async function extensionPlanActionTool(args = {}) {
  return safeText(planExtensionAction({
    extensionId: args.extensionId || args.id || args.skillId || "",
    actionId: args.actionId,
    label: args.label,
  }));
}

async function extensionExecuteActionTool(args = {}) {
  const plan = planExtensionAction({
    extensionId: args.extensionId || args.id || args.skillId || "",
    actionId: args.actionId,
    label: args.label,
  });

  if (!plan.ok) {
    return safeText(plan);
  }

  const action = plan.action;
  const confirm = args.confirm === true;
  const confirmText = String(args.confirmText || "").trim();

  if (action.requiresConfirmation) {
    const requiredPhrase = `I CONFIRM ${action.label}`.toUpperCase();

    if (!confirm || confirmText.toUpperCase() !== requiredPhrase) {
      return safeText({
        ok: false,
        requiresConfirmation: true,
        blocked: true,
        extensionId: plan.extension.id,
        action: {
          id: action.id,
          label: action.label,
          kind: action.kind,
          pageKey: action.pageKey,
        },
        requiredPhrase,
        message: `Blocked. To execute "${action.label}", the user must explicitly type: ${requiredPhrase}`,
      });
    }
  }

  if (action.href) {
    return safeText({
      ok: true,
      extensionId: plan.extension.id,
      actionId: action.id,
      mode: "navigate",
      browser: await lightpandaFetch({
        url: action.href,
        waitMs: args.waitMs || "1200",
      }),
    });
  }

  if (action.selector) {
    const currentUrl = String(args.currentUrl || args.url || "").trim();
    const skill = getExtensionSkill(plan.extension.id);
    const page = skill?.pages && !Array.isArray(skill.pages)
      ? skill.pages[action.pageKey]
      : null;

    const targetUrl = currentUrl || page?.url || "";

    if (!targetUrl) {
      return safeText({
        ok: false,
        error: "currentUrl is required for selector-based extension actions and no learned page URL was found",
        extensionId: plan.extension.id,
        action: {
          id: action.id,
          label: action.label,
          pageKey: action.pageKey,
          selector: action.selector,
        },
      });
    }

    return safeText({
      ok: true,
      extensionId: plan.extension.id,
      actionId: action.id,
      mode: "click",
      targetUrl,
      browser: await lightpandaAction({
        url: targetUrl,
        action: "click",
        selector: action.selector,
        text: action.label,
        waitMs: args.waitMs || "1200",
      }),
    });
  }

  return safeText({
    ok: false,
    error: `action has no href or selector: ${action.id}`,
    action,
  });
}

async function browserAgentRunTool(args = {}) {
  return safeText(compactBrowserAgentPayload(await browserAgentRun(args)), 80000);
}

async function browserAgentObserveTool(args = {}) {
  return safeText(await browserAgentObserve(args), 20000);
}

async function browserAgentLearnTool(args = {}) {
  return safeText(await browserAgentLearn(args), 20000);
}

async function browserAgentResetTool(args = {}) {
  return safeText(await browserAgentReset(args), 12000);
}

async function browserAgentStatusTool(args = {}) {
  return safeText(await browserAgentStatus(args), 20000);
}

async function browserAgentDiagnoseTool(args = {}) {
  return safeText(await browserAgentDiagnose(args), 20000);
}

const builtinServers = [
  {
    id: "local",
    title: "Local System",
    type: "builtin",
    transport: "internal",
    enabled: true,
    description: "Scoped local workspace and host context. File tools stay inside FILE_ROOT.",
    tools: [
      {
        name: "list_directory",
        description: "List files and directories under FILE_ROOT. Use for fuzzy requests like show files, what's in this folder, list workspace.",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
        execute: readDirectory,
      },
      {
        name: "read_text_file",
        description: "Read a small text file under FILE_ROOT. Use for open/read/cat/show file requests.",
        inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } },
        execute: readTextFile,
      },
      {
        name: "write_text_file",
        description: "Create or overwrite a text file under FILE_ROOT. Use for create/write/save/edit file when full content is known.",
        inputSchema: { type: "object", required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } },
        execute: writeTextFile,
      },
      {
        name: "replace_in_file",
        description: "Edit a text file under FILE_ROOT by replacing exact text. Use for change/update/patch/rename text inside a file.",
        inputSchema: { type: "object", required: ["path", "find", "replace"], properties: { path: { type: "string" }, find: { type: "string" }, replace: { type: "string" } } },
        execute: replaceInFile,
      },
      {
        name: "search_files",
        description: "Search file and directory names under FILE_ROOT. Use when the user gives an approximate filename or asks find file.",
        inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, path: { type: "string" } } },
        execute: searchFiles,
      },
      {
        name: "host_info",
        description: "Return read-only host OS, CPU, memory, and uptime information.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => safeText({
          platform: process.platform,
          arch: process.arch,
          hostname: os.hostname(),
          uptimeSeconds: os.uptime(),
          loadAverage: os.loadavg(),
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
          cpus: os.cpus().length,
        }),
      },
    ],
  },
  {
    id: "git",
    title: "Git",
    type: "builtin",
    transport: "internal",
    enabled: true,
    description: "Read-only git repository inspection.",
    tools: [
      {
        name: "status",
        description: "Show current git status. Use for repo status, what changed, branch state.",
        inputSchema: { type: "object", properties: {} },
        execute: () => runGit(["status", "--short", "--branch"]),
      },
      {
        name: "recent_commits",
        description: "Show recent commits. Use for git history, recent work, last commits.",
        inputSchema: { type: "object", properties: { limit: { type: "string" } } },
        execute: (args = {}) => runGit(["log", "--oneline", `-${Math.min(Number(args.limit || 10), 30)}`]),
      },
      {
        name: "diff_summary",
        description: "Show current git diff statistics. Use for what files changed or diff overview.",
        inputSchema: { type: "object", properties: {} },
        execute: () => runGit(["diff", "--stat"]),
      },
    ],
  },
  {
    id: "memory",
    title: "Graph Memory",
    type: "builtin",
    transport: "internal",
    enabled: true,
    description: "FalkorDB/Graphiti memory tools.",
    tools: [
      {
        name: "status",
        description: "Check memory backend health.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => safeText(await checkMemoryHealth()),
      },
      {
        name: "search",
        description: "Search long-term memory for this chat/project. Use for what do you remember, memory, saved notes.",
        inputSchema: { type: "object", required: ["projectId", "query"], properties: { projectId: { type: "string" }, query: { type: "string" } } },
        execute: async (args) => safeText(await searchMemory(args.projectId || "default-user", args.query || "")),
      },
      {
        name: "save_fact",
        description: "Save a durable long-term memory fact. Use for remember this, note this, save as memory.",
        inputSchema: { type: "object", required: ["projectId", "summary"], properties: { projectId: { type: "string" }, summary: { type: "string" }, subject: { type: "string" }, predicate: { type: "string" }, object: { type: "string" } } },
        execute: async (args) => safeText(await saveFact(args.projectId || "default-user", {
          type: "fact",
          subject: args.subject || "user",
          predicate: args.predicate || "asked assistant to remember",
          object: args.object || args.summary || "",
          summary: args.summary || args.object || "",
          confidence: 1,
          source: "mcp.memory",
        })),
      },
      {
        name: "graph_snapshot",
        description: "Return current memory graph nodes and edges.",
        inputSchema: { type: "object", properties: { projectId: { type: "string" } } },
        execute: async (args) => safeText(await getGraphSnapshot(args.projectId || "default-user", { all: true })),
      },
    ],
  },
  {
    id: "web",
    title: "Web Fetch/Search",
    type: "builtin",
    transport: "internal",
    enabled: true,
    description: "Read-only web search and fetch wrapper for current information.",
    tools: [
      {
        name: "search",
        description: "Search the web through configured SEARXNG_URL or server/config/services.json.",
        inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "string" } } },
        execute: searchWeb,
      },
      {
        name: "fetch_url",
        description: "Fetch a URL and return bounded text content.",
        inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" } } },
        execute: fetchUrl,
      },
    ],
  },
  {
    id: "browser_agent",
    title: "Browser Agent",
    type: "builtin",
    transport: "internal",
    enabled: true,
    description: "Runtime website agent with observe-plan-act-retry-learn loop.",
    tools: [
      {
        name: "run",
        description: "Run one runtime browser-agent loop for a website instruction. Prefer this for browser-mode website actions, extension actions, URL navigation, and learning requests.",
        inputSchema: {
          type: "object",
          required: ["instruction"],
          properties: {
            sessionId: { type: "string" },
            instruction: { type: "string" },
            currentUrl: { type: "string" },
            extensionId: { type: "string" },
            maxSteps: { type: "number" },
            useExtensions: { type: "boolean" },
            allowDangerous: { type: "boolean" },
            confirm: { type: "boolean" },
            confirmText: { type: "string" },
          },
        },
        execute: browserAgentRunTool,
      },
      {
        name: "observe",
        description: "Observe the current browser page and return URL, title, forms, inputs, buttons, links, matching extension, and possible safe actions.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            currentUrl: { type: "string" },
            extensionId: { type: "string" },
            useExtensions: { type: "boolean" },
          },
        },
        execute: browserAgentObserveTool,
      },
      {
        name: "learn",
        description: "Learn a user-named action or alias from the current page without overwriting imported site-skill observations.",
        inputSchema: {
          type: "object",
          required: ["instruction"],
          properties: {
            sessionId: { type: "string" },
            instruction: { type: "string" },
            label: { type: "string" },
            selector: { type: "string" },
            href: { type: "string" },
            textPattern: { type: "string" },
            extensionId: { type: "string" },
            currentUrl: { type: "string" },
            useExtensions: { type: "boolean" },
          },
        },
        execute: browserAgentLearnTool,
      },
      {
        name: "reset",
        description: "Reset persisted runtime browser-agent state for this chat/session.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
          },
        },
        execute: browserAgentResetTool,
      },
      {
        name: "status",
        description: "Return persisted runtime browser-agent state and optional runtime-model configuration.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
          },
        },
        execute: browserAgentStatusTool,
      },
      {
        name: "diagnose",
        description: "Diagnose a browser-agent failure using persisted browser state, tool result JSON, and error text. Use this for browser errors, CDP failures, static_fetch limitations, and backend/proxy failures.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            instruction: { type: "string" },
            currentUrl: { type: "string" },
            error: { type: "string" },
            browserResult: { type: "string" },
          },
        },
        execute: browserAgentDiagnoseTool,
      },
    ],
  },
  {
    id: "browser",
    title: "Browser",
    type: "builtin",
    transport: "cdp",
    enabled: true,
    description: "Shared headless browser engine for AI web navigation, extraction, and future extensions.",
    tools: [
      {
        name: "lightpanda_status",
        description: "Check Lightpanda CDP browser status and response time.",
        inputSchema: { type: "object", properties: {} },
        execute: lightpandaStatus,
      },
      {
        name: "lightpanda_navigate",
        description: "Navigate with Lightpanda and return title, URL, text, links, forms, stats, and duration.",
        inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" }, waitMs: { type: "string" } } },
        execute: (args) => lightpandaFetch(args),
      },
      {
        name: "lightpanda_extract",
        description: "Extract page text and structured browser metadata from a URL using Lightpanda.",
        inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" }, waitMs: { type: "string" } } },
        execute: (args) => lightpandaFetch(args),
      },
      {
        name: "lightpanda_action",
        description: "Guided browser action. Use one action per round: snapshot, fill, click, or submit. For submit with password fields, confirm=true is required.",
        inputSchema: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string" },
            action: { type: "string", description: "snapshot | fill | click | submit" },
            fields: { type: "array", description: "Fields to fill: [{selector,name,id,label,placeholder,type,value}]" },
            selector: { type: "string" },
            text: { type: "string" },
            buttonText: { type: "string" },
            formSelector: { type: "string" },
            formIndex: { type: "string" },
            waitMs: { type: "string" },
            confirm: { type: "boolean" },
            confirmText: { type: "string" },
          },
        },
        execute: (args) => lightpandaAction(args),
      },
      {
        name: "instant_scrape",
        description: "Instant scraper. Visit a URL and extract tables, repeated card/list groups, links, and a text preview. Use in scraper mode.",
        inputSchema: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string" },
            waitMs: { type: "string" },
          },
        },
        execute: (args) => lightpandaInstantScrape(args),
      },
      {
        name: "browser_open_headful",
        description: "Open a manual Chrome fallback window without changing the Lightpanda-first browser-agent default.",
        inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" } } },
        execute: openHeadfulBrowser,
      },
    ],
  },
  {
    id: "extensions",
    title: "Extensions",
    type: "builtin",
    transport: "internal",
    enabled: true,
    description: "Browser extensions generated from site skills. Use this for site-specific browser workflows.",
    tools: [
      {
        name: "list",
        description: "List enabled browser extensions generated from site skills.",
        inputSchema: { type: "object", properties: {} },
        execute: extensionListTool,
      },
      {
        name: "get",
        description: "Get one browser extension by id, including permissions and known actions.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            extensionId: { type: "string" },
          },
        },
        execute: extensionGetTool,
      },
      {
        name: "match_url",
        description: "Match a URL to a browser extension by domain.",
        inputSchema: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string" },
            currentUrl: { type: "string" },
          },
        },
        execute: extensionMatchUrlTool,
      },
      {
        name: "plan_action",
        description: "Plan an extension action before execution. Use this before clicking or navigating with a site-specific action.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            extensionId: { type: "string" },
            skillId: { type: "string" },
            actionId: { type: "string" },
            label: { type: "string" },
          },
        },
        execute: extensionPlanActionTool,
      },
      {
        name: "execute_action",
        description: "Execute a safe extension action. Risky actions require an exact user confirmation phrase and should not be called automatically.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            extensionId: { type: "string" },
            skillId: { type: "string" },
            actionId: { type: "string" },
            label: { type: "string" },
            currentUrl: { type: "string" },
            url: { type: "string" },
            waitMs: { type: "string" },
            confirm: { type: "boolean" },
            confirmText: { type: "string" },
          },
        },
        execute: extensionExecuteActionTool,
      },
    ],
  },
  {
    id: "ops",
    title: "Local Ops",
    type: "builtin",
    transport: "internal",
    enabled: true,
    description: "Read-only local Docker, Ollama API, and cold-start monitor tools.",
    tools: [
      {
        name: "mcp_architecture_status",
        description: "Return MCP architecture overview with builtin groups and external server configs.",
        inputSchema: { type: "object", properties: {} },
        execute: mcpArchitectureStatusTool,
      },
      {
        name: "external_mcp_servers",
        description: "List configured external MCP server definitions from config file.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ ok: true, servers: await loadExternalMcpConfigs() }),
      },
      {
        name: "external_mcp_status",
        description: "Check connection status of all configured external MCP servers.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ ok: true, statuses: await listExternalMcpStatuses() }),
      },
      {
        name: "external_mcp_tools",
        description: "List tools from a specific external MCP server by serverId. Requires real discovery.",
        inputSchema: { type: "object", required: ["serverId"], properties: { serverId: { type: "string" } } },
        execute: async (args) => ({ ok: true, tools: await listExternalMcpTools(args.serverId) }),
      },
      {
        name: "external_mcp_refresh",
        description: "Refresh/re-discover tools from a specific external MCP server by serverId.",
        inputSchema: { type: "object", required: ["serverId"], properties: { serverId: { type: "string" } } },
        execute: async (args) => ({ ok: true, tools: await refreshExternalMcpTools(args.serverId) }),
      },
      {
        name: "playwright_mcp_status",
        description: "Check status of the Playwright MCP external server specifically. Returns empty if not discovered.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
          const configs = await loadExternalMcpConfigs();
          const pwConfig = configs.find(c => c.id === "playwright");
          if (!pwConfig) return { ok: true, discovered: false, message: "Playwright MCP not configured" };
          const status = await getExternalMcpServerStatus("playwright");
          return { ok: true, discovered: true, server: status };
        },
      },
      {
        name: "local_docker_status",
        description: "Check local Docker engine status with docker info. Use for docker status and docker daemon checks.",
        inputSchema: { type: "object", properties: {} },
        execute: localDockerStatus,
      },
      {
        name: "local_docker_containers",
        description: "List local Docker containers and their status. Use for container status, ps, unhealthy containers.",
        inputSchema: { type: "object", properties: {} },
        execute: localDockerContainers,
      },
      {
        name: "local_docker_container_status",
        description: "Check status for a named local Docker container/service. Use for fuzzy service names like yt worker, api worker, backend worker.",
        inputSchema: { type: "object", properties: { name: { type: "string" } } },
        execute: localDockerContainerStatus,
      },
      {
        name: "local_docker_logs",
        description: "Read recent logs for a named local Docker container. Read-only and bounded.",
        inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" }, tail: { type: "string" } } },
        execute: localDockerLogs,
      },
      {
        name: "local_docker_disk_usage",
        description: "Show local Docker image/container/volume disk usage.",
        inputSchema: { type: "object", properties: {} },
        execute: localDockerDiskUsage,
      },
      {
        name: "ollama_health",
        description: "Check configured Ollama-compatible API health using /api/tags.",
        inputSchema: { type: "object", properties: {} },
        execute: ollamaHealth,
      },
      {
        name: "ollama_models",
        description: "List models from the configured Ollama-compatible API.",
        inputSchema: { type: "object", properties: {} },
        execute: ollamaModels,
      },
      {
        name: "ollama_chat_probe",
        description: "Run a short non-streaming chat probe against the configured Ollama-compatible API.",
        inputSchema: { type: "object", properties: { model: { type: "string" } } },
        execute: ollamaChatProbe,
      },
      {
        name: "monitor_status",
        description: "Read cold-start monitor pid/config and recent logs.",
        inputSchema: { type: "object", properties: {} },
        execute: monitorStatus,
      },
      {
        name: "monitor_recent_logs",
        description: "Read recent cold-start monitor logs.",
        inputSchema: { type: "object", properties: { bytes: { type: "string" } } },
        execute: monitorRecentLogs,
      },
      {
        name: "monitor_health_check",
        description: "Run the existing read-only system health-check script.",
        inputSchema: { type: "object", properties: {} },
        execute: monitorHealthCheck,
      },
    ],
  },
];

const extensionCatalog = [
  { name: "OpenWebUI MCP Streamable HTTP", type: "MCP", target: "MCP", risk: "medium", source: "https://docs.openwebui.com/features/mcp", description: "Connect Streamable HTTP MCP servers to OpenWebUI-style clients." },
  { name: "OpenWebUI mcpo bridge", type: "OpenWebUI Tool", target: "Extensions", risk: "medium", source: "https://docs.openwebui.com/features/extensibility/plugin/tools/openapi-servers/mcp/", description: "Expose stdio/SSE MCP tools as OpenAPI endpoints." },
  { name: "OpenWebUI Functions", type: "OpenWebUI Function", target: "Extensions", risk: "high", source: "https://docs.openwebui.com/features/extensibility/plugin/functions/", description: "Python functions that alter platform behavior; catalog only for v1." },
  { name: "Claude-style Skills", type: "Claude Skill", target: "Extensions", risk: "low", source: "https://support.claude.com/en/articles/10949351-getting-started-with-model-context-protocol-mcp-on-claude-for-desktop", description: "Reusable instructions and workflows that can be adapted later." },
  { name: "MCP for claude.ai browser bridge", type: "Browser Extension", target: "Extensions", risk: "high", source: "https://chromewebstore.google.com/detail/mcp-for-claudeai/jbdhaamjibfahpekpnjeikanebpdpfpb", description: "Browser bridge idea; keep separate from MCP server execution." },
];

let callLog = [];
const serverResponseMs = new Map();
const serverHealthOk = new Map();
const externalToolNameMaps = new Map();

function isServerEnabled(server) {
  if (server.id === "git" && !findGitRoot()) return false;
  return Boolean(server.enabled);
}

function isBuiltinServer(server) {
  return server.source === "builtin" || server.type === "builtin";
}

function serverStatus(server) {
  if (server.id === "git" && !findGitRoot()) return "disabled";
  if (server.id === "web" && !configuredSearxngBase()) return "needs_config";
  if (server.id === "memory" && !getMemoryStatus().ready) {
    return getMemoryStatus().fallback?.enabled ? "degraded" : "error";
  }
  if (serverHealthOk.get(server.id) === false) return "error";
  return "ready";
}

export async function listMcpServers() {
  const builtin = builtinServers.map((server) => ({
    id: server.id,
    title: server.title,
    type: server.type,
    transport: server.transport,
    enabled: isServerEnabled(server),
    description: server.description,
    status: serverStatus(server),
    toolCount: isServerEnabled(server) ? server.tools.length : 0,
    responseMs: serverResponseMs.get(server.id) ?? null,
    lastCheckedAt: null,
    lastCallAt: null,
    lastError: null,
    connected: serverStatus(server) === "ready",
    source: "builtin",
    protocol: "internal-function",
    external: false,
    mcpNative: false,
  }));

  const external = await loadExternalMcpConfigs();
  const externalStatuses = await listExternalMcpStatuses();
  return [
    ...builtin,
    ...external.map((cfg) => {
      const status = externalStatuses.find(s => s.id === cfg.id) || {};
      const tools = getExternalMcpCachedTools(cfg.id);
      const cachedResponseMs = serverResponseMs.get(cfg.id);
      return {
        id: cfg.id,
        title: cfg.title || cfg.id,
        type: "external",
        transport: cfg.transport,
        enabled: cfg.enabled,
        description: cfg.description || "",
        status: status.status || "unknown",
        toolCount: tools?.length ?? 0,
        responseMs: cachedResponseMs ?? null,
        lastCheckedAt: null,
        lastCallAt: null,
        lastError: status.error || null,
        connected: Boolean(status.running && status.initialized),
        source: "external",
        protocol: "mcp",
        external: true,
        mcpNative: true,
      };
    }),
  ];
}

function externalMcpToolRecords(config, tools = []) {
  if (!config || !config.enabled) return [];
  return tools.map((tool) => ({
    name: `mcp__${config.id}__${tool.name}`,
    serverId: config.id,
    serverTitle: config.title || config.id,
    source: "external",
    type: "mcp",
    transport: config.transport,
    protocol: "mcp",
    external: true,
    mcpNative: true,
    description: tool.description || "",
    inputSchema: tool.inputSchema || { type: "object", properties: {} },
    enabled: true,
    originalName: tool.name,
  }));
}

export async function listMcpTools() {
  const builtin = builtinServers.flatMap((server) =>
    isServerEnabled(server) ? server.tools.map((tool) => ({
      name: `mcp__${server.id}__${tool.name}`,
      serverId: server.id,
      serverTitle: server.title,
      source: "builtin",
      type: "builtin",
      transport: "internal",
      protocol: "internal-function",
      external: false,
      mcpNative: false,
      description: tool.description,
      inputSchema: tool.inputSchema,
      enabled: true,
    })) : []
  );

  const externalConfigs = await loadExternalMcpConfigs();
  const externalTools = [];
  for (const config of externalConfigs) {
    if (!config.enabled) continue;
    const tools = await getExternalMcpCachedTools(config.id);
    externalTools.push(...externalMcpToolRecords(config, tools));
  }

  return [...builtin, ...externalTools];
}

export async function listMcpToolDefinitions() {
  return (await listMcpTools())
    .filter((tool) => tool.enabled)
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: `[${tool.serverTitle}] ${tool.description}`,
        parameters: tool.inputSchema || { type: "object", properties: {} },
      },
    }));
}

export function getMcpLogs() {
  return callLog.slice(-100).reverse();
}

export function getExtensionCatalog() {
  return extensionCatalog;
}

function firstQuoted(text) {
  const match = String(text || "").match(/["'`](.+?)["'`]/);
  return match?.[1] || "";
}

function pathCandidate(text) {
  const quoted = firstQuoted(text);
  if (quoted && /[\\/.\w-]/.test(quoted)) return quoted;
  const match = String(text || "").match(/(?:file|path)\s+([^\s]+(?:\.[a-z0-9]+)?)/i);
  return match?.[1] || "";
}

function replacementCandidate(text) {
  const replaceMatch = String(text || "").match(/replace\s+["'`]?(.+?)["'`]?\s+with\s+["'`]?(.+?)["'`]?(?:\s+in\s+file\b|\s+file\b|\s+path\b|$)/i);
  if (replaceMatch) return { find: replaceMatch[1].trim(), replace: replaceMatch[2].trim() };
  const changeMatch = String(text || "").match(/change\s+["'`]?(.+?)["'`]?\s+(?:to|into)\s+["'`]?(.+?)["'`]?(?:\s+in\s+file\b|\s+file\b|\s+path\b|$)/i);
  if (changeMatch) return { find: changeMatch[1].trim(), replace: changeMatch[2].trim() };
  return { find: "", replace: "" };
}

function containerNameCandidate(text) {
  const raw = String(text || "");
  const quoted = firstQuoted(raw);
  if (quoted) return quoted.trim();
  const exact = raw.match(/\b([a-z0-9][a-z0-9_.-]*(?:worker|api|backend|frontend|server|service)[a-z0-9_.-]*)\b/i)?.[1];
  if (exact) return exact;
  if (/\byt\b|\byoutube\b/i.test(raw) && /\bworker\b/i.test(raw)) return "yt-worker";
  return "";
}

function useTools(candidates, reason, risk = "low", confidence = 0.9) {
  return {
    answer_directly: false,
    must_call_tools: true,
    tool_candidates: candidates,
    risk,
    confidence,
    reason,
  };
}

function isCasualNoTool(text) {
  const lower = String(text || "").trim().toLowerCase();
  return /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great|gm|gn)[!.?\s]*$/.test(lower);
}

function extractBrowserTarget(text = "") {
  const raw = String(text || "");
  const url = raw.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (url) return url.replace(/[.,;]+$/, "");
  const domain = raw.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>]*)?/i)?.[0];
  if (domain) return domain.replace(/[.,;]+$/, "");
  const quoted = raw.match(/["“']([^"”']+)["”']/)?.[1];
  return quoted && /\./.test(quoted) ? quoted.trim() : "";
}

function tokenSet(text = "") {
  return new Set(String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean));
}

function mentionedExtensionId(text = "") {
  const tokens = tokenSet(text);
  const matched = listExtensions().find((extension) => {
    const extensionTokens = tokenSet([
      extension.id,
      extension.name,
      ...(extension.domains || []),
    ].join(" "));
    return Array.from(extensionTokens).some((token) => token.length >= 3 && tokens.has(token));
  });
  return matched?.id || "";
}

function cachedExternalToolName(serverId, preferredNames = []) {
  const config = getExternalMcpServerConfig(serverId);
  if (!config) return "";
  const tools = externalMcpToolRecords(config, getExternalMcpCachedTools(serverId));
  for (const preferred of preferredNames) {
    const match = tools.find((tool) => tool.originalName === preferred || tool.name.endsWith(`__${preferred}`));
    if (match) return match.name;
  }
  return "";
}

export function routeMcpIntent(text = "", options = {}) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  const projectId = String(options.projectId || "default-user");
  const mode = String(options.mode || "auto").toLowerCase();
  const pathArg = pathCandidate(raw);

  const result = {
    answer_directly: true,
    must_call_tools: false,
    tool_candidates: [],
    risk: "low",
    confidence: 0,
    reason: "direct answer is acceptable",
  };

  const use = (name, args = {}, reason = "matched fuzzy MCP intent", risk = "low", confidence = 0.9) =>
    useTools([{ name, arguments: args }], reason, risk, confidence);

  if (isCasualNoTool(raw)) return result;

  const browserTarget = extractBrowserTarget(raw);
  const namedExtensionId = mentionedExtensionId(raw);
  const explicitPlaywright = /\b(playwright\s*mcp|mcp\s*playwright|use\s+playwright)\b/i.test(lower);

  if (explicitPlaywright) {
    if (/\b(status|health|ready|running|check|up|down|available)\b/i.test(lower)) {
      return use(
        "mcp__ops__playwright_mcp_status",
        {},
        "explicit Playwright MCP status request should use the ops status tool",
        "low",
        0.98
      );
    }

    if (/\b(refresh|reload|rediscover)\b/i.test(lower)) {
      return use(
        "mcp__ops__external_mcp_refresh",
        { serverId: "playwright" },
        "explicit Playwright MCP refresh request should rediscover real external tools",
        "low",
        0.98
      );
    }

    if (/\b(list|show|get|available|tools?)\b/i.test(lower)) {
      return use(
        "mcp__ops__external_mcp_tools",
        { serverId: "playwright" },
        "explicit Playwright MCP tool listing should query the external server",
        "low",
        0.98
      );
    }

    if (mode !== "browser" && browserTarget && /\b(open|visit|navigate|go to|browse)\b/i.test(lower)) {
      const navigateTool = cachedExternalToolName("playwright", ["browser_navigate"]);
      if (navigateTool) {
        return use(
          navigateTool,
          { url: browserTarget },
          "explicit Playwright MCP navigation uses the discovered real browser_navigate tool",
          "low",
          0.95
        );
      }
      return use(
        "mcp__ops__external_mcp_tools",
        { serverId: "playwright" },
        "Playwright MCP tools are not discovered yet; list or refresh them before calling a browser tool",
        "low",
        0.85
      );
    }
  }

  if (mode === "browser") {
    if (/\b(diagnose|diagnosis|debug|why did|why is|error|failed|failure|not working)\b/i.test(lower) && /\b(browser|browser agent|lightpanda|cdp|static_fetch|form|click|fill|submit|menu)\b/i.test(lower)) {
      return use(
        "mcp__browser_agent__diagnose",
        {
          sessionId: projectId,
          instruction: raw,
          currentUrl: options.currentUrl || "",
          error: raw,
        },
        "browser mode diagnostics should use the browser-agent diagnostic MCP tool",
        "low",
        0.97
      );
    }

    if (/\b(browser agent status|agent status)\b/i.test(lower)) {
      return use(
        "mcp__browser_agent__status",
        { sessionId: projectId },
        "browser mode status should use the runtime browser agent",
        "low",
        0.96
      );
    }

    if (/\b(lightpanda|light panda|cdp)\b/i.test(lower) && /\b(status|health|ready|running|check|up|down|available)\b/i.test(lower)) {
      return use(
        "mcp__browser__lightpanda_status",
        {},
        "explicit Lightpanda/CDP status requires the low-level browser tool",
        "low",
        0.98
      );
    }

    return use(
      "mcp__browser_agent__run",
      {
        sessionId: projectId,
        instruction: raw,
        currentUrl: options.currentUrl || "",
        ...(namedExtensionId ? { extensionId: namedExtensionId } : {}),
      },
      "browser mode website instructions should run through the runtime browser agent",
      "low",
      0.98
    );
  }

  // Extension / site-skill routing
  if (/\b(extension|extensions|site skill|site skills|known actions|available actions)\b/.test(lower) || namedExtensionId) {
    if (browserTarget) {
      return use(
        "mcp__extensions__match_url",
        { url: browserTarget },
        "site-specific browser workflow should match URL to an extension",
        "low",
        0.95
      );
    }

    if (namedExtensionId && /\b(show|list|get|available|known|actions?)\b/.test(lower)) {
      return use(
        "mcp__extensions__get",
        { id: namedExtensionId },
        "named extension catalog should be fetched through the extension layer",
        "low",
        0.94
      );
    }

    return use(
      "mcp__extensions__list",
      {},
      "extension catalog request should use the extension layer",
      "low",
      0.9
    );
  }

  // Browser / Lightpanda routing
  if (/\b(lightpanda|light panda|browser|cdp|headless browser|chrome)\b/.test(lower)) {
    if (/\b(status|health|ready|running|check|up|down|available)\b/.test(lower)) {
      return use(
        "mcp__browser__lightpanda_status",
        {},
        "Lightpanda/browser status requires browser MCP",
        "low",
        0.98
      );
    }

    if (browserTarget && /\b(open|visit|navigate|extract|read|browse|page|url|scrape)\b/.test(lower)) {
      if (mode === "scraper" || /\b(scrape|scraper|extract data|extract table|extract cards)\b/.test(lower)) {
        return use(
          "mcp__browser__instant_scrape",
          { url: browserTarget },
          "scraper request uses the instant scraper browser tool",
          "low",
          0.96
        );
      }

      return use(
        "mcp__browser__lightpanda_navigate",
        { url: browserTarget },
        "browser/page navigation requires Lightpanda MCP",
        "low",
        0.95
      );
    }
  }

  if (browserTarget && mode === "scraper") {
    return use(
      "mcp__browser__instant_scrape",
      { url: browserTarget },
      "scraper mode uses instant scraper",
      "low",
      0.96
    );
  }

  if (browserTarget && mode === "browser") {
    return use(
      "mcp__browser__lightpanda_navigate",
      { url: browserTarget },
      "browser mode uses Lightpanda navigation",
      "low",
      0.96
    );
  }

  const mcpAllowedMode = mode === "dev" || mode === "browser" || mode === "scraper";
  const explicitLocalOps =
    /\b(docker|container|containers|ollama|chat-api|chat api|llm api|monitor|cold start|cold-start|memory|graphiti|falkor|falkordb|repo|repository|git|branch|commit|diff|file|folder|directory|workspace|lightpanda|light panda|browser)\b/.test(lower);

  if (!mcpAllowedMode && !explicitLocalOps) {
    return result;
  }

  // Web search
  if (/\b(search|look up|lookup|google|find latest|latest news|current news|news|right now on the web)\b/.test(lower)) {
    return use(
      "mcp__web__search",
      { query: raw.slice(0, 240), limit: "5" },
      "explicit current/web request requires web MCP",
      "low",
      0.9
    );
  }

  // Docker / services
  if (/\b(docker|container|containers|image|images|volume|volumes)\b/.test(lower)) {
    if (/\b(disk|space|usage|size|df|volume|volumes|image|images|storage|full)\b/.test(lower)) {
      return use(
        "mcp__ops__local_docker_disk_usage",
        {},
        "Docker disk usage requires local Docker MCP",
        "low",
        0.95
      );
    }

    if (/\b(ps|list|containers?|running|unhealthy)\b/.test(lower)) {
      return use(
        "mcp__ops__local_docker_containers",
        {},
        "Docker container status requires local Docker MCP",
        "low",
        0.95
      );
    }

    return use(
      "mcp__ops__local_docker_status",
      {},
      "Docker status requires local Docker MCP",
      "low",
      0.92
    );
  }

  if (/\b(worker|service|pm2|process|backend|frontend|api)\b/.test(lower) && /\b(status|logs?|running|health|check|tail)\b/.test(lower)) {
    const name = containerNameCandidate(raw);

    if (/\b(log|logs|tail)\b/.test(lower) && name) {
      return use(
        "mcp__ops__local_docker_logs",
        { name, tail: "120" },
        "named service logs require Docker logs MCP",
        "low",
        0.92
      );
    }

    return use(
      "mcp__ops__local_docker_container_status",
      name ? { name } : {},
      "named service status requires Docker container MCP",
      "low",
      0.9
    );
  }

  // Ollama / model API
  if (/\b(ollama|model|models|chat-api|chat api|llm api|api health|api probe)\b/.test(lower)) {
    if (/\b(model|models|tags|available)\b/.test(lower)) {
      return use(
        "mcp__ops__ollama_models",
        {},
        "Ollama model listing requires Ollama MCP",
        "low",
        0.95
      );
    }

    if (/\b(probe|chat|generate|completion)\b/.test(lower)) {
      return use(
        "mcp__ops__ollama_chat_probe",
        {},
        "Ollama chat probe requires Ollama MCP",
        "low",
        0.9
      );
    }

    return use(
      "mcp__ops__ollama_health",
      {},
      "Ollama health check requires Ollama MCP",
      "low",
      0.92
    );
  }

  // Monitor
  if (/\b(cold start|cold-start|pinger|ping monitor|monitor|health check|health-check)\b/.test(lower)) {
    if (/\b(log|logs|recent|tail)\b/.test(lower)) {
      return use(
        "mcp__ops__monitor_recent_logs",
        {},
        "monitor logs require monitor MCP",
        "low",
        0.92
      );
    }

    if (/\b(run|check|health)\b/.test(lower)) {
      return use(
        "mcp__ops__monitor_health_check",
        {},
        "monitor health check requires monitor MCP",
        "low",
        0.9
      );
    }

    return use(
      "mcp__ops__monitor_status",
      {},
      "monitor status requires monitor MCP",
      "low",
      0.9
    );
  }

  if (/\b(vps|remote server)\b/.test(lower)) {
    return use(
      "mcp__ops__ollama_health",
      {},
      "VPS agent is disabled; checking configured APIs locally instead",
      "medium",
      0.75
    );
  }

  // File tools
  if (/\b(create|write|save|overwrite)\b.*\bfile\b|\bmake\b.*\bfile\b/.test(lower)) {
    return use(
      "mcp__local__write_text_file",
      {
        path: pathArg || "mcp-test.txt",
        content: options.content || "Created by MCP write_text_file.\n",
      },
      "file creation/write requires the scoped filesystem write tool",
      "medium",
      0.9
    );
  }

  if (/\b(edit|change|update|patch|replace)\b.*\bfile\b|\breplace\b/.test(lower)) {
    const replacement = replacementCandidate(raw);

    return use(
      "mcp__local__replace_in_file",
      {
        path: pathArg || "mcp-test.txt",
        find: options.find || replacement.find,
        replace: options.replace || replacement.replace,
      },
      "file edits require the scoped filesystem replace tool",
      "medium",
      0.9
    );
  }

  if (/\b(read|open|show|cat|view|peek)\b.*\bfile\b/.test(lower)) {
    return use(
      "mcp__local__read_text_file",
      { path: pathArg || "" },
      "file reads require the scoped filesystem read tool",
      "low",
      0.9
    );
  }

  if (/\b(list|show|open)\b.*\b(files|folder|directory|workspace)\b/.test(lower)) {
    return use(
      "mcp__local__list_directory",
      { path: pathArg || "." },
      "directory listing requires the scoped filesystem list tool",
      "low",
      0.9
    );
  }

  if (/\b(find|search)\b.*\b(file|folder|directory)\b/.test(lower)) {
    return use(
      "mcp__local__search_files",
      { query: firstQuoted(raw) || raw.slice(0, 80), path: "." },
      "file discovery requires the scoped filesystem search tool",
      "low",
      0.9
    );
  }

  // Git routing
  if (/\b(repo|repository|git|commit|diff|branch)\b/.test(lower)) {
    if (/\b(diff|changed|changes)\b/.test(lower)) {
      return use(
        "mcp__git__diff_summary",
        {},
        "repo change questions require git diff",
        "low",
        0.95
      );
    }

    if (/\b(commit|history|log)\b/.test(lower)) {
      return use(
        "mcp__git__recent_commits",
        { limit: "8" },
        "repo history questions require git log",
        "low",
        0.95
      );
    }

    return use(
      "mcp__git__status",
      {},
      "repo status questions require git status",
      "low",
      0.92
    );
  }

  // Memory
  if (/\b(memory|remembered|knowledge graph|graphiti|falkor|falkordb)\b/.test(lower)) {
    if (/\b(graph|nodes?|edges?|falkor|falkordb)\b/.test(lower)) {
      return use(
        "mcp__memory__graph_snapshot",
        { projectId },
        "memory graph questions require graph snapshot",
        "low",
        0.9
      );
    }

    return use(
      "mcp__memory__search",
      { projectId, query: raw.slice(0, 240) },
      "memory questions require memory search",
      "low",
      0.9
    );
  }

  // Current information fallback
  if (/\b(search|look up|lookup|latest|current|today|news|right now)\b/.test(lower)) {
    return use(
      "mcp__web__search",
      { query: raw.slice(0, 240), limit: "5" },
      "current information requires web search",
      "low",
      0.85
    );
  }

  return result;
}

export async function callMcpTool(name, args = {}) {
  const match = String(name || "").match(/^mcp__(.+?)__(.+)$/);
  if (!match) throw new Error(`invalid MCP tool name: ${name}`);

  const [, serverId, toolName] = match;
  const startedAt = Date.now();
  const entry = {
    id: `${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    tool: name,
    serverId,
    args,
    status: "running",
    startedAt,
    durationMs: 0,
    result: "",
  };

  callLog.push(entry);

  try {
    let result;
    const server = builtinServers.find(s => s.id === serverId);
    if (server) {
      if (!isServerEnabled(server)) throw new Error(`MCP server not enabled: ${serverId}`);
      const tool = server.tools.find((entry) => entry.name === toolName);
      if (!tool) throw new Error(`MCP tool not found: ${name}`);
      result = await tool.execute(args || {});
      serverResponseMs.set(server.id, Date.now() - startedAt);
      serverHealthOk.set(server.id, !(result && typeof result === "object" && result.ok === false));
    } else {
      const config = getExternalMcpServerConfig(serverId);
      if (!config) throw new Error(`MCP server not enabled: ${serverId}`);
      if (!config.enabled) throw new Error(`MCP server disabled: ${serverId}`);
      const cached = externalMcpToolRecords(config, getExternalMcpCachedTools(serverId));
      const originalToolName =
        externalToolNameMaps.get(serverId)?.get(toolName) ||
        cached.find((tool) => tool.name === name)?.originalName ||
        toolName;
      result = await callExternalMcpTool(serverId, originalToolName, args || {});
      serverResponseMs.set(serverId, Date.now() - startedAt);
      serverHealthOk.set(serverId, true);
    }
    entry.status = "complete";
    entry.durationMs = Date.now() - startedAt;
    entry.result = result;
    appendAuditEvent(convertMcpLogToAuditInput(entry));
    return result;
  } catch (err) {
    entry.status = "error";
    entry.durationMs = Date.now() - startedAt;
    serverResponseMs.set(serverId, entry.durationMs);
    serverHealthOk.set(serverId, false);
    entry.result = err?.message || String(err);
    appendAuditEvent(convertMcpLogToAuditInput(entry));
    throw err;
  } finally {
    callLog = callLog.slice(-200);
  }
}

setBrowserAgentMcpCaller(callMcpTool);

async function mcpArchitectureStatusTool() {
  const builtinList = builtinServers.map((server) => ({
    id: server.id,
    title: server.title,
    source: "builtin",
    type: "builtin",
    transport: "internal",
    protocol: "internal-function",
    external: false,
    mcpNative: false,
    enabled: isServerEnabled(server),
    status: serverStatus(server),
    toolCount: isServerEnabled(server) ? server.tools.length : 0,
  }));

  const externalList = await loadExternalMcpConfigs();

  return {
    builtinToolGroups: builtinList,
    externalMcpServers: externalList,
    summary: {
      builtinCount: builtinList.length,
      externalConfiguredCount: externalList.length,
      externalConnectedCount: externalList.filter((s) => s.connected).length,
      configPath: getMcpConfigPath(),
      hasConfigFile: hasExternalMcpConfig(),
    },
  };
}

export async function mcp__ops__mcp_architecture_status() {
  return mcpArchitectureStatusTool();
}

async function measureTool(name, args = {}) {
  const startedAt = Date.now();
  const match = String(name || "").match(/^mcp__(.+?)__/);
  const serverId = match?.[1];
  try {
    const result = await callMcpTool(name, args);
    const durationMs = Date.now() - startedAt;

    let parsedResult = result;
    if (typeof result === "string" && /^[\s\r\n]*[{[]/.test(result)) {
      try {
        parsedResult = JSON.parse(result);
      } catch {}
    }

    if (parsedResult && typeof parsedResult === "object" && parsedResult.ok === false) {
      if (serverId) {
        serverHealthOk.set(serverId, false);
        serverResponseMs.set(serverId, durationMs);
      }
      return {
        ok: false,
        tool: name,
        durationMs,
        error: parsedResult.error || parsedResult.reason || "service reported not ok",
        preview: safeText(result, 700),
      };
    }

    if (serverId) {
      serverHealthOk.set(serverId, true);
      serverResponseMs.set(serverId, durationMs);
    }
    return {
      ok: true,
      tool: name,
      durationMs,
      preview: safeText(result, 700),
    };
  } catch (err) {
    if (serverId) serverHealthOk.set(serverId, false);
    return {
      ok: false,
      tool: name,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getServiceStatus() {
  const startedAt = Date.now();

  const [memory, ollama, docker, browser, monitor, git, web] = await Promise.all([
    measureTool("mcp__memory__status"),
    measureTool("mcp__ops__ollama_health"),
    measureTool("mcp__ops__local_docker_status"),
    measureTool("mcp__browser__lightpanda_status"),
    measureTool("mcp__ops__monitor_status"),
    findGitRoot()
      ? measureTool("mcp__git__status")
      : Promise.resolve({
          ok: true,
          skipped: true,
          tool: "mcp__git__status",
          durationMs: 0,
          preview: "git repository unavailable",
        }),
    configuredSearxngBase()
      ? measureTool("mcp__web__search", { query: "health check", limit: "1" })
      : Promise.resolve({
          ok: false,
          tool: "mcp__web__search",
          durationMs: 0,
          error: "SearXNG is not configured",
        }),
  ]);

  serverHealthOk.set("memory", Boolean(memory.ok));
  serverHealthOk.set("browser", Boolean(browser.ok));
  serverHealthOk.set("git", Boolean(git.ok));
  serverHealthOk.set("web", Boolean(web.ok));
  serverHealthOk.set("ops", Boolean(ollama.ok || docker.ok || monitor.ok));
  serverResponseMs.set("ops", Math.max(ollama.durationMs || 0, docker.durationMs || 0, monitor.durationMs || 0));

  const mcpServersList = await listMcpServers();

  return {
    ok: true,
    durationMs: Date.now() - startedAt,
    backend: {
      ok: true,
      port: Number(process.env.PORT || 3003),
      durationMs: 0,
    },
    lightpanda: {
      ...browser,
      config: getLightpandaConfig(),
    },
    services: {
      memory,
      ollama,
      docker,
      browser,
      monitor,
      git,
      web,
    },
    mcpServers: mcpServersList,
  };
}

export {
  lightpandaNavigate,
  lightpandaStatus,
  openHeadfulBrowser,
  getLightpandaConfig,
};
