
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
import { useApp, type Page } from "@/contexts/app-context";
import { TerminalInstance } from "./terminal-instance";
import { KeyBar } from "./key-bar";
import { FilesPageViewer } from "@/components/files/files-page-viewer";
import { ImageViewer } from "@/components/viewers/image/image-viewer";
import { PdfViewer } from "@/components/viewers/pdf/pdf-viewer";
import { SpreadsheetViewer } from "@/components/viewers/spreadsheet/spreadsheet-viewer";
import { DocViewer } from "@/components/viewers/doc/doc-viewer";
import { BrowserShell } from "@/components/programs/browser/browser-shell";
import { ChatShell } from "@/components/programs/chat/chat-shell";
import { ForumShell } from "@/components/programs/forum/forum-shell";
import { CommunityShell } from "@/components/programs/community/community-shell";
import { McpShell } from "@/components/programs/tools/mcp-shell";
import { ExtensionsShell } from "@/components/programs/tools/extensions-shell";
import { PluginsShell } from "@/components/programs/tools/plugins-shell";
import { ScriptsShell } from "@/components/programs/tools/scripts-shell";
import { PlaygroundShell } from "@/components/programs/tools/playground-shell";
import { SettingsPanel } from "./settings-panel";
import {
  Plus, X, Terminal, FolderOpen,
  WifiOff, Loader2, ChevronRight, Settings,
  GitBranch, Bell, Moon, Sun, Globe, MessageSquare, Users, Image as ImageIcon,
  Blocks, Puzzle, Package, SquareTerminal, FlaskConical
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const FILE_VIEW_TYPES = new Set<Page["type"]>(["editor", "pdf", "spreadsheet", "doc"]);
const PRIMARY_TAB_TYPES = new Set<Page["type"]>([
  "terminal",
  "files",
  "image",
  "browser",
  "chat",
  "forum",
  "community",
  "mcp",
  "extensions",
  "plugins",
  "scripts",
  "playground",
]);

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
        <div className="reterm-login-titlebar" aria-hidden="true">
          <span className="reterm-login-dot" />
          <span className="reterm-login-dot" />
          <span className="reterm-login-dot" />
          <span className="reterm-login-title">auth</span>
        </div>
        <div className="reterm-login-logo">
          <Terminal size={28} strokeWidth={1.5} />
          <span>re.Term</span>
        </div>
        <p className="reterm-login-subtitle">connect to your terminal server</p>
        <form onSubmit={handleSubmit} className="reterm-login-form" autoComplete="off">
          <div className="reterm-login-field">
            <span className="reterm-login-label">password</span>
            <div className="reterm-login-command">
              <span className="reterm-login-prompt" aria-hidden="true">&gt;</span>
              <input
                ref={inputRef}
                type="text"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="password"
                className="reterm-login-input"
                disabled={connecting}
                autoComplete="off"
                inputMode="text"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                aria-label="password"
              />
              <button type="submit" disabled={connecting || !password.trim()} className="reterm-login-btn">
                {connecting
                  ? <><Loader2 size={14} className="reterm-spin" />connecting</>
                  : <><ChevronRight size={14} />connect</>}
              </button>
            </div>
          </div>
          {error && <div className="reterm-login-error">{error}</div>}
        </form>
      </div>
    </div>
  );
}

// ─── Row 1: Primary tab bar ───────────────────────────────────────────────────
// Shows: terminal tabs + files tab. No editor tabs here.

function PrimaryTabBar() {
  const { pages, activePageId, closePage, switchPage, openFiles } = useApp();
  const { createSession } = useTerminal();
  const primaryPages = pages.filter(page => PRIMARY_TAB_TYPES.has(page.type));
  const tabRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const activePage = pages.find(p => p.id === activePageId);
  const activePrimaryPage = primaryPages.find(page =>
    page.id === activePageId ||
    (page.type === "files" && isFileViewType(activePage?.type))
  );

  React.useEffect(() => {
    if (!activePrimaryPage) return;
    tabRefs.current.get(activePrimaryPage.id)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activePrimaryPage?.id]);

  return (
    <div className="reterm-tabbar">
      <div className="reterm-tabs">
        {primaryPages.map(page => {
          const isActive = page.id === activePageId ||
            (page.type === "files" && isFileViewType(activePage?.type));

          return (
            <button
              key={page.id}
              ref={node => {
                if (node) tabRefs.current.set(page.id, node);
                else tabRefs.current.delete(page.id);
              }}
              className={`reterm-tab ${isActive ? "reterm-tab--active" : ""} reterm-tab--${page.type}`}
              onClick={() => switchPage(page.id)}
              title={page.title}
            >
              {page.type === "terminal" && <Terminal size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              {page.type === "files" && <FolderOpen size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              {page.type === "image" && <ImageIcon size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              {page.type === "browser" && <Globe size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              {page.type === "chat" && <MessageSquare size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              {page.type === "forum" && <MessageSquare size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              {page.type === "community" && <Users size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              {page.type === "mcp" && <Blocks size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              {page.type === "extensions" && <Puzzle size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              {page.type === "plugins" && <Package size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              {page.type === "scripts" && <SquareTerminal size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              {page.type === "playground" && <FlaskConical size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              <span className="reterm-tab-title">{page.title}</span>
              <span
                className="reterm-tab-close"
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); closePage(page.id); }}
                onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); closePage(page.id); } }}
                aria-label="close"
              >
                <X size={11} strokeWidth={1.9} />
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
        <Plus size={14} strokeWidth={1.9} />
      </button>

      <button
        className="reterm-tab-new reterm-tab-new--files"
        onClick={() => {
          // Open new files page always from root (/)
          openFiles("/");
        }}
        title="open file explorer"
      >
        <FolderOpen size={14} strokeWidth={1.9} />
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

  // Save settings to localStorage and apply theme
  React.useEffect(() => {
    try {
      localStorage.setItem("reterm_settings", JSON.stringify(settings));
    } catch {}
  }, [settings]);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);
    window.dispatchEvent(new CustomEvent("reterm-theme-change", { detail: settings.theme }));
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

  if (!isConnected) {
    return (
      <div className="reterm-statusbar reterm-statusbar--login">
        <div className="reterm-statusbar-left">
          <div className="reterm-statusbar-topline">
            <span className="reterm-conn-badge reterm-conn-badge--idle">
              <span className="reterm-conn-dot reterm-conn-dot--idle" />
              <span className="reterm-conn-badge__text">idle</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="reterm-statusbar">
        <div className="reterm-statusbar-left">
          <div className="reterm-statusbar-topline">
            <span className={`reterm-conn-badge ${isConnected ? "reterm-conn-badge--connected" : isBusy ? "reterm-conn-badge--busy" : ""}`}>
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
              ) : null}
            </span>
            <button className="reterm-statusbar-btn reterm-statusbar-btn--danger" onClick={disconnect} title="disconnect">
              <WifiOff size={11} strokeWidth={1.8} />
            </button>
            {termSession && termSession.cols !== 80 && (
              <span className="reterm-statusbar-item reterm-dims">{termSession.cols}×{termSession.rows}</span>
            )}
            {sessions.length > 0 && (
              <span className="reterm-statusbar-item reterm-statusbar-sessioncount">
                {sessions.length} session{sessions.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
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
          
          <button 
            className="reterm-statusbar-btn" 
            title="settings"
            onClick={() => setSettingsOpen(open => !open)}
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

function PageContent({ page, isActive }: { page: Page; isActive: boolean }) {
  const parentDir = (filePath: string) => {
    const normalized = filePath.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    if (idx <= 0) return "/";
    return normalized.slice(0, idx);
  };

  if (page.type === "terminal") return <TerminalInstance sessionId={page.sessionId} isActive={isActive} />;
  if (page.type === "editor")   return <FilesPageViewer dir={parentDir(page.filePath)} selectedPath={page.filePath} />;
  if (page.type === "files")    return <FilesPageViewer dir={page.dir} />;
  if (page.type === "image")     return <ImageViewer filePath={page.filePath} />;
  if (page.type === "pdf")       return <PdfViewer filePath={page.filePath} />;
  if (page.type === "spreadsheet") return <SpreadsheetViewer filePath={page.filePath} />;
  if (page.type === "doc")       return <DocViewer filePath={page.filePath} />;
  if (page.type === "browser")   return <BrowserShell />;
  if (page.type === "chat")      return <ChatShell />;
  if (page.type === "forum")     return <ForumShell />;
  if (page.type === "community") return <CommunityShell />;
  if (page.type === "mcp")       return <McpShell />;
  if (page.type === "extensions") return <ExtensionsShell />;
  if (page.type === "plugins")   return <PluginsShell />;
  if (page.type === "scripts")   return <ScriptsShell />;
  if (page.type === "playground") return <PlaygroundShell />;
  return null;
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export function TerminalPage() {
  const { status, sessions, hasSessionList, createSession, closeSession } = useTerminal();
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

  // Auto-create first session only after the server has told us the real list.
  const didInitRef = React.useRef(false);
  React.useEffect(() => {
    if (isConnected && hasSessionList && sessions.length === 0 && !didInitRef.current) {
      didInitRef.current = true;
      createSession("terminal 1");
    }
    if (!isConnected) didInitRef.current = false;
  }, [isConnected, hasSessionList, sessions.length, createSession]);

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

  return (
    <div className="reterm-root">
      {/* Row 1: primary tabs */}
      <PrimaryTabBar />

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
          <AnimatePresence mode="wait">
            {activePage && (
              <motion.div
                key={activePage.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                style={{
                  position: "absolute",
                  inset: 0,
                }}
              >
                <PageContent page={activePage} isActive />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      <StatusBar />
    </div>
  );
}
