// ── Chat module exports ───────────────────────────────────────────────────────

// Main entry point
export { ChatShell } from "./components/chat-shell";

// Provider
export { ChatProvider, useChatContext } from "./engine/chat-provider";

// Types
export type { AttachedFile, ToolLog, SessionOptions, ChatContextValue } from "./types";

// API (for external use by scripts/MCP/extensions)
export {
  ollamaChatNonStream,
  ollamaChatStream,
  ollamaListModels,
  serverOllamaChatNonStream,
  serverListModels,
} from "./api/ollama";

export type {
  OllamaMessage,
  OllamaTool,
  OllamaChatOptions,
  OllamaChunk,
  OllamaToolCheckResponse,
} from "./api/ollama";

// Tools (for external use)
export { executeTool, toolGetWeather, toolGetExchangeRate, toolGetTime, toolSearchWeb } from "./tools/executor";
export { TOOLS } from "./tools/definitions";

// Config (for external use)
export {
  MODEL_ID,
  getMalaysiaTime,
  SYSTEM_PROMPT,
  DEFAULT_OPTIONS,
  BALANCED_OPTIONS,
  FULL_THINK_OPTIONS,
  NO_THINK_OPTIONS,
  shouldAutoThink,
  preDetectTool,
  shouldTriggerFactcheck,
  shouldEscalateToFullThink,
  generateUUID,
} from "./engine/config";

// Slash commands
export { parseSlashCommand } from "./engine/slash-commands";
export type { SlashResult } from "./engine/slash-commands";
