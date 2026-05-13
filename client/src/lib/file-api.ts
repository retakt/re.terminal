/**
 * File API client — talks to the server's /api/* endpoints.
 * Always connects to port 3003 regardless of what port the frontend is on.
 */

const BASE = (() => {
  const proto = window.location.protocol;
  const host  = window.location.hostname;
  // For tmux.retakt.cc, use Caddy's reverse proxy (no port)
  if (host === "tmux.retakt.cc") {
    return `${proto}//${host}`;
  }
  return `${proto}//${host}:3003`;
})();

export interface FileEntry {
  name: string;
  type: "file" | "dir";
  path: string;
}

export interface DirListing {
  path:  string;
  items: FileEntry[];
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    throw new Error(`file api unreachable — got HTML from ${BASE}${url}`);
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

export const fileApi = {
  list:   (path: string)                 => req<DirListing>("GET",    `/api/files?path=${encodeURIComponent(path)}`),
  read:   (path: string)                 => req<{ path: string; content: string }>("GET", `/api/file?path=${encodeURIComponent(path)}`),
  write:  (path: string, content: string)=> req<{ ok: boolean }>("PUT",    "/api/file",   { path, content }),
  delete: (path: string)                 => req<{ ok: boolean }>("DELETE", `/api/file?path=${encodeURIComponent(path)}`),
  mkdir:  (path: string)                 => req<{ ok: boolean }>("POST",   "/api/mkdir",  { path }),
  rename: (from: string, to: string)     => req<{ ok: boolean }>("POST",   "/api/rename", { from, to }),
};
