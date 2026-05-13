/**
 * AppContext — manages the tab/page system.
 * Pages are persisted to localStorage so they survive refresh.
 * Terminal pages are restored by matching against the server's session-list.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type PageType = "terminal" | "editor" | "files";

export interface TerminalPage {
  id:        string;
  type:      "terminal";
  sessionId: string;
  title:     string;
}

export interface EditorPage {
  id:       string;
  type:     "editor";
  filePath: string;
  title:    string;
  dirty:    boolean;
}

export interface FilesPage {
  id:    string;
  type:  "files";
  title: string;
  dir:   string;
}

export type Page = TerminalPage | EditorPage | FilesPage;

export interface AppContextValue {
  pages:        Page[];
  activePageId: string | null;
  openTerminal: (sessionId: string, title: string) => void;
  openEditor:   (filePath: string, title?: string) => void;
  openFiles:    (dir?: string) => void;
  closePage:    (id: string) => void;
  switchPage:   (id: string) => void;
  markDirty:    (id: string, dirty: boolean) => void;
  updateDir:    (id: string, dir: string) => void;
  setTerminalCloser: (fn: (sessionId: string) => void) => void;
}

const Ctx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be inside <AppProvider>");
  return ctx;
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const PAGES_KEY  = "reterm_pages";
const ACTIVE_KEY = "reterm_active";

function loadPages(): Page[] {
  try {
    const raw = localStorage.getItem(PAGES_KEY);
    if (!raw) return [];
    const pages = JSON.parse(raw) as Page[];
    // Strip dirty flag and terminal pages (terminals restored from server)
    return pages
      .filter(p => p.type !== "terminal")
      .map(p => p.type === "editor" ? { ...p, dirty: false } : p);
  } catch { return []; }
}

function savePages(pages: Page[], activeId: string | null) {
  try {
    // Don't persist terminal pages — they come from the server
    const toSave = pages.filter(p => p.type !== "terminal");
    localStorage.setItem(PAGES_KEY, JSON.stringify(toSave));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch (_) {}
}

function loadActiveId(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [pages,        setPages]        = useState<Page[]>(() => loadPages());
  const [activePageId, setActivePageId] = useState<string | null>(() => loadActiveId());

  // Callback injected by TerminalPage to kill PTY when terminal tab closes
  const onCloseTerminalRef = useRef<((sessionId: string) => void) | null>(null);

  useEffect(() => {
    savePages(pages, activePageId);
  }, [pages, activePageId]);

  const openTerminal = useCallback((sessionId: string, title: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "terminal" && p.sessionId === sessionId);
      if (existing) { setActivePageId(existing.id); return prev; }
      const page: TerminalPage = { id: uid(), type: "terminal", sessionId, title };
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, []);

  const openEditor = useCallback((filePath: string, title?: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "editor" && p.filePath === filePath);
      if (existing) { setActivePageId(existing.id); return prev; }
      const name = title || filePath.split(/[/\\]/).pop() || filePath;
      const page: EditorPage = { id: uid(), type: "editor", filePath, title: name, dirty: false };
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, []);

  const openFiles = useCallback((dir = "/") => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "files");
      if (existing) { setActivePageId(existing.id); return prev; }
      const page: FilesPage = { id: uid(), type: "files", title: "files", dir };
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, []);

  const closePage = useCallback((id: string) => {
    setPages(prev => {
      const page = prev.find(p => p.id === id);
      // If closing a terminal tab, kill the PTY on the server
      if (page?.type === "terminal") {
        onCloseTerminalRef.current?.(page.sessionId);
      }
      const idx  = prev.findIndex(p => p.id === id);
      const next = prev.filter(p => p.id !== id);
      setActivePageId(cur => {
        if (cur !== id) return cur;
        if (next.length === 0) return null;
        return next[Math.min(idx, next.length - 1)].id;
      });
      return next;
    });
  }, []);

  const switchPage = useCallback((id: string) => {
    setActivePageId(id);
  }, []);

  const markDirty = useCallback((id: string, dirty: boolean) => {
    setPages(prev => prev.map(p =>
      p.id === id && p.type === "editor" ? { ...p, dirty } : p
    ));
  }, []);

  const updateDir = useCallback((id: string, dir: string) => {
    setPages(prev => prev.map(p =>
      p.id === id && p.type === "files" ? { ...p, dir } : p
    ));
  }, []);

  const setTerminalCloser = useCallback((fn: (sessionId: string) => void) => {
    onCloseTerminalRef.current = fn;
  }, []);

  return (
    <Ctx.Provider value={{
      pages, activePageId,
      openTerminal, openEditor, openFiles,
      closePage, switchPage, markDirty, updateDir,
      setTerminalCloser,
    }}>
      {children}
    </Ctx.Provider>
  );
}
