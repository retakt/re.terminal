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
}

export interface McpTool {
  name: string;
  serverId: string;
  serverTitle: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
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

export interface McpRoute {
  answer_directly: boolean;
  must_call_tools: boolean;
  tool_candidates: Array<{ name: string; arguments: Record<string, unknown> }>;
  risk: "low" | "medium" | "high" | string;
  reason: string;
}

async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(url);
    if (!response.ok) return fallback;
    return response.json();
  } catch {
    return fallback;
  }
}

export async function listMcpServers(): Promise<McpServer[]> {
  const data = await getJson<{ servers: McpServer[] }>("/api/mcp/servers", { servers: [] });
  return data.servers ?? [];
}

export async function listMcpTools(): Promise<McpTool[]> {
  const data = await getJson<{ tools: McpTool[] }>("/api/mcp/tools", { tools: [] });
  return data.tools ?? [];
}

export async function listMcpToolDefinitions(): Promise<OllamaTool[]> {
  const data = await getJson<{ tools: OllamaTool[] }>("/api/mcp/tool-definitions", { tools: [] });
  return data.tools ?? [];
}

export async function listMcpLogs(): Promise<McpLog[]> {
  const data = await getJson<{ logs: McpLog[] }>("/api/mcp/logs", { logs: [] });
  return data.logs ?? [];
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

export async function routeMcpIntent(text: string, projectId: string): Promise<McpRoute | null> {
  try {
    const response = await fetch("/api/mcp/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, projectId }),
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
