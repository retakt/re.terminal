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

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data as T;
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
  return data.result as T;
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

export async function getServiceStatus(): Promise<ServiceStatus> {
  return readJson<ServiceStatus>("/api/services/status");
}
