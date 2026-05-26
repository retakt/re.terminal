export interface LightpandaStatus {
  ok: boolean;
  status?: string;
  engine: string;
  cdpUrl?: string;
  durationMs?: number;
  error?: string;
  hint?: string;
  version?: Record<string, unknown>;
  capabilities?: {
    cdp?: boolean;
    markdown?: boolean;
    accessibilityTree?: boolean;
    domEval?: boolean;
    nativeMcp?: boolean;
  };
  chromeFallback?: {
    automatic?: boolean;
    supported?: boolean;
    cdpUrl?: string;
  };
}

export interface LightpandaPageResult {
  ok: boolean;
  engine: string;
  cdpUrl?: string;
  durationMs?: number;
  requestedUrl?: string;
  page?: {
    url?: string;
    title?: string;
    text?: string;
    markdown?: string;
    links?: Array<{ text: string; href: string }>;
    forms?: Array<Record<string, unknown>>;
    inputs?: Array<Record<string, unknown>>;
    buttons?: Array<Record<string, unknown>>;
    interactiveElements?: Array<Record<string, unknown>>;
    accessibility?: {
      ok?: boolean;
      nodeCount?: number;
      rootRole?: string;
      rootName?: string;
      controls?: Array<Record<string, unknown>>;
      textPreview?: string;
    } | null;
    extractionPath?: string;
    extractionSources?: string[];
    extractionCapabilities?: {
      markdown?: boolean;
      accessibilityTree?: boolean;
      domEval?: boolean;
      selectors?: boolean;
    };
    stats?: Record<string, number | string>;
  };
  error?: string;
}

export interface ServiceStatus {
  ok: boolean;
  durationMs: number;
  backend?: { ok: boolean; port: number; durationMs: number };
  lightpanda?: Record<string, unknown>;
  services?: Record<string, { ok: boolean; durationMs: number; error?: string; preview?: string }>;
  mcpServers?: Array<{ id: string; title: string; status: string; enabled: boolean; responseMs?: number | null }>;
}

export type BrowserBackend = "auto" | "lightpanda" | "playwright";

export interface PlaywrightMcpStatus {
  ok: boolean;
  discovered?: boolean;
  message?: string;
  server?: {
    id?: string;
    title?: string;
    enabled?: boolean;
    configured?: boolean;
    running?: boolean;
    initialized?: boolean;
    status?: "ready" | "configured" | "disabled" | "error" | string;
    error?: string;
    toolCount?: number;
    responseMs?: number | null;
    durationMs?: number | null;
  };
  error?: string;
}

export interface PlaywrightMcpResult {
  ok?: boolean;
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

export interface BrowserAgentObservation {
  url?: string;
  title?: string;
  textPreview?: string;
  text?: string;
  markdown?: string;
  links?: Array<{ text?: string; href?: string }>;
  forms?: Array<Record<string, unknown>>;
  inputs?: Array<Record<string, unknown>>;
  buttons?: Array<Record<string, unknown>>;
  interactiveElements?: Array<Record<string, unknown>>;
  stats?: Record<string, number | string>;
  extractionPath?: string;
  extractionSources?: string[];
  extractionCapabilities?: Record<string, unknown>;
  engine?: string;
  error?: string;
}

export interface BrowserAgentStatus {
  ok: boolean;
  status?: string;
  sessionId?: string;
  uiReport?: BrowserAgentStatusReport;
  state?: {
    currentUrl?: string;
    currentTitle?: string;
    activeEngine?: string;
    lastIntent?: string;
    lastCommand?: {
      tool?: string;
      backend?: string;
      args?: Record<string, unknown>;
    };
    lastToolResult?: {
      ok?: boolean;
      status?: string;
      engine?: string;
      action?: string;
      currentUrl?: string;
      currentTitle?: string;
      error?: string;
    };
    lastValidObservation?: BrowserAgentObservation | null;
    lastObservation?: BrowserAgentObservation | null;
    lastFailedObservation?: BrowserAgentObservation | null;
    updatedAt?: string;
  };
  runtime?: {
    configured?: boolean;
    model?: string;
    models?: {
      default?: string;
      planner?: string;
      reporter?: string;
    };
    strategy?: string;
  };
  error?: string;
}

export interface BrowserAgentScreenshot {
  id: string;
  stepIndex: number;
  label: string;
  capturedAt: string;
  mimeType: string;
  imagePath: string;
  hasImage: boolean;
  bytesApprox: number;
  dataUrl: string;
}

export interface BrowserAgentUiReport {
  reportVersion: "browser-agent-ui-report/v1" | string;
  generatedAt: string;
  ok: boolean;
  status: string;
  route: "playwright" | "lightpanda" | string;
  backend: string;
  requiredUserInput: boolean;
  summary: string;
  nextSafeAction: string;
  current: { url: string; title: string };
  routeIsolation: {
    ok: boolean;
    selectedRoute: string;
    backend: string;
    stepRoutes: string[];
    stepBackends: string[];
  };
  metrics: {
    totalMs: number;
    stepCount: number;
    completedSteps: number;
    failedStepIndex: number | null;
    screenshotCount: number;
    scrollCount: number;
    reachedBottom: boolean;
  };
  llm: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalDurationMs: number;
    models: string[];
    byRole: Record<string, unknown>;
    byRoute: Record<string, unknown>;
    calls: Array<Record<string, unknown>>;
  };
  plan: {
    status: string;
    userIntent: string;
    routeHint: string;
    reason: string;
    confidence: number;
    needsLightpandaWarmup: boolean;
    steps: Array<Record<string, unknown>>;
  };
  routeSelection: {
    route: string;
    reason: string;
    confidence: number;
    warmLightpanda: boolean;
  };
  steps: Array<{
    id: string;
    index: number;
    kind: string;
    text: string;
    route: string;
    backend: string;
    tool: string;
    status: string;
    ok: boolean;
    durationMs: number;
    summary: string;
    nextSafeAction: string;
    currentUrl: string;
    currentTitle: string;
    command: Record<string, unknown>;
    verification: Record<string, unknown> | null;
    extraction: Record<string, unknown>;
    filledFields: Array<Record<string, unknown>>;
    missingFields: Array<Record<string, unknown>>;
    scroll: Record<string, unknown> | null;
    screenshots: BrowserAgentScreenshot[];
    agents: Array<Record<string, unknown>>;
  }>;
  evidence: {
    facts: string[];
    screenshots: BrowserAgentScreenshot[];
    latestScroll: Record<string, unknown> | null;
    finalObservation: BrowserAgentObservation;
    filledFields: Array<Record<string, unknown>>;
    missingFields: Array<Record<string, unknown>>;
  };
  trace: Array<Record<string, unknown>>;
  raw: {
    hasRawResult: boolean;
    hasStepResults: boolean;
    imageDataIncluded: boolean;
  };
}

export interface BrowserAgentStatusReport {
  reportVersion: "browser-agent-status-report/v1" | string;
  generatedAt: string;
  ok: boolean;
  status: string;
  sessionId: string;
  route: string;
  backend: string;
  current: { url: string; title: string };
  lastInstruction: string;
  lastCommand: Record<string, unknown>;
  finalObservation: BrowserAgentObservation;
  history: Array<Record<string, unknown>>;
  runtime?: BrowserAgentStatus["runtime"] | null;
  browserHealth?: Record<string, unknown> | null;
}

export interface BrowserAgentRunResult {
  ok: boolean;
  status: string;
  route?: string;
  summary?: string;
  nextSafeAction?: string;
  currentUrl?: string;
  currentTitle?: string;
  requiredUserInput?: boolean;
  uiReport?: BrowserAgentUiReport;
  runtimeTiming?: Record<string, unknown>;
  tokenUsage?: Record<string, unknown>;
  stepResults?: Array<Record<string, unknown>>;
  agentTrace?: Array<Record<string, unknown>>;
  error?: string;
}

export interface BrowserAgentSessionSummary {
  sessionId: string;
  currentUrl?: string;
  currentTitle?: string;
  route?: string;
  routeEngine?: string;
  lastInstruction?: string;
  summary?: string;
  status?: string;
  updatedAt?: string;
  historyCount?: number;
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data as T;
}

function parseMcpResultPayload<T>(payload: unknown): T {
  if (typeof payload !== "string") return payload as T;
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return payload as T;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return payload as T;
  }
}

async function callMcpJson<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/mcp/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false || data.ok === false) {
    throw new Error(data.error || `MCP tool failed: ${name}`);
  }
  return parseMcpResultPayload<T>(data.result);
}

export function normalizeBrowserUrl(input: string) {
  const raw = input.trim();
  if (!raw) return "";
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) return raw;
  return `https://${raw}`;
}

export async function getLightpandaStatus(): Promise<LightpandaStatus> {
  return readJson<LightpandaStatus>("/api/browser/status");
}

export async function navigateLightpanda(url: string, waitMs = 1200): Promise<LightpandaPageResult> {
  return readJson<LightpandaPageResult>("/api/browser/navigate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: normalizeBrowserUrl(url), waitMs }),
  });
}

export async function openHeadfulBrowser(url: string): Promise<Record<string, unknown>> {
  return readJson<Record<string, unknown>>("/api/browser/open-headful", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: normalizeBrowserUrl(url || "about:blank") }),
  });
}

export async function getPlaywrightMcpStatus(): Promise<PlaywrightMcpStatus> {
  return callMcpJson<PlaywrightMcpStatus>("mcp__ops__playwright_mcp_status");
}

export async function startPlaywrightMcp(): Promise<{ ok?: boolean; tools?: unknown[]; error?: string }> {
  return callMcpJson<{ ok?: boolean; tools?: unknown[]; error?: string }>(
    "mcp__ops__external_mcp_refresh",
    { serverId: "playwright" },
  );
}

export async function navigatePlaywright(url: string): Promise<PlaywrightMcpResult> {
  return callMcpJson<PlaywrightMcpResult>(
    "mcp__playwright__browser_navigate",
    { url: normalizeBrowserUrl(url) },
  );
}

export async function snapshotPlaywright(): Promise<PlaywrightMcpResult> {
  return callMcpJson<PlaywrightMcpResult>("mcp__playwright__browser_snapshot", {});
}

export async function screenshotPlaywright(): Promise<PlaywrightMcpResult> {
  return callMcpJson<PlaywrightMcpResult>(
    "mcp__playwright__browser_take_screenshot",
    { type: "png" },
  );
}

export async function getBrowserAgentStatus(sessionId?: string, model?: string): Promise<BrowserAgentStatus> {
  const params = new URLSearchParams();
  if (sessionId) params.set("sessionId", sessionId);
  if (model) params.set("model", model);
  const query = params.toString() ? `?${params.toString()}` : "";
  return readJson<BrowserAgentStatus>(`/api/browser-agent/status${query}`);
}

export async function getBrowserAgentSessions(): Promise<BrowserAgentSessionSummary[]> {
  return readJson<BrowserAgentSessionSummary[]>("/api/browser-agent/sessions");
}

export async function createBrowserAgentSession(sessionId?: string, model?: string): Promise<BrowserAgentStatus> {
  return readJson<BrowserAgentStatus>("/api/browser-agent/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(sessionId ? { sessionId } : {}), ...(model ? { model } : {}) }),
  });
}

export async function runBrowserAgent(args: {
  instruction: string;
  sessionId?: string;
  route?: "playwright" | "lightpanda" | "auto" | string;
  currentUrl?: string;
  currentTitle?: string;
  includeImages?: boolean;
  model?: string;
}): Promise<BrowserAgentRunResult> {
  return readJson<BrowserAgentRunResult>("/api/browser-agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

export async function notifyBrowserAgentNavigation(args: {
  sessionId?: string;
  currentUrl: string;
  currentTitle?: string;
  textPreview?: string;
  stats?: Record<string, number | string>;
  instruction?: string;
  model?: string;
}): Promise<BrowserAgentStatus> {
  return readJson<BrowserAgentStatus>("/api/browser-agent/navigation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

export async function resetBrowserAgent(sessionId?: string): Promise<BrowserAgentStatus> {
  return readJson<BrowserAgentStatus>("/api/browser-agent/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessionId ? { sessionId } : {}),
  });
}

export async function getServiceStatus(): Promise<ServiceStatus> {
  return readJson<ServiceStatus>("/api/services/status");
}
