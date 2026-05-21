import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCcw,
  Search,
  Sparkles,
} from "lucide-react";
import {
  getLightpandaStatus,
  getPlaywrightMcpStatus,
  navigateLightpanda,
  navigatePlaywright,
  normalizeBrowserUrl,
  screenshotPlaywright,
  snapshotPlaywright,
  startPlaywrightMcp,
  type BrowserBackend,
  type LightpandaPageResult,
  type LightpandaStatus,
  type PlaywrightMcpResult,
  type PlaywrightMcpStatus,
} from "@/lib/browser-api";
import { focusInputShell } from "@/lib/focus-input-shell";

function duration(ms?: number) {
  if (typeof ms !== "number") return "n/a";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function compact(value = "", limit = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function mcpResultText(value: PlaywrightMcpResult | null, limit = 2400) {
  if (!value) return "";
  const contentText = Array.isArray(value.content)
    ? value.content.map((item) => item?.text || "").filter(Boolean).join("\n")
    : "";
  const text = contentText || JSON.stringify(value.structuredContent ?? value, null, 2);
  return compact(text, limit);
}

function mcpImageDataUrl(value: PlaywrightMcpResult | null) {
  const image = Array.isArray(value?.content)
    ? value.content.find((item) => item?.type === "image" && typeof item.data === "string")
    : null;
  if (!image || typeof image.data !== "string") return "";
  const mime = typeof image.mimeType === "string" ? image.mimeType : "image/png";
  return `data:${mime};base64,${image.data}`;
}

function playwrightStatusLabel(status: PlaywrightMcpStatus | null) {
  if (!status) return "checking";
  if (!status.ok) return "error";
  if (!status.discovered) return "not configured";
  return status.server?.status || "configured";
}

function playwrightReady(status: PlaywrightMcpStatus | null) {
  return Boolean(status?.ok && status.discovered && status.server?.status === "ready");
}

function backendLabel(backend: BrowserBackend) {
  if (backend === "auto") return "Auto";
  if (backend === "playwright") return "Playwright";
  return "Lightpanda";
}

export function BrowserShell({ isActive = true }: { isActive?: boolean }) {
  const [address, setAddress] = React.useState("");
  const [visualUrl, setVisualUrl] = React.useState("");
  const [backend, setBackend] = React.useState<BrowserBackend>("auto");
  const [history, setHistory] = React.useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const [lightpandaStatus, setLightpandaStatus] = React.useState<LightpandaStatus | null>(null);
  const [playwrightStatus, setPlaywrightStatus] = React.useState<PlaywrightMcpStatus | null>(null);
  const [lightpandaResult, setLightpandaResult] = React.useState<LightpandaPageResult | null>(null);
  const [playwrightResult, setPlaywrightResult] = React.useState<PlaywrightMcpResult | null>(null);
  const [liveImage, setLiveImage] = React.useState("");
  const [liveEnabled, setLiveEnabled] = React.useState(true);
  const [lastLiveAt, setLastLiveAt] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const page = lightpandaResult?.page;
  const readablePreview = page?.text || page?.accessibility?.textPreview || page?.markdown || "";
  const playwrightPreview = mcpResultText(playwrightResult);
  const activeUrl = page?.url || visualUrl;
  const previewSrc = /^https?:\/\//i.test(activeUrl) ? activeUrl : "";
  const selectedBackend = backend === "auto" ? "lightpanda" : backend;
  const livePreviewActive = selectedBackend === "playwright" && Boolean(liveImage);

  const refreshPlaywrightLive = React.useCallback(async ({ includeSnapshot = true } = {}) => {
    const [shot, snap] = await Promise.all([
      screenshotPlaywright(),
      includeSnapshot ? snapshotPlaywright().catch(() => null) : Promise.resolve(null),
    ]);
    const imageUrl = mcpImageDataUrl(shot);
    if (imageUrl) setLiveImage(imageUrl);
    if (snap) setPlaywrightResult(snap);
    setLastLiveAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    return { shot, snap };
  }, []);

  const loadStatus = React.useCallback(async () => {
    const [nextLightpanda, nextPlaywright] = await Promise.all([
      getLightpandaStatus().catch((err) => ({
        ok: false,
        engine: "lightpanda",
        status: "down",
        error: err instanceof Error ? err.message : String(err),
      })),
      getPlaywrightMcpStatus().catch((err) => ({
        ok: false,
        discovered: false,
        error: err instanceof Error ? err.message : String(err),
      })),
    ]);
    setLightpandaStatus(nextLightpanda);
    setPlaywrightStatus(nextPlaywright);
  }, []);

  React.useEffect(() => {
    if (!isActive) return;
    void loadStatus();
    const interval = window.setInterval(() => void loadStatus(), 15000);
    return () => window.clearInterval(interval);
  }, [isActive, loadStatus]);

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
      if (selectedBackend === "playwright") {
        const nav = await navigatePlaywright(nextUrl);
        const live = await refreshPlaywrightLive().catch(() => ({ snap: nav }));
        const snap = live.snap || nav;
        setPlaywrightResult(snap);
        setLightpandaResult(null);
        if (nav.isError || snap.isError) setError(mcpResultText(snap, 700) || "Playwright navigation failed.");
      } else {
        const next = await navigateLightpanda(nextUrl);
        setLightpandaResult(next);
        setPlaywrightResult(null);
        setLiveImage("");
        if (!next.ok && next.error) setError(next.error);
      }
    } catch (err) {
      setLightpandaResult(null);
      setPlaywrightResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      void loadStatus();
    }
  }, [history, historyIndex, loadStatus, refreshPlaywrightLive, selectedBackend]);

  const goHistory = React.useCallback((delta: number) => {
    const nextIndex = Math.max(0, Math.min(history.length - 1, historyIndex + delta));
    setHistoryIndex(nextIndex);
    void navigate(history[nextIndex], false);
  }, [history, historyIndex, navigate]);

  const startPlaywright = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await startPlaywrightMcp();
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadStatus]);

  const snapshot = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const live = await refreshPlaywrightLive();
      const next = live.snap || await snapshotPlaywright();
      setPlaywrightResult(next);
      setLightpandaResult(null);
      if (next.isError) setError(mcpResultText(next, 700) || "Playwright snapshot failed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      void loadStatus();
    }
  }, [loadStatus, refreshPlaywrightLive]);

  React.useEffect(() => {
    if (!isActive || !liveEnabled || selectedBackend !== "playwright" || !playwrightReady(playwrightStatus) || !visualUrl || loading) return;
    const interval = window.setInterval(() => {
      void refreshPlaywrightLive({ includeSnapshot: false }).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [isActive, liveEnabled, loading, playwrightStatus, refreshPlaywrightLive, selectedBackend, visualUrl]);

  const visibleLinks = React.useMemo(
    () => (page?.links || [])
      .map((link) => ({
        text: String(link.text || "").trim(),
        href: String(link.href || "").trim(),
      }))
      .filter((link) => link.text || link.href)
      .slice(0, 8),
    [page?.links],
  );

  const formsCount = Number(page?.stats?.forms || page?.forms?.length || 0);
  const inputsCount = Number(page?.stats?.inputs || 0);
  const buttonsCount = Number(page?.stats?.buttons || 0);
  const linksCount = Number(page?.stats?.links || page?.links?.length || 0);
  const extractionPath = page?.extractionPath || page?.extractionSources?.join(", ") || (playwrightResult ? "playwright_mcp.snapshot" : "none");

  return (
    <div className="program-shell browser-workbench">
      <header className="browser-topbar">
        <div className="browser-title">
          <span className="browser-title-icon"><Globe size={15} /></span>
          <div>
            <strong>Browser</strong>
            <span>live preview + AI page understanding</span>
          </div>
        </div>
        <div className="browser-status-strip">
          <span className={lightpandaStatus?.ok ? "is-ready" : "is-down"}>Lightpanda: {lightpandaStatus?.ok ? "ready" : "not ready"}</span>
          <span className={playwrightReady(playwrightStatus) ? "is-ready" : ""}>Playwright: {playwrightStatusLabel(playwrightStatus)}</span>
          <button
            type="button"
            className={liveEnabled ? "is-ready" : ""}
            onClick={() => setLiveEnabled((value) => !value)}
            title="Poll the real Playwright browser screenshot while active"
          >
            Live {liveEnabled ? "on" : "off"}
          </button>
          {playwrightStatus?.discovered && !playwrightReady(playwrightStatus) && (
            <button type="button" onClick={() => void startPlaywright()} disabled={loading}>
              Start Playwright
            </button>
          )}
        </div>
      </header>

      <form
        className="browser-commandbar"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate(address);
        }}
      >
        <button type="button" onClick={() => goHistory(-1)} disabled={historyIndex <= 0} title="Back">
          <ArrowLeft size={15} />
        </button>
        <button type="button" onClick={() => goHistory(1)} disabled={historyIndex >= history.length - 1} title="Forward">
          <ArrowRight size={15} />
        </button>
        <button type="button" onClick={() => void navigate(address, false)} disabled={loading || !address} title="Reload">
          <RefreshCcw size={15} className={loading ? "animate-spin" : ""} />
        </button>
        <label className="browser-address input-shell" onPointerDown={focusInputShell}>
          <Search size={14} />
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="enter a URL, domain, or page to inspect"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <select value={backend} onChange={(event) => setBackend(event.target.value as BrowserBackend)} title="Browser backend">
          <option value="auto">Auto</option>
          <option value="lightpanda">Lightpanda</option>
          <option value="playwright">Playwright</option>
        </select>
        <button type="submit" className="browser-primary-action" disabled={loading || !address}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
          Go
        </button>
        <button type="button" onClick={() => void snapshot()} disabled={loading || backend !== "playwright"}>
          Snapshot
        </button>
      </form>

      <main className="browser-stage">
        <section className="browser-live">
          <div className="browser-live-chrome">
            <span />
            <span />
            <span />
            <code>{previewSrc || "no page loaded"}</code>
            <strong>{backendLabel(backend)}</strong>
          </div>
          <div className="browser-live-frame">
            {loading ? (
              <div className="browser-empty-state">
                <Loader2 size={30} className="animate-spin" />
                <strong>loading browser action</strong>
                <span>{visualUrl || "starting runtime browser..."}</span>
              </div>
            ) : livePreviewActive ? (
              <img src={liveImage} alt="Live Playwright browser preview" />
            ) : previewSrc ? (
              <iframe title="Live browser preview" src={previewSrc} referrerPolicy="no-referrer" />
            ) : (
              <div className="browser-empty-state">
                <Sparkles size={30} />
                <strong>ready for a real page</strong>
                <span>choose Auto for fast extraction or Playwright for real click/type/form behavior.</span>
              </div>
            )}
          </div>
          <div className="browser-live-footer">
            <span><Bot size={13} /> AI backend: {selectedBackend === "playwright" ? "playwright_mcp" : "lightpanda"}</span>
            <span><Clock size={13} /> {duration(lightpandaResult?.durationMs || lightpandaStatus?.durationMs)}</span>
            {lastLiveAt && <span>live refreshed {lastLiveAt}</span>}
            <span>{extractionPath}</span>
          </div>
        </section>

        <aside className="browser-ai-panel">
          <section className="browser-card browser-card--hero">
            <span>what the AI sees</span>
            <h2>{page?.title || (playwrightResult ? "Playwright snapshot" : "No page yet")}</h2>
            <p>{compact(readablePreview || playwrightPreview || "Navigate to a page and the browser agent preview will appear here.", 420)}</p>
            {error && <pre>{error}</pre>}
          </section>

          <section className="browser-card">
            <span>page signals</span>
            <div className="browser-signal-grid">
              <strong>{formsCount}<em>forms</em></strong>
              <strong>{inputsCount}<em>inputs</em></strong>
              <strong>{buttonsCount}<em>buttons</em></strong>
              <strong>{linksCount}<em>links</em></strong>
            </div>
          </section>

          <section className="browser-card">
            <span>useful next actions</span>
            <div className="browser-action-list">
              <button type="button" onClick={() => setBackend("playwright")}>Use real browser</button>
              <button type="button" onClick={() => void snapshot()} disabled={loading || !playwrightReady(playwrightStatus)}>Read Playwright snapshot</button>
              <button type="button" onClick={() => setBackend("lightpanda")}>Fast extract mode</button>
            </div>
          </section>

          <section className="browser-card">
            <span>visible links</span>
            <div className="browser-link-list">
              {visibleLinks.length === 0 && <em>No links extracted yet.</em>}
              {visibleLinks.map((link, index) => (
                <button key={`${link.href}-${index}`} type="button" onClick={() => void navigate(link.href)}>
                  <strong>{compact(link.text || link.href || "untitled", 46)}</strong>
                  <small>{compact(link.href || "no href", 58)}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
