import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Clipboard, Pause, Play, RefreshCcw, ScrollText, Search, Trash2 } from "lucide-react";
import { listAuditEvents, type AuditEvent } from "@/lib/logs-api";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

const PHONE_QUERY = "(max-width: 980px), (hover: none) and (pointer: coarse)";
const CATEGORY_OPTIONS = ["all", "ui", "terminal", "chat", "llm", "mcp", "server"] as const;
const STATUS_OPTIONS = ["all", "success", "info", "warning", "error"] as const;
const MAX_BUFFERED_EVENTS = 1600;

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function previewText(value: unknown, limit = 220) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  const normalized = stripAnsi(String(text || "")).replace(/\s+/g, " ").trim();
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

function formatAbsoluteTime(ts: string) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
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
  const refsText = Object.entries(event.refs || {})
    .slice(0, 3)
    .map(([key, value]) => `${key}=${previewText(value, 48)}`)
    .join(" ");
  return [
    previewText(event.summary || event.title, 260),
    payloadData ? previewText(payloadData, 260) : "",
    refsText,
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

function FeedRow({
  event,
  selected,
  onSelect,
}: {
  event: AuditEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const sessionId = typeof event.refs?.sessionId === "string" ? event.refs.sessionId : "";
  const runId = typeof event.refs?.runId === "string" ? event.refs.runId : "";
  const preview = summarizeEvent(event);

  return (
    <button
      type="button"
      className={`logs-row ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
      title={preview || event.title}
    >
      <div className="logs-row__line">
        <span className="logs-segment logs-segment--time">[{formatClock(event.ts)}]</span>
        <span className={`logs-segment logs-segment--category is-${event.category}`}>[{event.category}]</span>
        <span className="logs-segment logs-segment--action">[{event.action}]</span>
        <span className={`logs-segment logs-segment--status is-${event.status}`}>[{event.status}]</span>
        {event.usage?.totalTokens ? (
          <span className="logs-segment logs-segment--usage">[tok={event.usage.totalTokens}]</span>
        ) : null}
        {sessionId ? (
          <span className="logs-segment logs-segment--ref">[sid={sessionId.slice(0, 8)}]</span>
        ) : null}
        {!sessionId && runId ? (
          <span className="logs-segment logs-segment--ref">[run={runId.slice(0, 8)}]</span>
        ) : null}
        <span className="logs-row__text">{preview || event.title}</span>
      </div>
    </button>
  );
}

function Inspector({ event }: { event: AuditEvent | null }) {
  const [notice, setNotice] = useState("");

  if (!event) {
    return (
      <aside className="logs-inspector">
        <div className="logs-inspector__empty">
          <ScrollText size={16} />
          <span>select a log line to inspect raw payload and usage</span>
        </div>
      </aside>
    );
  }

  const copyEvent = async () => {
    await navigator.clipboard?.writeText(JSON.stringify(event, null, 2));
    setNotice("copied");
    window.setTimeout(() => setNotice(""), 1200);
  };

  return (
    <aside className="logs-inspector">
      <div className="logs-inspector__header">
        <div className="logs-inspector__title">
          <span className={`logs-segment logs-segment--category is-${event.category}`}>[{event.category}]</span>
          <span className="logs-segment logs-segment--action">[{event.action}]</span>
          <span className={`logs-segment logs-segment--status is-${event.status}`}>[{event.status}]</span>
        </div>
        <button type="button" className="logs-action-btn" onClick={() => void copyEvent()}>
          <Clipboard size={12} />
          {notice || "copy"}
        </button>
      </div>

      <div className="logs-inspector__meta">
        <div><span>time</span><code>{formatAbsoluteTime(event.ts)}</code></div>
        <div><span>seq</span><code>{event.seq}</code></div>
        <div><span>source</span><code>{event.source}</code></div>
        <div><span>title</span><code>{event.title}</code></div>
      </div>

      <section className="logs-inspector__section">
        <h3>summary</h3>
        <pre>{event.summary || event.title}</pre>
      </section>

      <section className="logs-inspector__section">
        <h3>refs</h3>
        <pre>{JSON.stringify(event.refs || {}, null, 2)}</pre>
      </section>

      <section className="logs-inspector__section">
        <h3>usage</h3>
        <pre>{JSON.stringify(event.usage || null, null, 2)}</pre>
      </section>

      <section className="logs-inspector__section">
        <h3>payload</h3>
        <pre>{JSON.stringify(event.payload ?? null, null, 2)}</pre>
      </section>
    </aside>
  );
}

export function LogsShell({ isActive = true }: { isActive?: boolean }) {
  const isPhone = useIsPhoneLayout();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [category, setCategory] = useState<(typeof CATEGORY_OPTIONS)[number]>("all");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("all");
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
        const result = await refresh();
        if (!alive) return;
        if (result.events.length > 0) {
          setSelectedSeq(result.events[result.events.length - 1].seq);
        }
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
      if (status !== "all" && event.status !== status) return false;
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
  }, [category, clearedAfterSeq, deferredQuery, events, status]);

  const selectedEvent = useMemo(() => {
    return visibleEvents.find((event) => event.seq === selectedSeq)
      || events.find((event) => event.seq === selectedSeq)
      || null;
  }, [events, selectedSeq, visibleEvents]);

  useEffect(() => {
    if (!followLive) return;
    const latest = visibleEvents[visibleEvents.length - 1];
    if (!latest) return;
    setSelectedSeq(latest.seq);
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [followLive, visibleEvents]);

  useEffect(() => {
    if (selectedSeq != null && visibleEvents.some((event) => event.seq === selectedSeq)) return;
    const latest = visibleEvents[visibleEvents.length - 1];
    if (latest) setSelectedSeq(latest.seq);
  }, [selectedSeq, visibleEvents]);

  const toolbar = (
    <>
      <section className="tool-compact-card tool-compact-card--wide logs-toolbar">
        <div className="tool-card-title">
          <ScrollText size={14} />
          <h2>Logs</h2>
          {loading && <span className="tool-card-title__note">syncing</span>}
          {error && <span className="tool-card-title__note">{error}</span>}
        </div>

        <div className="logs-toolbar__controls">
          <div className="catalog-filter-chips logs-filter-row">
            {CATEGORY_OPTIONS.map((entry) => (
              <button
                key={entry}
                type="button"
                className={`catalog-filter-chip ${category === entry ? "is-active" : ""}`}
                onClick={() => setCategory(entry)}
              >
                {entry}
              </button>
            ))}
          </div>

          <div className="logs-toolbar__secondary">
            <div className="catalog-filter-chips logs-filter-row">
              {STATUS_OPTIONS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={`catalog-filter-chip ${status === entry ? "is-active" : ""}`}
                  onClick={() => setStatus(entry)}
                >
                  {entry}
                </button>
              ))}
            </div>

            <label className="catalog-search logs-search">
              <Search size={12} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="grep logs" />
            </label>

            <button type="button" className="logs-action-btn" onClick={() => setFollowLive((value) => !value)}>
              {followLive ? <Pause size={12} /> : <Play size={12} />}
              {followLive ? "pause" : "live"}
            </button>

            <button
              type="button"
              className="logs-action-btn"
              onClick={() => {
                setClearedAfterSeq(lastSeqRef.current);
                setSelectedSeq(null);
              }}
            >
              <Trash2 size={12} />
              clear
            </button>

            <button
              type="button"
              className="logs-action-btn"
              onClick={() => {
                setError("");
                void refresh(lastSeqRef.current).catch((err) => {
                  setError(err instanceof Error ? err.message : "refresh failed");
                });
              }}
            >
              <RefreshCcw size={12} />
              refresh
            </button>
          </div>
        </div>
      </section>

      <section className="tool-compact-card tool-compact-card--wide logs-strip">
        <span>[events={visibleEvents.length}]</span>
        <span>[last_seq={lastSeqRef.current}]</span>
        <span>[follow={followLive ? "on" : "off"}]</span>
        {clearedAfterSeq > 0 ? <span>[screen_cleared_after={clearedAfterSeq}]</span> : null}
      </section>
    </>
  );

  const feed = (
    <section className="tool-compact-card logs-feed-card">
      <div className="tool-card-title">
        <ScrollText size={14} />
        <h2>stream</h2>
      </div>

      <div ref={feedRef} className="logs-feed">
        {visibleEvents.length === 0 ? (
          <div className="logs-empty">
            <span>[00:00:00] [logs] [idle] [info] waiting for audit events</span>
          </div>
        ) : (
          visibleEvents.map((event) => (
            <FeedRow
              key={event.seq}
              event={event}
              selected={selectedSeq === event.seq}
              onSelect={() => {
                setSelectedSeq(event.seq);
                setFollowLive(false);
              }}
            />
          ))
        )}
      </div>
    </section>
  );

  return (
    <div className="program-shell tool-compact-page logs-page">
      <main className="tool-compact-body logs-page__body">
        {toolbar}
        {isPhone ? (
          <div className="logs-stack">
            {feed}
            <Inspector event={selectedEvent} />
          </div>
        ) : (
          <ResizablePanelGroup orientation="horizontal" className="logs-resizable-row">
            <ResizablePanel minSize="520px">
              {feed}
            </ResizablePanel>

            <ResizableHandle className="chat-resize-handle" />

            <ResizablePanel
              defaultSize="420px"
              minSize="320px"
              maxSize="620px"
              groupResizeBehavior="preserve-pixel-size"
            >
              <Inspector event={selectedEvent} />
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </main>
    </div>
  );
}
