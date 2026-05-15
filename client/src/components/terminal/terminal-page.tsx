
/**
 * re.Term — Two-row tab layout
 *
 * ┌──────────────────────────────────────────────────────┐
 * │  Row 1: [>_ term 1] [files] [+] [📁]                │  primary views
 * ├──────────────────────────────────────────────────────┤
 * │  Row 2: [main.rs ×] [notes.md ×] [+]  (files only)  │  open files
 * ├──────────────────────────────────────────────────────┤
 * │  key bar  (terminal pages only)                      │
 * ├──────────────────────────────────────────────────────┤
 * │  content area                                        │
 * ├──────────────────────────────────────────────────────┤
 * │  status bar                                          │
 * └──────────────────────────────────────────────────────┘
 */

import * as React from "react";
import { useTerminal } from "@/contexts/terminal-context";
import { useApp, type Page, type EditorPage } from "@/contexts/app-context";
import { TerminalInstance } from "./terminal-instance";
import { KeyBar } from "./key-bar";
import { FileBrowser } from "@/components/files/file-browser";
import { FileEditor } from "@/components/editor/file-editor";
import { ScrollableBreadcrumb } from "@/components/common/scrollable-breadcrumb";
import { ImageViewer } from "@/components/viewers/image/image-viewer";
import { PdfViewer } from "@/components/viewers/pdf/pdf-viewer";
import { SpreadsheetViewer } from "@/components/viewers/spreadsheet/spreadsheet-viewer";
import { DocViewer } from "@/components/viewers/doc/doc-viewer";
import { BrowserShell } from "@/components/programs/browser/browser-shell";
import { ChatShell } from "@/components/programs/chat/chat-shell";
import { ForumShell } from "@/components/programs/forum/forum-shell";
import { CommunityShell } from "@/components/programs/community/community-shell";
import { SettingsPanel } from "./settings-panel";
import {
  Plus, X, Terminal, FileText, FolderOpen, FileSpreadsheet,
  WifiOff, Loader2, ChevronRight, Settings, Circle,
  GitBranch, Bell, Moon, Sun, AppWindow, Globe, MessageSquare, Users, Image as ImageIcon
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const FILE_VIEW_TYPES = new Set<Page["type"]>(["editor", "pdf", "spreadsheet", "doc"]);
const PRIMARY_TAB_TYPES = new Set<Page["type"]>(["terminal", "files", "image", "browser", "chat", "forum", "community"]);

function isFileViewType(type: Page["type"] | undefined): boolean {
  return !!type && FILE_VIEW_TYPES.has(type);
}

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginScreen() {
  const { connect } = useTerminal();
  const [password,   setPassword]   = React.useState("");
  const [error,      setError]      = React.useState("");
  const [connecting, setConnecting] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setError(""); setConnecting(true);
    try { await connect(password); }
    catch (err) { setError(err instanceof Error ? err.message : "connection failed"); }
    finally { setConnecting(false); }
  };

  return (
    <div className="reterm-login">
      <div className="reterm-login-card">
        <div className="reterm-login-logo">
          <Terminal size={28} strokeWidth={1.5} />
          <span>re.Term</span>
        </div>
        <p className="reterm-login-subtitle">connect to your terminal server</p>
        <form onSubmit={handleSubmit} className="reterm-login-form">
          <label className="reterm-login-label">password</label>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="enter password"
            className="reterm-login-input"
            disabled={connecting}
            autoComplete="current-password"
          />
          {error && <div className="reterm-login-error">{error}</div>}
          <button type="submit" disabled={connecting || !password.trim()} className="reterm-login-btn">
            {connecting
              ? <><Loader2 size={15} className="reterm-spin" />connecting…</>
              : <><ChevronRight size={15} />connect</>}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Row 1: Primary tab bar ───────────────────────────────────────────────────
// Shows: terminal tabs + files tab. No editor tabs here.

function PrimaryTabBar() {
  const { pages, activePageId, closePage, switchPage, openFiles, openProgram } = useApp();
  const { createSession } = useTerminal();
  const [launcherOpen, setLauncherOpen] = React.useState(false);
  const launcherRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!launcherRef.current?.contains(event.target as Node)) {
        setLauncherOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLauncherOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const primaryPages = pages.filter(page => PRIMARY_TAB_TYPES.has(page.type));

  return (
    <div className="reterm-tabbar">
      <div className="reterm-tabs">
        {primaryPages.map(page => {
          const activePage = pages.find(p => p.id === activePageId);
          const isActive = page.id === activePageId ||
            (page.type === "files" && isFileViewType(activePage?.type));

          return (
            <button
              key={page.id}
              className={`reterm-tab ${isActive ? "reterm-tab--active" : ""} reterm-tab--${page.type}`}
              onClick={() => switchPage(page.id)}
              title={page.title}
            >
              {page.type === "terminal" && <Terminal size={11} strokeWidth={1.5} className="reterm-tab-icon" />}
              {page.type === "files" && <FolderOpen size={11} strokeWidth={1.5} className="reterm-tab-icon" />}
              {page.type === "image" && <ImageIcon size={11} strokeWidth={1.5} className="reterm-tab-icon" />}
              {page.type === "browser" && <Globe size={11} strokeWidth={1.5} className="reterm-tab-icon" />}
              {page.type === "chat" && <MessageSquare size={11} strokeWidth={1.5} className="reterm-tab-icon" />}
              {page.type === "forum" && <MessageSquare size={11} strokeWidth={1.5} className="reterm-tab-icon" />}
              {page.type === "community" && <Users size={11} strokeWidth={1.5} className="reterm-tab-icon" />}
              <span className="reterm-tab-title">{page.title}</span>
              <span
                className="reterm-tab-close"
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); closePage(page.id); }}
                onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); closePage(page.id); } }}
                aria-label="close"
              >
                <X size={10} strokeWidth={2} />
              </span>
            </button>
          );
        })}
      </div>

      <button
        className="reterm-tab-new"
        onClick={() => createSession(`terminal ${Date.now()}`)}
        title="new terminal"
      >
        <Plus size={13} strokeWidth={2} />
      </button>

      <button
        className="reterm-tab-new"
        onClick={() => {
          // Open new files page always from root (/)
          openFiles("/");
        }}
        title="open file explorer"
      >
        <FolderOpen size={13} strokeWidth={1.8} />
      </button>

      <div className="reterm-launcher" ref={launcherRef}>
        <button
          className="reterm-tab-new reterm-tab-new--launcher"
          onClick={() => setLauncherOpen(open => !open)}
          title="open program tabs"
          type="button"
        >
          <AppWindow size={13} strokeWidth={1.8} />
        </button>

        {launcherOpen && (
          <div className="reterm-launcher-menu" role="menu" aria-label="program launchers">
            {[
              { kind: "browser" as const, label: "inside browser", icon: Globe },
              { kind: "chat" as const, label: "ai chat", icon: MessageSquare },
              { kind: "forum" as const, label: "forum", icon: MessageSquare },
              { kind: "community" as const, label: "community", icon: Users },
            ].map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.kind}
                  type="button"
                  className="reterm-launcher-item"
                  onClick={() => {
                    openProgram(item.kind);
                    setLauncherOpen(false);
                  }}
                >
                  <Icon size={13} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Row 2: File tabs sub-bar ─────────────────────────────────────────────────
// Shows open editor pages. Only visible when files page exists.
// Active editor is highlighted. Clicking switches to that editor.

function FileTabBar() {
  const { pages, activePageId, closePage, switchPage, openEditor } = useApp();

  // Find the active files page (the one currently selected in row 1)
  const activeFilesPage = pages.find((p): p is Extract<Page, { type: "files" }> => p.type === "files" && p.id === activePageId);

  // If no files page is active, find any files page or return null
  const filesPage = activeFilesPage || pages.find((p): p is Extract<Page, { type: "files" }> => p.type === "files");
  if (!filesPage) return null;

  const editorPages = pages.filter((p): p is EditorPage => p.type === "editor");
  const pdfPages = pages.filter((p): p is Extract<Page, { type: "pdf" }> => p.type === "pdf");
  const spreadsheetPages = pages.filter((p): p is Extract<Page, { type: "spreadsheet" }> => p.type === "spreadsheet");
  const docPages = pages.filter((p): p is Extract<Page, { type: "doc" }> => p.type === "doc");
  const filePages = [...editorPages, ...pdfPages, ...spreadsheetPages, ...docPages];

  // Extract current directory name from the files page dir path
  const dirPath = filesPage.dir || "/";
  const dirName = dirPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "/";
  const activePage = pages.find(p => p.id === activePageId);
  const filesActive = activePage?.type === "files" || isFileViewType(activePage?.type);

  return (
    <div className="reterm-filetabbar">
      <button
        className={`reterm-filetab reterm-filetab--files ${filesActive ? "reterm-filetab--active" : ""}`}
        onClick={() => switchPage(filesPage.id)}
        title={dirPath}
      >
        <FolderOpen size={11} strokeWidth={1.5} />
        <span>{dirName}</span>
      </button>

      <div className="reterm-filetabbar-scroll" aria-label="open file tabs">
        {filePages.map(page => {
          const isActive = page.id === activePageId;
          const title = page.type === "editor" && page.dirty ? `${page.title} ●` : page.title;
          return (
            <button
              key={page.id}
              className={`reterm-filetab ${isActive ? "reterm-filetab--active" : ""}`}
              onClick={() => switchPage(page.id)}
              title={page.title}
            >
              {page.type === "editor" && <FileText size={10} strokeWidth={1.5} className="reterm-filetab-icon" />}
              {page.type === "pdf" && <FileText size={10} strokeWidth={1.5} className="reterm-filetab-icon" />}
              {page.type === "spreadsheet" && <FileSpreadsheet size={10} strokeWidth={1.5} className="reterm-filetab-icon" />}
              {page.type === "doc" && <FileText size={10} strokeWidth={1.5} className="reterm-filetab-icon" />}
              <span>{title}</span>
              <span
                className="reterm-filetab-close"
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); closePage(page.id); }}
                onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); closePage(page.id); } }}
              >
                <X size={9} strokeWidth={2} />
              </span>
            </button>
          );
        })}
      </div>

      {/* New file button */}
      <button
        className="reterm-filetab-new"
        onClick={() => {
          // Open new file in the current directory of the active files page
          const name = prompt("file name:");
          if (name) {
            const filePath = dirPath.endsWith("/") ? `${dirPath}${name}` : `${dirPath}/${name}`;
            openEditor(filePath, name);
          }
        }}
        title="new file in current directory"
      >
        <Plus size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function StatusBar() {
  const { status, sessions, disconnect } = useTerminal();
  const { pages, activePageId } = useApp();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settings, setSettings] = React.useState(() => {
    try {
      const saved = localStorage.getItem("reterm_settings");
      return saved ? JSON.parse(saved) : {
        theme: 'dark' as const,
        fontSize: 14,
        fontFamily: '"Ubuntu Mono", monospace',
        terminalOpacity: 0.95,
      };
    } catch {
      return {
        theme: 'dark' as const,
        fontSize: 14,
        fontFamily: '"Ubuntu Mono", monospace',
        terminalOpacity: 0.95,
      };
    }
  });

  const activePage  = pages.find(p => p.id === activePageId);
  const isConnected = status === "connected";
  const isBusy      = status === "reconnecting" || status === "connecting";

  const termSession = activePage?.type === "terminal"
    ? sessions.find(s => s.id === activePage.sessionId)
    : null;

  const activeFilePath = activePage && "filePath" in activePage ? activePage.filePath : null;

  // Save settings to localStorage and apply theme
  React.useEffect(() => {
    try {
      localStorage.setItem("reterm_settings", JSON.stringify(settings));
    } catch {}
  
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  // Apply font settings
  React.useEffect(() => {
    document.documentElement.style.setProperty('--term-font-size', `${settings.fontSize}px`);
    document.documentElement.style.setProperty('--term-font-family', settings.fontFamily);
  }, [settings.fontSize, settings.fontFamily]);

  // Listen for system theme changes

  const handleSettingsUpdate = (updates: Partial<typeof settings>) => {
    setSettings((prev: typeof settings) => ({ ...prev, ...updates }));
  };

  return (
    <>
      <div className="reterm-statusbar">
        <div className="reterm-statusbar-left">
          <div className="reterm-statusbar-topline">
            <span className={`reterm-conn-badge ${isConnected ? "reterm-conn-badge--connected" : ""}`}>
              {isConnected ? (
                <>
                  <span className="reterm-conn-dot reterm-conn-dot--connected" />
                  <span className="reterm-conn-badge__text">connected</span>
                </>
              ) : isBusy ? (
                <>
                  <Loader2 size={10} className="reterm-spin" />
                  <span className="reterm-conn-badge__text">{status === "connecting" ? "connecting…" : "reconnecting…"}</span>
                </>
              ) : (
                <>
                  <Circle size={8} strokeWidth={2} style={{ opacity: 0.4 }} />
                  <span className="reterm-conn-badge__text">{status === "idle" ? "idle" : "disconnected"}</span>
                </>
              )}
            </span>
            {termSession && termSession.cols !== 80 && (
              <span className="reterm-statusbar-item reterm-dims">{termSession.cols}×{termSession.rows}</span>
            )}
            {sessions.length > 0 && (
              <span className="reterm-statusbar-item reterm-statusbar-sessioncount">
                {sessions.length} session{sessions.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {activeFilePath && (
            <div className="reterm-statusbar-pathline">
              <ScrollableBreadcrumb
                className="reterm-statusbar-breadcrumb"
                path={activeFilePath}
              />
            </div>
          )}
        </div>
        <div className="reterm-statusbar-right">
          <span className="reterm-statusbar-brand">re.Term</span>
          <button className="reterm-statusbar-btn" title="notifications"><Bell size={11} strokeWidth={1.8} /></button>
          <button className="reterm-statusbar-btn" title="git"><GitBranch size={11} strokeWidth={1.8} /></button>
          
          {/* Theme toggle */}
          <button 
            className="reterm-statusbar-btn" 
            title="toggle theme"
            onClick={() => {
              const nextTheme = settings.theme === "dark" ? "light" : "dark";
              handleSettingsUpdate({ theme: nextTheme  });
            }}
          >
            {settings.theme === 'dark' && <Moon size={11} strokeWidth={1.8} />}
            {settings.theme === 'light' && <Sun size={11} strokeWidth={1.8} />}
          </button>
          
          {isConnected && (
            <button className="reterm-statusbar-btn reterm-statusbar-btn--danger" onClick={disconnect} title="disconnect">
              <WifiOff size={11} strokeWidth={1.8} />
            </button>
          )}
          <button 
            className="reterm-statusbar-btn" 
            title="settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={11} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}

// ─── Page content ─────────────────────────────────────────────────────────────

function PageContent({ page }: { page: Page }) {
  if (page.type === "terminal") return <TerminalInstance sessionId={page.sessionId} isActive={true} />;
  if (page.type === "editor")   return <FileEditor pageId={page.id} filePath={page.filePath} />;
  if (page.type === "files")    return <FileBrowser pageId={page.id} dir={page.dir} />;
  if (page.type === "image")     return <ImageViewer filePath={page.filePath} />;
  if (page.type === "pdf")       return <PdfViewer filePath={page.filePath} />;
  if (page.type === "spreadsheet") return <SpreadsheetViewer filePath={page.filePath} />;
  if (page.type === "doc")       return <DocViewer filePath={page.filePath} />;
  if (page.type === "browser")   return <BrowserShell />;
  if (page.type === "chat")      return <ChatShell />;
  if (page.type === "forum")     return <ForumShell />;
  if (page.type === "community") return <CommunityShell />;
  return null;
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export function TerminalPage() {
  const { status, sessions, createSession, closeSession } = useTerminal();
  const { pages, activePageId, openTerminal, setTerminalCloser } = useApp();
  const isConnected = status === "connected";

  // Wire terminal tab close → server PTY kill
  React.useEffect(() => {
    setTerminalCloser((sessionId: string) => {
      closeSession(sessionId);
    });
  }, [setTerminalCloser, closeSession]);

  // Open a terminal tab for each new PTY session from the server
  const prevSessionsRef = React.useRef<string[]>([]);
  React.useEffect(() => {
    const prevIds = prevSessionsRef.current;
    const newSessions = sessions.filter(s => !prevIds.includes(s.id));
    for (const s of newSessions) openTerminal(s.id, s.title);
    prevSessionsRef.current = sessions.map(s => s.id);
  }, [sessions, openTerminal]);

  // Auto-create first session if server has none
  const didInitRef = React.useRef(false);
  React.useEffect(() => {
    if (isConnected && sessions.length === 0 && !didInitRef.current) {
      didInitRef.current = true;
      createSession("terminal 1");
    }
    if (!isConnected) didInitRef.current = false;
  }, [isConnected, sessions.length, createSession]);

  // Ctrl+Shift+T → new terminal
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "T") {
        e.preventDefault();
        if (isConnected) createSession(`terminal ${sessions.length + 1}`);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isConnected, sessions.length, createSession]);

  if (!isConnected) {
    return (
      <div className="reterm-root">
        <LoginScreen />
        <StatusBar />
      </div>
    );
  }

  const activePage       = pages.find(p => p.id === activePageId);
  const activeIsTerminal = activePage?.type === "terminal";
  const activeSessionId  = activeIsTerminal ? activePage.sessionId : null;

  // What to actually render in the content area:
  // - If active page is an editor, show it
  // - If active page is files, show the file browser
  // - If active page is terminal, show the terminal
  // All terminals stay mounted (hidden) to preserve PTY output
  const hasFilesPage = pages.some(p => p.type === "files" || isFileViewType(p.type));

  return (
    <div className="reterm-root">
      {/* Row 1: primary tabs */}
      <PrimaryTabBar />

      {/* Row 2: file sub-tabs (only when files page exists) */}
      {hasFilesPage && <FileTabBar />}

      {/* Key bar — only for terminal pages (positioned under the top bars) */}
      {activeIsTerminal && <KeyBar sessionId={activeSessionId} />}

      {/* Content area */}
      <div className="reterm-area">
        {pages.length === 0 ? (
          <div className="reterm-empty">
            <Terminal size={40} strokeWidth={1} opacity={0.3} />
            <p>no pages open</p>
            <button className="reterm-empty-btn" onClick={() => createSession("terminal 1")}>
              <Plus size={14} /> new terminal
            </button>
          </div>
        ) : (
          // Simplified: No rotateY, no exit animation. Instant switch + fade.
          <AnimatePresence mode="wait">
            {pages.map(page => {
              const isVisible = page.id === activePageId;
              return (
                <motion.div
                  key={page.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: isVisible ? 1 : 0 }}
                  transition={{ duration: 0.1 }} // Fast fade
                  style={{
                    position: "absolute",
                    inset: 0,
                    pointerEvents: isVisible ? "auto" : "none",
                    display: !isVisible ? "none" : undefined,
                  }}
                >
                  <PageContent page={page} />
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      <StatusBar />
    </div>
  );
}
