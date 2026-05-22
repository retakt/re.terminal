import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RefreshCcw, Search, Trash2, Terminal } from "lucide-react";
import { listAuditEvents, type AuditEvent } from "@/lib/logs-api";
import {
  stripAnsiCodes,
  sanitizeControlChars
} from "@/lib/terminal-formatter";

const PHONE_QUERY = "(max-width: 980px), (hover: none) and (pointer: coarse)";
const CATEGORY_OPTIONS = ["all", "ui", "terminal", "chat", "llm", "mcp", "server"] as const;
const STATUS_OPTIONS = ["success", "info", "warning", "error"] as const;
const MAX_BUFFERED_EVENTS = 1600;

function previewText(value: unknown, limit = 220) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  // Use new formatter for better sanitization
  const cleaned = sanitizeControlChars(stripAnsiCodes(String(text || "")));
  const normalized = cleaned.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function formatClock(ts: string) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function summarizeEvent(event: AuditEvent) {
  const payloadData = event.payload && typeof event.payload === "object" && "data" in (event.payload as Record<string, unknown>)
    ? (event.payload as Record<string, unknown>).data
    : null;
  return [
    previewText(event.summary || event.title, 260),
    payloadData ? previewText(payloadData, 260) : "",
  ].filter(Boolean).join(" ");
}

function useIsPhoneLayout() {
  const getIsPhone = () =>
    typeof window !== "undefined" &&
    window.matchMedia(PHONE_QUERY).matches;

  const [isPhone, setIsPhone] = useState(getIsPhone);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isPhone;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "success": return "log-success";
    case "info": return "log-info";
    case "warning": return "log-warning";
    case "error": return "log-error";
    default: return "log-muted";
  }
}

function getCategoryColor(category: string): string {
  switch (category) {
    case "ui": return "log-cyan";
    case "terminal": return "log-success";
    case "chat": return "log-magenta";
    case "llm": return "log-yellow";
    case "mcp": return "log-teal";
    case "server": return "log-error";
    default: return "log-muted";
  }
}

function compactSource(source: string) {
  const parts = String(source || "").split(".").filter(Boolean);
  if (parts.length === 0) return "--";
  if (parts.length === 1) return parts[0];
  return parts.slice(-2).join(".");
}

function compactId(value: string, limit = 12) {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function payloadRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function getDurationColor(durationMs: number | null) {
  if (durationMs == null || durationMs <= 0) return "log-muted";
  if (durationMs <= 250) return "log-success";
  if (durationMs <= 1000) return "log-warning";
  return "log-error";
}

function getHttpStatusColor(statusCode: number) {
  if (statusCode >= 200 && statusCode < 300) return "log-success";
  if (statusCode >= 300 && statusCode < 500) return "log-warning";
  return "log-error";
}

function getPreviewMatchColor(segment: string) {
  const normalized = segment.trim();
  if (!normalized) return "";

  if (normalized === "=>") return "log-preview-arrow";

  if (/^args=/i.test(normalized)) return "log-preview-args";
  if (/^query[:=]/i.test(normalized) || /"query"\s*:/i.test(normalized)) return "log-preview-query";
  if (/^url[:=]/i.test(normalized) || /^https?:\/\//i.test(normalized)) return "log-preview-url";
  if (/^path[:=]/i.test(normalized) || /^[A-Za-z]:\\/.test(normalized) || /^\/[\w./-]+/.test(normalized)) return "log-preview-path";
  if (/^id[:=]/i.test(normalized) || /"ID"\s*:/i.test(normalized)) return "log-preview-id";

  const durationMatch = normalized.match(/durationMs"?\s*[:=]\s*(\d+)/i);
  if (durationMatch) return getDurationColor(Number(durationMatch[1]));

  const statusMatch = normalized.match(/status"?\s*[:=]\s*(\d{3})/i);
  if (statusMatch) return getHttpStatusColor(Number(statusMatch[1]));

  if (/ok"?\s*[:=]\s*true/i.test(normalized)) return "log-preview-bool-true";
  if (/ok"?\s*[:=]\s*false/i.test(normalized)) return "log-preview-bool-false";

  if (/\bready\b/i.test(normalized)) return "log-preview-ready";
  if (/\bsuccess\b/i.test(normalized)) return "log-success";
  if (/\bwarning\b/i.test(normalized)) return "log-warning";
  if (/\berror\b/i.test(normalized) || /\bfailed\b/i.test(normalized)) return "log-error";

  return "";
}

function renderPreview(preview: string) {
  const pattern = /(args=.*?(?=\s=>|$)|=>|"?ok"?\s*[:=]\s*(?:true|false)|"?status"?\s*[:=]\s*\d{3}|"?durationMs"?\s*[:=]\s*\d+|"?query"?\s*[:=]\s*"[^"]*"|"?url"?\s*[:=]\s*"[^"]*"|https?:\/\/[^\s",}]+|"?ID"?\s*[:=]\s*"?[a-z0-9-]{8,}"?|[A-Za-z]:\\[^\s",}]+|\/[\w./-]+|\b(?:ready|success|warning|error|failed)\b)/gi;
  const pieces: JSX.Element[] = [];
  let cursor = 0;

  for (const match of preview.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      pieces.push(
  <span key={`plain-${index}`} className="log-preview-plain">
    {preview.slice(cursor, index)}
  </span>,
);
    }

    const segment = match[0];
    const className = getPreviewMatchColor(segment);
    pieces.push(
      <span key={`hit-${index}`} className={className || undefined}>
        {segment}
      </span>,
    );
    cursor = index + segment.length;
  }

  if (cursor < preview.length) {
    pieces.push(
  <span key={`tail-${cursor}`} className="log-preview-plain">
    {preview.slice(cursor)}
  </span>,
);
  }

  return pieces;
}

function buildPreview(event: AuditEvent, titleText: string, durationMs: number | null) {
  const payload = payloadRecord(event.payload);
  const rawOutput = [
    payload && typeof payload.output === "string" ? payload.output : "",
    payload && typeof payload.data === "string" ? payload.data : "",
    payload && typeof payload.message === "string" ? payload.message : "",
  ].find((value) => value && value.trim());

  if (rawOutput) return previewText(rawOutput, 440);

  const errorText = payload && typeof payload.error === "string"
    ? previewText(payload.error, 440)
    : "";
  if (errorText) return errorText;

  const argsText = payload && "args" in payload
    ? previewText(payload.args, 110)
    : "";
  const resultText = payload && "result" in payload
    ? previewText(payload.result, 320)
    : "";

  if (argsText || resultText) {
    if (argsText && resultText) return `args=${argsText} => ${resultText}`;
    return resultText || `args=${argsText}`;
  }

  let summary = summarizeEvent(event);
  const serverId = typeof event.refs?.serverId === "string" ? event.refs.serverId : "";
  const metricPrefix = durationMs != null && durationMs > 0 ? `${durationMs}ms` : "";
  const redundantPrefixes = [
    `${titleText} server=${serverId} ${metricPrefix}`,
    `${titleText} server=${serverId}`,
    `${titleText} ${metricPrefix}`,
    titleText,
  ].filter(Boolean);

  for (const prefix of redundantPrefixes) {
    if (summary.startsWith(prefix)) {
      summary = summary.slice(prefix.length).trimStart();
      break;
    }
  }

  summary = summary.replace(/^args=\{\}\s*->\s*/i, "").replace(/^->\s*/i, "").trim();
  return summary || previewText(event.title || event.action, 440);
}

function compactLogLabel(value: string, limit = 20) {
  let label = sanitizeControlChars(stripAnsiCodes(String(value || ""))).trim();

  label = label
    // display-only cleanup; real refs/tool/action values stay untouched
    .replace(/^mcp[_\-\s:]+/i, "")
    .replace(/^mcp(?=[A-Z])/i, "")
    .replace(/__+/g, "_")
    .replace(/--+/g, "-")
    .replace(/^ops[_-]local[_-]docker[_-]/i, "docker/")
    .replace(/^ops[_-]monitor[_-]/i, "mon/")
    .replace(/^ops[_-]ollama[_-]/i, "ollama/")
    .replace(/^ops[_-]/i, "")
    .replace(/^web[_-]search$/i, "web")
    .replace(/^web[_-]/i, "web/")
    .replace(/^browser[_-]lightpanda/i, "browser")
    .replace(/^browser[_-]/i, "browser/")
    .replace(/^git[_-]/i, "git/")
    .replace(/^memory[_-]/i, "mem/")
    .replace(/^terminal[_-]/i, "term/")
.replace(/^client\s+connected$/i, "client conn")
.replace(/^client\s+disconnected$/i, "client disc")
.replace(/^client[_-]connected$/i, "client conn")
.replace(/^client[_-]disconnected$/i, "client disc");

  if (!label) label = "event";
  return label.length > limit ? `${label.slice(0, Math.max(0, limit - 1))}…` : label;
}

function compactActionLabel(value: string) {
  return String(value || "")
    .replace(/^gateway\.call$/i, "call")
    .replace(/^session\.resized$/i, "resize")
    .replace(/^shell\.output$/i, "out")
    .replace(/^llm\./i, "")
    .replace(/^mcp\./i, "");
}

function BracketedCell({
  className,
  children,
}: {
  className: string;
  children: string;
}) {
  if (!children) return <span className={className} />;

  return (
    <span className={`${className} log-bracket-cell`}>
      <span className="log-bracket">[</span>
      <span className="log-bracket-value">{children}</span>
      <span className="log-bracket">]</span>
    </span>
  );
}

function TerminalLine({ event }: { event: AuditEvent }) {
  const statusColor = getStatusColor(event.status);
  const categoryColor = getCategoryColor(event.category);

  const tool = typeof event.refs?.tool === "string" ? event.refs.tool : "";
  const sessionId = typeof event.refs?.sessionId === "string" ? event.refs.sessionId : "";
  const pageType = typeof event.refs?.pageType === "string" ? event.refs.pageType : "";
  const serverId = typeof event.refs?.serverId === "string" ? event.refs.serverId : "";

  const durationMs = typeof event.refs?.durationMs === "number"
    ? event.refs.durationMs
    : typeof event.payload === "object" && event.payload && typeof (event.payload as Record<string, unknown>).durationMs === "number"
      ? (event.payload as Record<string, unknown>).durationMs as number
      : null;

  const bytes = typeof event.refs?.bytes === "number" ? event.refs.bytes : null;
  const cols = typeof event.refs?.cols === "number" ? event.refs.cols : null;
  const rows = typeof event.refs?.rows === "number" ? event.refs.rows : null;

  const rawTitle = tool || event.title || event.action || event.category;
  const titleText = compactLogLabel(rawTitle, 26);
  const actionText = compactActionLabel(event.action);

  const scopeText = previewText(
    serverId
      || pageType
      || (sessionId ? compactId(sessionId, 10) : "")
      || compactSource(event.source),
    16,
  );

  const metricText = durationMs != null && durationMs > 0
    ? `${durationMs}ms`
    : bytes != null && bytes > 0
      ? `${bytes}b`
      : cols != null && rows != null
        ? `${cols}x${rows}`
        : "";

  const metricColor = durationMs != null ? getDurationColor(durationMs) : "log-muted";
  const tokenText = event.usage?.totalTokens ? `${event.usage.totalTokens}t` : "";
  const preview = buildPreview(event, rawTitle, durationMs);

  const rowTitle = [
    `[${formatClock(event.ts)}]`,
    `[${event.category}]`,
    `[${actionText}]`,
    `[${event.status}]`,
    titleText,
    scopeText,
    metricText,
    tokenText,
    preview,
  ].filter(Boolean).join(" ");

  return (
    <div className="log-line" data-tooltip={rowTitle}>
<BracketedCell className="log-cell log-time log-time-cell">
  {formatClock(event.ts)}
</BracketedCell>

<BracketedCell className={`log-cell log-category ${categoryColor}`}>
  {event.category}
</BracketedCell>

<BracketedCell className="log-cell log-action">
  {actionText}
</BracketedCell>

<BracketedCell className={`log-cell log-status-cell ${statusColor}`}>
  {event.status}
</BracketedCell>

<BracketedCell className="log-cell log-title log-magenta">
  {titleText}
</BracketedCell>

<BracketedCell className="log-cell log-scope log-teal">
  {scopeText}
</BracketedCell>

<BracketedCell className={`log-cell log-metric ${metricColor}`}>
  {metricText}
</BracketedCell>

<BracketedCell className="log-cell log-tokens log-yellow">
  {tokenText}
</BracketedCell>

<span className="log-message">{renderPreview(preview)}</span>
    </div>
  );
}

export function LogsShell({ isActive = true }: { isActive?: boolean }) {
  useIsPhoneLayout();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [category, setCategory] = useState<(typeof CATEGORY_OPTIONS)[number]>("all");
  const [statuses, setStatuses] = useState<Set<(typeof STATUS_OPTIONS)[number]>>(new Set());
  const [query, setQuery] = useState("");
  const [followLive, setFollowLive] = useState(true);
  const [clearedAfterSeq, setClearedAfterSeq] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const lastSeqRef = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (afterSeq?: number) => {
    const result = await listAuditEvents({
      afterSeq,
      limit: afterSeq ? 240 : 320,
    });

    startTransition(() => {
      setEvents((current) => {
        if (!afterSeq) {
          const next = result.events.slice(-MAX_BUFFERED_EVENTS);
          return next;
        }
        if (result.events.length === 0) return current;
        const merged = [...current, ...result.events];
        const deduped = merged.filter((event, index, array) =>
          index === array.findIndex((entry) => entry.seq === event.seq),
        );
        return deduped.slice(-MAX_BUFFERED_EVENTS);
      });
    });

    lastSeqRef.current = Math.max(lastSeqRef.current, result.lastSeq || 0);
    return result;
  }, []);

  useEffect(() => {
    if (!isActive) return;
    let alive = true;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        await refresh();
        if (!alive) return;
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "failed to load logs");
      } finally {
        if (alive) setLoading(false);
      }
    };

    void load();
    const interval = window.setInterval(() => {
      void refresh(lastSeqRef.current).catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "live sync failed");
      });
    }, 1200);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [isActive, refresh]);

  const visibleEvents = useMemo(() => {
    return events.filter((event) => {
      if (event.seq <= clearedAfterSeq) return false;
      if (category !== "all" && event.category !== category) return false;
      if (statuses.size > 0 && !statuses.has(event.status as (typeof STATUS_OPTIONS)[number])) return false;
      if (deferredQuery) {
        const haystack = [
          event.source,
          event.category,
          event.action,
          event.status,
          event.title,
          event.summary,
          JSON.stringify(event.refs || {}),
          JSON.stringify(event.payload ?? null),
        ].join(" ").toLowerCase();
        if (!haystack.includes(deferredQuery)) return false;
      }
      return true;
    });
  }, [category, clearedAfterSeq, deferredQuery, events, statuses]);

  useEffect(() => {
    if (!followLive) return;
    const latest = visibleEvents[visibleEvents.length - 1];
    if (!latest) return;
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [followLive, visibleEvents]);

  return (
    <div className="log-page">
      {/* Minimal toolbar */}
      <header className="log-toolbar">
        <div className="log-toolbar-left">
          <Terminal size={14} className="log-icon" />
          <span className="log-toolbar-title">logs</span>
          {loading && <span className="log-status log-info">syncing...</span>}
          {error && <span className="log-status log-error">{error}</span>}
          <span className="log-status log-muted">
            [{visibleEvents.length}]
          </span>
        </div>

        <div className="log-toolbar-right">
          {/* Compact filter chips */}
          <div className="log-filters log-filters--category">
            <span className="log-filter-label">cat:</span>
            {CATEGORY_OPTIONS.map((entry) => (
              <button
                key={entry}
                type="button"
                className={`log-chip ${category === entry ? "is-active" : ""}`}
                data-type="category"
                data-value={entry}
                onClick={() => setCategory(entry)}
                title={`Filter category: ${entry}`}
              >
                {entry}
              </button>
            ))}
          </div>

          <div className="log-filters">
            <span className="log-filter-label">status:</span>
            {STATUS_OPTIONS.map((entry) => {
              const isActive = statuses.has(entry);
              return (
                <button
                  key={entry}
                  type="button"
                  className={`log-chip ${isActive ? "is-active" : ""}`}
                  data-type="status"
                  data-value={entry}
                  onClick={() => {
                    setStatuses((prev) => {
                      const next = new Set(prev);
                      if (next.has(entry)) {
                        next.delete(entry);
                      } else {
                        next.add(entry);
                      }
                      return next;
                    });
                  }}
                  title={`${isActive ? "Remove" : "Add"} status filter: ${entry}`}
                >
                  {entry}
                </button>
              );
            })}
          </div>

          {/* Search */}
          <label className="log-search">
            <Search size={12} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="grep..."
              aria-label="Search logs"
            />
          </label>

          {/* Controls */}
          <button
            type="button"
            className="log-btn"
            onClick={() => setFollowLive((value) => !value)}
            title={followLive ? "Pause live updates" : "Resume live updates"}
          >
            {followLive ? <Pause size={12} /> : <Play size={12} />}
          </button>

          <button
            type="button"
            className="log-btn"
            onClick={() => {
              setClearedAfterSeq(lastSeqRef.current);
            }}
            title="Clear logs"
          >
            <Trash2 size={12} />
          </button>

          <button
            type="button"
            className="log-btn"
            onClick={() => {
              setError("");
              void refresh(lastSeqRef.current).catch((err) => {
                setError(err instanceof Error ? err.message : "refresh failed");
              });
            }}
            title="Refresh logs"
          >
            <RefreshCcw size={12} />
          </button>
        </div>
      </header>

      {/* Terminal viewport */}
      <main className="log-viewport">
        <div className="log-container">
          <div ref={feedRef} className="log-feed">
            {visibleEvents.length === 0 ? (
              <div className="log-empty">
                <span className="log-muted">[00:00:00] [logs] [idle] [info] waiting for events...</span>
              </div>
            ) : (
              visibleEvents.map((event) => (
                <TerminalLine
                  key={event.seq}
                  event={event}
                />
              ))
            )}
          </div>

          {/* Terminal cursor indicator */}
          <div className="log-cursor-line">
            <span className="log-cursor">▋</span>
          </div>
        </div>
      </main>
    </div>
  );
}
