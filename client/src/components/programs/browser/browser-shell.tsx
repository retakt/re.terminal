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
  getBrowserAgentStatus,
  getPlaywrightMcpStatus,
  navigateLightpanda,
  navigatePlaywright,
  normalizeBrowserUrl,
  screenshotPlaywright,
  snapshotPlaywright,
  startPlaywrightMcp,
  type BrowserAgentObservation,
  type BrowserAgentStatus,
  type BrowserBackend,
  type LightpandaPageResult,
  type LightpandaStatus,
  type PlaywrightMcpResult,
  type PlaywrightMcpStatus,
} from "@/lib/browser-api";
import { focusInputShell } from "@/lib/focus-input-shell";

const CHAT_SESSION_ID_KEY = "reterm.chat.sessionId";

function duration(ms?: number) {
  if (typeof ms !== "number") return "n/a";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function compact(value = "", limit = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function numberish(value: unknown) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

function currentChatSessionId() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(CHAT_SESSION_ID_KEY) || "";
  } catch {
    return "";
  }
}

function observationToPage(observation?: BrowserAgentObservation | null): LightpandaPageResult["page"] | null {
  if (!observation) return null;
  const links = Array.isArray(observation.links)
    ? observation.links.map((link) => ({
      text: String(link?.text || "").trim(),
      href: String(link?.href || "").trim(),
    }))
    : [];
  const forms = Array.isArray(observation.forms) ? observation.forms : [];
  const inputs = Array.isArray(observation.inputs) ? observation.inputs : [];
  const buttons = Array.isArray(observation.buttons) ? observation.buttons : [];
  return {
    url: observation.url || "",
    title: observation.title || "",
    text: observation.text || observation.textPreview || "",
    markdown: observation.markdown || observation.textPreview || "",
    links,
    forms,
    inputs,
    buttons,
    interactiveElements: observation.interactiveElements || [],
    extractionPath: observation.extractionPath || observation.engine || "browser_agent.state",
    extractionSources: observation.extractionSources || [observation.engine || "browser_agent"],
    extractionCapabilities: observation.extractionCapabilities || {},
    stats: {
      forms: numberish(observation.stats?.forms) || forms.length,
      inputs: numberish(observation.stats?.inputs) || inputs.length,
      buttons: numberish(observation.stats?.buttons) || buttons.length,
      links: numberish(observation.stats?.links) || links.length,
    },
  };
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
  const [agentStatus, setAgentStatus] = React.useState<BrowserAgentStatus | null>(null);
  const [agentSessionId, setAgentSessionId] = React.useState("");
  const [agentStatusError, setAgentStatusError] = React.useState("");
  const [lightpandaResult, setLightpandaResult] = React.useState<LightpandaPageResult | null>(null);
  const [playwrightResult, setPlaywrightResult] = React.useState<PlaywrightMcpResult | null>(null);
  const [screenshotImage, setScreenshotImage] = React.useState("");
  const [screenshotPolling, setScreenshotPolling] = React.useState(true);
  const [lastScreenshotAt, setLastScreenshotAt] = React.useState("");
  const [screenshotError, setScreenshotError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const agentState = agentStatus?.state;
  const agentObservation = agentState?.lastValidObservation || agentState?.lastObservation || null;
  const agentPage = React.useMemo(() => observationToPage(agentObservation), [agentObservation]);
  const page = lightpandaResult?.page || agentPage;
  const readablePreview = page?.text || page?.accessibility?.textPreview || page?.markdown || "";
  const playwrightPreview = mcpResultText(playwrightResult);
  const selectedBackend = backend === "auto" ? "lightpanda" : backend;
  const previewUrl = selectedBackend === "playwright" ? visualUrl : page?.url || visualUrl;
  const agentBackend = String(agentState?.lastCommand?.backend || agentState?.lastToolResult?.engine || agentState?.activeEngine || "");
  const agentUpdatedAt = agentState?.updatedAt || "";

  const refreshPlaywrightScreenshot = React.useCallback(async ({ includeSnapshot = true } = {}) => {
    setScreenshotError("");
    const [shotResult, snapResult] = await Promise.allSettled([
      screenshotPlaywright(),
      includeSnapshot ? snapshotPlaywright() : Promise.resolve(null),
    ]);
    const shot = shotResult.status === "fulfilled" ? shotResult.value : null;
    const snap = snapResult.status === "fulfilled" ? snapResult.value : null;
    const imageUrl = mcpImageDataUrl(shot);
    if (imageUrl) {
      setScreenshotImage(imageUrl);
    } else if (shot?.isError || shotResult.status === "rejected") {
      const message = shotResult.status === "rejected"
        ? shotResult.reason instanceof Error ? shotResult.reason.message : String(shotResult.reason)
        : mcpResultText(shot, 500) || "Playwright screenshot did not include an image.";
      setScreenshotError(message);
    }
    if (snap) setPlaywrightResult(snap);
    if (snapResult.status === "rejected") {
      const message = snapResult.reason instanceof Error ? snapResult.reason.message : String(snapResult.reason);
      setScreenshotError((previous) => previous || message);
    }
    setLastScreenshotAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
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
    return { lightpanda: nextLightpanda, playwright: nextPlaywright };
  }, []);

  React.useEffect(() => {
    if (!isActive) return;
    void loadStatus();
    const interval = window.setInterval(() => void loadStatus(), 15000);
    return () => window.clearInterval(interval);
  }, [isActive, loadStatus]);

  const loadAgentStatus = React.useCallback(async () => {
    const sessionId = currentChatSessionId();
    setAgentSessionId(sessionId);
    if (!sessionId) return null;
    try {
      const next = await getBrowserAgentStatus(sessionId);
      setAgentStatus(next);
      setAgentStatusError("");
      return next;
    } catch (err) {
      setAgentStatusError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  React.useEffect(() => {
    if (!isActive) return;
    void loadAgentStatus();
    const interval = window.setInterval(() => void loadAgentStatus(), 2500);
    return () => window.clearInterval(interval);
  }, [isActive, loadAgentStatus]);

  React.useEffect(() => {
    if (!agentState || loading) return;
    const stateUrl = agentState.currentUrl || agentObservation?.url || "";
    if (stateUrl) {
      setVisualUrl(stateUrl);
      const activeElement = typeof document !== "undefined" ? document.activeElement : null;
      const userIsTypingAddress = activeElement instanceof HTMLInputElement && Boolean(activeElement.closest(".browser-address"));
      if (!userIsTypingAddress) setAddress(stateUrl);
    }
    if (agentBackend === "playwright_mcp" && backend !== "playwright") {
      setBackend("playwright");
    }
  }, [agentBackend, agentObservation?.url, agentState, backend, loading]);

  React.useEffect(() => {
    if (!isActive || loading || agentBackend !== "playwright_mcp" || !playwrightReady(playwrightStatus)) return;
    void refreshPlaywrightScreenshot({ includeSnapshot: true }).catch((err) => {
      setScreenshotError(err instanceof Error ? err.message : String(err));
    });
  }, [agentBackend, agentUpdatedAt, isActive, loading, playwrightStatus, refreshPlaywrightScreenshot]);

  const ensurePlaywrightReady = React.useCallback(async () => {
    let status = await getPlaywrightMcpStatus();
    setPlaywrightStatus(status);
    if (!playwrightReady(status)) {
      await startPlaywrightMcp();
      status = await getPlaywrightMcpStatus();
      setPlaywrightStatus(status);
    }
    if (!playwrightReady(status)) {
      throw new Error(status.error || status.message || status.server?.error || "Playwright MCP is not ready.");
    }
    setScreenshotPolling(true);
    return status;
  }, []);

  const navigate = React.useCallback(async (target: string, pushHistory = true) => {
    const nextUrl = normalizeBrowserUrl(target);
    if (!nextUrl) return;
    setAddress(nextUrl);
    setVisualUrl(nextUrl);
    setLoading(true);
    setError("");
    setScreenshotError("");
    if (pushHistory) {
      const nextHistory = [...history.slice(0, historyIndex + 1), nextUrl].slice(-40);
      setHistory(nextHistory);
      setHistoryIndex(nextHistory.length - 1);
    }

    try {
      if (selectedBackend === "playwright") {
        await ensurePlaywrightReady();
        const nav = await navigatePlaywright(nextUrl);
        const shot = await screenshotPlaywright().catch((err) => {
          setScreenshotError(err instanceof Error ? err.message : String(err));
          return null;
        });
        const imageUrl = mcpImageDataUrl(shot);
        if (imageUrl) {
          setScreenshotImage(imageUrl);
        } else if (shot?.isError) {
          setScreenshotError(mcpResultText(shot, 700) || "Playwright screenshot did not include an image.");
        }
        const snap = await snapshotPlaywright().catch((err) => {
          setScreenshotError((previous) => previous || (err instanceof Error ? err.message : String(err)));
          return nav;
        });
        setPlaywrightResult(snap);
        setLightpandaResult(null);
        if (nav.isError || snap.isError) setError(mcpResultText(snap, 700) || "Playwright navigation failed.");
      } else {
        const next = await navigateLightpanda(nextUrl);
        setLightpandaResult(next);
        setPlaywrightResult(null);
        setScreenshotImage("");
        setScreenshotError("");
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
  }, [ensurePlaywrightReady, history, historyIndex, loadStatus, selectedBackend]);

  const goHistory = React.useCallback((delta: number) => {
    const nextIndex = Math.max(0, Math.min(history.length - 1, historyIndex + delta));
    setHistoryIndex(nextIndex);
    void navigate(history[nextIndex], false);
  }, [history, historyIndex, navigate]);

  const startPlaywright = React.useCallback(async () => {
    setLoading(true);
    setError("");
    setScreenshotError("");
    try {
      await startPlaywrightMcp();
      await loadStatus();
      setScreenshotPolling(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadStatus]);

  const snapshot = React.useCallback(async () => {
    setLoading(true);
    setError("");
    setScreenshotError("");
    try {
      await ensurePlaywrightReady();
      const live = await refreshPlaywrightScreenshot();
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
  }, [ensurePlaywrightReady, loadStatus, refreshPlaywrightScreenshot]);

  React.useEffect(() => {
    if (!isActive || !screenshotPolling || selectedBackend !== "playwright" || !playwrightReady(playwrightStatus) || loading) return;
    const interval = window.setInterval(() => {
      void refreshPlaywrightScreenshot({ includeSnapshot: false }).catch((err) => {
        setScreenshotError(err instanceof Error ? err.message : String(err));
      });
    }, 2500);
    return () => window.clearInterval(interval);
  }, [isActive, loading, playwrightStatus, refreshPlaywrightScreenshot, screenshotPolling, selectedBackend]);

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
  const inputsCount = numberish(page?.stats?.inputs) || (Array.isArray(page?.inputs) ? page.inputs.length : 0);
  const buttonsCount = numberish(page?.stats?.buttons) || (Array.isArray(page?.buttons) ? page.buttons.length : 0);
  const linksCount = Number(page?.stats?.links || page?.links?.length || 0);
  const extractionPath = page?.extractionPath || page?.extractionSources?.join(", ") || (playwrightResult ? "playwright_mcp.snapshot" : "none");
  const aiRuntimeTitle = agentState?.currentTitle || page?.title || (playwrightResult ? "Playwright snapshot" : "No page yet");
  const agentModel = agentStatus?.runtime?.models?.planner || agentStatus?.runtime?.model || "";

  return (
    <div className="program-shell browser-workbench">
      <header className="browser-topbar">
        <div className="browser-title">
          <span className="browser-title-icon"><Globe size={15} /></span>
          <div>
            <strong>Browser</strong>
            <span>Browser preview + AI page understanding</span>
          </div>
        </div>
        <div className="browser-status-strip">
          <span className={lightpandaStatus?.ok ? "is-ready" : "is-down"}>Lightpanda: {lightpandaStatus?.ok ? "ready" : "not ready"}</span>
          <span className={playwrightReady(playwrightStatus) ? "is-ready" : ""}>
            Playwright: {playwrightStatusLabel(playwrightStatus)}
            {playwrightStatus?.server?.toolCount ? ` (${playwrightStatus.server.toolCount} tools)` : ""}
          </span>
          {agentSessionId && (
            <span className={agentStatus?.ok ? "is-ready" : "is-down"}>AI: {agentStatus?.ok ? "following" : "offline"}</span>
          )}
          <button
            type="button"
            className={screenshotPolling ? "is-ready" : ""}
            onClick={() => setScreenshotPolling((value) => !value)}
            title="Poll the real Playwright browser screenshot while active"
          >
            Screenshot polling {screenshotPolling ? "on" : "off"}
          </button>
          {selectedBackend === "playwright" && !playwrightReady(playwrightStatus) && (
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
            <code>{previewUrl || "no page loaded"}</code>
            <strong>{backendLabel(backend)}</strong>
          </div>
          <div className="browser-live-frame">
            {loading ? (
              <div className="browser-empty-state">
                <Loader2 size={30} className="animate-spin" />
                <strong>loading browser action</strong>
                <span>{visualUrl || "starting runtime browser..."}</span>
              </div>
            ) : selectedBackend === "playwright" ? (
              screenshotImage ? (
                <img src={screenshotImage} alt="Playwright browser screenshot preview" />
              ) : (
                <div className="browser-empty-state">
                  <Sparkles size={30} />
                  <strong>No Playwright screenshot yet. Click Start Playwright or Go.</strong>
                  <span>Playwright preview uses screenshot polling, not video streaming.</span>
                  {screenshotError && <em className="browser-screenshot-error">{screenshotError}</em>}
                </div>
              )
            ) : readablePreview ? (
              <div className="browser-extraction-preview">
                <strong>{page?.title || page?.url || "Extracted page"}</strong>
                <p>{readablePreview}</p>
              </div>
            ) : (
              <div className="browser-empty-state">
                <Sparkles size={30} />
                <strong>ready for extraction</strong>
                <span>Auto and Lightpanda show extracted page text/signals. Switch to Playwright for screenshot polling of the controlled browser.</span>
              </div>
            )}
          </div>
          <div className="browser-live-footer">
            <span><Bot size={13} /> AI backend: {selectedBackend === "playwright" ? "playwright_mcp" : "lightpanda"}</span>
            {agentSessionId && <span>AI session {agentSessionId.slice(0, 8)}</span>}
            <span><Clock size={13} /> {duration(lightpandaResult?.durationMs || lightpandaStatus?.durationMs)}</span>
            {selectedBackend === "playwright" && <span>Playwright preview uses screenshot polling, not video streaming.</span>}
            {lastScreenshotAt && selectedBackend === "playwright" && <span>screenshot updated {lastScreenshotAt}</span>}
            {screenshotError && selectedBackend === "playwright" && <span className="is-down">screenshot error: {compact(screenshotError, 120)}</span>}
            <span>{extractionPath}</span>
          </div>
        </section>

        <aside className="browser-ai-panel">
          <section className="browser-card browser-card--hero">
            <span>what the AI sees</span>
            <h2>{aiRuntimeTitle}</h2>
            <p>{compact(readablePreview || playwrightPreview || "Navigate to a page and the browser agent preview will appear here.", 420)}</p>
            {error && <pre>{error}</pre>}
            {agentStatusError && <pre>{agentStatusError}</pre>}
            {agentModel && <small className="browser-agent-model">planner: {compact(agentModel, 54)}</small>}
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
