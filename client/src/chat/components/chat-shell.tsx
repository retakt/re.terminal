import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PanelRightOpenIcon, PanelRightCloseIcon, Brain } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Thread } from "./thread";
import { RightPanel, type PanelMotionMode } from "./right-panel";
import { MemoryPanel } from "./memory-panel";
import { ChatProvider, useChatContext } from "../engine/chat-provider";

const PANEL_MOTION_KEY = "reterm.chat.panelMotion";

function loadPanelMotion(): PanelMotionMode {
  if (typeof window === "undefined") return "square";
  const value = window.localStorage.getItem(PANEL_MOTION_KEY);
  return value === "soft" || value === "off" || value === "square" ? value : "square";
}

// ── Chat toolbar ──────────────────────────────────────────────────────────────

function ChatToolbar({
  onTogglePanel,
  onOpenMemory,
  panelOpen,
}: {
  onTogglePanel: () => void;
  onOpenMemory: () => void;
  panelOpen: boolean;
}) {
  const { sessionId } = useChatContext();

  return (
    <div className="chat-toolbar-row relative z-30 flex items-center justify-between px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold lowercase text-foreground">ai chat</span>
        <span className="font-mono text-[10px] text-muted-foreground/50">
          {sessionId.slice(0, 8)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="chat-tool-button size-7 rounded-sm text-muted-foreground"
          onClick={onOpenMemory}
          title="Open memory panel"
        >
          <Brain className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "chat-tool-button size-7 rounded-sm transition-all duration-150",
            panelOpen
              ? "is-active text-primary"
              : "text-muted-foreground"
          )}
          onClick={onTogglePanel}
          title={panelOpen ? "Close activity log" : "Open activity log"}
        >
          {panelOpen ? (
            <PanelRightCloseIcon className="size-3.5" />
          ) : (
            <PanelRightOpenIcon className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Chat layout ───────────────────────────────────────────────────────────────

function ChatLayout() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [panelMotion, setPanelMotion] = useState<PanelMotionMode>(() => loadPanelMotion());
  const togglePanel = useCallback(() => setPanelOpen((p) => !p), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const openMemory = useCallback(() => setShowMemory(true), []);
  const { sessionId } = useChatContext();

  const handlePanelMotionChange = useCallback((next: PanelMotionMode) => {
    setPanelMotion(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PANEL_MOTION_KEY, next);
    }
  }, []);

  return (
    <div className="chat-shell-root flex h-full flex-col overflow-hidden">
      <ChatToolbar onTogglePanel={togglePanel} onOpenMemory={openMemory} panelOpen={panelOpen} />

      {/* Main content area */}
      <div className="chat-workspace relative flex flex-1 overflow-hidden">
        {panelOpen ? (
          <ResizablePanelGroup
            orientation="horizontal"
            className="chat-split-group"
          >
            <ResizablePanel minSize="34%">
              <Thread />
            </ResizablePanel>
            <ResizableHandle className="chat-resize-handle" />
            <ResizablePanel
              defaultSize="320px"
              minSize="238px"
              maxSize="520px"
              groupResizeBehavior="preserve-pixel-size"
            >
              <div className={cn("chat-activity-pane", `chat-motion-${panelMotion}`)}>
                <RightPanel
                  onClose={closePanel}
                  motionMode={panelMotion}
                  onMotionModeChange={handlePanelMotionChange}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <Thread />
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

export function ChatShell() {
  return (
    <ChatProvider>
      <ChatLayout />
    </ChatProvider>
  );
}
