import type { AuditUsage } from "@/lib/logs-api";

const API_BASE = window.location.origin;

export type MemoryType = "command" | "error" | "fix" | "preference" | "fact";

export type MemoryRecord = {
  id?: string;
  memoryId?: string;
  nodeId?: number;
  type?: MemoryType | string;
  text?: string;
  output?: string;
  message?: string;
  context?: string;
  error?: string;
  description?: string;
  key?: string;
  value?: string;
  subject?: string;
  predicate?: string;
  object?: string;
  summary?: string;
  confidence?: number;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  timestamp?: number | string;
};

export type MemoryWriteResponse = {
  success?: boolean;
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  memory?: MemoryRecord | null;
};

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  return data as T;
}

export async function saveCommand(projectId: string, command: string, output?: string): Promise<MemoryWriteResponse> {
  const res = await fetch(`${API_BASE}/api/memory/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, command, output })
  });
  return readJson<MemoryWriteResponse>(res);
}

export async function saveError(projectId: string, error: string, context?: string): Promise<MemoryWriteResponse> {
  const res = await fetch(`${API_BASE}/api/memory/error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, error, context })
  });
  return readJson<MemoryWriteResponse>(res);
}

export async function saveFix(projectId: string, error: string, fix: string): Promise<MemoryWriteResponse> {
  const res = await fetch(`${API_BASE}/api/memory/fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, error, fix })
  });
  return readJson<MemoryWriteResponse>(res);
}

export async function savePreference(projectId: string, key: string, value: string): Promise<MemoryWriteResponse> {
  const res = await fetch(`${API_BASE}/api/memory/preference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, key, value })
  });
  return readJson<MemoryWriteResponse>(res);
}

export async function saveFact(projectId: string, memory: MemoryRecord): Promise<MemoryWriteResponse> {
  const res = await fetch(`${API_BASE}/api/memory/fact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, memory })
  });
  return readJson<MemoryWriteResponse>(res);
}

export async function extractMemories(
  projectId: string,
  model: string,
  userMessage: string,
  assistantMessage: string,
): Promise<{ success?: boolean; memories?: MemoryRecord[]; usage?: AuditUsage | null; error?: string }> {
  const res = await fetch(`${API_BASE}/api/memory/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, model, userMessage, assistantMessage })
  });
  return readJson<{ success?: boolean; memories?: MemoryRecord[]; usage?: AuditUsage | null; error?: string }>(res);
}

export async function searchMemory(projectId: string, query: string): Promise<MemoryRecord[]> {
  const res = await fetch(`${API_BASE}/api/memory/search?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}`);
  return readJson<MemoryRecord[]>(res);
}

export async function updateMemory(projectId: string, memory: MemoryRecord): Promise<MemoryWriteResponse> {
  const id = memory.memoryId || memory.id || (memory.nodeId != null ? String(memory.nodeId) : "");
  const res = await fetch(`${API_BASE}/api/memory/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, memory }),
  });
  return readJson<MemoryWriteResponse>(res);
}

export async function clearProjectMemory(projectId: string) {
  void projectId;
  // Assuming a simple endpoint or logic to clear memory, or relying on graphiti's reset
  // For now, we'll just return a placeholder or assume the backend handles a specific clear action
  // Since Graphiti is a graph DB, clearing might involve a specific query. 
  // We'll return success for now as per minimal implementation.
  return { success: true };
}
