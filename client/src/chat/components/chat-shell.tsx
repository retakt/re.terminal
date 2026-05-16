import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PanelRightOpenIcon, PanelRightCloseIcon, Brain } from "lucide-react";
import { Thread } from "./thread";
import { RightPanel } from "./right-panel";
import { MemoryPanel } from "./memory-panel";
import { ChatProvider, useChatContext } from "../engine/chat-provider";

// ── Chat toolbar ──────────────────────────────────────────────────────────────

function ChatToolbar({
  onTogglePanel,
  panelOpen,
}: {
  onTogglePanel: () => void;
  panelOpen: boolean;
}) {
  const { sessionId } = useChatContext();

  return (
    <div className="relative z-30 flex items-center justify-between border-b border-border/50 bg-background/95 backdrop-blur-sm px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">AI Chat</span>
        <span className="font-mono text-[10px] text-muted-foreground/50">
          {sessionId.slice(0, 8)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setShowMemory(true)}
          title="Open memory panel"
        >
          <Brain className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-8 rounded-lg transition-all duration-200",
            panelOpen
              ? "bg-primary/10 text-primary hover:bg-primary/20"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
      </div>
    </div>
  );
}

// ── Chat layout ───────────────────────────────────────────────────────────────

function ChatLayout() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const togglePanel = useCallback(() => setPanelOpen((p) => !p), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const { sessionId } = useChatContext();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <ChatToolbar onTogglePanel={togglePanel} panelOpen={panelOpen} />

      {/* Main content area */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Chat thread */}
        <div
          className={cn(
            "flex-1 transition-all duration-300 ease-out",
            panelOpen ? "mr-[320px]" : "mr-0"
          )}
        >
          <Thread />
        </div>

        {/* Right panel - slides in from right */}
        <div
          className={cn(
            "absolute right-0 top-0 z-20 h-full w-[320px] border-l border-border/50 bg-background shadow-xl transition-transform duration-300 ease-out",
            panelOpen ? "translate-x-0" : "translate-x-full"
          )}
        >
          <RightPanel onClose={closePanel} />
        </div>
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
