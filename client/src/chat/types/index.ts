// ── Chat types ────────────────────────────────────────────────────────────────
import type { MemoryRecord } from "../api/memory";

export type AttachedFile =
  | { type: "text"; name: string; content: string }
  | { type: "image"; name: string; base64: string; mimeType: string }
  | { type: "audio"; name: string; base64: string; mimeType: string };

export type ToolLog = {
  tool: string;
  args: Record<string, string>;
  result: string;
  status: "running" | "complete" | "error";
  timestamp?: number;
  durationMs?: number;
  runId?: string;
  model?: string;
  memory?: MemoryRecord | null;
};

export type AssistantRunLog = {
  id: string;
  status: "queued" | "running" | "success" | "failed";
  model: string;
  startedAt: number;
  updatedAt: number;
  durationMs?: number;
  userPrompt?: string;
  toolCount: number;
  errorCount: number;
  toolsUsed: string[];
};

export type ReasoningLog = {
  id: string;
  title: string;
  text: string;
  status: "running" | "complete";
  startedAt: number;
  updatedAt: number;
  runId?: string;
  model?: string;
};

export type ChatActivityStatus =
  | "idle"
  | "loading"
  | "checking-memory"
  | "choosing-tool"
  | "calling-tool"
  | "reasoning"
  | "crafting"
  | "saving-memory";

export type ChatMode = "auto" | "think" | "nothink" | "dev" | "scraper" | "browser";

export interface SessionOptions {
  think: boolean;
  temperature: number;
  top_k: number;
  top_p: number;
  browserUseExtensions: boolean;
}

export interface RuntimeContext {
  notes: string;
  skills: string;
}

export interface ChatContextValue {
  sessionId: string;
  attachedFile: AttachedFile | null;
  setAttachedFile: (f: AttachedFile | null) => void;
  toolLogsRef: React.MutableRefObject<ToolLog[]>;
  runLogsRef: React.MutableRefObject<AssistantRunLog[]>;
  reasoningLogsRef: React.MutableRefObject<ReasoningLog[]>;
  activityStatus: ChatActivityStatus;
  persistToolLogs: () => void;
  persistRunLogs: () => void;
  clearActivity: () => void;
  chatMode: ChatMode;
  setChatMode: (mode: ChatMode) => void;
  selectedModel: string;
  models: string[];
  modelsLoading: boolean;
  modelError: string;
  setSelectedModel: (model: string) => void;
  refreshModels: () => Promise<void>;
  sessionOptions: SessionOptions;
  updateSessionOptions: (updates: Partial<SessionOptions>) => void;
  runtimeContext: RuntimeContext;
  updateRuntimeContext: (updates: Partial<RuntimeContext>) => void;
  clearRuntimeContext: () => void;
  clearChatHistory: () => void;
}
