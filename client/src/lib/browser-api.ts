export interface LightpandaStatus {
  ok: boolean;
  status?: string;
  engine: string;
  cdpUrl?: string;
  durationMs?: number;
  error?: string;
  hint?: string;
  version?: Record<string, unknown>;
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
    links?: Array<{ text: string; href: string }>;
    forms?: Array<Record<string, unknown>>;
    stats?: Record<string, number>;
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

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data as T;
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

export async function getServiceStatus(): Promise<ServiceStatus> {
  return readJson<ServiceStatus>("/api/services/status");
}
