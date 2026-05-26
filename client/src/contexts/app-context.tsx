/**
 * AppContext — manages the tab/page system.
 * Pages are persisted to localStorage so they survive refresh.
 * Terminal pages are restored by matching against the server's session-list.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getBaseName, getViewerKind, type ProgramKind } from "@/lib/file-routing";
import { generateUUID } from "@/chat/engine/config";
import { emitAuditEvent, type AuditEventInput } from "@/lib/logs-api";

export type PageType =
  | "terminal"
  | "files"
  | "editor"
  | "image"
  | "pdf"
  | "spreadsheet"
  | "doc"
  | ProgramKind;

export interface PageMeta {
  id: string;
  title: string;
  pinned?: boolean;
}

export interface TerminalPage extends PageMeta {
  type: "terminal";
  sessionId: string;
}

export interface FilesPage extends PageMeta {
  type: "files";
  dir: string;
}

export interface EditorPage extends PageMeta {
  type: "editor";
  filePath: string;
}

export interface ViewerPageBase extends PageMeta {
  filePath: string;
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

export interface ProgramPage extends PageMeta {
  type: ProgramKind;
  sessionId?: string; // Unique session ID for isolated chat memories
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
  openProgram: (kind: ProgramKind, title?: string, options?: { sessionId?: string }) => string | undefined;
  openPath: (filePath: string) => void;
  closePage: (id: string) => void;
  switchPage: (id: string) => void;
  renamePage: (id: string, title: string) => void;
  reorderPage: (sourceId: string, targetId: string, placement?: "before" | "after") => void;
  togglePagePin: (id: string) => void;
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
    let migratedChatNumber = 1;
    return pages
      .filter(p => p.type !== "terminal")
      .map((page) => {
        if (page.type !== "chat") return page;
        const title = String(page.title || "").trim();
        const legacy = title.match(/^ai chat\s*(\d+)?$/i);
        const existing = title.match(/^session\s*#\s*(\d+)$/i);
        const sessionId = "sessionId" in page && page.sessionId ? page.sessionId : generateUUID();
        if (existing) {
          migratedChatNumber = Math.max(migratedChatNumber, Number(existing[1]) + 1);
          return { ...page, sessionId };
        }
        if (!legacy && title) return { ...page, sessionId };
        const number = legacy?.[1] ? Number(legacy[1]) : migratedChatNumber;
        migratedChatNumber = Math.max(migratedChatNumber, number + 1);
        return { ...page, sessionId, title: `session #${number}` };
      });
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
  browser: "browser",
  chat: "session",
  logs: "Logs",
  forum: "forum",
  community: "community",
  mcp: "mcp",
  extensions: "extensions",
  plugins: "plugins",
  scripts: "scripts",
  playground: "playground",
  "memory-graph": "memory graph",
};

function nextChatSessionTitle(pages: Page[]) {
  const maxNumber = pages
    .filter((page) => page.type === "chat")
    .reduce((max, page) => {
      const match = String(page.title || "").match(/(?:session\s*#|ai chat\s*)(\d+)/i);
      const number = match ? Number(match[1]) : 0;
      return Number.isFinite(number) ? Math.max(max, number) : max;
    }, 0);
  return `session #${maxNumber + 1}`;
}

function viewerTitle(filePath: string, title?: string) {
  return title || getBaseName(filePath);
}

function filePageTitle(filePath: string, title?: string) {
  return title || getBaseName(filePath);
}

function pageAuditRefs(page: Page) {
  return {
    pageId: page.id,
    pageType: page.type,
    title: page.title,
    pinned: !!page.pinned,
    ...(page.type === "terminal" ? { sessionId: page.sessionId } : {}),
    ...(page.type === "files" ? { dir: page.dir } : {}),
    ...("filePath" in page ? { filePath: page.filePath } : {}),
    ...(page.type !== "terminal" && page.type !== "files" && "sessionId" in page && page.sessionId ? { sessionId: page.sessionId } : {}),
  };
}

function makePageAuditEvent(
  page: Page,
  action: string,
  summary: string,
  refs: Record<string, unknown> = {},
  payload?: unknown,
): AuditEventInput {
  return {
    source: "client.ui",
    category: "ui",
    action,
    status: "success",
    title: page.title || page.type,
    summary,
    refs: {
      ...pageAuditRefs(page),
      ...refs,
    },
    payload,
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [pages, setPages] = useState<Page[]>(() => loadPages());
  const [activePageId, setActivePageId] = useState<string | null>(() => loadActiveId());

  // Callback injected by TerminalPage to kill PTY when terminal tab closes
  const onCloseTerminalRef = useRef<((sessionId: string) => void) | null>(null);
  const pagesRef = useRef<Page[]>(pages);
  const activePageIdRef = useRef<string | null>(activePageId);
  const pendingAuditEventsRef = useRef<AuditEventInput[]>([]);

  const queueAuditEvent = useCallback((event: AuditEventInput | AuditEventInput[]) => {
    pendingAuditEventsRef.current.push(...(Array.isArray(event) ? event : [event]));
  }, []);

  useEffect(() => {
    pagesRef.current = pages;
    activePageIdRef.current = activePageId;
    savePages(pages, activePageId);
  }, [pages, activePageId]);

  useEffect(() => {
    if (pendingAuditEventsRef.current.length === 0) return;
    const events = pendingAuditEventsRef.current.splice(0, pendingAuditEventsRef.current.length);
    const deduped = Array.from(new Map(
      events.map((event) => [
        `${event.action}|${event.title}|${event.summary}|${JSON.stringify(event.refs || {})}|${JSON.stringify(event.payload ?? null)}`,
        event,
      ]),
    ).values());
    void emitAuditEvent(deduped);
  }, [activePageId, pages]);

  const openTerminal = useCallback((sessionId: string, title: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "terminal" && p.sessionId === sessionId);
      if (existing) {
        if (activePageIdRef.current !== existing.id) {
          queueAuditEvent(
            makePageAuditEvent(existing, "page.switch", `switched to ${existing.title}`, { toPageId: existing.id }),
          );
        }
        setActivePageId(existing.id);
        return prev.map(p => p.id === existing.id && p.type === "terminal" && p.title !== title ? { ...p, title } : p);
      }
      const page: TerminalPage = { id: uid(), type: "terminal", sessionId, title };
      queueAuditEvent([
        makePageAuditEvent(page, "page.open", `opened ${page.title}`),
        makePageAuditEvent(page, "page.switch", `switched to ${page.title}`, { toPageId: page.id }),
      ]);
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, [queueAuditEvent]);

  const openFiles = useCallback((dir = "/") => {
    setPages(prev => {
      // Allow multiple files pages - always create a new one
      const page: FilesPage = {
        id: uid(),
        type: "files",
        title: `files ${prev.filter(p => p.type === "files").length + 1}`,
        dir,
      };
      queueAuditEvent([
        makePageAuditEvent(page, "page.open", `opened ${page.title}`),
        makePageAuditEvent(page, "page.switch", `switched to ${page.title}`, { toPageId: page.id }),
      ]);
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, [queueAuditEvent]);

  const openEditor = useCallback((filePath: string, title?: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "editor" && p.filePath === filePath);
      if (existing) {
        if (activePageIdRef.current !== existing.id) {
          queueAuditEvent(
            makePageAuditEvent(existing, "page.switch", `switched to ${existing.title}`, { toPageId: existing.id }),
          );
        }
        setActivePageId(existing.id);
        return prev;
      }
      const page: EditorPage = {
        id: uid(),
        type: "editor",
        filePath,
        title: filePageTitle(filePath, title),
      };
      queueAuditEvent([
        makePageAuditEvent(page, "page.open", `opened ${page.title}`),
        makePageAuditEvent(page, "page.switch", `switched to ${page.title}`, { toPageId: page.id }),
      ]);
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, [queueAuditEvent]);

  const openImage = useCallback((filePath: string, title?: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "image" && p.filePath === filePath);
      if (existing) {
        if (activePageIdRef.current !== existing.id) {
          queueAuditEvent(
            makePageAuditEvent(existing, "page.switch", `switched to ${existing.title}`, { toPageId: existing.id }),
          );
        }
        setActivePageId(existing.id);
        return prev;
      }
      const page: ImagePage = {
        id: uid(),
        type: "image",
        filePath,
        title: viewerTitle(filePath, title),
      };
      queueAuditEvent([
        makePageAuditEvent(page, "page.open", `opened ${page.title}`),
        makePageAuditEvent(page, "page.switch", `switched to ${page.title}`, { toPageId: page.id }),
      ]);
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, [queueAuditEvent]);

  const openPdf = useCallback((filePath: string, title?: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "pdf" && p.filePath === filePath);
      if (existing) {
        if (activePageIdRef.current !== existing.id) {
          queueAuditEvent(
            makePageAuditEvent(existing, "page.switch", `switched to ${existing.title}`, { toPageId: existing.id }),
          );
        }
        setActivePageId(existing.id);
        return prev;
      }
      const page: PdfPage = {
        id: uid(),
        type: "pdf",
        filePath,
        title: viewerTitle(filePath, title),
      };
      queueAuditEvent([
        makePageAuditEvent(page, "page.open", `opened ${page.title}`),
        makePageAuditEvent(page, "page.switch", `switched to ${page.title}`, { toPageId: page.id }),
      ]);
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, [queueAuditEvent]);

  const openSpreadsheet = useCallback((filePath: string, title?: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "spreadsheet" && p.filePath === filePath);
      if (existing) {
        if (activePageIdRef.current !== existing.id) {
          queueAuditEvent(
            makePageAuditEvent(existing, "page.switch", `switched to ${existing.title}`, { toPageId: existing.id }),
          );
        }
        setActivePageId(existing.id);
        return prev;
      }
      const page: SpreadsheetPage = {
        id: uid(),
        type: "spreadsheet",
        filePath,
        title: viewerTitle(filePath, title),
      };
      queueAuditEvent([
        makePageAuditEvent(page, "page.open", `opened ${page.title}`),
        makePageAuditEvent(page, "page.switch", `switched to ${page.title}`, { toPageId: page.id }),
      ]);
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, [queueAuditEvent]);

  const openDoc = useCallback((filePath: string, title?: string) => {
    setPages(prev => {
      const existing = prev.find(p => p.type === "doc" && p.filePath === filePath);
      if (existing) {
        if (activePageIdRef.current !== existing.id) {
          queueAuditEvent(
            makePageAuditEvent(existing, "page.switch", `switched to ${existing.title}`, { toPageId: existing.id }),
          );
        }
        setActivePageId(existing.id);
        return prev;
      }
      const page: DocPage = {
        id: uid(),
        type: "doc",
        filePath,
        title: viewerTitle(filePath, title),
      };
      queueAuditEvent([
        makePageAuditEvent(page, "page.open", `opened ${page.title}`),
        makePageAuditEvent(page, "page.switch", `switched to ${page.title}`, { toPageId: page.id }),
      ]);
      setActivePageId(page.id);
      return [...prev, page];
    });
  }, [queueAuditEvent]);

  const openProgram = useCallback((kind: ProgramKind, title?: string, options?: { sessionId?: string }) => {
    const requestedChatSessionId = kind === "chat" ? options?.sessionId || generateUUID() : undefined;
    setPages(prev => {
      // Allow multiple chat tabs, each with a unique session/memory
      if (kind === "chat") {
        const sessionId = requestedChatSessionId || generateUUID();
        const page: ProgramPage = {
          id: uid(),
          type: kind,
          sessionId,
          title: title || nextChatSessionTitle(prev),
        };
        queueAuditEvent([
          makePageAuditEvent(page, "page.open", `opened ${page.title}`),
          makePageAuditEvent(page, "page.switch", `switched to ${page.title}`, { toPageId: page.id }),
        ]);
        setActivePageId(page.id);
        return [...prev, page];
      }

      const existing = prev.find(p => p.type === kind);
      if (existing) {
        if (activePageIdRef.current !== existing.id) {
          queueAuditEvent(
            makePageAuditEvent(existing, "page.switch", `switched to ${existing.title}`, { toPageId: existing.id }),
          );
        }
        setActivePageId(existing.id);
        return prev;
      }
      const page: ProgramPage = {
        id: uid(),
        type: kind,
        title: title || PROGRAM_TITLES[kind],
      };
      queueAuditEvent([
        makePageAuditEvent(page, "page.open", `opened ${page.title}`),
        makePageAuditEvent(page, "page.switch", `switched to ${page.title}`, { toPageId: page.id }),
      ]);
      setActivePageId(page.id);
      return [...prev, page];
    });
    return requestedChatSessionId;
  }, [queueAuditEvent]);

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
      if (!page) return prev;
      // If closing a terminal tab, kill the PTY on the server
      if (page.type === "terminal") {
        onCloseTerminalRef.current?.(page.sessionId);
      }
      const idx = prev.findIndex(p => p.id === id);
      const next = prev.filter(p => p.id !== id);
      const fallbackNextId = activePageIdRef.current === id && next.length > 0
        ? next[Math.min(idx, next.length - 1)]?.id || null
        : activePageIdRef.current;
      const fallbackNextPage = fallbackNextId ? next.find(p => p.id === fallbackNextId) || null : null;
      queueAuditEvent(makePageAuditEvent(page, "page.close", `closed ${page.title}`));
      if (activePageIdRef.current === id && fallbackNextPage) {
        queueAuditEvent(
          makePageAuditEvent(fallbackNextPage, "page.switch", `switched to ${fallbackNextPage.title}`, {
            toPageId: fallbackNextPage.id,
            fromPageId: id,
          }),
        );
      }
      setActivePageId(cur => {
        if (cur !== id) return cur;
        if (next.length === 0) return null;
        return next[Math.min(idx, next.length - 1)].id;
      });
      return next;
    });
  }, [queueAuditEvent]);

  const switchPage = useCallback((id: string) => {
    const page = pagesRef.current.find(entry => entry.id === id);
    if (page && activePageIdRef.current !== id) {
      queueAuditEvent(
        makePageAuditEvent(page, "page.switch", `switched to ${page.title}`, {
          fromPageId: activePageIdRef.current,
          toPageId: id,
        }),
      );
    }
    setActivePageId(id);
  }, [queueAuditEvent]);

  const renamePage = useCallback((id: string, title: string) => {
    const clean = title.trim().slice(0, 80);
    if (!clean) return;
    setPages(prev => prev.map(p => {
      if (p.id !== id || p.title === clean) return p;
      queueAuditEvent(
        makePageAuditEvent(p, "page.rename", `renamed ${p.title} to ${clean}`, { previousTitle: p.title, nextTitle: clean }),
      );
      return { ...p, title: clean } as Page;
    }));
  }, [queueAuditEvent]);

  const reorderPage = useCallback((sourceId: string, targetId: string, placement: "before" | "after" = "before") => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setPages(prev => {
      const sourceIndex = prev.findIndex(p => p.id === sourceId);
      const targetIndex = prev.findIndex(p => p.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const sourcePage = prev[sourceIndex];
      const targetPage = prev[targetIndex];
      const next = [...prev];
      const [source] = next.splice(sourceIndex, 1);
      const targetAfterRemoval = next.findIndex(p => p.id === targetId);
      const insertAt = placement === "after" ? targetAfterRemoval + 1 : targetAfterRemoval;
      next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, source);
      queueAuditEvent(
        makePageAuditEvent(sourcePage, "page.reorder", `moved ${sourcePage.title} ${placement} ${targetPage.title}`, {
          targetPageId: targetPage.id,
          targetTitle: targetPage.title,
          placement,
          order: next.map(page => ({ id: page.id, title: page.title, type: page.type })),
        }),
      );
      return next;
    });
  }, [queueAuditEvent]);

  const togglePagePin = useCallback((id: string) => {
    setPages(prev => prev.map(p => {
      if (p.id !== id) return p;
      const nextPinned = !p.pinned;
      queueAuditEvent(
        makePageAuditEvent(p, "page.pin", nextPinned ? `pinned ${p.title}` : `unpinned ${p.title}`, {
          pinned: nextPinned,
        }),
      );
      return { ...p, pinned: nextPinned } as Page;
    }));
  }, [queueAuditEvent]);

  const updateDir = useCallback((id: string, dir: string) => {
    setPages(prev => prev.map(p =>
      p.id === id && p.type === "files" ? { ...p, dir } : p
    ));
  }, []);

  const setTerminalCloser = useCallback((fn: (sessionId: string) => void) => {
    onCloseTerminalRef.current = fn;
  }, []);

  const value = useMemo<AppContextValue>(() => ({
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
    renamePage,
    reorderPage,
    togglePagePin,
    updateDir,
    setTerminalCloser,
  }), [
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
    renamePage,
    reorderPage,
    togglePagePin,
    updateDir,
    setTerminalCloser,
  ]);

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}
