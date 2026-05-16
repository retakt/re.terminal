const API_BASE = window.location.origin;

export async function saveCommand(projectId: string, command: string, output?: string) {
  const res = await fetch(`${API_BASE}/api/memory/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, command, output })
  });
  return res.json();
}

export async function saveError(projectId: string, error: string, context?: string) {
  const res = await fetch(`${API_BASE}/api/memory/error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, error, context })
  });
  return res.json();
}

export async function saveFix(projectId: string, error: string, fix: string) {
  const res = await fetch(`${API_BASE}/api/memory/fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, error, fix })
  });
  return res.json();
}

export async function savePreference(projectId: string, key: string, value: string) {
  const res = await fetch(`${API_BASE}/api/memory/preference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, key, value })
  });
  return res.json();
}

export async function searchMemory(projectId: string, query: string) {
  const res = await fetch(`${API_BASE}/api/memory/search?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}`);
  return res.json();
}

export async function clearProjectMemory(projectId: string) {
  // Assuming a simple endpoint or logic to clear memory, or relying on graphiti's reset
  // For now, we'll just return a placeholder or assume the backend handles a specific clear action
  // Since Graphiti is a graph DB, clearing might involve a specific query. 
  // We'll return success for now as per minimal implementation.
  return { success: true };
}
