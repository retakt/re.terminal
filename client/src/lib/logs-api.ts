export interface AuditUsage {
  stage?: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs?: number;
  used?: boolean;
  reason?: string;
}

export interface AuditEvent {
  seq: number;
  id: string;
  ts: string;
  source: string;
  category: string;
  action: string;
  status: string;
  title: string;
  summary: string;
  refs: Record<string, unknown>;
  usage: AuditUsage | null;
  payload: unknown;
}

export interface AuditEventInput extends Partial<Pick<AuditEvent, "id" | "ts">> {
  source: string;
  category: string;
  action: string;
  status?: string;
  title: string;
  summary?: string;
  refs?: Record<string, unknown>;
  usage?: AuditUsage | null;
  payload?: unknown;
}

export interface AuditQueryResult {
  events: AuditEvent[];
  returned: number;
  limit: number;
  lastSeq: number;
  logFile?: string;
}

export interface AuditWriteResult {
  ok?: boolean;
  count?: number;
  appended?: AuditEvent[];
  logFile?: string;
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || `${response.status} ${response.statusText}`);
  }
  return data as T;
}

export function normalizeAuditUsage(
  value: unknown,
  defaults: Partial<AuditUsage> = {},
): AuditUsage | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as Record<string, unknown>;
  const watcher = usage.watcher && typeof usage.watcher === "object" ? usage.watcher as Record<string, unknown> : null;
  const mainModel = usage.mainModel && typeof usage.mainModel === "object" ? usage.mainModel as Record<string, unknown> : null;
  const promptTokens =
    Number(usage.promptTokens ?? usage.prompt_eval_count ?? 0)
    + Number(watcher?.promptTokens ?? 0)
    + Number(mainModel?.promptTokens ?? 0);
  const completionTokens =
    Number(usage.completionTokens ?? usage.eval_count ?? 0)
    + Number(watcher?.completionTokens ?? 0)
    + Number(mainModel?.completionTokens ?? 0);
  const totalTokens =
    Number(usage.totalTokens ?? usage.total_tokens ?? 0)
    + Number(watcher?.totalTokens ?? 0)
    + Number(mainModel?.totalTokens ?? 0)
    || (promptTokens + completionTokens);
  const model = String(usage.model ?? mainModel?.model ?? watcher?.model ?? defaults.model ?? "").trim();
  const stage = String(usage.stage ?? defaults.stage ?? "").trim();
  const normalized: AuditUsage = {
    stage,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
  };

  if (defaults.durationMs != null) normalized.durationMs = defaults.durationMs;
  if (usage.durationMs != null && Number.isFinite(Number(usage.durationMs))) normalized.durationMs = Number(usage.durationMs);
  if (usage.used != null) normalized.used = Boolean(usage.used);
  if (usage.reason != null) normalized.reason = String(usage.reason);

  if (!normalized.stage && !normalized.model && normalized.totalTokens === 0) {
    return null;
  }

  return normalized;
}

export function aggregateAuditUsage(
  values: Array<AuditUsage | null | undefined>,
  defaults: Partial<AuditUsage> = {},
): AuditUsage | null {
  const usable = values.filter(Boolean) as AuditUsage[];
  if (usable.length === 0) {
    if (!defaults.stage && !defaults.model) return null;
    return {
      stage: defaults.stage,
      model: defaults.model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      ...(defaults.durationMs != null ? { durationMs: defaults.durationMs } : {}),
    };
  }

  return {
    stage: defaults.stage || usable[usable.length - 1]?.stage || "",
    model: defaults.model || [...usable].reverse().find((entry) => entry.model)?.model || "",
    promptTokens: usable.reduce((sum, entry) => sum + Number(entry.promptTokens || 0), 0),
    completionTokens: usable.reduce((sum, entry) => sum + Number(entry.completionTokens || 0), 0),
    totalTokens: usable.reduce((sum, entry) => sum + Number(entry.totalTokens || 0), 0),
    ...(defaults.durationMs != null ? { durationMs: defaults.durationMs } : {}),
  };
}

export async function listAuditEvents(params: {
  afterSeq?: number;
  limit?: number;
  category?: string;
  status?: string;
  q?: string;
} = {}): Promise<AuditQueryResult> {
  const url = new URL("/api/logs/events", window.location.origin);
  if (params.afterSeq != null) url.searchParams.set("afterSeq", String(params.afterSeq));
  if (params.limit != null) url.searchParams.set("limit", String(params.limit));
  if (params.category) url.searchParams.set("category", params.category);
  if (params.status) url.searchParams.set("status", params.status);
  if (params.q) url.searchParams.set("q", params.q);
  return readJson<AuditQueryResult>(url.toString());
}

export async function postAuditEvents(events: AuditEventInput[]): Promise<AuditWriteResult | null> {
  return readJson<AuditWriteResult | null>("/api/logs/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ events }),
  });
}

export function emitAuditEvent(event: AuditEventInput | AuditEventInput[]) {
  const events = Array.isArray(event) ? event : [event];
  return postAuditEvents(events).catch(() => null);
}
