import { useEffect, useMemo, useState } from "react";
import { useChatContext } from "../engine/chat-provider";
import type { AssistantRunLog, ReasoningLog, ToolLog } from "../types";
import { updateMemory, type MemoryRecord } from "../api/memory";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ActivityIcon,
  BrainIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CpuIcon,
  FileTextIcon,
  LoaderIcon,
  PlugIcon,
  RefreshCwIcon,
  SaveIcon,
  SparklesIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type PanelMotionMode = "square" | "soft" | "off";

function memorySummary(memory?: MemoryRecord | null, fallback = "") {
  return memory?.summary
    || memory?.text
    || memory?.message
    || memory?.description
    || memory?.value
    || memory?.object
    || memory?.error
    || memory?.context
    || fallback
    || "";
}

function memoryFields(type?: string) {
  switch ((type || "fact").toLowerCase()) {
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
    case "command":
      return [
        { key: "text", label: "text", multiline: true },
        { key: "output", label: "output", multiline: true },
      ] as const;
    default:
      return [
        { key: "subject", label: "subject", multiline: false },
        { key: "predicate", label: "relation", multiline: false },
        { key: "object", label: "object", multiline: true },
        { key: "summary", label: "summary", multiline: true },
      ] as const;
  }
}

function statusIcon(status: ToolLog["status"] | ReasoningLog["status"]) {
  if (status === "running") return <LoaderIcon className="size-3.5 animate-spin text-primary" />;
  if (status === "complete") return <CheckCircleIcon className="size-3.5 text-primary" />;
  return <XCircleIcon className="size-3.5 text-red-500" />;
}

function activityLabel(status: string) {
  return status.replace(/-/g, " ");
}

function shortModelName(model = "") {
  const clean = model.split("/").pop() || model || "model";
  return clean.length > 26 ? `${clean.slice(0, 23)}...` : clean;
}

function compactPreview(value: unknown, limit = 180) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

type BrowserAgentProfile = {
  id?: string;
  role?: string;
  title?: string;
  stage?: string;
  personality?: string;
  skills?: string[];
  settings?: Record<string, unknown>;
  memory?: string;
};

type BrowserAgentTraceEntry = {
  role?: string;
  title?: string;
  roleLabel?: string;
  agentName?: string;
  agentKind?: string;
  agentProfile?: BrowserAgentProfile | null;
  personality?: string;
  skills?: string[];
  settings?: Record<string, unknown>;
  model?: string;
  modelLabel?: string;
  status?: string;
  step?: number | null;
  tool?: string;
  ok?: boolean | null;
  durationMs?: number | null;
  tokens?: number | null;
  input?: unknown;
  output?: unknown;
  summary?: unknown;
  reasoning?: string;
};

function parseJsonMaybe(value = ""): any | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(value.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function browserAgentTraceFromResult(result = ""): BrowserAgentTraceEntry[] {
  const data = parseJsonMaybe(result);
  const trace = Array.isArray(data?.agentTrace)
    ? data.agentTrace
    : Array.isArray(data?.pipeline?.agentTrace)
      ? data.pipeline.agentTrace
      : [];
  return trace.filter(Boolean).slice(0, 80);
}

function traceRoleLabel(entry: BrowserAgentTraceEntry) {
  if (entry.roleLabel || entry.agentName || entry.title) {
    return entry.roleLabel || entry.agentName || entry.title || "Agent";
  }

  return (entry.role || "")
    .replace(/^gemma_/i, "")
    .replace(/^main_/i, "")
    .replace(/^playwright_/i, "")
    .replace(/_/g, " ")
    .trim() || "Agent";
}

function traceModelLabel(entry: BrowserAgentTraceEntry) {
  return entry.modelLabel || (entry.model ? shortModelName(entry.model) : "");
}

function traceKindLabel(kind = "") {
  return kind.replace(/_/g, " ").trim();
}

function traceProfile(entry: BrowserAgentTraceEntry) {
  return entry.agentProfile || {
    personality: entry.personality || "",
    skills: entry.skills || [],
    settings: entry.settings || {},
  };
}

function hasTraceProfileDetails(entry: BrowserAgentTraceEntry) {
  const profile = traceProfile(entry);
  return Boolean(
    profile?.personality ||
    profile?.memory ||
    (Array.isArray(profile?.skills) && profile.skills.length) ||
    Object.keys(profile?.settings || {}).length
  );
}

function BrowserAgentTraceView({ trace }: { trace: BrowserAgentTraceEntry[] }) {
  if (!trace.length) return null;

  return (
    <div className="run-reasoning-block">
      <div className="run-reasoning-block__head">
        <BrainIcon className="size-3 text-primary" />
        <span>browser agent trace</span>
        <em>{trace.length} events</em>
      </div>
      <div className="space-y-1.5 p-2">
        {trace.map((entry, index) => (
          <div key={`${entry.role || "agent"}-${entry.step ?? "x"}-${index}`} className="rounded-sm border border-border/60 bg-background/60 p-2">
            <div className="flex items-center gap-1.5">
              {statusIcon(entry.ok === false ? "error" : entry.status === "running" ? "running" : "complete")}
              <span className="font-mono text-[10px] font-semibold uppercase text-foreground">
                {entry.step ? `step ${entry.step} · ` : ""}{traceRoleLabel(entry)}
              </span>
              {traceModelLabel(entry) && (
                <span className="ml-auto max-w-32 truncate rounded-sm border border-primary/20 px-1 font-mono text-[9px] text-muted-foreground">
                  {traceModelLabel(entry)}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-1 font-mono text-[9px] text-muted-foreground">
              {entry.agentKind && <span>{traceKindLabel(entry.agentKind)}</span>}
              {entry.status && <span>status={entry.status}</span>}
              {entry.tool && <span>tool={entry.tool}</span>}
              {typeof entry.tokens === "number" && <span>{entry.tokens.toLocaleString()} tok</span>}
              {typeof entry.durationMs === "number" && <span>{durationText(entry.durationMs)}</span>}
            </div>
            {entry.summary != null && String(entry.summary).trim() && (
              <div className="mt-1 text-[11px] leading-4 text-foreground/90">
                {compactPreview(entry.summary, 280)}
              </div>
            )}

            {hasTraceProfileDetails(entry) && (
              <details className="mt-1 text-[10px] text-muted-foreground">
                <summary className="cursor-pointer font-mono uppercase tracking-wide text-muted-foreground/80">
                  profile
                </summary>
                <div className="mt-1 space-y-1 rounded-sm border border-border/50 bg-muted/20 p-1.5">
                  {traceProfile(entry)?.personality && (
                    <div><span className="font-mono text-muted-foreground/70">personality:</span> {traceProfile(entry)?.personality}</div>
                  )}
                  {Array.isArray(traceProfile(entry)?.skills) && Boolean(traceProfile(entry)?.skills?.length) && (
                    <div><span className="font-mono text-muted-foreground/70">skills:</span> {traceProfile(entry)?.skills?.join(", ")}</div>
                  )}
                  {Object.keys(traceProfile(entry)?.settings || {}).length > 0 && (
                    <div><span className="font-mono text-muted-foreground/70">settings:</span> {compactPreview(traceProfile(entry)?.settings, 220)}</div>
                  )}
                  {traceProfile(entry)?.memory && (
                    <div><span className="font-mono text-muted-foreground/70">memory:</span> {compactPreview(traceProfile(entry)?.memory, 220)}</div>
                  )}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function durationText(ms?: number) {
  if (typeof ms !== "number") return "running";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function tokenText(total?: number) {
  if (!total) return "0 tok";
  return `${total.toLocaleString()} tok`;
}

export function ModelSection() {
  const {
    selectedModel,
    models,
    modelsLoading,
    modelError,
    setSelectedModel,
    refreshModels,
    sessionOptions,
    updateSessionOptions,
    activityStatus,
    chatMode,
    runtimeContext,
  } = useChatContext();
  const contextActive = Boolean(runtimeContext.notes.trim() || runtimeContext.skills.trim());

  return (
    <section className="chat-panel-section">
      <div className="chat-panel-section-title">
        <CpuIcon className="size-3.5 text-primary" />
        <span>model</span>
        <Button
          variant="ghost"
          size="icon"
          className="chat-tool-button ml-auto size-6 rounded-sm"
          onClick={() => void refreshModels()}
          title="Refresh models"
        >
          <RefreshCwIcon className={`size-3 ${modelsLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <select
        className="chat-select-field h-8 w-full rounded-sm px-2 font-mono text-[11px] text-foreground outline-none"
        value={selectedModel}
        onChange={(event) => setSelectedModel(event.target.value)}
      >
        {[selectedModel, ...models.filter((model) => model !== selectedModel)].filter(Boolean).map((model) => (
          <option key={model} value={model}>{model}</option>
        ))}
      </select>

      {modelError && (
        <div className="chat-inline-error">{modelError}</div>
      )}

      <div className="chat-model-status">
        <span>{activityStatus === "idle" ? <CheckCircleIcon className="size-3" /> : <LoaderIcon className="size-3 animate-spin" />}</span>
        <strong>{activityLabel(activityStatus)}</strong>
        <span className={`chat-mode-pill chat-mode-pill--${chatMode}`}>{chatMode}</span>
        {contextActive && <span className="chat-mode-pill chat-mode-pill--context">context</span>}
      </div>

      <div className="chat-setting-row">
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={sessionOptions.think}
            onChange={(event) => updateSessionOptions({ think: event.target.checked })}
          />
          <span>reasoning</span>
        </label>
      </div>

      {chatMode === "browser" && (
        <div className="chat-setting-row">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground" title="Allow browser_agent to use enabled site-skill extensions for the current matching site">
            <input
              type="checkbox"
              checked={sessionOptions.browserUseExtensions !== false}
              onChange={(event) => updateSessionOptions({ browserUseExtensions: event.target.checked })}
            />
            <PlugIcon className="size-3" />
            <span>site-skill extensions</span>
          </label>
        </div>
      )}

      <div className="space-y-2">
        <SliderRow
          label="temperature"
          min={0}
          max={1.5}
          step={0.1}
          value={sessionOptions.temperature}
          onChange={(temperature) => updateSessionOptions({ temperature })}
        />
        <SliderRow
          label="top p"
          min={0.1}
          max={1}
          step={0.05}
          value={sessionOptions.top_p}
          onChange={(top_p) => updateSessionOptions({ top_p })}
        />
        <SliderRow
          label="top k"
          min={1}
          max={100}
          step={1}
          value={sessionOptions.top_k}
          onChange={(top_k) => updateSessionOptions({ top_k })}
        />
      </div>
    </section>
  );
}

export function RuntimeContextSection() {
  const { runtimeContext, updateRuntimeContext, clearRuntimeContext } = useChatContext();
  const [notes, setNotes] = useState(runtimeContext.notes);
  const [skills, setSkills] = useState(runtimeContext.skills);

  useEffect(() => {
    setNotes(runtimeContext.notes);
    setSkills(runtimeContext.skills);
  }, [runtimeContext.notes, runtimeContext.skills]);

  const dirty = notes !== runtimeContext.notes || skills !== runtimeContext.skills;
  const active = Boolean(runtimeContext.notes.trim() || runtimeContext.skills.trim());

  return (
    <section className="chat-panel-section">
      <div className="chat-panel-section-title">
        <FileTextIcon className="size-3.5 text-primary" />
        <span>notes / skills</span>
        {active && <span className="ml-auto chat-count-pill">active</span>}
      </div>

      <label className="chat-runtime-field">
        <span>runtime notes</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Session-only notes the AI should consider."
        />
      </label>

      <label className="chat-runtime-field">
        <span>skills</span>
        <textarea
          value={skills}
          onChange={(event) => setSkills(event.target.value)}
          placeholder="Session-only operating preferences, project rules, or skills."
        />
      </label>

      <div className="flex items-center gap-2">
        <Button
          className="chat-solid-button h-7 gap-1.5 rounded-sm px-2 text-xs"
          onClick={() => updateRuntimeContext({ notes, skills })}
          disabled={!dirty}
        >
          <SaveIcon className="size-3" />
          save
        </Button>
        <Button
          variant="ghost"
          className="chat-tool-button h-7 rounded-sm px-2 text-xs"
          onClick={() => {
            setNotes("");
            setSkills("");
            clearRuntimeContext();
          }}
        >
          clear
        </Button>
      </div>
    </section>
  );
}

function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[82px_1fr_42px] items-center gap-2 text-[11px] text-muted-foreground">
      <span>{label}</span>
      <input
        className="chat-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="text-right font-mono text-[10px] text-foreground">{value}</span>
    </label>
  );
}

function ReasoningSection({ isActive = true }: { isActive?: boolean }) {
  const { reasoningLogsRef } = useChatContext();
  const [logs, setLogs] = useState<ReasoningLog[]>([]);

  useEffect(() => {
    if (!isActive) return;
    const refresh = () => setLogs([...reasoningLogsRef.current].filter((log) => !log.runId).reverse());
    refresh();
    const interval = setInterval(refresh, 350);
    return () => clearInterval(interval);
  }, [isActive, reasoningLogsRef]);

  return (
    <section className="chat-panel-section">
      <div className="chat-panel-section-title">
        <BrainIcon className="size-3.5 text-primary" />
        <span>reasoning</span>
      </div>
      {logs.length === 0 ? (
        <div className="chat-empty-note rounded-sm px-3 py-2 text-[11px] text-muted-foreground/70">
          model reasoning appears here
        </div>
      ) : (
        <div className="chat-reasoning-timeline">
          {logs.map((log) => (
            <ReasoningEntry key={log.id} log={log} />
          ))}
        </div>
      )}
    </section>
  );
}

function ReasoningEntry({ log }: { log: ReasoningLog }) {
  const [expanded, setExpanded] = useState(log.status === "running");
  const lines = useMemo(() => log.text.split(/\n+/).map((line) => line.trim()).filter(Boolean), [log.text]);

  return (
    <article className="chat-reasoning-entry">
      <button
        className="flex w-full items-start gap-2 bg-transparent text-left"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="chat-reasoning-dot">{statusIcon(log.status)}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-foreground">{log.title || "reasoning"}</span>
          <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
            {new Date(log.updatedAt).toLocaleTimeString()}
          </span>
        </span>
        {expanded ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
      </button>
      {expanded && (
        <div className="chat-reasoning-body">
          {lines.length === 0 ? (
            <p>thinking...</p>
          ) : (
            lines.slice(-10).map((line, index) => <p key={`${line}-${index}`}>{line}</p>)
          )}
        </div>
      )}
    </article>
  );
}

function MemoryLogEntry({ log, onLogsChanged }: { log: ToolLog; onLogsChanged: () => void }) {
  const { sessionId, persistToolLogs } = useChatContext();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<MemoryRecord>(log.memory || { type: "fact", summary: log.result });
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!saving) setDraft(log.memory || { type: "fact", summary: log.result });
  }, [log.memory, log.result, saving]);

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
    <article className="chat-log-card chat-log-card--memory overflow-hidden rounded-sm">
      <button
        className="flex w-full items-start gap-2 bg-transparent px-2.5 py-2 text-left text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        {statusIcon(log.status)}
        <SparklesIcon className="mt-px size-3.5 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">{log.tool}</span>
            <span className="rounded-sm border border-primary/25 bg-background/70 px-1 font-mono text-[9px] uppercase text-primary">
              {draft.type || "fact"}
            </span>
          </span>
          <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
            {memorySummary(log.memory, log.result || "memory extraction running")}
          </span>
        </span>
        {expanded ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
      </button>

      {expanded && (
        <div className="chat-log-detail space-y-2 px-2.5 py-2">
          {!log.memory && log.status !== "running" ? (
            <pre className="chat-code-block whitespace-pre-wrap rounded-sm p-2 font-mono text-[10px] text-muted-foreground/80">
              {log.result || "no memory was saved"}
            </pre>
          ) : (
            <>
              {fields.map((field) => (
                <label key={field.key} className="block space-y-1">
                  <span className="font-mono text-[10px] uppercase text-muted-foreground">{field.label}</span>
                  {field.multiline ? (
                    <textarea
                      className="chat-edit-field min-h-16 w-full resize-y rounded-sm px-2 py-1.5 font-mono text-[11px] leading-4 text-foreground outline-none"
                      value={String(draft[field.key as keyof MemoryRecord] || "")}
                      onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                    />
                  ) : (
                    <input
                      className="chat-edit-field h-7 w-full rounded-sm px-2 font-mono text-[11px] text-foreground outline-none"
                      value={String(draft[field.key as keyof MemoryRecord] || "")}
                      onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                    />
                  )}
                </label>
              ))}
              {localError && <div className="chat-inline-error">{localError}</div>}
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {canSave ? draft.memoryId || draft.id || draft.nodeId : "pending id"}
                </span>
                <Button className="chat-solid-button h-7 gap-1.5 rounded-sm px-2 text-xs" onClick={saveDraft} disabled={saving || !canSave}>
                  {saving ? <LoaderIcon className="size-3 animate-spin" /> : <SaveIcon className="size-3" />}
                  save
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function ToolLogEntry({ log }: { log: ToolLog }) {
  const [expanded, setExpanded] = useState(false);
  const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "";
  const duration = typeof log.durationMs === "number" ? `${log.durationMs}ms` : "";

  return (
    <article className="chat-log-card rounded-sm p-2.5">
      <button
        className="flex w-full items-center gap-2 bg-transparent text-left text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        {statusIcon(log.status)}
        <WrenchIcon className="size-3.5 text-primary" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{log.tool}</span>
        <span className="font-mono text-[10px] text-muted-foreground/70">{duration || time}</span>
        {expanded ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2 text-[11px]">
          <div className="grid grid-cols-3 gap-2 font-mono text-[10px] text-muted-foreground/80">
            <span>status: {log.status}</span>
            <span>duration: {duration || "running"}</span>
            <span>time: {time || "now"}</span>
          </div>
          <pre className="chat-code-block whitespace-pre-wrap rounded-sm p-2 font-mono text-[10px] text-muted-foreground/80">
            {JSON.stringify(log.args, null, 2)}
          </pre>
          {log.result && (
            <pre className="chat-code-block max-h-32 overflow-y-auto whitespace-pre-wrap rounded-sm p-2 font-mono text-[10px] text-muted-foreground/80">
              {log.result}
            </pre>
          )}
        </div>
      )}
    </article>
  );
}

function groupRunTools(logs: ToolLog[]) {
  const groups = new Map<string, ToolLog[]>();
  for (const log of logs) {
    const key = `${log.tool}:${log.status}`;
    groups.set(key, [...(groups.get(key) || []), log]);
  }
  return Array.from(groups.values()).sort((a, b) => (a[0]?.timestamp || 0) - (b[0]?.timestamp || 0));
}

function RunToolGroup({
  logs,
  onLogsChanged,
}: {
  logs: ToolLog[];
  onLogsChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const latest = logs[logs.length - 1];
  const hasError = logs.some((log) => log.status === "error");
  const totalDuration = logs.reduce((sum, log) => sum + (log.durationMs || 0), 0);
  const browserAgentTrace = latest?.tool === "mcp__browser_agent__run"
    ? browserAgentTraceFromResult(latest.result)
    : [];

  if (!latest) return null;

  return (
    <article className={`run-tool-row ${hasError ? "run-tool-row--error" : ""}`}>
      <button className="run-tool-row__head" onClick={() => setExpanded((value) => !value)}>
        {statusIcon(hasError ? "error" : latest.status)}
        <WrenchIcon className="size-3.5 text-primary" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold text-foreground">
          {latest.tool}
          {logs.length > 1 && <em> x{logs.length}</em>}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{durationText(totalDuration || latest.durationMs)}</span>
        {expanded ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
      </button>
      <div className="run-tool-preview">
        <span>in</span>
        <code>{compactPreview(latest.args, 120) || "{}"}</code>
      </div>
      <div className={`run-tool-preview ${hasError ? "run-tool-preview--error" : ""}`}>
        <span>{hasError ? "err" : "out"}</span>
        <code>{compactPreview(latest.result, 180) || (latest.status === "running" ? "running" : "empty")}</code>
      </div>
      {browserAgentTrace.length > 0 && (
        <BrowserAgentTraceView trace={browserAgentTrace} />
      )}
      {expanded && (
        <div className="run-tool-expanded">
          {logs.map((log, index) => (
            log.tool.startsWith("memory.") ? (
              <MemoryLogEntry
                key={`${log.tool}-${log.timestamp}-${index}`}
                log={log}
                onLogsChanged={onLogsChanged}
              />
            ) : (
              <ToolLogEntry key={`${log.tool}-${log.timestamp}-${index}`} log={log} />
            )
          ))}
        </div>
      )}
    </article>
  );
}

function RunCard({
  run,
  logs,
  reasoning,
  onLogsChanged,
}: {
  run: AssistantRunLog;
  logs: ToolLog[];
  reasoning?: ReasoningLog | null;
  onLogsChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(run.status === "running" || run.status === "failed");
  const errorCount = logs.filter((log) => log.status === "error").length || run.errorCount;
  const groupedTools = groupRunTools(logs);
  const status = run.status === "success" && errorCount > 0 ? "failed" : run.status;

  return (
    <article className={`run-card run-card--${status}`}>
      <button className="run-card__summary" onClick={() => setExpanded((value) => !value)}>
        {statusIcon(status === "failed" ? "error" : status === "running" || status === "queued" ? "running" : "complete")}
        <span className="run-card__main">
          <span className="run-card__title">{run.userPrompt || "assistant run"}</span>
          <span className="run-card__meta">
            <strong>{status}</strong>
            <span>{shortModelName(run.model)}</span>
            <span>{durationText(run.durationMs)}</span>
            <span>{tokenText(run.usage?.totalTokens)}</span>
            <span>{logs.length || run.toolCount} tools</span>
            <span>{errorCount} errors</span>
          </span>
        </span>
        {expanded ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
      </button>
      {expanded && (
        <div className="run-card__details">
          {(run.usage || (run.usageStages && run.usageStages.length > 0)) && (
            <div className="run-reasoning-block">
              <div className="run-reasoning-block__head">
                <CpuIcon className="size-3 text-primary" />
                <span>usage</span>
                <em>{tokenText(run.usage?.totalTokens)}</em>
              </div>
              <pre>
                {[
                  `prompt=${run.usage?.promptTokens || 0}`,
                  `completion=${run.usage?.completionTokens || 0}`,
                  `total=${run.usage?.totalTokens || 0}`,
                  "",
                  ...(run.usageStages || []).map((stage) =>
                    `${stage.stage || "stage"} :: total=${stage.totalTokens || 0} prompt=${stage.promptTokens || 0} completion=${stage.completionTokens || 0}${stage.durationMs ? ` duration=${stage.durationMs}ms` : ""}`,
                  ),
                ].join("\n")}
              </pre>
            </div>
          )}
          {reasoning?.text && (
            <div className="run-reasoning-block">
              <div className="run-reasoning-block__head">
                <BrainIcon className="size-3 text-primary" />
                <span>reasoning</span>
                <em>{reasoning.status}</em>
              </div>
              <pre>{compactPreview(reasoning.text, 1800)}</pre>
            </div>
          )}
          {groupedTools.length === 0 ? (
            <div className="chat-empty-note rounded-sm px-3 py-2 text-[11px] text-muted-foreground/70">
              no tool calls for this run
            </div>
          ) : (
            groupedTools.map((group) => (
              <RunToolGroup
                key={`${group[0]?.tool}-${group[0]?.status}-${group[0]?.timestamp}`}
                logs={group}
                onLogsChanged={onLogsChanged}
              />
            ))
          )}
        </div>
      )}
    </article>
  );
}

function ActivitySection({ isActive = true }: { isActive?: boolean }) {
  const { toolLogsRef, runLogsRef, reasoningLogsRef, clearActivity } = useChatContext();
  const [logs, setLogs] = useState<ToolLog[]>([]);
  const [runs, setRuns] = useState<AssistantRunLog[]>([]);
  const [reasoningLogs, setReasoningLogs] = useState<ReasoningLog[]>([]);

  useEffect(() => {
    if (!isActive) return;
    const refresh = () => {
      setLogs([...toolLogsRef.current]);
      setRuns([...runLogsRef.current].reverse());
      setReasoningLogs([...reasoningLogsRef.current]);
    };
    refresh();
    const interval = setInterval(refresh, 350);
    return () => clearInterval(interval);
  }, [isActive, reasoningLogsRef, runLogsRef, toolLogsRef]);

  const orphanLogs = logs.filter((log) => !log.runId);
  const refreshLocal = () => {
    setLogs([...toolLogsRef.current]);
    setRuns([...runLogsRef.current].reverse());
  };

  return (
    <section className="chat-panel-section">
      <div className="chat-panel-section-title">
        <ActivityIcon className="size-3.5 text-primary" />
        <span>run inspector</span>
        {runs.length > 0 && <span className="ml-auto chat-count-pill">{runs.length}</span>}
        {runs.length > 0 && (
          <Button
            variant="ghost"
            className="chat-tool-button h-6 rounded-sm px-2 text-[10px]"
            onClick={clearActivity}
          >
            clear
          </Button>
        )}
      </div>
      {runs.length === 0 && orphanLogs.length === 0 ? (
        <div className="chat-empty-note rounded-sm px-3 py-2 text-[11px] text-muted-foreground/70">
          assistant runs, tool calls, and autonomous memories appear here
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              logs={logs.filter((log) => log.runId === run.id)}
              reasoning={reasoningLogs.find((log) => log.runId === run.id) || null}
              onLogsChanged={refreshLocal}
            />
          ))}
          {orphanLogs.map((log, index) => (
            log.tool.startsWith("memory.") ? (
              <MemoryLogEntry
                key={`${log.tool}-${log.timestamp}-${index}`}
                log={log}
                onLogsChanged={refreshLocal}
              />
            ) : (
              <ToolLogEntry key={`${log.tool}-${log.timestamp}-${index}`} log={log} />
            )
          ))}
        </div>
      )}
    </section>
  );
}

export function RightPanel({
  isActive = true,
  motionMode: _motionMode = "soft",
  onMotionModeChange: _onMotionModeChange,
}: {
  onClose?: () => void;
  isActive?: boolean;
  motionMode?: PanelMotionMode;
  onMotionModeChange?: (mode: PanelMotionMode) => void;
}) {
  void _motionMode;
  void _onMotionModeChange;

  return (
    <div className="chat-activity-panel flex h-full flex-col">
      <div className="chat-activity-header flex items-center gap-2 px-3 py-1.5">
        <ActivityIcon className="size-3.5 text-primary" />
        <span className="text-[13px] font-semibold lowercase text-foreground">activity</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          <ReasoningSection isActive={isActive} />
          <ActivitySection isActive={isActive} />
        </div>
      </ScrollArea>
    </div>
  );
}
