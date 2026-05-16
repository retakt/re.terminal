/**
 * File API client over the terminal WebSocket.
 * Uses the same password/session storage as the terminal connection.
 */

const SESSION_KEY = "reterm_session";
const REQUEST_TIMEOUT_MS = 30_000;

function getWsUrl(): string {
  if (import.meta.env.VITE_TERMINAL_WS_URL) {
    return import.meta.env.VITE_TERMINAL_WS_URL;
  }
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.hostname}:3003`;
}

function withPassword(url: string, password: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}password=${encodeURIComponent(password)}`;
}

export interface FileEntry {
  name: string;
  type: "file" | "dir";
  path: string;
}

export interface DirListing {
  path: string;
  items: FileEntry[];
}

export interface BinaryFileData {
  path: string;
  mime: string;
  size: number;
  contentBase64: string;
}

type FileAction =
  | "list"
  | "read"
  | "readBinary"
  | "write"
  | "delete"
  | "mkdir"
  | "rename";

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

let socket: WebSocket | null = null;
let readyPromise: Promise<void> | null = null;
let resolveReady: (() => void) | null = null;
let rejectReady: ((error: Error) => void) | null = null;
const pending = new Map<string, PendingRequest<unknown>>();

function rejectAll(error: Error) {
  for (const [requestId, request] of pending) {
    clearTimeout(request.timeout);
    request.reject(error);
    pending.delete(requestId);
  }
}

function resetSocket(error?: Error) {
  if (error) rejectAll(error);
  socket = null;
  readyPromise = null;
  resolveReady = null;
  rejectReady = null;
}

function ensureSocket(): Promise<void> {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (socket?.readyState === WebSocket.CONNECTING && readyPromise) return readyPromise;

  const password = sessionStorage.getItem(SESSION_KEY);
  if (!password) {
    return Promise.reject(new Error("not connected"));
  }

  socket = new WebSocket(withPassword(getWsUrl(), password));
  readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  socket.onmessage = (event) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    if (msg.type === "ready") {
      resolveReady?.();
      resolveReady = null;
      rejectReady = null;
      return;
    }

    if (msg.type === "error" && msg.code === "AUTH_FAILED") {
      const error = new Error("Authentication failed");
      rejectReady?.(error);
      resetSocket(error);
      return;
    }

    if (msg.type !== "file-response") return;

    const requestId = String(msg.requestId || "");
    const request = pending.get(requestId);
    if (!request) return;

    clearTimeout(request.timeout);
    pending.delete(requestId);

    if (msg.ok) {
      request.resolve(msg.result);
    } else {
      request.reject(new Error(String(msg.error || "file request failed")));
    }
  };

  socket.onerror = () => {
    const error = new Error("file websocket failed");
    rejectReady?.(error);
    resetSocket(error);
  };

  socket.onclose = () => {
    resetSocket(new Error("file websocket closed"));
  };

  return readyPromise;
}

async function request<T>(action: FileAction, data: Record<string, unknown>): Promise<T> {
  await ensureSocket();

  const ws = socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("file websocket is not open");
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("file request timed out"));
    }, REQUEST_TIMEOUT_MS);

    pending.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
    });

    ws.send(JSON.stringify({
      type: "file",
      requestId,
      data: { action, ...data },
    }));
  });
}

export const fileApi = {
  list: (path: string) =>
    request<DirListing>("list", { path }),
  read: (path: string) =>
    request<{ path: string; content: string }>("read", { path }),
  readBinary: (path: string) =>
    request<BinaryFileData>("readBinary", { path }),
  write: (path: string, content: string) =>
    request<{ ok: boolean }>("write", { path, content }),
  delete: (path: string) =>
    request<{ ok: boolean }>("delete", { path }),
  mkdir: (path: string) =>
    request<{ ok: boolean }>("mkdir", { path }),
  rename: (from: string, to: string) =>
    request<{ ok: boolean }>("rename", { from, to }),
};
