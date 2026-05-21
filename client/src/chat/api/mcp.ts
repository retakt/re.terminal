import type { OllamaTool } from "./ollama";

export interface McpServer {
  id: string;
  title: string;
  type: string;
  transport: string;
  enabled: boolean;
  description: string;
  status: "ready" | "needs_config" | "error" | string;
  toolCount: number;
  responseMs?: number | null;
  // Metadata for UI classification
  source?: "builtin" | "external";
  mcpNative?: boolean;
  external?: boolean;
  protocol?: string;
  connected?: boolean;
}

export interface McpTool {
  name: string;
  serverId: string;
  serverTitle: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  // Metadata for UI classification
  source?: "builtin" | "external";
  external?: boolean;
  mcpNative?: boolean;
}

export interface McpLog {
  id: string;
  tool: string;
  serverId: string;
  args: Record<string, unknown>;
  status: "running" | "complete" | "error";
  startedAt: number;
  durationMs: number;
  result: string;
}

export interface ExtensionCatalogItem {
  name: string;
  type: string;
  target: string;
  risk: "low" | "medium" | "high" | string;
  source: string;
  description: string;
}

export interface BrowserExtensionAction {
  id: string;
  label: string;
  kind: string;
  pageKey: string;
  requiresConfirmation: boolean;
  observedOnly: boolean;
}

export interface BrowserExtension {
  id: string;
  skillId: string;
  type: string;
  name: string;
  enabled: boolean;
  version: string;
  domains: string[];
  description: string;
  source: string;
  updatedAt: string;
  permissions: string[];
  dangerousActions: string[];
  rules: string[];
  actions: BrowserExtensionAction[];
  pages: string[];
}

export interface McpRoute {
  answer_directly: boolean;
  must_call_tools: boolean;
  tool_candidates: Array<{ name: string; arguments: Record<string, unknown> }>;
  risk: "low" | "medium" | "high" | string;
  confidence?: number;
  reason: string;
}
// Result type for API calls that can fail
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function getJson<T>(url: string, fallback: T): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }
    const data = await response.json();
    return { ok: true, data: data as T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: message };
  }
}

export async function listMcpServers(): Promise<ApiResult<McpServer[]>> {
  const result = await getJson<McpServer[] | { servers: McpServer[] }>("/api/mcp/servers", []);
  if (!result.ok) return result;
  const payload = result.data;
  return { ok: true, data: Array.isArray(payload) ? payload : payload.servers ?? [] };
}

export async function listMcpTools(): Promise<ApiResult<McpTool[]>> {
  const result = await getJson<McpTool[] | { tools: McpTool[] }>("/api/mcp/tools", []);
  if (!result.ok) return result;
  const payload = result.data;
  return { ok: true, data: Array.isArray(payload) ? payload : payload.tools ?? [] };
}

export async function listMcpToolDefinitions(): Promise<ApiResult<OllamaTool[]>> {
  const result = await getJson<OllamaTool[] | { tools: OllamaTool[] }>("/api/mcp/tool-definitions", []);
  if (!result.ok) return result;
  const payload = result.data;
  return { ok: true, data: Array.isArray(payload) ? payload : payload.tools ?? [] };
}

export async function listMcpLogs(): Promise<ApiResult<McpLog[]>> {
  const result = await getJson<{ logs: McpLog[] }>("/api/mcp/logs", { logs: [] });
  if (!result.ok) return result;
  return { ok: true, data: result.data.logs ?? [] };
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const response = await fetch("/api/mcp/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `MCP tool failed: ${name}`);
  }
  return typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2);
}

export async function routeMcpIntent(
  text: string,
  projectId: string,
  options: { mode?: string; currentUrl?: string } = {},
): Promise<McpRoute | null> {
  try {
    const response = await fetch("/api/mcp/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, projectId, ...options }),
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
export async function listExtensionCatalog(): Promise<ExtensionCatalogItem[]> {
  const data = await getJson<{ items: ExtensionCatalogItem[] }>("/api/extensions/catalog", { items: [] });
  return data.items ?? [];
}
export async function listBrowserExtensions(): Promise<BrowserExtension[]> {
  const data = await getJson<{ ok: boolean; extensions: BrowserExtension[] }>("/api/extensions", {
    ok: false,
    extensions: [],
  });

  return data.extensions ?? [];
}

export async function updateBrowserExtensionEnabled(id: string, enabled: boolean): Promise<BrowserExtension | null> {
  const body = JSON.stringify({ enabled });
  let response = await fetch(`/api/extensions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (response.status === 404 || response.status === 405) {
    response = await fetch(`/api/extensions/${encodeURIComponent(id)}/enabled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Failed to update extension ${id}`);
  }
  return data.extension ?? null;
}
