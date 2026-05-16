import { useEffect, useState } from "react";
import { useChatContext } from "../engine/chat-provider";
import type { ToolLog } from "../types";
import { updateMemory, type MemoryRecord } from "../api/memory";
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
  SaveIcon,
  NetworkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GraphVisualizer } from "./graph-visualizer";

export type PanelMotionMode = "square" | "soft" | "off";

// ── Tool log entry ────────────────────────────────────────────────────────────

function memorySummary(memory?: MemoryRecord | null, fallback = "") {
  return memory?.text
    || memory?.message
    || memory?.description
    || memory?.value
    || memory?.error
    || memory?.context
    || fallback
    || "";
}

function memoryFields(type?: string) {
  switch ((type || "command").toLowerCase()) {
    case "error":
      return [
        { key: "message", label: "message", multiline: true },
        { key: "context", label: "context", multiline: true },
      ] as const;
    case "fix":
      return [
        { key: "error", label: "error", multiline: true },
        { key: "description", label: "fix", multiline: true },
      ] as const;
    case "preference":
      return [
        { key: "key", label: "key", multiline: false },
        { key: "value", label: "value", multiline: true },
      ] as const;
    default:
      return [
        { key: "text", label: "text", multiline: true },
        { key: "output", label: "output", multiline: true },
      ] as const;
  }
}

function MemoryLogEntry({
  log,
  onLogsChanged,
}: {
  log: ToolLog;
  onLogsChanged: () => void;
}) {
  const { sessionId, persistToolLogs } = useChatContext();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<MemoryRecord>(log.memory || { type: "command", text: log.args.text || "" });
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!saving) setDraft(log.memory || { type: "command", text: log.args.text || "" });
  }, [log.args.text, log.memory, saving]);

  const statusIcon = log.status === "running" ? (
    <LoaderIcon className="size-3.5 animate-spin text-primary" />
  ) : log.status === "complete" ? (
    <CheckCircleIcon className="size-3.5 text-primary" />
  ) : (
    <XCircleIcon className="size-3.5 text-red-500" />
  );

  const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "";
  const summary = memorySummary(log.memory, log.args.text);
  const fields = memoryFields(draft.type);
  const canSave = Boolean(draft.memoryId || draft.id || draft.nodeId != null);

  const saveDraft = async () => {
    if (!canSave) {
      setLocalError("waiting for database id");
      return;
    }

    setSaving(true);
    setLocalError("");
    try {
      const response = await updateMemory(sessionId, draft);
      if (response.success && response.memory) {
        log.memory = response.memory;
        log.result = memorySummary(response.memory, "memory updated");
        log.status = "complete";
        setDraft(response.memory);
        persistToolLogs();
        onLogsChanged();
      } else {
        setLocalError(response.reason || "memory update failed");
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "memory update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="chat-log-card chat-log-card--memory overflow-hidden rounded-sm transition-colors duration-150">
      <button
        className="flex w-full items-start gap-2 bg-transparent px-2.5 py-2 text-left text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        {statusIcon}
        <BrainIcon className="mt-px size-3.5 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">memory.save</span>
            <span className="rounded-sm border border-primary/25 bg-background/70 px-1 font-mono text-[9px] uppercase text-primary">
              {draft.type || "command"}
            </span>
          </span>
          <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
            {summary || log.result || "saving memory..."}
          </span>
        </span>
        <span className="mt-px shrink-0 font-mono text-[10px] text-muted-foreground/70">{time}</span>
        {expanded ? (
          <ChevronUpIcon className="mt-px size-3 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="mt-px size-3 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="chat-log-detail space-y-2 px-2.5 py-2 animate-in fade-in slide-in-from-top-1 duration-150">
          {fields.map((field) => (
            <label key={field.key} className="block space-y-1">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">{field.label}</span>
              {field.multiline ? (
                <textarea
                  className="chat-edit-field min-h-16 w-full resize-y rounded-sm px-2 py-1.5 font-mono text-[11px] leading-4 text-foreground outline-none transition-colors"
                  value={String(draft[field.key] || "")}
                  onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                />
              ) : (
                <input
                  className="chat-edit-field h-7 w-full rounded-sm px-2 font-mono text-[11px] text-foreground outline-none transition-colors"
                  value={String(draft[field.key] || "")}
                  onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                />
              )}
            </label>
          ))}

          {localError && (
            <div className="rounded-sm border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
              {localError}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {canSave ? draft.memoryId || draft.id || draft.nodeId : "pending id"}
            </span>
            <Button className="chat-solid-button h-7 gap-1.5 rounded-sm px-2 text-xs" onClick={saveDraft} disabled={saving || !canSave}>
              {saving ? <LoaderIcon className="size-3 animate-spin" /> : <SaveIcon className="size-3" />}
              save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolLogEntry({ log }: { log: ToolLog }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = log.status === "running" ? (
    <LoaderIcon className="size-3.5 animate-spin text-primary" />
  ) : log.status === "complete" ? (
    <CheckCircleIcon className="size-3.5 text-primary" />
  ) : (
    <XCircleIcon className="size-3.5 text-red-500" />
  );

  const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "";

  return (
    <div className="chat-log-card rounded-sm p-2.5 transition-all duration-150">
      <button
        className="flex w-full items-center gap-2 text-left text-xs bg-transparent border-none cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {statusIcon}
        <WrenchIcon className="size-3.5 text-primary" />
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
            <pre className="chat-code-block mt-1 whitespace-pre-wrap rounded-sm p-2 font-mono text-[10px] text-muted-foreground/80">
              {JSON.stringify(log.args, null, 2)}
            </pre>
          </div>
          {log.result && (
            <div>
              <span className="text-muted-foreground font-medium">Result:</span>
              <pre className="chat-code-block mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-sm p-2 font-mono text-[10px] text-muted-foreground/80">
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
        <BrainIcon className="size-3.5 text-primary" />
        <span>thinking</span>
      </div>
      <div className="chat-empty-note rounded-sm px-3 py-2 text-[11px] text-muted-foreground/70 italic">
        reasoning notes appear here when the model thinks
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
        <WrenchIcon className="size-3.5 text-primary" />
        <span>events</span>
        {logs.length > 0 && (
          <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            {logs.length}
          </span>
        )}
      </div>
      {logs.length === 0 ? (
        <div className="chat-empty-note rounded-sm px-3 py-2 text-[11px] text-muted-foreground/70 italic">
          tool calls and memory saves appear here
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log, i) => (
            log.tool.startsWith("memory.") ? (
              <MemoryLogEntry
                key={`${log.tool}-${i}`}
                log={log}
                onLogsChanged={() => setLogs([...toolLogsRef.current])}
              />
            ) : (
              <ToolLogEntry key={`${log.tool}-${i}`} log={log} />
            )
          ))}
        </div>
      )}
    </div>
  );
}

// ── Right side panel ──────────────────────────────────────────────────────────

export function RightPanel({
  onClose,
  motionMode = "square",
  onMotionModeChange,
}: {
  onClose?: () => void;
  motionMode?: PanelMotionMode;
  onMotionModeChange?: (mode: PanelMotionMode) => void;
}) {
  const [showGraph, setShowGraph] = useState(false);

  return (
    <div className="chat-activity-panel flex h-full flex-col">
      {/* Header */}
      <div className="chat-activity-header flex items-center gap-2 px-3 py-2">
        <span className="text-[13px] font-semibold lowercase text-foreground">activity</span>
        <Button
          variant="ghost"
          size="icon"
          className="chat-tool-button size-7 rounded-sm transition-all duration-150"
          onClick={() => setShowGraph(!showGraph)}
          title="Toggle Memory Graph"
        >
          <NetworkIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="chat-tool-button ml-auto size-7 rounded-sm transition-all duration-150"
          onClick={onClose}
          title="Close panel"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          {showGraph ? (
            <GraphVisualizer />
          ) : (
            <>
              <ThinkingSection />
              <Separator className="chat-section-separator" />
              <ToolLogsSection />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
