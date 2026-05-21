import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Braces,
  Chrome,
  Clock,
  ExternalLink,
  Globe,
  Link as LinkIcon,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Puzzle,
  RefreshCcw,
  Search,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import {
  getLightpandaStatus,
  navigateLightpanda,
  normalizeBrowserUrl,
  openHeadfulBrowser,
  type LightpandaPageResult,
  type LightpandaStatus,
} from "@/lib/browser-api";
import { focusInputShell } from "@/lib/focus-input-shell";

const INSPECTOR_EXIT_MS = 380;
const PHONE_QUERY = "(max-width: 767px), (hover: none) and (pointer: coarse)";

function matchesPhoneLayout() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(PHONE_QUERY).matches
  );
}

function duration(ms?: number) {
  if (typeof ms !== "number") return "n/a";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function compact(value = "", limit = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function useIsPhoneLayout() {
  const [isPhone, setIsPhone] = React.useState(matchesPhoneLayout);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(query.matches);

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isPhone;
}

export function BrowserShell({ isActive = true }: { isActive?: boolean }) {
  const isPhone = useIsPhoneLayout();
  const previousIsPhoneRef = React.useRef(isPhone);
  const [address, setAddress] = React.useState("");
  const [visualUrl, setVisualUrl] = React.useState("");
  const [history, setHistory] = React.useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const [status, setStatus] = React.useState<LightpandaStatus | null>(null);
  const [result, setResult] = React.useState<LightpandaPageResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [headfulNotice, setHeadfulNotice] = React.useState("");
  const [inspectorOpen, setInspectorOpen] = React.useState(() => !matchesPhoneLayout());
  const [inspectorClosing, setInspectorClosing] = React.useState(false);
  const inspectorTimerRef = React.useRef<number | null>(null);

  const clearInspectorTimer = React.useCallback(() => {
    if (inspectorTimerRef.current === null) return;
    window.clearTimeout(inspectorTimerRef.current);
    inspectorTimerRef.current = null;
  }, []);

  const loadStatus = React.useCallback(async () => {
    const next = await getLightpandaStatus().catch((err) => ({
      ok: false,
      engine: "lightpanda",
      status: "down",
      error: err instanceof Error ? err.message : String(err),
    }));
    setStatus(next);
  }, []);

  React.useEffect(() => {
    if (!isActive) return;
    void loadStatus();
    const interval = window.setInterval(() => void loadStatus(), 15000);
    return () => window.clearInterval(interval);
  }, [isActive, loadStatus]);

  React.useEffect(() => clearInspectorTimer, [clearInspectorTimer]);

  React.useEffect(() => {
    const wasPhone = previousIsPhoneRef.current;
    previousIsPhoneRef.current = isPhone;

    clearInspectorTimer();
    setInspectorClosing(false);
    if (!isPhone) {
      setInspectorOpen(true);
      return;
    }

    if (!wasPhone) {
      setInspectorOpen(false);
    }
  }, [clearInspectorTimer, isPhone]);

  const navigate = React.useCallback(async (target: string, pushHistory = true) => {
    const nextUrl = normalizeBrowserUrl(target);
    if (!nextUrl) return;
    setAddress(nextUrl);
    setVisualUrl(nextUrl);
    setLoading(true);
    setError("");
    if (pushHistory) {
      const nextHistory = [...history.slice(0, historyIndex + 1), nextUrl].slice(-40);
      setHistory(nextHistory);
      setHistoryIndex(nextHistory.length - 1);
    }
    try {
      const next = await navigateLightpanda(nextUrl);
      setResult(next);
      if (!next.ok && next.error) setError(next.error);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      void loadStatus();
    }
  }, [history, historyIndex, loadStatus]);

  const goHistory = (delta: number) => {
    const nextIndex = Math.max(0, Math.min(history.length - 1, historyIndex + delta));
    setHistoryIndex(nextIndex);
    void navigate(history[nextIndex], false);
  };

  const page = result?.page;

  const closeInspector = React.useCallback(() => {
    if (!inspectorOpen) return;

    clearInspectorTimer();
    if (!isPhone) {
      setInspectorOpen(false);
      setInspectorClosing(false);
      return;
    }

    setInspectorOpen(false);
    setInspectorClosing(true);
    inspectorTimerRef.current = window.setTimeout(() => {
      setInspectorClosing(false);
      inspectorTimerRef.current = null;
    }, INSPECTOR_EXIT_MS);
  }, [clearInspectorTimer, inspectorOpen, isPhone]);

  const toggleInspector = React.useCallback(() => {
    clearInspectorTimer();

    if (!isPhone) {
      setInspectorOpen((open) => !open);
      setInspectorClosing(false);
      return;
    }

    if (inspectorOpen) {
      setInspectorOpen(false);
      setInspectorClosing(true);
      inspectorTimerRef.current = window.setTimeout(() => {
        setInspectorClosing(false);
        inspectorTimerRef.current = null;
      }, INSPECTOR_EXIT_MS);
      return;
    }

    setInspectorClosing(false);
    setInspectorOpen(true);
  }, [clearInspectorTimer, inspectorOpen, isPhone]);

  const openHeadful = React.useCallback(async () => {
    const target = normalizeBrowserUrl(address || page?.url || visualUrl || "about:blank");
    setHeadfulNotice("opening chrome...");
    try {
      const response = await openHeadfulBrowser(target);
      setHeadfulNotice(String(response.note || "opened chrome"));
      window.setTimeout(() => setHeadfulNotice(""), 3500);
      void loadStatus();
    } catch (err) {
      setHeadfulNotice(err instanceof Error ? err.message : String(err));
    }
  }, [address, loadStatus, page?.url, visualUrl]);

  const visibleLinks = React.useMemo(
    () => (page?.links || [])
      .map((link) => ({
        text: String(link.text || "").trim(),
        href: String(link.href || "").trim(),
      }))
      .filter((link) => link.text || link.href)
      .slice(0, 24),
    [page?.links],
  );
  const extractionPath = page?.extractionPath || page?.extractionSources?.join(", ") || "lightpanda_cdp";
  const markdownReady = Boolean(page?.extractionCapabilities?.markdown ?? status?.capabilities?.markdown);
  const axTreeReady = Boolean(page?.extractionCapabilities?.accessibilityTree ?? status?.capabilities?.accessibilityTree);
  const readablePreview = page?.text || page?.accessibility?.textPreview || page?.markdown || "";
  const axNodeCount = page?.accessibility?.nodeCount ?? page?.stats?.axNodes ?? 0;

  const inspectorMounted = inspectorOpen || (isPhone && inspectorClosing);
  const inspectorMotionClass = isPhone
    ? inspectorClosing ? "is-closing" : inspectorOpen ? "is-open" : ""
    : inspectorOpen ? "is-open" : "";

  return (
    <div className="program-shell lightpanda-browser">
      <header className="lightpanda-toolbar">
        <div className="lightpanda-titlebar">
          <div className="lightpanda-brand">
            <span className="lightpanda-brand-icon">
              <Globe size={16} />
            </span>
            <span className="lightpanda-brand-title">Lightpanda CDP</span>
            <strong className={status?.ok ? "is-ok" : "is-down"}>{status?.ok ? "ready" : "down"}</strong>
            <em><Clock size={11} />{duration(status?.durationMs)}</em>
          </div>
          <div className="lightpanda-toolbar-actions">
            <button
              type="button"
              className="lightpanda-open lightpanda-open--extract chat-tool-button"
              onClick={() => void navigate(address)}
              title="Extract page"
            >
              <ExternalLink size={16} />
              <span className="lightpanda-open__label">extract</span>
            </button>
            <button
              type="button"
              className="lightpanda-open lightpanda-open--icon chat-tool-button"
              onClick={() => void openHeadful()}
              title="Open manual Chrome fallback"
              aria-label="Open manual Chrome fallback"
            >
              <Chrome size={16} />
            </button>
            {isPhone && (
              <button
                type="button"
                className={`lightpanda-inspector-toggle chat-tool-button ${inspectorOpen ? "is-open is-active" : ""}`}
                onClick={toggleInspector}
                title={inspectorOpen ? "Close inspector" : "Open inspector"}
                aria-label={inspectorOpen ? "Close inspector" : "Open inspector"}
              >
                {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="lightpanda-main">
        <section className="lightpanda-preview">
          {page ? (
            <article className="lightpanda-preview-document">
              <header>
                <span>extracted page</span>
                <strong>{extractionPath}</strong>
              </header>
              <h1>{page.title || page.url}</h1>
              <p>{compact(readablePreview || "No readable text returned by Lightpanda.", 1400)}</p>
            </article>
          ) : (
            <div className={`lightpanda-preview-empty ${loading ? "is-loading" : ""}`}>
              {loading ? <Loader2 size={26} className="animate-spin" /> : <Globe size={26} />}
              <strong>{loading ? "loading page" : "ready to browse"}</strong>
              <span>{loading ? visualUrl : "navigate from the address bar; extracted text and links appear in the inspector."}</span>
            </div>
          )}
          <form
            className="lightpanda-address"
            onSubmit={(event) => {
              event.preventDefault();
              void navigate(address);
            }}
          >
            <button
              type="button"
              className="lightpanda-nav-btn lightpanda-nav-btn--back"
              onClick={() => goHistory(-1)}
              disabled={historyIndex <= 0}
              title="Back"
            >
              <ArrowLeft size={16} />
            </button>
            <button
              type="button"
              className="lightpanda-nav-btn lightpanda-nav-btn--forward"
              onClick={() => goHistory(1)}
              disabled={historyIndex >= history.length - 1}
              title="Forward"
            >
              <ArrowRight size={16} />
            </button>
            <button
              type="button"
              className="lightpanda-nav-btn lightpanda-nav-btn--reload"
              onClick={() => void navigate(address, false)}
              title="Reload"
            >
              <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <label className="lightpanda-address-field click-field input-shell" onPointerDown={focusInputShell}>
              <div className="lightpanda-address-field__icon pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 z-10">
                <Search size={14} className="text-muted-foreground" />
              </div>
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="url, domain, or docs page"
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="pl-7"
              />
            </label>
          </form>
          <div className="lightpanda-preview-status">
            <span className={loading ? "is-loading" : page ? "is-ok" : ""}>
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
              {loading ? "loading" : page?.title || "preview"}
            </span>
            <code>{page?.url || visualUrl || "no page loaded"}</code>
          </div>
        </section>

        {inspectorMounted && (
          <>
            {isPhone && (
              <button
                type="button"
                className={`lightpanda-mobile-backdrop ${inspectorMotionClass}`}
                onClick={closeInspector}
                aria-label="Close browser inspector"
                disabled={inspectorClosing}
              />
            )}

            <aside className={`lightpanda-inspector ${inspectorMotionClass}`}>
              <div className="lightpanda-mobile-header">
                <Globe size={14} />
                <span>browser inspector</span>
              </div>
              <div className="lightpanda-inspector-body">
                <section className="lightpanda-panel lightpanda-panel--overlay">
                  <div className="lightpanda-panel-title">
                    <Bot size={14} />
                    <span>ai browser</span>
                    <strong>{result?.engine || "lightpanda"}</strong>
                  </div>
                  <div className="lightpanda-kv">
                    <span>cdp</span>
                    <code>{status?.cdpUrl || "ws://127.0.0.1:9222"}</code>
                    <span>nav</span>
                    <code>{duration(result?.durationMs)}</code>
                    <span>markdown</span>
                    <code>{markdownReady ? "ready" : "n/a"}</code>
                    <span>AXTree</span>
                    <code>{axTreeReady ? `${axNodeCount || "ready"}` : "n/a"}</code>
                    <span>page</span>
                    <code>{page?.title || error || "not loaded"}</code>
                  </div>
                  {error && <pre className="lightpanda-error">{error}</pre>}
                  {status?.hint && !status.ok && <pre className="lightpanda-hint">{status.hint}</pre>}
                </section>

                <section className="lightpanda-panel lightpanda-panel--links">
                  <div className="lightpanda-panel-title">
                    <TerminalSquare size={14} />
                    <span>extraction</span>
                    <strong>{page?.stats?.links ?? 0} links</strong>
                  </div>
                  <div className="lightpanda-kv">
                    <span>path</span>
                    <code>{extractionPath}</code>
                    <span>chrome</span>
                    <code>{status?.chromeFallback?.automatic ? "auto" : "manual"}</code>
                  </div>
                  <p className="lightpanda-text-preview">
                    {compact(readablePreview || headfulNotice || "Navigate to a page. Lightpanda extracts text, links, forms, and timing for AI use.", 900)}
                  </p>
                </section>

                <section className="lightpanda-panel lightpanda-panel--links">
                  <div className="lightpanda-panel-title">
                    <LinkIcon size={14} />
                    <span>links</span>
                    <strong>{page?.links?.length || 0}</strong>
                  </div>
                  <div className="lightpanda-link-list">
                    {visibleLinks.length === 0 && (
                      <div className="lightpanda-link-empty">no readable link labels returned</div>
                    )}
                    {visibleLinks.map((link, index) => (
                      <button key={`${link.href}-${index}`} type="button" onClick={() => void navigate(link.href)}>
                        <span>{compact(link.text || link.href || "untitled link", 56)}</span>
                        <code>{compact(link.href || link.text || "no href", 72)}</code>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="lightpanda-panel lightpanda-extension-slots">
                  <div className="lightpanda-panel-title">
                    <Puzzle size={14} />
                    <span>extensions later</span>
                    <strong>slots</strong>
                  </div>
                  <div>
                    <span><ShieldCheck size={12} /> MCP browser tools</span>
                    <span><Braces size={12} /> userscripts</span>
                    <span><Puzzle size={12} /> web extensions</span>
                  </div>
                </section>
              </div>
            </aside>
          </>
        )}
      </main>
    </div>
  );
}