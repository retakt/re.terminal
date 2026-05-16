import { useEffect, useState } from "react";
import { useChatContext } from "../engine/chat-provider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  BrainIcon,
  WrenchIcon,
  LoaderIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Tool log entry ────────────────────────────────────────────────────────────

function ToolLogEntry({
  log,
}: {
  log: {
    tool: string;
    args: Record<string, string>;
    result: string;
    status: string;
    timestamp?: number;
  };
}) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = log.status === "running" ? (
    <LoaderIcon className="size-3.5 animate-spin text-orange-500" />
  ) : log.status === "complete" ? (
    <CheckCircleIcon className="size-3.5 text-green-500" />
  ) : (
    <XCircleIcon className="size-3.5 text-red-500" />
  );

  const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "";

  return (
    <div className={cn(
      "rounded-lg border p-2.5 transition-all duration-200",
      "border-border/50 bg-muted/30 hover:bg-muted/50"
    )}>
      <button
        className="flex w-full items-center gap-2 text-left text-xs bg-transparent border-none cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {statusIcon}
        <WrenchIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">{log.tool}</span>
        <span className="text-[10px] text-muted-foreground/60 ml-auto">{time}</span>
        {expanded ? (
          <ChevronUpIcon className="size-3 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 text-[11px] animate-in fade-in slide-in-from-top-1 duration-200">
          <div>
            <span className="text-muted-foreground font-medium">Args:</span>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-muted-foreground/80 bg-muted/50 rounded p-2 text-[10px]">
              {JSON.stringify(log.args, null, 2)}
            </pre>
          </div>
          {log.result && (
            <div>
              <span className="text-muted-foreground font-medium">Result:</span>
              <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-muted-foreground/80 bg-muted/50 rounded p-2 text-[10px]">
                {log.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Thinking panel ────────────────────────────────────────────────────────────

function ThinkingSection() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <BrainIcon className="size-3.5 text-orange-500" />
        <span>Thinking</span>
      </div>
      <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground/60 italic">
        Thinking process will appear here when the AI reasons...
      </div>
    </div>
  );
}

// ── Tool logs panel ───────────────────────────────────────────────────────────

function ToolLogsSection() {
  const { toolLogsRef } = useChatContext();
  const [logs, setLogs] = useState<typeof toolLogsRef.current>([]);

  // Poll for updates (simple approach)
  useEffect(() => {
    const interval = setInterval(() => {
      const current = toolLogsRef.current;
      if (JSON.stringify(current) !== JSON.stringify(logs)) {
        setLogs([...current]);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [toolLogsRef, logs]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <WrenchIcon className="size-3.5 text-orange-500" />
        <span>Tool Calls</span>
        {logs.length > 0 && (
          <span className="ml-auto rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[10px] text-orange-500">
            {logs.length}
          </span>
        )}
      </div>
      {logs.length === 0 ? (
        <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground/60 italic">
          Tool calls will appear here when the AI uses tools...
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log, i) => (
            <ToolLogEntry key={`${log.tool}-${i}`} log={log} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Right side panel ──────────────────────────────────────────────────────────

export function RightPanel({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5">
        <span className="text-sm font-semibold text-foreground">Activity Log</span>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-lg transition-all duration-200 hover:bg-muted"
            onClick={onClose}
            title="Close panel"
          >
            <XIcon className="size-4" />
          </Button>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          <ThinkingSection />
          <Separator />
          <ToolLogsSection />
        </div>
      </ScrollArea>
    </div>
  );
}
