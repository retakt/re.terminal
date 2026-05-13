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
import {
  Plus, X, Terminal, FileText, FolderOpen,
  WifiOff, Loader2, ChevronRight, Settings, Circle,
} from "lucide-react";

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
  const { pages, activePageId, closePage, switchPage, openFiles } = useApp();
  const { createSession } = useTerminal();

  // Only show terminal and files pages in row 1
  const primaryPages = pages.filter(p => p.type === "terminal" || p.type === "files");

  return (
    <div className="reterm-tabbar">
      <div className="reterm-tabs">
        {primaryPages.map(page => {
          const isActive = page.id === activePageId ||
            // files tab is "active" when an editor under it is active
            (page.type === "files" && pages.find(p => p.id === activePageId)?.type === "editor");

          return (
            <button
              key={page.id}
              className={`reterm-tab ${isActive ? "reterm-tab--active" : ""} reterm-tab--${page.type}`}
              onClick={() => switchPage(page.id)}
              title={page.title}
            >
              {page.type === "terminal"
                ? <Terminal size={11} strokeWidth={1.5} className="reterm-tab-icon" />
                : <FolderOpen size={11} strokeWidth={1.5} className="reterm-tab-icon" />
              }
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
          // Open new files page with the current active files page's directory
          const filesPages = pages.filter(p => p.type === "files");
          const activePage = pages.find(p => p.id === activePageId);
          
          let dir = "/";
          if (activePage?.type === "files") {
            dir = activePage.dir || "/";
          } else if (activePage?.type === "editor") {
            // Find the parent files page for this editor
            const parentFilesPage = filesPages[0]; // Use first files page as fallback
            if (parentFilesPage) {
              dir = parentFilesPage.dir || "/";
            }
          }
          
          openFiles(dir);
        }}
        title="open file explorer"
        style={{ borderLeft: "1px solid var(--border-subtle)" }}
      >
        <FolderOpen size={13} strokeWidth={1.8} />
      </button>
    </div>
  );
}

// ─── Row 2: File tabs sub-bar ─────────────────────────────────────────────────
// Shows open editor pages. Only visible when files page exists.
// Active editor is highlighted. Clicking switches to that editor.

function FileTabBar() {
  const { pages, activePageId, closePage, switchPage, openEditor } = useApp();

  // Find the active files page (the one currently selected in row 1)
  const activeFilesPage = pages.find(p => p.type === "files" && p.id === activePageId);
  
  // If no files page is active, find any files page or return null
  const filesPage = activeFilesPage || pages.find(p => p.type === "files");
  if (!filesPage) return null;

  const editorPages = pages.filter((p): p is EditorPage => p.type === "editor");

  // Extract current directory name from the files page dir path
  const dirPath = filesPage.dir || "/";
  const dirName = dirPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "/";

  return (
    <div className="reterm-filetabbar">
      {/* Files label — clicking goes back to the tree */}
      <button
        className={`reterm-filetab reterm-filetab--files ${activePageId === filesPage.id ? "reterm-filetab--active" : ""}`}
        onClick={() => switchPage(filesPage.id)}
        title={dirPath}
      >
        <FolderOpen size={11} strokeWidth={1.5} />
        <span>{dirName}</span>
      </button>

      {/* Divider */}
      {editorPages.length > 0 && (
        <div className="reterm-filetab-sep" />
      )}

      {/* Open file tabs */}
      {editorPages.map(page => {
        const isActive = page.id === activePageId;
        const title    = page.dirty ? `${page.title} ●` : page.title;
        return (
          <button
            key={page.id}
            className={`reterm-filetab ${isActive ? "reterm-filetab--active" : ""}`}
            onClick={() => switchPage(page.id)}
            title={page.filePath}
          >
            <FileText size={10} strokeWidth={1.5} className="reterm-filetab-icon" />
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

      {/* New file button */}
      <button
        className="reterm-filetab-new"
        onClick={() => {
          // Open new file in the current directory shown in the files tab
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

  const activePage  = pages.find(p => p.id === activePageId);
  const isConnected = status === "connected";
  const isBusy      = status === "reconnecting" || status === "connecting";

  const termSession = activePage?.type === "terminal"
    ? sessions.find(s => s.id === activePage.sessionId)
    : null;

  const editorPath = activePage?.type === "editor" ? activePage.filePath : null;

  return (
    <div className="reterm-statusbar">
      <div className="reterm-statusbar-left">
        <span className={`reterm-conn-badge ${isConnected ? "reterm-conn-badge--connected" : ""}`}>
          {isConnected ? (
            <><span className="reterm-conn-dot reterm-conn-dot--connected" />connected</>
          ) : isBusy ? (
            <><Loader2 size={10} className="reterm-spin" />{status === "connecting" ? "connecting…" : "reconnecting…"}</>
          ) : (
            <><Circle size={8} strokeWidth={2} style={{ opacity: 0.4 }} />{status === "idle" ? "idle" : "disconnected"}</>
          )}
        </span>
        {termSession && termSession.cols !== 80 && (
          <span className="reterm-statusbar-item reterm-dims">{termSession.cols}×{termSession.rows}</span>
        )}
        {editorPath && (
          <span className="reterm-statusbar-item reterm-dims" style={{ opacity: 0.6 }}>{editorPath}</span>
        )}
        {sessions.length > 0 && (
          <span className="reterm-statusbar-item" style={{ opacity: 0.5, fontSize: 10 }}>
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="reterm-statusbar-right">
        <span className="reterm-statusbar-brand">re.Term</span>
        <button className="reterm-statusbar-btn" title="settings"><Settings size={11} strokeWidth={1.8} /></button>
        {isConnected && (
          <button className="reterm-statusbar-btn reterm-statusbar-btn--danger" onClick={disconnect} title="disconnect">
            <WifiOff size={11} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page content ─────────────────────────────────────────────────────────────

function PageContent({ page }: { page: Page }) {
  if (page.type === "terminal") return <TerminalInstance sessionId={page.sessionId} isActive={true} />;
  if (page.type === "editor")   return <FileEditor pageId={page.id} filePath={page.filePath} />;
  if (page.type === "files")    return <FileBrowser pageId={page.id} dir={page.dir} />;
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
  const hasFilesPage = pages.some(p => p.type === "files");

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
          pages.map(page => {
            const isVisible = page.id === activePageId;
            return (
              <div
                key={page.id}
                style={{
                  position:      "absolute",
                  inset:         0,
                  opacity:       isVisible ? 1 : 0,
                  pointerEvents: isVisible ? "auto" : "none",
                  // Keep terminals mounted; unmount editor/files when hidden
                  display: !isVisible ? "none" : undefined,
                }}
              >
                <PageContent page={page} />
              </div>
            );
          })
        )}
      </div>

      <StatusBar />
    </div>
  );
}
