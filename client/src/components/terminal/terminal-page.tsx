
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
import { MemoryGraph } from "@/components/programs/memory-graph/MemoryGraph";
import { SettingsPanel } from "./settings-panel";
import { callMcpTool } from "@/chat/api/mcp";
import { getServiceStatus } from "@/lib/browser-api";
import {
  Plus, X, Terminal, FolderOpen,
  WifiOff, Loader2, ChevronRight, Settings,
  GitBranch, Bell, Moon, Sun, Globe, MessageSquare, Users, Image as ImageIcon,
  Blocks, Puzzle, Package, SquareTerminal, FlaskConical, Network, Search, ClipboardCheck, RotateCw, Stethoscope,
  Server, Pin, PinOff, Check
} from "lucide-react";

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
  "memory-graph",
]);

function isFileViewType(type: Page["type"] | undefined): boolean {
  return !!type && FILE_VIEW_TYPES.has(type);
}

function readActiveModel() {
  try {
    const model = localStorage.getItem("reterm.chat.model") || "";
    const clean = model.split("/").pop() || model || "model";
    return clean.length > 22 ? `${clean.slice(0, 19)}...` : clean;
  } catch {
    return "model";
  }
}

function clearStoredActivity() {
  try {
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith("reterm.chat.toolLogs.")
      || key.startsWith("reterm.chat.runLogs.")
      || key.startsWith("reterm.chat.reasoningLogs.")
    );
    keys.forEach((key) => localStorage.removeItem(key));
    window.dispatchEvent(new CustomEvent("reterm-activity-clear"));
  } catch {}
}

function shortBranch(value: string) {
  if (!value) return "";
  return value.length > 14 ? `${value.slice(0, 11)}…` : value;
}

type LoginRateLimitState = {
  attempts: number;
  lockedUntil: number;
};

const LOGIN_RATE_LIMIT_KEY = "reterm.login.rateLimit";
const LOGIN_LOCK_SCHEDULE = [0, 0, 0, 15_000, 60_000, 300_000, 900_000, 3_600_000];

function readLoginRateLimit(): LoginRateLimitState {
  try {
    const raw = localStorage.getItem(LOGIN_RATE_LIMIT_KEY);
    if (!raw) return { attempts: 0, lockedUntil: 0 };
    const parsed = JSON.parse(raw) as Partial<LoginRateLimitState>;
    return {
      attempts: Number(parsed.attempts) || 0,
      lockedUntil: Number(parsed.lockedUntil) || 0,
    };
  } catch {
    return { attempts: 0, lockedUntil: 0 };
  }
}

function writeLoginRateLimit(next: LoginRateLimitState) {
  try { localStorage.setItem(LOGIN_RATE_LIMIT_KEY, JSON.stringify(next)); } catch {}
}

function clearLoginRateLimit() {
  try { localStorage.removeItem(LOGIN_RATE_LIMIT_KEY); } catch {}
}

function recordLoginFailure(): LoginRateLimitState {
  const current = readLoginRateLimit();
  const attempts = current.attempts + 1;
  const lockMs = LOGIN_LOCK_SCHEDULE[Math.min(attempts, LOGIN_LOCK_SCHEDULE.length - 1)];
  const lockedUntil = lockMs > 0 ? Date.now() + lockMs : 0;
  const next = { attempts, lockedUntil };
  writeLoginRateLimit(next);
  return next;
}

function formatLockout(ms: number) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.ceil(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  return `${hours}h`;
}

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginScreen() {
  const { connect } = useTerminal();
  const [password,   setPassword]   = React.useState("");
  const [error,      setError]      = React.useState("");
  const [connecting, setConnecting] = React.useState(false);
  const [rateLimit, setRateLimit] = React.useState<LoginRateLimitState>(() => readLoginRateLimit());
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { inputRef.current?.focus(); }, []);

  React.useEffect(() => {
    if (rateLimit.lockedUntil <= Date.now()) return;
    const timer = window.setInterval(() => setRateLimit(readLoginRateLimit()), 1000);
    return () => window.clearInterval(timer);
  }, [rateLimit.lockedUntil]);

  const lockRemaining = Math.max(0, rateLimit.lockedUntil - Date.now());
  const isLocked = lockRemaining > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    if (isLocked) {
      setError(`too many failed attempts. try again in ${formatLockout(lockRemaining)}`);
      return;
    }
    setError(""); setConnecting(true);
    try {
      await connect(password);
      clearLoginRateLimit();
      setRateLimit({ attempts: 0, lockedUntil: 0 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "connection failed";
      if (message.toLowerCase().includes("authentication failed")) {
        const next = recordLoginFailure();
        setRateLimit(next);
        const remaining = Math.max(0, next.lockedUntil - Date.now());
        setError(remaining > 0
          ? `authentication failed. try again in ${formatLockout(remaining)}`
          : "authentication failed");
      } else {
        setError(message);
      }
    }
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
              <button type="submit" disabled={connecting || isLocked || !password.trim()} className="reterm-login-btn">
                {connecting
                  ? <><Loader2 size={14} className="reterm-spin" />connecting</>
                  : isLocked
                    ? <><ChevronRight size={14} />wait {formatLockout(lockRemaining)}</>
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
  const { pages, activePageId, closePage, switchPage, openFiles, openProgram, renamePage, reorderPage, togglePagePin } = useApp();
  const { createSession, sessions, renameSession } = useTerminal();
  const [activityBadge, setActivityBadge] = React.useState({ unread: 0, failed: false });
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<{ id: string; placement: "before" | "after" } | null>(null);
  const [tabMenu, setTabMenu] = React.useState<{ id: string; x: number; y: number } | null>(null);
  const [tabMenuDraft, setTabMenuDraft] = React.useState("");
  const primaryPages = pages
    .filter(page => PRIMARY_TAB_TYPES.has(page.type))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const tabRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const touchDragRef = React.useRef<{ id: string; x: number; y: number } | null>(null);
  const longPressRef = React.useRef<{ id: string; timer: number; fired: boolean } | null>(null);
  const suppressClickRef = React.useRef<string | null>(null);
  const tabMenuRef = React.useRef<HTMLDivElement>(null);
  const activePage = pages.find(p => p.id === activePageId);
  const activePrimaryPage = primaryPages.find(page =>
    page.id === activePageId ||
    (page.type === "files" && isFileViewType(activePage?.type))
  );

  React.useEffect(() => {
    if (!activePrimaryPage) return;
    const tab = tabRefs.current.get(activePrimaryPage.id);
    const scroller = tab?.parentElement;
    if (!tab || !scroller) return;
    const tabRect = tab.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const isClipped = tabRect.left < scrollerRect.left || tabRect.right > scrollerRect.right;
    if (!isClipped) return;
    tab.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "center",
    });
  }, [activePrimaryPage?.id]);

  React.useEffect(() => {
    const readActivity = () => {
      try {
        const runKeys = Object.keys(localStorage).filter((key) => key.startsWith("reterm.chat.runLogs."));
        const runs = runKeys.flatMap((key) => JSON.parse(localStorage.getItem(key) || "[]"));
        setActivityBadge({
          unread: runs.filter((run: any) => run.status === "running" || run.status === "queued").length,
          failed: runs.some((run: any) => run.status === "failed" || run.errorCount > 0),
        });
      } catch {
        setActivityBadge({ unread: 0, failed: false });
      }
    };
    readActivity();
    const interval = window.setInterval(readActivity, 1500);
    return () => window.clearInterval(interval);
  }, []);

  const activeMenuPage = tabMenu ? primaryPages.find(page => page.id === tabMenu.id) ?? null : null;

  React.useEffect(() => {
    if (!tabMenu) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (target instanceof Node && tabMenuRef.current?.contains(target)) return;
      setTabMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabMenu(null);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("touchstart", onPointerDown, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [tabMenu]);

  React.useEffect(() => {
    if (!tabMenu) return;
    const page = primaryPages.find(item => item.id === tabMenu.id);
    setTabMenuDraft(page?.title || "");
  }, [primaryPages, tabMenu]);

  const closeTabMenu = React.useCallback(() => setTabMenu(null), []);

  const openTabMenu = React.useCallback((page: Page, x: number, y: number) => {
    suppressClickRef.current = page.id;
    window.setTimeout(() => {
      if (suppressClickRef.current === page.id) suppressClickRef.current = null;
    }, 600);
    setTabMenu({ id: page.id, x, y });
  }, []);

  const saveTabMenu = React.useCallback(() => {
    if (!activeMenuPage) return;
    const clean = tabMenuDraft.trim().slice(0, 64);
    if (!clean) return;
    renamePage(activeMenuPage.id, clean);
    if (activeMenuPage.type === "terminal") renameSession(activeMenuPage.sessionId, clean);
    closeTabMenu();
  }, [activeMenuPage, closeTabMenu, renamePage, renameSession, tabMenuDraft]);

  const toggleTabPin = React.useCallback(() => {
    if (!activeMenuPage) return;
    togglePagePin(activeMenuPage.id);
    closeTabMenu();
  }, [activeMenuPage, closeTabMenu, togglePagePin]);

  const clearLongPress = React.useCallback(() => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  }, []);

  const moveTabBySwipe = React.useCallback((pageId: string, direction: -1 | 1) => {
    const index = primaryPages.findIndex(page => page.id === pageId);
    const target = primaryPages[index + direction];
    if (!target) return;
    reorderPage(pageId, target.id, direction > 0 ? "after" : "before");
  }, [primaryPages, reorderPage]);

  const computeDropPlacement = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
  }, []);

  return (
    <div className="reterm-tabbar">
      <div className="reterm-tabs">
        {primaryPages.map(page => {
          const isActive = page.id === activePageId ||
            (page.type === "files" && isFileViewType(activePage?.type));
          const isRunningTerminal = page.type === "terminal" && sessions.some(session => session.id === page.sessionId);
          const isDirtyFile = page.type === "editor";
          const hasFailedRun = page.type === "chat" && activityBadge.failed;
          const hasUnreadActivity = page.type === "chat" && activityBadge.unread > 0 && !isActive;

          return (
            <button
              key={page.id}
              ref={node => {
                if (node) tabRefs.current.set(page.id, node);
                else tabRefs.current.delete(page.id);
              }}
              className={`reterm-tab ${isActive ? "reterm-tab--active" : ""} reterm-tab--${page.type}`}
              draggable
              onClick={() => {
                if (suppressClickRef.current === page.id) {
                  suppressClickRef.current = null;
                  return;
                }
                switchPage(page.id);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                togglePagePin(page.id);
                setTabMenu(null);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                openTabMenu(page, event.clientX, event.clientY);
              }}
              onDragStart={(event) => {
                setDraggingId(page.id);
                setDropTarget(null);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", page.id);
              }}
              onDragOver={(event) => {
                if (!draggingId || draggingId === page.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget({ id: page.id, placement: computeDropPlacement(event) });
              }}
              onDragLeave={() => setDropTarget(current => current?.id === page.id ? null : current)}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId = event.dataTransfer.getData("text/plain") || draggingId;
                if (sourceId && sourceId !== page.id) {
                  const placement = dropTarget?.id === page.id ? dropTarget.placement : computeDropPlacement(event);
                  reorderPage(sourceId, page.id, placement);
                }
                setDraggingId(null);
                setDropTarget(null);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTarget(null);
              }}
              onPointerDown={(event) => {
                if (event.pointerType === "touch") {
                  const startX = event.clientX;
                  const startY = event.clientY;
                  touchDragRef.current = { id: page.id, x: startX, y: startY };
                  const press = { id: page.id, fired: false, timer: 0 };
                  press.timer = window.setTimeout(() => {
                    press.fired = true;
                    openTabMenu(page, startX, startY);
                  }, 560);
                  longPressRef.current = press;
                }
              }}
              onPointerUp={(event) => {
                const longPress = longPressRef.current;
                clearLongPress();
                if (longPress?.id === page.id && longPress.fired) {
                  event.preventDefault();
                  suppressClickRef.current = page.id;
                  return;
                }
                const start = touchDragRef.current;
                touchDragRef.current = null;
                if (!start || start.id !== page.id) return;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.35) {
                  event.preventDefault();
                  moveTabBySwipe(page.id, dx > 0 ? 1 : -1);
                }
              }}
              onPointerCancel={() => {
                clearLongPress();
                touchDragRef.current = null;
              }}
              data-dragging={draggingId === page.id ? "true" : undefined}
              data-drop-target={dropTarget?.id === page.id ? dropTarget.placement : undefined}
              data-pinned={page.pinned ? "true" : undefined}
              title={`${page.title}${page.pinned ? " (pinned)" : ""} · double-click pin · long-press/right-click menu`}
            >
              {page.pinned && <Pin size={10} strokeWidth={2} className="reterm-tab-pin" />}
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
              {page.type === "memory-graph" && <Network size={13} strokeWidth={1.9} className="reterm-tab-icon" />}
              <span className="reterm-tab-title" title="Double-click to pin">{page.title}</span>
              <span className="reterm-tab-indicators" aria-hidden="true">
                {isDirtyFile && <span className="reterm-tab-indicator reterm-tab-indicator--dirty" />}
                {isRunningTerminal && <span className="reterm-tab-indicator reterm-tab-indicator--running" />}
                {hasFailedRun && <span className="reterm-tab-indicator reterm-tab-indicator--failed" />}
                {hasUnreadActivity && <span className="reterm-tab-indicator reterm-tab-indicator--unread" />}
              </span>
              {!page.pinned && (
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
              )}
            </button>
          );
        })}
      </div>

      {tabMenu && activeMenuPage && (
        <div className="reterm-tab-menu-backdrop" aria-hidden="true">
          <div
            ref={tabMenuRef}
            className="reterm-tab-menu"
            role="menu"
            aria-label="tab actions"
            style={{
              left: Math.max(8, Math.min(tabMenu.x, window.innerWidth - 264)),
              top: Math.max(8, Math.min(tabMenu.y + 8, window.innerHeight - 240)),
            }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="reterm-tab-menu-head">
              <div className="reterm-tab-menu-label">tab actions</div>
              <button type="button" className="reterm-tab-menu-close" onClick={closeTabMenu} aria-label="close menu">
                <X size={12} />
              </button>
            </div>
            <label className="reterm-tab-menu-field">
              <span>name</span>
              <input
                value={tabMenuDraft}
                onChange={(event) => setTabMenuDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveTabMenu();
                  }
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="reterm-tab-menu-actions">
              <button type="button" onClick={saveTabMenu} className="reterm-tab-menu-btn">
                <Check size={12} /> save
              </button>
              <button type="button" onClick={toggleTabPin} className="reterm-tab-menu-btn">
                {activeMenuPage.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                {activeMenuPage.pinned ? "unpin" : "pin"}
              </button>
              {!activeMenuPage.pinned && (
                <button
                  type="button"
                  onClick={() => {
                    closePage(activeMenuPage.id);
                    closeTabMenu();
                  }}
                  className="reterm-tab-menu-btn reterm-tab-menu-btn--danger"
                >
                  <X size={12} /> close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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

      <button
        className="reterm-tab-new"
        onClick={() => openProgram("memory-graph")}
        title="open memory graph"
      >
        <Network size={14} strokeWidth={1.9} />
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
  const [debugInfo, setDebugInfo] = React.useState({
    branch: "",
    docker: "unknown",
    browser: "unknown",
    model: readActiveModel(),
    latency: "",
  });

  React.useEffect(() => {
    let alive = true;
    const refreshDebug = async () => {
      let latency = "";
      let docker = "unknown";
      let browser = "unknown";
      let branch = "";
      try {
        const serviceStatus = await getServiceStatus();
        latency = `${serviceStatus.durationMs}ms`;
        docker = serviceStatus.services?.docker?.ok ? "ok" : "down";
        browser = serviceStatus.services?.browser?.ok ? "ok" : "down";
        const gitPreview = serviceStatus.services?.git?.preview || "";
        branch = gitPreview.match(/##\s+([^\s.]+)/)?.[1] || gitPreview.match(/On branch\s+([^\s]+)/)?.[1] || "";
      } catch {
        latency = "api down";
      }

      if (alive) setDebugInfo({ branch, docker, browser, model: readActiveModel(), latency });
    };

    void refreshDebug();
    const interval = window.setInterval(() => void refreshDebug(), 30000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, []);

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
                  <span className="reterm-conn-badge__text">live</span>
                </>
              ) : isBusy ? (
                <>
                  <Loader2 size={10} className="reterm-spin" />
                  <span className="reterm-conn-badge__text">{status === "connecting" ? "sync" : "relink"}</span>
                </>
              ) : null}
            </span>
            <button className="reterm-statusbar-btn reterm-statusbar-btn--danger" onClick={disconnect} title="disconnect">
              <WifiOff size={11} strokeWidth={1.8} />
            </button>
            {termSession && termSession.cols !== 80 && (
              <span className="reterm-statusbar-item reterm-dims" title={`terminal size ${termSession.cols} by ${termSession.rows}`}>
                <Terminal size={11} strokeWidth={1.8} />
                <span className="reterm-statusbar-item__value">{termSession.cols}×{termSession.rows}</span>
              </span>
            )}
            {sessions.length > 0 && (
              <span className="reterm-statusbar-item reterm-statusbar-sessioncount" title={`${sessions.length} terminal session${sessions.length !== 1 ? "s" : ""}`}>
                <SquareTerminal size={11} strokeWidth={1.8} />
                <span className="reterm-statusbar-item__value">{sessions.length}</span>
              </span>
            )}
            <span className="reterm-statusbar-item reterm-statusbar-item--api" title="backend api port 3003">
              <Server size={11} strokeWidth={1.8} />
              <span className="reterm-statusbar-item__value">3003</span>
            </span>
            {debugInfo.branch && (
              <span className="reterm-statusbar-item reterm-statusbar-item--branch" title={`git branch ${debugInfo.branch}`}>
                <GitBranch size={11} strokeWidth={1.8} />
                <span className="reterm-statusbar-item__value">{shortBranch(debugInfo.branch)}</span>
              </span>
            )}
            <span className={`reterm-statusbar-item reterm-statusbar-item--icononly reterm-statusbar-docker reterm-statusbar-docker--${debugInfo.docker}`} title={`docker ${debugInfo.docker}`}>
              <Blocks size={11} strokeWidth={1.8} />
            </span>
            <span className={`reterm-statusbar-item reterm-statusbar-item--icononly reterm-statusbar-docker reterm-statusbar-docker--${debugInfo.browser}`} title={`lightpanda ${debugInfo.browser}`}>
              <Globe size={11} strokeWidth={1.8} />
            </span>
            <span className="reterm-statusbar-item reterm-statusbar-item--icononly reterm-statusbar-item--model" title={`active model ${debugInfo.model}`}>
              <MessageSquare size={11} strokeWidth={1.8} />
            </span>
            {debugInfo.latency && (
              <span className="reterm-statusbar-item reterm-statusbar-item--latency" title={`service ping ${debugInfo.latency}`}>
                <RotateCw size={11} strokeWidth={1.8} />
                <span className="reterm-statusbar-item__value">{debugInfo.latency}</span>
              </span>
            )}
          </div>
        </div>
        <div className="reterm-statusbar-right">
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

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { openFiles, openProgram } = useApp();
  const { createSession } = useTerminal();
  const [query, setQuery] = React.useState("");
  const [notice, setNotice] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setNotice("");
  }, [open]);

  if (!open) return null;

  const commands = [
    { id: "files", label: "Open files", hint: "workspace explorer", icon: FolderOpen, run: () => openFiles("/") },
    { id: "mcp", label: "Open MCP page", hint: "servers, tools, logs", icon: Blocks, run: () => openProgram("mcp") },
    { id: "extensions", label: "Open extensions page", hint: "catalog and imports", icon: Puzzle, run: () => openProgram("extensions") },
    { id: "chat", label: "Open AI chat", hint: "agent console", icon: MessageSquare, run: () => openProgram("chat") },
    { id: "browser", label: "Open Lightpanda browser", hint: "shared AI/browser inspector", icon: Globe, run: () => openProgram("browser") },
    { id: "terminal", label: "Open terminal", hint: "new shell session", icon: Terminal, run: () => createSession(`terminal ${Date.now()}`) },
    { id: "clear-activity", label: "Clear activity", hint: "run inspector logs", icon: ClipboardCheck, run: () => clearStoredActivity() },
    { id: "restart-server", label: "Restart server", hint: "placeholder: backend action not exposed", icon: RotateCw, run: () => setNotice("restart server TODO: backend action not exposed") },
    {
      id: "docker",
      label: "Check docker status",
      hint: "uses MCP if available",
      icon: Stethoscope,
      run: async () => {
        setNotice("checking docker...");
        try {
          await callMcpTool("mcp__ops__local_docker_status", {});
          setNotice("docker ok");
        } catch (err) {
          setNotice(err instanceof Error ? err.message.slice(0, 120) : "docker check failed");
        }
      },
    },
  ];

  const filtered = commands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(query.toLowerCase()));

  const runCommand = (command: typeof commands[number]) => {
    void Promise.resolve(command.run()).then(() => {
      if (command.id !== "docker" && command.id !== "restart-server") onClose();
    });
  };

  return (
    <div className="command-palette-backdrop" onMouseDown={onClose}>
      <div className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
        <label className="command-palette-search">
          <Search size={14} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "Enter" && filtered[0]) runCommand(filtered[0]);
            }}
            placeholder="run command"
          />
          <span>ctrl+k</span>
        </label>
        <div className="command-palette-list">
          {filtered.map((command) => {
            const Icon = command.icon;
            return (
              <button key={command.id} type="button" onClick={() => runCommand(command)} className="command-palette-row">
                <Icon size={14} />
                <span>{command.label}</span>
                <em>{command.hint}</em>
              </button>
            );
          })}
        </div>
        {notice && <div className="command-palette-notice">{notice}</div>}
      </div>
    </div>
  );
}

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
  if (page.type === "browser")   return <BrowserShell isActive={isActive} />;
  if (page.type === "chat")      return <ChatShell isActive={isActive} />;
  if (page.type === "forum")     return <ForumShell />;
  if (page.type === "community") return <CommunityShell />;
  if (page.type === "mcp")       return <McpShell isActive={isActive} />;
  if (page.type === "extensions") return <ExtensionsShell />;
  if (page.type === "plugins")   return <PluginsShell />;
  if (page.type === "scripts")   return <ScriptsShell />;
  if (page.type === "playground") return <PlaygroundShell />;
  if (page.type === "memory-graph") return <MemoryGraph isActive={isActive} />;
  return null;
}

const PageSlot = React.memo(function PageSlot({
  page,
  isActive,
}: {
  page: Page;
  isActive: boolean;
}) {
  return (
    <div
      aria-hidden={!isActive}
      className={`reterm-page-slot ${isActive ? "reterm-page-slot--active" : ""}`}
      style={{
        zIndex: isActive ? 1 : 0,
        visibility: isActive ? "visible" : "hidden",
        pointerEvents: isActive ? "auto" : "none",
      }}
    >
      <PageContent page={page} isActive={isActive} />
    </div>
  );
}, (prev, next) => prev.page === next.page && prev.isActive === next.isActive);

// ─── Main app ─────────────────────────────────────────────────────────────────

export function TerminalPage() {
  const { status, sessions, hasSessionList, createSession, closeSession } = useTerminal();
  const { pages, activePageId, openTerminal, setTerminalCloser } = useApp();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(open => !open);
        return;
      }
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
          pages.map((page) => {
            const isActive = page.id === activePageId;
            return <PageSlot key={page.id} page={page} isActive={isActive} />;
          })
        )}
      </div>

      <StatusBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
