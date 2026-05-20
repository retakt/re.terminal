// ── Backwards compatibility re-exports ───────────────────────────────────────
// The chat logic has been moved to src/chat/ for better organization
// This file re-exports everything for backwards compatibility

export { ChatProvider, useChatContext } from "@/chat/engine/chat-provider";
export type { AttachedFile, ToolLog, SessionOptions, ChatContextValue } from "@/chat/types";
