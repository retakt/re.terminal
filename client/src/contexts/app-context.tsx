/**
 * AppContext — manages the tab/page system.
 * Pages are persisted to localStorage so they survive refresh.
 * Terminal pages are restored by matching against the server's session-list.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getBaseName, getViewerKind, type ProgramKind } from "@/lib/file-routing";

export type PageType =
  | "terminal"
  | "files"
  | "editor"
  | "image"
  | "pdf"
  | "spreadsheet"
  | "doc"
  | ProgramKind;

export interface TerminalPage {
  id: string;
  type: "terminal";
  sessionId: string;
  title: string;
}

export interface FilesPage {
  id: string;
  type: "files";
  title: string;
  dir: string;
}

export interface EditorPage {
  id: string;
  type: "editor";
  filePath: string;
  title: string;
  dirty: boolean;
}

export interface ViewerPageBase {
  id: string;
  filePath: string;
  title: string;
}

export interface ImagePage extends ViewerPageBase {
  type: "image";
}

export interface PdfPage extends ViewerPageBase {
  type: "pdf";
}

export interface SpreadsheetPage extends ViewerPageBase {
  type: "spreadsheet";
}

export interface DocPage extends ViewerPageBase {
  type: "doc";
}

export interface ProgramPage {
  id: string;
  type: ProgramKind;
  title: string;
}

export type Page = TerminalPage | FilesPage | EditorPage | ImagePage | PdfPage | SpreadsheetPage | DocPage | ProgramPage;

export interface AppContextValue {
  pages: Page[];
  activePageId: string | null;
  openTerminal: (sessionId: string, title: string) => void;
  openFiles: (dir?: string) => void;
  openEditor: (filePath: string, title?: string) => void;
  openImage: (filePath: string, title?: string) => void;
  openPdf: (filePath: string, title?: string) => void;
  openSpreadsheet: (filePath: string, title?: string) => void;
  openDoc: (filePath: string, title?: string) => void;
  openProgram: (kind: ProgramKind, title?: string) => void;
  openPath: (filePath: string) => void;
  closePage: (id: string) => void;
  switchPage: (id: string) => void;
  markDirty: (id: string, dirty: boolean) => void;
  updateDir: (id: string, dir: string) => void;
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

const PAGES_KEY = "reterm_pages";
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
  } catch {
    return [];
  }
}

function savePages(pages: Page[], activeId: string | null) {
  try {
    // Don't persist terminal pages — they come from the server
    const toSave = pages.filter(p => p.type !== "terminal");
    localStorage.setItem(PAGES_KEY, JSON.stringify(toSave));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {}
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

const PROGRAM_TITLES: Record<ProgramKind, string> = {
  browser: "inside browser",
  chat: "ai chat",
  forum: "forum",
  community: "community",
};

function viewerTitle(filePath: string, title?: string) {
  return title || getBaseName(filePath);
}

function filePageTitle(filePath: string, title?: string) {
  return title || getBaseName(filePath);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [pages, setPages] = useState<Page[]>(() => loadPages());
  const [activePageId, setActivePageId] = useState<string | null>(() => loadActiveId());

  // Callback injected by TerminalPage to kill PTY when terminal tab closes
  const onCloseTerminalRef = useRef<((sessionId: string) => void) | null>(null);

  useEffect(() => {
    savePages(pages, activePageId);
  }, [pages, activePageId]);

  const openTerminal = useCallback((sessionId: string, title: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "terminal" && p.sessionId === sessionId);
      if (existing) {
        setActivePageId(existing.id);
        return prev;
      }
      const page: TerminalPage = { id: uid(), type: "terminal", sessionId, title };
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, []);

  const openFiles = useCallback((dir = "/") => {
    setPages(prev => {
      // Allow multiple files pages - always create a new one
      const page: FilesPage = {
        id: uid(),
        type: "files",
        title: `files ${prev.filter(p => p.type === "files").length + 1}`,
        dir,
      };
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, []);

  const openEditor = useCallback((filePath: string, title?: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "editor" && p.filePath === filePath);
      if (existing) {
        setActivePageId(existing.id);
        return prev;
      }
      const page: EditorPage = {
        id: uid(),
        type: "editor",
        filePath,
        title: filePageTitle(filePath, title),
        dirty: false,
      };
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, []);

  const openImage = useCallback((filePath: string, title?: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "image" && p.filePath === filePath);
      if (existing) {
        setActivePageId(existing.id);
        return prev;
      }
      const page: ImagePage = {
        id: uid(),
        type: "image",
        filePath,
        title: viewerTitle(filePath, title),
      };
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, []);

  const openPdf = useCallback((filePath: string, title?: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "pdf" && p.filePath === filePath);
      if (existing) {
        setActivePageId(existing.id);
        return prev;
      }
      const page: PdfPage = {
        id: uid(),
        type: "pdf",
        filePath,
        title: viewerTitle(filePath, title),
      };
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, []);

  const openSpreadsheet = useCallback((filePath: string, title?: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "spreadsheet" && p.filePath === filePath);
      if (existing) {
        setActivePageId(existing.id);
        return prev;
      }
      const page: SpreadsheetPage = {
        id: uid(),
        type: "spreadsheet",
        filePath,
        title: viewerTitle(filePath, title),
      };
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, []);

  const openDoc = useCallback((filePath: string, title?: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "doc" && p.filePath === filePath);
      if (existing) {
        setActivePageId(existing.id);
        return prev;
      }
      const page: DocPage = {
        id: uid(),
        type: "doc",
        filePath,
        title: viewerTitle(filePath, title),
      };
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, []);

  const openProgram = useCallback((kind: ProgramKind, title?: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === kind);
      if (existing) {
        setActivePageId(existing.id);
        return prev;
      }
      const page: ProgramPage = {
        id: uid(),
        type: kind,
        title: title || PROGRAM_TITLES[kind],
      };
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, []);

  const openPath = useCallback((filePath: string) => {
    const kind = getViewerKind(filePath);
    const title = getBaseName(filePath);
    switch (kind) {
      case "image":
        openImage(filePath, title);
        break;
      case "pdf":
        openPdf(filePath, title);
        break;
      case "spreadsheet":
        openSpreadsheet(filePath, title);
        break;
      case "doc":
        openDoc(filePath, title);
        break;
      default:
        openEditor(filePath, title);
        break;
    }
  }, [openDoc, openEditor, openImage, openPdf, openSpreadsheet]);

  const closePage = useCallback((id: string) => {
    setPages(prev => {
      const page = prev.find(p => p.id === id);
      // If closing a terminal tab, kill the PTY on the server
      if (page?.type === "terminal") {
        onCloseTerminalRef.current?.(page.sessionId);
      }
      const idx = prev.findIndex(p => p.id === id);
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
      pages,
      activePageId,
      openTerminal,
      openFiles,
      openEditor,
      openImage,
      openPdf,
      openSpreadsheet,
      openDoc,
      openProgram,
      openPath,
      closePage,
      switchPage,
      markDirty,
      updateDir,
      setTerminalCloser,
    }}>
      {children}
    </Ctx.Provider>
  );
}
