import fs from "fs";
import path from "path";

const AUDIT_LOG_FILE = path.resolve(
  process.cwd(),
  process.env.AUDIT_LOG_FILE || "re-term.audit.jsonl",
);
const MAX_IN_MEMORY = Math.max(200, Math.min(parseInt(process.env.AUDIT_LOG_MEMORY_MAX || "5000", 10) || 5000, 20000));

let initialized = false;
let sequence = 0;
let auditStream = null;
let recentEvents = [];

function safeClone(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}

function safeText(value, limit = 4000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  const normalized = String(text || "").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function redactSecretText(value = "") {
  return String(value || "")
    .replace(/\b(password|pass|pwd|otp|pin|code)\s*(?::|=|\bis\b)?\s*([^\s,;]+)/ig, "$1: [redacted]")
    .replace(/(["']?(?:password|pass|pwd|otp|pin|code)["']?\s*:\s*["']?)([^"',}\]\s]+)/ig, "$1[redacted]");
}

function isSecretKey(key = "") {
  return /(^|[_-])(password|pass|pwd|secret|otp|pin|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|csrf[_-]?token|_token)([_-]|$)/i
    .test(String(key || ""));
}

function sanitizeAuditPayload(value, key = "") {
  if (value == null) return value;
  if (isSecretKey(key)) return "[redacted]";
  if (typeof value === "string") return redactSecretText(value);
  if (["number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeAuditPayload(entry));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeAuditPayload(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function sanitizeRefs(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (entry == null) return [key, null];
      if (["string", "number", "boolean"].includes(typeof entry)) return [key, entry];
      return [key, safeText(entry, 240)];
    }),
  );
}

export function normalizeAuditUsage(value, defaults = {}) {
  if (!value || typeof value !== "object") return null;
  const usage = value;

  const watcher = usage.watcher && typeof usage.watcher === "object" ? usage.watcher : null;
  const mainModel = usage.mainModel && typeof usage.mainModel === "object" ? usage.mainModel : null;
  const promptTokens =
    Number(usage.promptTokens ?? usage.prompt_eval_count ?? 0)
    + Number(watcher?.promptTokens ?? 0)
    + Number(mainModel?.promptTokens ?? 0);
  const completionTokens =
    Number(usage.completionTokens ?? usage.eval_count ?? 0)
    + Number(watcher?.completionTokens ?? 0)
    + Number(mainModel?.completionTokens ?? 0);
  const totalTokens =
    Number(usage.totalTokens ?? usage.total_tokens ?? 0)
    + Number(watcher?.totalTokens ?? 0)
    + Number(mainModel?.totalTokens ?? 0)
    || (promptTokens + completionTokens);
  const model = String(
    usage.model
    || mainModel?.model
    || watcher?.model
    || defaults.model
    || "",
  ).trim();
  const stage = String(usage.stage || defaults.stage || "").trim();
  const normalized = {
    stage,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
  };

  if (!normalized.stage && !normalized.model && normalized.totalTokens === 0) {
    return null;
  }

  return normalized;
}

function createEventId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function appendRecent(event) {
  recentEvents.push(event);
  if (recentEvents.length > MAX_IN_MEMORY) {
    recentEvents = recentEvents.slice(-MAX_IN_MEMORY);
  }
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  fs.mkdirSync(path.dirname(AUDIT_LOG_FILE), { recursive: true });

  if (fs.existsSync(AUDIT_LOG_FILE)) {
    try {
      const raw = fs.readFileSync(AUDIT_LOG_FILE, "utf8");
      const lines = raw.split(/\r?\n/).filter(Boolean);
      for (const line of lines.slice(-MAX_IN_MEMORY)) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === "object" && Number.isFinite(parsed.seq)) {
            sequence = Math.max(sequence, Number(parsed.seq));
            appendRecent(parsed);
          }
        } catch {
          // Ignore malformed historical lines.
        }
      }
    } catch {
      // Ignore file read failures; new events still append.
    }
  }

  auditStream = fs.createWriteStream(AUDIT_LOG_FILE, { flags: "a" });
}

export function getAuditLogFile() {
  ensureInitialized();
  return AUDIT_LOG_FILE;
}

export function appendAuditEvent(input = {}) {
  ensureInitialized();

  const event = {
    seq: sequence + 1,
    id: createEventId(),
    ts: new Date().toISOString(),
    source: String(input.source || "server"),
    category: String(input.category || "server"),
    action: String(input.action || "event"),
    status: String(input.status || "info"),
    title: String(input.title || input.action || "event"),
    summary: String(input.summary || ""),
    refs: sanitizeRefs(input.refs),
    usage: normalizeAuditUsage(input.usage),
    payload: safeClone(sanitizeAuditPayload(input.payload)),
  };

  sequence = event.seq;
  appendRecent(event);
  auditStream.write(JSON.stringify(event) + "\n");
  return event;
}

export function appendAuditEvents(inputs = []) {
  return (Array.isArray(inputs) ? inputs : [inputs]).map((input) => appendAuditEvent(input));
}

export function queryAuditEvents(options = {}) {
  ensureInitialized();

  const afterSeq = Math.max(0, Number(options.afterSeq) || 0);
  const limit = Math.max(1, Math.min(Number(options.limit) || 200, 1000));
  const category = String(options.category || "all").trim().toLowerCase();
  const status = String(options.status || "all").trim().toLowerCase();
  const q = String(options.q || "").trim().toLowerCase();

  let events = recentEvents.filter((event) => event.seq > afterSeq);

  if (category && category !== "all") {
    events = events.filter((event) => String(event.category || "").toLowerCase() === category);
  }

  if (status && status !== "all") {
    events = events.filter((event) => String(event.status || "").toLowerCase() === status);
  }

  if (q) {
    events = events.filter((event) => {
      const haystack = [
        event.source,
        event.category,
        event.action,
        event.status,
        event.title,
        event.summary,
        safeText(event.refs, 1200),
        safeText(event.payload, 4000),
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }

  if (events.length > limit) {
    events = events.slice(-limit);
  }

  return {
    events,
    returned: events.length,
    limit,
    lastSeq: sequence,
    logFile: AUDIT_LOG_FILE,
  };
}
