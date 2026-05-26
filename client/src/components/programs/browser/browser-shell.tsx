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
  getBrowserAgentSessions,
  createBrowserAgentSession,
  runBrowserAgent,
  resetBrowserAgent,
  getPlaywrightMcpStatus,
  navigateLightpanda,
  navigatePlaywright,
  normalizeBrowserUrl,
  screenshotPlaywright,
  snapshotPlaywright,
  startPlaywrightMcp,
  type BrowserAgentObservation,
  type BrowserAgentRunResult,
  type BrowserAgentStatus,
  type BrowserAgentSessionSummary,
  type BrowserBackend,
  type LightpandaPageResult,
  type LightpandaStatus,
  type PlaywrightMcpResult,
  type PlaywrightMcpStatus,
} from "@/lib/browser-api";
import { focusInputShell } from "@/lib/focus-input-shell";
import { useApp } from "@/contexts/app-context";

const CHAT_SESSION_ID_KEY = "reterm.chat.sessionId";
const BROWSER_SESSION_ID_KEY = "reterm.browser.agentSessionId";
const BROWSER_SESSION_LINK_EVENT = "reterm.browser.session-link";

type BrowserSessionRecord = {
  sessionId: string;
  currentUrl: string;
  currentTitle: string;
  route: string;
  routeEngine: string;
  lastInstruction: string;
  summary: string;
  status: string;
  updatedAt: string;
  historyCount: number;
};

function duration(ms?: number) {
  if (typeof ms !== "number") return "n/a";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function latencyTone(ms?: number) {
  if (typeof ms !== "number") return "idle";
  if (ms <= 300) return "fast";
  if (ms <= 1200) return "ok";
  if (ms <= 3000) return "slow";
  return "bad";
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

function browserSessionIdSeed() {
  const chatSession = currentChatSessionId();
  return chatSession || `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function currentBrowserSessionId() {
  if (typeof window === "undefined") return browserSessionIdSeed();
  try {
    return window.localStorage.getItem(BROWSER_SESSION_ID_KEY) || browserSessionIdSeed();
  } catch {
    return browserSessionIdSeed();
  }
}

function browserSessionLabel(session: BrowserSessionRecord | BrowserAgentSessionSummary | null | undefined) {
  if (!session) return "browser session";
  return session.currentTitle?.trim()
    || session.currentUrl?.trim()
    || session.summary?.trim()
    || `session ${session.sessionId.slice(0, 8)}`;
}

function browserSessionSubtitle(session: BrowserSessionRecord | BrowserAgentSessionSummary | null | undefined) {
  if (!session) return "";
  return compact(session.lastInstruction || session.summary || session.routeEngine || session.route || "", 140);
}

function explicitInstructionRoute(instruction = "") {
  const lower = instruction.toLowerCase();
  if (/\blightpanda\b/.test(lower)) return "lightpanda";
  if (/\bplaywright\b/.test(lower)) return "playwright";
  return "auto";
}

function playwrightResponseMs(status: PlaywrightMcpStatus | null) {
  const server = status?.server as (PlaywrightMcpStatus["server"] & { responseMs?: number | null; durationMs?: number | null }) | undefined;
  const ms = Number(server?.responseMs ?? server?.durationMs ?? 0);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function browserSessionFromSummary(
  session: BrowserAgentSessionSummary | null | undefined,
  fallbackSessionId = "",
): BrowserSessionRecord | null {
  if (!session?.sessionId) return null;
  return {
    sessionId: session.sessionId || fallbackSessionId,
    currentUrl: String(session.currentUrl || "").trim(),
    currentTitle: String(session.currentTitle || "").trim(),
    route: String(session.route || "").trim(),
    routeEngine: String(session.routeEngine || "").trim(),
    lastInstruction: String(session.lastInstruction || "").trim(),
    summary: String(session.summary || "").trim(),
    status: String(session.status || "").trim(),
    updatedAt: String(session.updatedAt || new Date().toISOString()).trim(),
    historyCount: Number(session.historyCount || 0),
  };
}

function browserSessionFromStatus(
  status: BrowserAgentStatus | null | undefined,
  fallbackSessionId = "",
): BrowserSessionRecord | null {
  if (!status?.sessionId && !fallbackSessionId) return null;
  const state = (status?.state || {}) as Record<string, any>;
  const report = (status?.uiReport || {}) as Record<string, any>;
  return {
    sessionId: status?.sessionId || fallbackSessionId,
    currentUrl: String(state.currentUrl || report?.current?.url || "").trim(),
    currentTitle: String(state.currentTitle || report?.current?.title || "").trim(),
    route: String(report?.route || state.lastCommand?.backend || state.activeEngine || "").trim(),
    routeEngine: String(report?.backend || state.activeEngine || "").trim(),
    lastInstruction: String(state.lastIntent || state.lastInstruction || report?.lastInstruction || "").trim(),
    summary: String(report?.summary || state.lastResult?.summary || state.lastResult?.status || state.lastInstruction || state.currentTitle || state.currentUrl || "").trim(),
    status: String(status?.status || report?.status || "").trim(),
    updatedAt: String(state.updatedAt || report?.generatedAt || new Date().toISOString()).trim(),
    historyCount: Number(Array.isArray(state?.history) ? state.history.length : 0),
  };
}

function browserSessionFromRun(
  result: BrowserAgentRunResult | null | undefined,
  fallbackSessionId = "",
): BrowserSessionRecord | null {
  if (!result && !fallbackSessionId) return null;
  const report = result?.uiReport || null;
  return {
    sessionId: fallbackSessionId,
    currentUrl: String(result?.currentUrl || report?.current?.url || "").trim(),
    currentTitle: String(result?.currentTitle || report?.current?.title || "").trim(),
    route: String(result?.route || report?.route || "").trim(),
    routeEngine: String(report?.backend || "").trim(),
    lastInstruction: String(report?.plan?.userIntent || "").trim(),
    summary: String(result?.summary || report?.summary || "").trim(),
    status: String(result?.status || report?.status || "").trim(),
    updatedAt: new Date().toISOString(),
    historyCount: Number(report?.steps?.length || 0),
  };
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
  const { pages, openProgram } = useApp();
  const [address, setAddress] = React.useState("");
  const [visualUrl, setVisualUrl] = React.useState("");
  const [backend, setBackend] = React.useState<BrowserBackend>("auto");
  const [history, setHistory] = React.useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const [lightpandaStatus, setLightpandaStatus] = React.useState<LightpandaStatus | null>(null);
  const [playwrightStatus, setPlaywrightStatus] = React.useState<PlaywrightMcpStatus | null>(null);
  const [agentStatus, setAgentStatus] = React.useState<BrowserAgentStatus | null>(null);
  const [agentSessionId, setAgentSessionId] = React.useState(() => currentBrowserSessionId());
  const [browserSessions, setBrowserSessions] = React.useState<BrowserSessionRecord[]>([]);
  const [browserInstruction, setBrowserInstruction] = React.useState("");
  const [browserRunResult, setBrowserRunResult] = React.useState<BrowserAgentRunResult | null>(null);
  const [browserRunError, setBrowserRunError] = React.useState("");
  const [browserRunning, setBrowserRunning] = React.useState(false);
  const [agentStatusError, setAgentStatusError] = React.useState("");
  const [lightpandaResult, setLightpandaResult] = React.useState<LightpandaPageResult | null>(null);
  const [playwrightResult, setPlaywrightResult] = React.useState<PlaywrightMcpResult | null>(null);
  const [screenshotImage, setScreenshotImage] = React.useState("");
  const [screenshotPolling, setScreenshotPolling] = React.useState(true);
  const [lastScreenshotAt, setLastScreenshotAt] = React.useState("");
  const [screenshotError, setScreenshotError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const agentStatusRef = React.useRef<BrowserAgentStatus | null>(null);
  const agentSessionIdRef = React.useRef(agentSessionId);

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
  const chatSessions = React.useMemo(
    () => pages.flatMap((page, index) => {
      if (page.type !== "chat" || !("sessionId" in page) || !page.sessionId) return [];
      return [{
        pageId: page.id,
        title: page.title || `session #${index + 1}`,
        sessionId: String(page.sessionId || ""),
      }];
    }),
    [pages],
  );
  const linkedChatSession = chatSessions.find((session) => session.sessionId === agentSessionId) || null;

  React.useEffect(() => {
    agentStatusRef.current = agentStatus;
  }, [agentStatus]);

  React.useEffect(() => {
    agentSessionIdRef.current = agentSessionId;
  }, [agentSessionId]);

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

  const upsertBrowserSession = React.useCallback((record: BrowserSessionRecord | null) => {
    if (!record?.sessionId) return;
    setBrowserSessions((current) => {
      const next = [
        record,
        ...current.filter((entry) => entry.sessionId !== record.sessionId),
      ];
      next.sort((left, right) => {
        const leftTime = new Date(left.updatedAt || 0).getTime() || 0;
        const rightTime = new Date(right.updatedAt || 0).getTime() || 0;
        return rightTime - leftTime;
      });
      return next.slice(0, 24);
    });
  }, []);

  const refreshBrowserSessions = React.useCallback(async () => {
    try {
      const next = await getBrowserAgentSessions();
      const normalized = next
        .map((session) => browserSessionFromSummary(session))
        .filter(Boolean) as BrowserSessionRecord[];
      const activeRecord = browserSessionFromStatus(agentStatusRef.current, agentSessionIdRef.current);
      const merged = activeRecord
        ? [
          activeRecord,
          ...normalized.filter((session) => session.sessionId !== activeRecord.sessionId),
        ]
        : normalized;
      setBrowserSessions(merged);
      return merged;
    } catch {
      return [];
    }
  }, []);

  const loadAgentStatus = React.useCallback(async (sessionId: string) => {
    if (!sessionId) return null;
    setAgentSessionId(sessionId);
    try {
      const next = await getBrowserAgentStatus(sessionId);
      setAgentStatus(next);
      setAgentStatusError("");
      const record = browserSessionFromStatus(next, sessionId);
      if (record) upsertBrowserSession(record);
      return next;
    } catch (err) {
      setAgentStatusError(err instanceof Error ? err.message : String(err));
      setAgentStatus(null);
      return null;
    }
  }, [upsertBrowserSession]);

  const activateBrowserSession = React.useCallback(async (sessionId: string) => {
    setError("");
    setAgentStatusError("");
    setBrowserRunError("");
    setBrowserRunResult(null);
    setBrowserInstruction("");
    try {
      window.localStorage.setItem(BROWSER_SESSION_ID_KEY, sessionId);
    } catch {}
    return loadAgentStatus(sessionId);
  }, [loadAgentStatus]);

  const linkChatSessionToBrowser = React.useCallback(async (sessionId: string) => {
    if (!sessionId) return null;
    try {
      window.localStorage.setItem(CHAT_SESSION_ID_KEY, sessionId);
      window.localStorage.setItem(BROWSER_SESSION_ID_KEY, sessionId);
    } catch {}
    return activateBrowserSession(sessionId);
  }, [activateBrowserSession]);

  React.useEffect(() => {
    const handleBrowserSessionLink = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail || {};
      const nextSessionId = detail.sessionId || currentBrowserSessionId();
      if (!nextSessionId || nextSessionId === agentSessionIdRef.current) return;
      void activateBrowserSession(nextSessionId);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== BROWSER_SESSION_ID_KEY || !event.newValue || event.newValue === agentSessionIdRef.current) return;
      void activateBrowserSession(event.newValue);
    };
    window.addEventListener(BROWSER_SESSION_LINK_EVENT, handleBrowserSessionLink as EventListener);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(BROWSER_SESSION_LINK_EVENT, handleBrowserSessionLink as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, [activateBrowserSession]);

  React.useEffect(() => {
    if (!isActive) return;
    void refreshBrowserSessions();
    void loadAgentStatus(agentSessionId);
    const statusInterval = window.setInterval(() => void loadAgentStatus(agentSessionId), 2500);
    const sessionsInterval = window.setInterval(() => void refreshBrowserSessions(), 12000);
    return () => {
      window.clearInterval(statusInterval);
      window.clearInterval(sessionsInterval);
    };
  }, [agentSessionId, isActive, loadAgentStatus, refreshBrowserSessions]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(BROWSER_SESSION_ID_KEY, agentSessionId);
    } catch {}
  }, [agentSessionId]);

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

  const createLinkedChatSession = React.useCallback(async () => {
    const sessionId = openProgram("chat");
    if (!sessionId) return;
    try {
      window.localStorage.setItem(CHAT_SESSION_ID_KEY, sessionId);
      window.localStorage.setItem(BROWSER_SESSION_ID_KEY, sessionId);
    } catch {}
    setAgentSessionId(sessionId);
    setAgentStatus(null);
    setBrowserRunResult(null);
    setBrowserRunError("");
    setBrowserInstruction("");
    try {
      const created = await createBrowserAgentSession(sessionId);
      const record = browserSessionFromStatus(created, sessionId);
      if (record) upsertBrowserSession(record);
      await refreshBrowserSessions();
    } catch (err) {
      setAgentStatusError(err instanceof Error ? err.message : String(err));
    }
  }, [openProgram, refreshBrowserSessions, upsertBrowserSession]);

  const resetBrowserSession = React.useCallback(async () => {
    if (!agentSessionId) return;
    setError("");
    setAgentStatusError("");
    setBrowserRunError("");
    setBrowserRunResult(null);
    setBrowserInstruction("");
    setAgentStatus(null);
    try {
      await resetBrowserAgent(agentSessionId);
      await refreshBrowserSessions();
      await loadAgentStatus(agentSessionId);
    } catch (err) {
      setAgentStatusError(err instanceof Error ? err.message : String(err));
    }
  }, [agentSessionId, loadAgentStatus, refreshBrowserSessions]);

  const runBrowserInstruction = React.useCallback(async () => {
    const instruction = browserInstruction.trim();
    if (!instruction || browserRunning) return;
    const runSessionId = agentSessionId;

    setBrowserRunning(true);
    setError("");
    setBrowserRunError("");
    try {
      const route = explicitInstructionRoute(instruction);
      const result = await runBrowserAgent({
        instruction,
        sessionId: runSessionId,
        route,
        currentUrl: visualUrl || page?.url || address || "",
        currentTitle: page?.title || "",
        includeImages: route === "playwright" || selectedBackend === "playwright",
      });
      const stillCurrent = agentSessionIdRef.current === runSessionId;
      if (stillCurrent) setBrowserRunResult(result);
      const nextUrl = result.currentUrl || result.uiReport?.current?.url || "";
      if (stillCurrent && nextUrl) {
        setVisualUrl(nextUrl);
        setAddress(nextUrl);
      }
      const record = browserSessionFromRun(result, runSessionId);
      if (record) upsertBrowserSession(record);
      await refreshBrowserSessions();
      if (stillCurrent) {
        await loadAgentStatus(runSessionId);
        setBrowserInstruction("");
      }
      if (stillCurrent && !result.ok && result.error) {
        setBrowserRunError(result.error);
      }
    } catch (err) {
      if (agentSessionIdRef.current === runSessionId) {
        setBrowserRunError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBrowserRunning(false);
    }
  }, [address, agentSessionId, browserInstruction, browserRunning, loadAgentStatus, page?.title, page?.url, refreshBrowserSessions, selectedBackend, upsertBrowserSession, visualUrl]);

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
  const currentBrowserSession = React.useMemo(() => {
    return browserSessions.find((session) => session.sessionId === agentSessionId)
      || browserSessionFromStatus(agentStatus, agentSessionId)
      || null;
  }, [agentSessionId, agentStatus, browserSessions]);
  const browserOnlySessions = React.useMemo(() => {
    const chatSessionIds = new Set(chatSessions.map((session) => session.sessionId));
    return browserSessions.filter((session) => !chatSessionIds.has(session.sessionId));
  }, [browserSessions, chatSessions]);
  const browserRunSummary = browserRunResult?.summary || browserRunResult?.uiReport?.summary || "";
  const browserRunNextAction = browserRunResult?.nextSafeAction || browserRunResult?.uiReport?.nextSafeAction || "";
  const browserRunRoute = browserRunResult?.route || browserRunResult?.uiReport?.route || "";
  const activeLatencyMs = selectedBackend === "playwright"
    ? playwrightResponseMs(playwrightStatus)
    : lightpandaResult?.durationMs || lightpandaStatus?.durationMs;
  const activeLatencyTone = latencyTone(activeLatencyMs);

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
            <span
              className={agentStatus?.ok ? "is-ready" : "is-down"}
              title={currentBrowserSession?.summary || currentBrowserSession?.lastInstruction || ""}
            >
              AI session: {linkedChatSession?.title || "browser-only"} · #{agentSessionId.slice(0, 8)} · {agentStatus?.ok ? "following" : "offline"}
            </span>
          )}
          <span className={`browser-latency browser-latency--${activeLatencyTone}`}>
            response {duration(activeLatencyMs)}
          </span>
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
            {agentSessionId && <span>AI session {linkedChatSession?.title || `#${agentSessionId.slice(0, 8)}`}</span>}
            <span className={`browser-latency browser-latency--${activeLatencyTone}`}><Clock size={13} /> {duration(activeLatencyMs)}</span>
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
            {browserRunSummary && <small className="browser-session-summary">last run: {compact(browserRunSummary, 220)}</small>}
            {browserRunNextAction && <small className="browser-session-summary browser-session-summary--next">next: {compact(browserRunNextAction, 220)}</small>}
            <div className="browser-hero-meta">
              {currentBrowserSession && <small className="browser-agent-model">session: {browserSessionLabel(currentBrowserSession)}</small>}
              {agentModel && <small className="browser-agent-model">planner: {compact(agentModel, 54)}</small>}
              {browserRunRoute && <small className="browser-agent-model">route: {browserRunRoute}</small>}
            </div>
          </section>

          <form
            className="browser-card browser-composer-shell"
            onSubmit={(event) => {
              event.preventDefault();
              void runBrowserInstruction();
            }}
          >
            <div className="browser-composer-head">
              <span>browser prompt</span>
              <small>direct to orchestrator · {linkedChatSession?.title || "browser-only session"}</small>
            </div>
            <label className="browser-composer input-shell" onPointerDown={focusInputShell}>
              <textarea
                value={browserInstruction}
                onChange={(event) => setBrowserInstruction(event.target.value)}
                placeholder="Go to a page, read the table, scrape the contents, fill a form, or compare two pages."
                rows={4}
              />
            </label>
            <div className="browser-composer-actions">
              <button type="submit" className="browser-primary-action" disabled={browserRunning || !browserInstruction.trim()}>
                {browserRunning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Run prompt
              </button>
            </div>
            {(browserRunError || browserRunSummary) && (
              <div className="browser-composer-output">
                {browserRunError && <pre className="browser-composer-error">{browserRunError}</pre>}
                {!browserRunError && browserRunSummary && <p>{compact(browserRunSummary, 260)}</p>}
              </div>
            )}
          </form>

          <section className="browser-card">
            <div className="browser-card-head">
              <span>linked chat sessions</span>
              <button type="button" className="browser-card-action" onClick={() => void createLinkedChatSession()} disabled={browserRunning}>
                New chat tab
              </button>
            </div>
            <div className="browser-session-list">
              {chatSessions.length === 0 ? (
                <em>No chat sessions yet. Create one to link chat and browser state.</em>
              ) : (
                chatSessions.map((session) => {
                  const active = session.sessionId === agentSessionId;
                  return (
                    <button
                      key={session.sessionId}
                      type="button"
                      className={active ? "is-active" : ""}
                      onClick={() => void linkChatSessionToBrowser(session.sessionId)}
                    >
                      <strong>{session.title}</strong>
                      <small>{active ? "browser agent attached" : "attach browser agent to this chat"}</small>
                      <span className="browser-session-id">#{compact(session.sessionId, 10)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="browser-card">
            <div className="browser-card-head">
              <span>browser-only sessions</span>
              <div className="browser-hero-meta">
                <button type="button" className="browser-card-action" onClick={() => void resetBrowserSession()} disabled={browserRunning || !agentSessionId}>
                  Reset current
                </button>
              </div>
            </div>
            <div className="browser-session-list">
              {browserOnlySessions.length === 0 ? (
                <em>No standalone browser sessions yet.</em>
              ) : (
                browserOnlySessions.map((session) => {
                  const active = session.sessionId === agentSessionId;
                  return (
                    <button
                      key={session.sessionId}
                      type="button"
                      className={active ? "is-active" : ""}
                      onClick={() => void activateBrowserSession(session.sessionId)}
                    >
                      <strong>{browserSessionLabel(session)}</strong>
                      <small>{browserSessionSubtitle(session) || "session ready"}</small>
                      <span className="browser-session-id">#{compact(session.sessionId, 10)}</span>
                    </button>
                  );
                })
              )}
            </div>
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
