/**
 * re.Term — Terminal Context
 *
 * Sessions are persistent on the server — they survive page refreshes.
 * On connect the server sends "session-list" with all live sessions.
 * The client attaches to each one to receive output.
 */

import React, {
  createContext, useCallback, useContext,
  useEffect, useRef, useState,
} from "react";
import type { Terminal as XTerminal } from "@xterm/xterm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Session {
  id:    string;
  title: string;
  cols:  number;
  rows:  number;
  cwd?:  string;
}

export type ConnectionStatus =
  "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

export interface TerminalContextValue {
  status:          ConnectionStatus;
  connect:         (password: string) => Promise<void>;
  disconnect:      () => void;
  hasSessionList:  boolean;
  sessions:        Session[];
  activeSessionId: string | null;
  createSession:   (title?: string) => void;
  closeSession:    (id: string) => void;
  switchSession:   (id: string) => void;
  renameSession:   (id: string, title: string) => void;
  registerXterm:   (sessionId: string, xterm: XTerminal) => void;
  unregisterXterm: (sessionId: string) => void;
  getXterm:        (sessionId: string) => XTerminal | undefined;
  sendInput:       (sessionId: string, data: string) => void;
  sendResize:      (sessionId: string, cols: number, rows: number) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const Ctx = createContext<TerminalContextValue | null>(null);

export function useTerminal(): TerminalContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTerminal must be inside <TerminalProvider>");
  return ctx;
}

// ─── Constants ────────────────────────────────────────────────────────────────

function getWsUrl(): string {
  const defaultUrl =
    window.location.protocol === "https:"
      ? `wss://${window.location.host}`
      : `ws://${window.location.hostname}:3003`;

  const rawUrl =
    import.meta.env.VITE_TERMINAL_WS_URL ||
    import.meta.env.VITE_WS_URL ||
    defaultUrl;

  try {
    const url = new URL(rawUrl, window.location.href);

    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";

    if (url.pathname === "/api" || url.pathname === "/api/") {
      url.pathname = "/";
    } else if (url.pathname.endsWith("/api")) {
      url.pathname = url.pathname.slice(0, -4) || "/";
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const SESSION_KEY      = "reterm_session";

function writeXtermSafely(xterm: XTerminal | undefined, data: string, reset = false) {
  if (!xterm || !data) return;

  requestAnimationFrame(() => {
    try {
      if (reset) xterm.reset();
      xterm.write(data);
    } catch (error) {
      window.setTimeout(() => {
        try {
          if (reset) xterm.reset();
          xterm.write(data);
        } catch {
          // xterm renderer can briefly be unavailable during mount/resize.
        }
      }, 30);
    }
  });
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const [status,          setStatus]          = useState<ConnectionStatus>("idle");
  const [sessions,        setSessions]        = useState<Session[]>([]);
  const [hasSessionList,  setHasSessionList]  = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const wsRef          = useRef<WebSocket | null>(null);
  const passwordRef    = useRef("");
  const retryRef       = useRef(0);
  const retryTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef     = useRef(true);
  const pendingResolve = useRef<(() => void) | null>(null);
  const pendingReject  = useRef<((e: Error) => void) | null>(null);
  const xtermsRef      = useRef<Map<string, XTerminal>>(new Map());

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const sendMsg = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const closeWs = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try { ws.close(); } catch (_) {}
    wsRef.current = null;
  }, []);

  // ── Message handler ───────────────────────────────────────────────────────────

  const handleMessage = useCallback((event: MessageEvent) => {
    if (!mountedRef.current) return;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(event.data as string); } catch { return; }

    switch (msg.type) {

      case "ready": {
        retryRef.current = 0;
        setStatus("connected");
        if (pendingResolve.current) { pendingResolve.current(); pendingResolve.current = null; }
        try { sessionStorage.setItem(SESSION_KEY, passwordRef.current); } catch (_) {}
        break;
      }

      // Server sends the full list of live sessions on connect
      case "session-list": {
        const list = (msg.sessions as Session[]) || [];
        setHasSessionList(true);
        setSessions(list);
        // Auto-select first session
        if (list.length > 0) {
          setActiveSessionId(prev => prev ?? list[0].id);
        }
        // Attach to all existing sessions so we receive their output
        for (const s of list) {
          sendMsg({ type: "attach", sessionId: s.id });
        }
        break;
      }

      case "session-created": {
        const { sessionId, title, cols, rows } = msg as {
          sessionId: string; title: string; cols: number; rows: number;
        };
        setSessions(prev => {
          if (prev.find(s => s.id === sessionId)) return prev;
          return [...prev, { id: sessionId, title, cols, rows }];
        });
        // Auto-select if this is the first session
        setActiveSessionId(prev => prev ?? sessionId);
        // Attach to receive output
        sendMsg({ type: "attach", sessionId });
        break;
      }

      case "session-closed": {
        const { sessionId } = msg as { sessionId: string };
        setSessions(prev => prev.filter(s => s.id !== sessionId));
        setActiveSessionId(prev => prev === sessionId ? null : prev);
        break;
      }

      case "session-renamed": {
        const { sessionId, title } = msg as { sessionId: string; title: string };
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title } : s));
        break;
      }

      case "session-resized": {
        const { sessionId, cols, rows } = msg as { sessionId: string; cols: number; rows: number };
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, cols, rows } : s));
        break;
      }

      case "output": {
        const { sessionId, data } = msg as { sessionId: string; data: string };
        writeXtermSafely(xtermsRef.current.get(sessionId), data);
        break;
      }

      case "history": {
        const { sessionId, data } = msg as { sessionId: string; data: string };
        writeXtermSafely(xtermsRef.current.get(sessionId), data, true);
        break;
      }

      case "session-exit":
        // PTY exited — keep tab open so user sees the message
        break;

      case "error": {
        const { code } = msg as { code: string };
        if (code === "AUTH_FAILED") {
          try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
          setStatus("disconnected");
          if (pendingReject.current) {
            pendingReject.current(new Error("Authentication failed"));
            pendingReject.current = null;
          }
        }
        break;
      }

      case "pong":
        break;
    }
  }, [sendMsg]);

  // ── Connect ───────────────────────────────────────────────────────────────────

  const connect = useCallback((password: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!mountedRef.current) { reject(new Error("Unmounted")); return; }

      clearRetry();
      closeWs();

      passwordRef.current = password;
      setStatus("connecting");
      // Don't clear sessions here — we'll get the real list from server
      setSessions([]);
      setHasSessionList(false);
      setActiveSessionId(null);

      pendingResolve.current = resolve;
      pendingReject.current  = reject;

      const wsUrl = new URL(getWsUrl(), window.location.href);
      wsUrl.searchParams.set("password", password);
      const ws = new WebSocket(wsUrl.toString());
      wsRef.current = ws;

      ws.onopen    = () => { /* wait for "ready" */ };
      ws.onmessage = handleMessage;
      ws.onerror   = () => { if (wsRef.current !== ws) return; };

      ws.onclose = (ev) => {
        if (!mountedRef.current || wsRef.current !== ws) return;
        wsRef.current = null;

        if (ev.code === 4001) {
          try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
          setStatus("disconnected");
          if (pendingReject.current) { pendingReject.current(new Error("Authentication failed")); pendingReject.current = null; }
          return;
        }

        if (pendingReject.current) {
          pendingReject.current(new Error("Connection failed"));
          pendingReject.current = pendingResolve.current = null;
          setStatus("disconnected");
          return;
        }

        // Auto-reconnect
        setStatus("reconnecting");
        const delay = RECONNECT_DELAYS[Math.min(retryRef.current, RECONNECT_DELAYS.length - 1)];
        retryRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect(password).catch(() => {});
        }, delay);
      };
    });
  }, [clearRetry, closeWs, handleMessage]);

  // ── Disconnect ────────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    clearRetry();
    closeWs();
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
    setSessions([]);
    setHasSessionList(false);
    setActiveSessionId(null);
    setStatus("idle");
    retryRef.current = 0;
  }, [clearRetry, closeWs]);

  // ── Session ops ───────────────────────────────────────────────────────────────

  const createSession = useCallback((title?: string) => {
    sendMsg({ type: "create", data: { title: title || `terminal ${Date.now()}` } });
  }, [sendMsg]);

  const closeSession = useCallback((id: string) => {
    sendMsg({ type: "close", sessionId: id });
  }, [sendMsg]);

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const renameSession = useCallback((id: string, title: string) => {
    sendMsg({ type: "rename", sessionId: id, data: { title } });
  }, [sendMsg]);

  // ── xterm registration ────────────────────────────────────────────────────────

  const registerXterm = useCallback((sessionId: string, xterm: XTerminal) => {
    xtermsRef.current.set(sessionId, xterm);
    // Request history replay (attach was already sent on session-list/session-created)
    sendMsg({ type: "history", sessionId });
  }, [sendMsg]);

  const unregisterXterm = useCallback((sessionId: string) => {
    xtermsRef.current.delete(sessionId);
  }, []);

  const getXterm = useCallback((sessionId: string) => {
    return xtermsRef.current.get(sessionId);
  }, []);

  // ── Input / resize ────────────────────────────────────────────────────────────

  const sendInput = useCallback((sessionId: string, data: string) => {
    sendMsg({ type: "input", sessionId, data });
  }, [sendMsg]);

  const sendResize = useCallback((sessionId: string, cols: number, rows: number) => {
    sendMsg({ type: "resize", sessionId, data: { cols, rows } });
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, cols, rows } : s));
  }, [sendMsg]);

  // ── Auto-switch when active session closes ────────────────────────────────────

  useEffect(() => {
    if (activeSessionId === null && sessions.length > 0) {
      setActiveSessionId(sessions[sessions.length - 1].id);
    }
  }, [activeSessionId, sessions]);

  // ── Auto-connect from stored session ─────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) connect(stored).catch(() => {});
    } catch (_) {}
    return () => {
      mountedRef.current = false;
      clearRetry();
      closeWs();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keepalive ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(() => sendMsg({ type: "ping" }), 30000);
    return () => clearInterval(id);
  }, [status, sendMsg]);

  return (
    <Ctx.Provider value={{
      status, connect, disconnect,
      hasSessionList,
      sessions, activeSessionId,
      createSession, closeSession, switchSession, renameSession,
      registerXterm, unregisterXterm, getXterm,
      sendInput, sendResize,
    }}>
      {children}
    </Ctx.Provider>
  );
}
