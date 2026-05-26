import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PanelLeftCloseIcon, PanelLeftOpenIcon, PanelRightOpenIcon, PanelRightCloseIcon, Brain, SlidersHorizontalIcon, PencilIcon, Trash2Icon, MessageSquareIcon, GlobeIcon } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Thread } from "./thread";
import { ModelSection, RightPanel, RuntimeContextSection, type PanelMotionMode } from "./right-panel";
import { MemoryPanel } from "./memory-panel";
import { ChatProvider, useChatContext } from "../engine/chat-provider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useApp } from "@/contexts/app-context";

const PANEL_MOTION_KEY = "reterm.chat.panelMotion";
const MOBILE_QUERY = "(max-width: 1024px), (hover: none) and (pointer: coarse)";
const MOBILE_PANEL_EXIT_MS = 380;
const BROWSER_SESSION_ID_KEY = "reterm.browser.agentSessionId";
const BROWSER_SESSION_LINK_EVENT = "reterm.browser.session-link";
type MobilePanelSide = "context" | "activity";

function loadPanelMotion(): PanelMotionMode {
  if (typeof window === "undefined") return "soft";
  const value = window.localStorage.getItem(PANEL_MOTION_KEY);
  return value === "soft" || value === "off" || value === "square" ? value : "soft";
}

function useIsCompactChatLayout() {
  const getIsCompact = () =>
    typeof window !== "undefined" &&
    window.matchMedia(MOBILE_QUERY).matches;

  const [isCompact, setIsCompact] = useState(getIsCompact);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const query = window.matchMedia(MOBILE_QUERY);
    const handleChange = () => setIsCompact(query.matches);

    handleChange();
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return isCompact;
}

function sessionHash(sessionId = "") {
  return sessionId ? sessionId.slice(0, 8) : "--------";
}

// ── Chat toolbar ──────────────────────────────────────────────────────────────

function ChatToolbar({
  onToggleContext,
  onTogglePanel,
  onOpenMemory,
  contextOpen,
  panelOpen,
  showPanelToggle,
  showContextToggle,
}: {
  onToggleContext: () => void;
  onTogglePanel: () => void;
  onOpenMemory: () => void;
  contextOpen: boolean;
  panelOpen: boolean;
  showPanelToggle: boolean;
  showContextToggle: boolean;
}) {
  const { sessionId: activeSessionId, chatMode, runtimeContext, clearChatHistory } = useChatContext();
  const { pages, activePageId, openProgram, renamePage } = useApp();
  const activePage = pages.find(page => page.id === activePageId);
  const sessionTitle = activePage?.title || "ai chat";
  const sessionId = (activePage as any)?.sessionId || activeSessionId;
  const contextActive = Boolean(runtimeContext.notes.trim() || runtimeContext.skills.trim());
  const renameSessionTitle = () => {
    if (!activePageId) return;
    const next = window.prompt("Name this chat session", sessionTitle)?.trim();
    if (!next || next === sessionTitle) return;
    renamePage(activePageId, next.slice(0, 64));
  };

  return (
    <div className="chat-toolbar-row relative z-30 flex items-center justify-between px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {showContextToggle && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "chat-tool-button size-8 rounded-sm transition-all duration-150",
              contextOpen ? "is-active text-primary" : "text-muted-foreground"
            )}
            onClick={onToggleContext}
            title={contextOpen ? "Close context panel" : "Open context panel"}
          >
            {contextOpen ? (
              <PanelLeftCloseIcon className="size-4" />
            ) : (
              <PanelLeftOpenIcon className="size-4" />
            )}
          </Button>
        )}
        <button type="button" className="chat-session-title" onClick={renameSessionTitle} title="Rename chat session">
          <span>{sessionTitle}</span>
          <PencilIcon className="size-3" />
        </button>
        <button
          type="button"
          className="chat-tool-button size-7 rounded-sm text-muted-foreground hover:text-primary transition-colors"
          onClick={() => openProgram("chat")}
          title="Create new chat session"
        >
          <span className="text-lg leading-none">+</span>
        </button>
        <span className="font-mono text-[10px] text-muted-foreground/50">
          {sessionId.slice(0, 8)}
        </span>
        <span className={`chat-mode-pill chat-mode-pill--${chatMode}`}>{chatMode}</span>
        {contextActive && <span className="chat-mode-pill chat-mode-pill--context">notes</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="chat-tool-button size-8 rounded-sm text-muted-foreground"
          onClick={() => {
            if (window.confirm("Flush this session's history and memory? This cannot be undone.")) clearChatHistory();
          }}
          title="Flush this session's history and memory"
        >
          <Trash2Icon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="chat-tool-button size-8 rounded-sm text-muted-foreground"
          onClick={onOpenMemory}
          title="Open memory panel"
        >
          <Brain className="size-4" />
        </Button>
        {showPanelToggle && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "chat-tool-button size-8 rounded-sm transition-all duration-150",
              panelOpen ? "is-active text-primary" : "text-muted-foreground"
            )}
            onClick={onTogglePanel}
            title={panelOpen ? "Close activity log" : "Open activity log"}
          >
            {panelOpen ? (
              <PanelRightCloseIcon className="size-4" />
            ) : (
              <PanelRightOpenIcon className="size-4" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function ContextPanel() {
  return (
    <div className="chat-context-panel flex h-full flex-col">
      <div className="chat-context-header flex items-center gap-2 px-3 py-1.5">
        <SlidersHorizontalIcon className="size-3.5 text-primary" />
        <span className="text-[13px] font-semibold lowercase text-foreground">context</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          <ModelSection />
          <RuntimeContextSection />
          <ChatSessionsSection />
        </div>
      </ScrollArea>
    </div>
  );
}

function ChatSessionsSection() {
  const { sessionId: activeSessionId, setChatMode } = useChatContext();
  const { pages, switchPage } = useApp();
  const chatPages = pages.flatMap((page, index) => {
    if (page.type !== "chat" || !("sessionId" in page) || !page.sessionId) return [];
    return [{
      pageId: page.id,
      title: page.title || `session #${index + 1}`,
      sessionId: String(page.sessionId),
    }];
  });

  const linkBrowserSession = (pageId: string, sessionId: string) => {
    try {
      window.localStorage.setItem(BROWSER_SESSION_ID_KEY, sessionId);
      window.dispatchEvent(new CustomEvent(BROWSER_SESSION_LINK_EVENT, { detail: { sessionId } }));
    } catch {}
    setChatMode("browser");
    switchPage(pageId);
  };

  return (
    <section className="chat-session-switcher">
      <div className="chat-session-switcher__head">
        <span>chat sessions</span>
        <small>tabs own sessions</small>
      </div>
      <div className="chat-session-switcher__list">
        {chatPages.length === 0 ? (
          <em>No chat sessions yet.</em>
        ) : (
          chatPages.map((page) => {
            const sessionId = page.sessionId;
            const active = sessionId === activeSessionId;
            return (
              <div key={page.pageId} className={cn("chat-session-switcher__row", active && "is-active")}>
                <button type="button" className="chat-session-switcher__main" onClick={() => switchPage(page.pageId)}>
                  <MessageSquareIcon className="size-3.5" />
                  <span>{page.title}</span>
                  <code>#{sessionHash(sessionId)}</code>
                </button>
                <button
                  type="button"
                  className="chat-session-switcher__browser"
                  onClick={() => linkBrowserSession(page.pageId, sessionId)}
                  title="Use this chat session as the browser-agent session"
                >
                  <GlobeIcon className="size-3" />
                  browser
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function MobileContextPanel({
  mounted,
  isClosing,
  onClose,
}: {
  mounted: boolean;
  isClosing: boolean;
  onClose: () => void;
}) {
  if (!mounted) return null;
  const motionClass = isClosing ? "is-closing" : "is-open";

  return (
    <>
      <button
        type="button"
        className={cn("chat-mobile-context-backdrop", motionClass)}
        aria-label="Close context panel"
        disabled={isClosing}
        onClick={onClose}
      />
      <aside className={cn("chat-mobile-context-drawer", motionClass)}>
        <ContextPanel />
      </aside>
    </>
  );
}

// ── Chat layout ───────────────────────────────────────────────────────────────

function MobileActivityPanel({
  mounted,
  isClosing,
  onClose,
  isActive,
  panelMotion,
  onMotionModeChange,
}: {
  mounted: boolean;
  isClosing: boolean;
  onClose: () => void;
  isActive: boolean;
  panelMotion: PanelMotionMode;
  onMotionModeChange: (next: PanelMotionMode) => void;
}) {
  if (!mounted) return null;
  const motionClass = isClosing ? "is-closing" : "is-open";

  return (
    <>
      <button
        type="button"
        className={cn("chat-mobile-panel-backdrop", motionClass)}
        aria-label="Close activity panel"
        disabled={isClosing}
        onClick={onClose}
      />
      <aside className={cn("chat-mobile-panel-drawer", motionClass)}>
        <div className={cn("chat-activity-pane", `chat-motion-${panelMotion}`)}>
          <RightPanel
            onClose={onClose}
            isActive={isActive && !isClosing}
            motionMode={panelMotion}
            onMotionModeChange={onMotionModeChange}
          />
        </div>
      </aside>
    </>
  );
}

function ChatLayout({ isActive }: { isActive: boolean }) {
  const isCompact = useIsCompactChatLayout();
  const [mobilePanel, setMobilePanel] = useState<MobilePanelSide | null>(null);
  const [closingMobilePanel, setClosingMobilePanel] = useState<MobilePanelSide | null>(null);
  const [showMemory, setShowMemory] = useState(false);
  const [panelMotion, setPanelMotion] = useState<PanelMotionMode>(() => loadPanelMotion());
  const mobilePanelSwitchTimer = useRef<number | null>(null);

  const clearMobilePanelTimer = useCallback(() => {
    if (mobilePanelSwitchTimer.current === null) return;
    window.clearTimeout(mobilePanelSwitchTimer.current);
    mobilePanelSwitchTimer.current = null;
  }, []);

  const closeMobilePanel = useCallback((side: MobilePanelSide) => {
    if (mobilePanel !== side) return;

    clearMobilePanelTimer();
    setMobilePanel(null);
    setClosingMobilePanel(side);
    mobilePanelSwitchTimer.current = window.setTimeout(() => {
      setClosingMobilePanel((current) => (current === side ? null : current));
      mobilePanelSwitchTimer.current = null;
    }, MOBILE_PANEL_EXIT_MS);
  }, [clearMobilePanelTimer, mobilePanel]);

  const toggleMobilePanel = useCallback((side: MobilePanelSide) => {
    clearMobilePanelTimer();

    if (mobilePanel === side) {
      setMobilePanel(null);
      setClosingMobilePanel(side);
      mobilePanelSwitchTimer.current = window.setTimeout(() => {
        setClosingMobilePanel((current) => (current === side ? null : current));
        mobilePanelSwitchTimer.current = null;
      }, MOBILE_PANEL_EXIT_MS);
      return;
    }

    if (mobilePanel) {
      const previous = mobilePanel;
      setMobilePanel(null);
      setClosingMobilePanel(previous);
      mobilePanelSwitchTimer.current = window.setTimeout(() => {
        setClosingMobilePanel(null);
        setMobilePanel(side);
        mobilePanelSwitchTimer.current = null;
      }, MOBILE_PANEL_EXIT_MS);
      return;
    }

    setClosingMobilePanel(null);
    setMobilePanel(side);
  }, [clearMobilePanelTimer, mobilePanel]);

  const togglePanel = useCallback(() => toggleMobilePanel("activity"), [toggleMobilePanel]);
  const toggleContext = useCallback(() => toggleMobilePanel("context"), [toggleMobilePanel]);
  const closePanel = useCallback(() => closeMobilePanel("activity"), [closeMobilePanel]);
  const closeContext = useCallback(() => closeMobilePanel("context"), [closeMobilePanel]);

  const openMemory = useCallback(() => setShowMemory(true), []);
  const { sessionId } = useChatContext();

  useEffect(() => {
    clearMobilePanelTimer();
    setMobilePanel(null);
    setClosingMobilePanel(null);
  }, [clearMobilePanelTimer, isCompact]);

  useEffect(() => clearMobilePanelTimer, [clearMobilePanelTimer]);

  const contextOpen = isCompact && mobilePanel === "context";
  const panelOpen = isCompact && mobilePanel === "activity";
  const contextMounted = isCompact && (mobilePanel === "context" || closingMobilePanel === "context");
  const panelMounted = isCompact && (mobilePanel === "activity" || closingMobilePanel === "activity");
  const contextClosing = closingMobilePanel === "context";
  const panelClosing = closingMobilePanel === "activity";

  const handlePanelMotionChange = useCallback((next: PanelMotionMode) => {
    setPanelMotion(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PANEL_MOTION_KEY, next);
    }
  }, []);

  return (
    <div className="chat-shell-root flex h-full flex-col overflow-hidden">
      <ChatToolbar
        onToggleContext={toggleContext}
        onTogglePanel={togglePanel}
        onOpenMemory={openMemory}
        contextOpen={contextOpen}
        panelOpen={panelOpen}
        showPanelToggle={isCompact}
        showContextToggle={isCompact}
      />

      {/* Main content area */}
      <div
        className={cn(
          "chat-workspace relative flex flex-1 overflow-hidden",
          isCompact && "chat-workspace--mobile"
        )}
      >
        {isCompact ? (
          <>
            <Thread isActive={isActive} />
            <MobileContextPanel
              mounted={contextMounted}
              isClosing={contextClosing}
              onClose={closeContext}
            />
            <MobileActivityPanel
              mounted={panelMounted}
              isClosing={panelClosing}
              onClose={closePanel}
              isActive={isActive && panelOpen}
              panelMotion={panelMotion}
              onMotionModeChange={handlePanelMotionChange}
            />
          </>
        ) : (
          <ResizablePanelGroup
            orientation="horizontal"
            className="chat-split-group"
          >
            <ResizablePanel
              defaultSize="280px"
              minSize="240px"
              maxSize="360px"
              groupResizeBehavior="preserve-pixel-size"
            >
              <div className="chat-context-pane">
                <ContextPanel />
              </div>
            </ResizablePanel>
            <ResizableHandle className="chat-resize-handle" />
            <ResizablePanel minSize="420px">
              <Thread isActive={isActive} />
            </ResizablePanel>
            <ResizableHandle className="chat-resize-handle" />
            <ResizablePanel
              defaultSize="560px"
              minSize="320px"
              maxSize="760px"
              groupResizeBehavior="preserve-pixel-size"
            >
              <div className={cn("chat-activity-pane", `chat-motion-${panelMotion}`)}>
                <RightPanel
                  onClose={undefined}
                  isActive={isActive}
                  motionMode={panelMotion}
                  onMotionModeChange={handlePanelMotionChange}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      {/* Memory Panel Modal */}
      {showMemory && (
        <MemoryPanel projectId={sessionId} onClose={() => setShowMemory(false)} />
      )}
    </div>
  );
}

// ── Chat shell (entry point) ──────────────────────────────────────────────────

export function ChatShell({
  isActive = true,
  pageSessionId,
  pageTitle,
}: {
  isActive?: boolean;
  pageSessionId?: string;
  pageTitle?: string;
}) {
  const { pages, activePageId } = useApp();
  const activePage = pages.find(p => p.id === activePageId);
  const initialSessionId = pageSessionId || (activePage as any)?.sessionId;
  const sessionName = pageTitle || activePage?.title;

  return (
    <ChatProvider initialSessionId={initialSessionId} sessionName={sessionName} isActive={isActive}>
      <ChatLayout isActive={isActive} />
    </ChatProvider>
  );
}
