import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RefreshCcw, Search, Trash2, Terminal } from "lucide-react";
import { listAuditEvents, type AuditEvent } from "@/lib/logs-api";
import {
  formatTerminalOutput,
  type FormattedLogEntry,
  getLevelClass,
  needsPrettyPrint,
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

/**
 * TerminalLogLine - Renders a single formatted log entry in Docker BuildKit style
 * Used ONLY for output that was pretty-printed (needsPrettyPrint returned true)
 */
function TerminalLogLine({ entry }: { entry: FormattedLogEntry }) {
  const levelClass = getLevelClass(entry.level);
  
  return (
    <div className="log-line">
      {/* Prefix: [+], =>, #0, ERROR, WARNING - only shown for pretty-printed output */}
      {entry.prefix && (
        <span className={`log-prefix ${levelClass}`}>
          {entry.prefix}
        </span>
      )}
      {/* Content with proper wrapping */}
      <span className="log-content">{entry.content}</span>
    </div>
  );
}

/**
 * TerminalLine - Renders an AuditEvent with conditional formatting
 * - Normal logs: rendered with original timestamped, tagged format
 * - Messy terminal blobs: converted to vertical Docker-style output
 */
function TerminalLine({ event }: { event: AuditEvent }) {
  // Extract raw output from event payload or summary
  const rawOutput = useMemo(() => {
    // Try to get raw terminal output from various payload locations
    if (event.payload && typeof event.payload === 'object') {
      const payload = event.payload as Record<string, unknown>;
      if (typeof payload.output === 'string') return payload.output;
      if (typeof payload.data === 'string') return payload.data;
      if (typeof payload.message === 'string') return payload.message;
    }
    // Fallback to summary/title
    return event.summary || event.title || '';
  }, [event]);
  
  // Determine if this output needs pretty-printing
  const shouldPrettyPrint = useMemo(() => {
    return needsPrettyPrint(rawOutput);
  }, [rawOutput]);
  
  // Format the output - conditional based on content
  const formattedEntries = useMemo(() => {
    if (!shouldPrettyPrint) {
      // Return empty - we'll render with original format below
      return [];
    }
    
    return formatTerminalOutput(rawOutput, {
      maxWidth: 120,
      timestamp: event.ts,
      category: event.category,
      action: event.action,
      status: event.status
    });
  }, [rawOutput, shouldPrettyPrint, event.ts, event.category, event.action, event.status]);
  
  // If output was pretty-printed, render formatted entries
  if (shouldPrettyPrint && formattedEntries.length > 0) {
    return (
      <>
        {formattedEntries.map((entry, index) => (
          <TerminalLogLine key={`${event.seq}-${index}`} entry={entry} />
        ))}
      </>
    );
  }
  
  // Otherwise, render with ORIGINAL format - preserving timestamps, tags, colors
  const preview = summarizeEvent(event);
  const statusColor = getStatusColor(event.status);
  const categoryColor = getCategoryColor(event.category);
  const tool = typeof event.refs?.tool === "string" ? event.refs.tool : "";
  const serverId = typeof event.refs?.serverId === "string" ? event.refs.serverId : "";
  const durationMs = typeof event.refs?.durationMs === "number"
    ? event.refs.durationMs
    : typeof event.payload === "object" && event.payload && typeof (event.payload as Record<string, unknown>).durationMs === "number"
      ? (event.payload as Record<string, unknown>).durationMs as number
      : null;
  
  return (
    <div className="log-line">
      <span className="log-segment log-time">[{formatClock(event.ts)}]</span>
      <span className={`log-segment ${categoryColor}`}>[{event.category}]</span>
      <span className="log-segment log-action">[{event.action}]</span>
      <span className={`log-segment ${statusColor}`}>[{event.status}]</span>
      {tool ? (
        <span className="log-segment log-magenta">[{tool}]</span>
      ) : null}
      {serverId ? (
        <span className="log-segment log-teal">[{serverId}]</span>
      ) : null}
      {typeof durationMs === "number" && durationMs > 0 ? (
        <span className="log-segment log-muted">[{durationMs}ms]</span>
      ) : null}
      {event.usage?.totalTokens ? (
        <span className="log-segment log-yellow">[tok={event.usage.totalTokens}]</span>
      ) : null}
      <span className="log-message">{preview}</span>
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
