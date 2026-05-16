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
  memory?: MemoryRecord | null;
};

export interface SessionOptions {
  think: boolean;
  temperature: number;
  top_k: number;
  top_p: number;
}

export interface ChatContextValue {
  sessionId: string;
  attachedFile: AttachedFile | null;
  setAttachedFile: (f: AttachedFile | null) => void;
  toolLogsRef: React.MutableRefObject<ToolLog[]>;
  persistToolLogs: () => void;
}
