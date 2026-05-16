// ── Chat Provider (Engine) ───────────────────────────────────────────────────
// Core chat logic — connects @assistant-ui/react runtime to Ollama API

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ChatModelRunOptions } from "@assistant-ui/react";
import { PauseDictationAdapter } from "./pause-dictation-adapter";
import { parseSlashCommand } from "./slash-commands";
import {
  MODEL_ID,
  getMalaysiaTime,
  SYSTEM_PROMPT,
  DEFAULT_OPTIONS,
  shouldAutoThink,
  shouldEscalateToFullThink,
  shouldTriggerFactcheck,
  preDetectTool,
  generateUUID,
} from "./config";
import { TOOLS } from "../tools/definitions";
import { executeTool } from "../tools/executor";
import { ollamaChatNonStream, ollamaChatStream, type OllamaMessage } from "../api/ollama";
import type { AttachedFile, SessionOptions, ToolLog, ChatContextValue } from "../types";

// ── Context ───────────────────────────────────────────────────────────────────

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be inside <ChatProvider>");
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ChatProvider({ children, initialSessionId }: { children: ReactNode; initialSessionId?: string }) {
  const sessionId = initialSessionId ?? generateUUID();
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const attachedFileRef = useRef<AttachedFile | null>(null);
  attachedFileRef.current = attachedFile;

  // Tool logs — exposed to side panel
  const toolLogsRef = useRef<ToolLog[]>([]);

  // Mutable session options
  const sessionOptionsRef = useRef<SessionOptions>({ ...DEFAULT_OPTIONS });
  const thinkOverrideRef = useRef<boolean | null>(null);
  const assistantTurnCountRef = useRef(0);
  const webSearchEnabledRef = useRef<boolean>(true);

  const adapter = useMemo((): ChatModelAdapter => ({
    async *run({ messages, abortSignal }: ChatModelRunOptions) {
      const file = attachedFileRef.current;
      const lastMsg = messages[messages.length - 1];
      const lastText = lastMsg?.content
        .filter((c) => c.type === "text")
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("") ?? "";

      // ── Slash command handling ──────────────────────────────────────────────
      const slash = parseSlashCommand(lastText);
      if (slash) {
        if (slash.optionOverrides) {
          Object.assign(sessionOptionsRef.current, slash.optionOverrides);
          if ("think" in slash.optionOverrides) {
            const cmd = lastText.trim().slice(1).split(/\s+/)[0].toLowerCase();
            thinkOverrideRef.current = cmd === "auto" ? null : (slash.optionOverrides.think ?? null);
          }
        }
        if (slash.webSearchOverride !== undefined) {
          webSearchEnabledRef.current = slash.webSearchOverride;
        }
        yield { content: [{ type: "text" as const, text: slash.response }] };
        return;
      }

      // ── Build Ollama messages ───────────────────────────────────────────────
      const apiMessages: OllamaMessage[] = messages.map((m, i) => {
        const isLast = i === messages.length - 1;
        const textContent = m.content
          .filter((c) => c.type === "text")
          .map((c) => (c.type === "text" ? c.text : ""))
          .join("");

        if (isLast && file) {
          if (file.type === "text") {
            return {
              role: m.role,
              content: `[Attached file: ${file.name}]\n\`\`\`\n${file.content}\n\`\`\`\n\n${textContent}`,
            };
          } else if (file.type === "image") {
            return {
              role: m.role,
              content: textContent || "What is in this image?",
              images: [file.base64],
            };
          } else if (file.type === "audio") {
            return {
              role: m.role,
              content: textContent || "Please analyze this audio.",
              audio: file.base64,
            };
          }
        }

        return { role: m.role, content: textContent };
      });

      // Clear attachment immediately
      setAttachedFile(null);

      const { think: _think, ...inferenceOptions } = sessionOptionsRef.current;

      // ── Determine think mode ────────────────────────────────────────────────
      let think: boolean;
      if (thinkOverrideRef.current !== null) {
        think = thinkOverrideRef.current;
      } else if (assistantTurnCountRef.current >= 2 && shouldEscalateToFullThink(lastText)) {
        think = true;
      } else {
        think = shouldAutoThink(lastText);
      }

      const webSearchEnabled = webSearchEnabledRef.current;

      // ── System prompt ───────────────────────────────────────────────────────
      const systemPromptContent = SYSTEM_PROMPT.replace("{MALAYSIA_TIME}", getMalaysiaTime())
        + (webSearchEnabled ? "" : "\n\nWeb search is currently DISABLED by the user. Do NOT attempt to use search_web or any search tool. Answer only from your training data.");

      const systemMessage: OllamaMessage = { role: "system", content: systemPromptContent };

      // Filter tools
      const activeTools = webSearchEnabled
        ? TOOLS
        : TOOLS.filter((t) => t.function.name !== "search_web");

      // ── Tool detection ──────────────────────────────────────────────────────
      const factcheckHint = webSearchEnabled && shouldTriggerFactcheck(lastText)
        ? " [Note: this query may involve current or time-sensitive information — consider using search_web to verify]"
        : "";

      const preDetected = preDetectTool(lastText);
      const preDetectedFiltered = preDetected?.name === "search_web" && !webSearchEnabled
        ? null
        : preDetected;

      let toolCalls: Array<{ function: { name: string; arguments: Record<string, string> } }> | undefined;

      if (preDetectedFiltered) {
        toolCalls = [{ function: { name: preDetectedFiltered.name, arguments: preDetectedFiltered.args } }];
      } else {
        const recentMessages = apiMessages.slice(-3);
        const toolCheckMessages: OllamaMessage[] = [
          systemMessage,
          ...recentMessages.slice(0, -1),
          {
            ...recentMessages[recentMessages.length - 1],
            content: (recentMessages[recentMessages.length - 1]?.content ?? "") + factcheckHint,
          },
        ];

        try {
          const toolCheckRes = await ollamaChatNonStream({
            model: MODEL_ID,
            messages: toolCheckMessages,
            think: false,
            tools: activeTools,
            options: { ...inferenceOptions, num_ctx: 2048 },
            signal: abortSignal,
          });
          toolCalls = toolCheckRes?.message?.tool_calls;
        } catch (err) {
          console.warn("Tool check failed:", err);
        }
      }

      // ── Execute tools ───────────────────────────────────────────────────────
      let finalMessages: OllamaMessage[] = [systemMessage, ...apiMessages];

      if (toolCalls && toolCalls.length > 0) {
        // Log tools for side panel
        const toolLogEntries: ToolLog[] = toolCalls.map(tc => ({
          tool: tc.function.name,
          args: tc.function.arguments,
          result: "",
          status: "running",
          timestamp: Date.now(),
        }));
        toolLogsRef.current = [...toolLogsRef.current, ...toolLogEntries];

        const toolResults = await Promise.all(
          toolCalls.map(async (tc) => {
            const logEntry = toolLogEntries.find(
              e => e.tool === tc.function.name && JSON.stringify(e.args) === JSON.stringify(tc.function.arguments)
            );
            try {
              const result = await executeTool(tc.function.name, tc.function.arguments);
              if (logEntry) { logEntry.result = result; logEntry.status = "complete"; }
              return { name: tc.function.name, result };
            } catch (err: any) {
              if (logEntry) { logEntry.result = String(err); logEntry.status = "error"; }
              return { name: tc.function.name, result: `Error: ${err}` };
            }
          })
        );

        finalMessages = [
          ...finalMessages,
          { role: "assistant", content: "", tool_calls: toolCalls },
          ...toolResults.map((tr) => ({
            role: "tool" as const,
            tool_name: tr.name,
            content: tr.result,
          })),
        ];
      }

      // ── Final streaming response ────────────────────────────────────────────
      let reasoningText = "";
      let responseText = "";

      try {
        for await (const chunk of ollamaChatStream({
          model: MODEL_ID,
          messages: finalMessages,
          think,
          options: { ...inferenceOptions, num_ctx: 4096 },
          signal: abortSignal,
        })) {
          const thinking = chunk?.message?.thinking;
          const content = chunk?.message?.content;

          if (thinking) reasoningText += thinking;
          if (content) responseText += content;

          if (thinking || content) {
            yield {
              content: [
                ...(reasoningText ? [{ type: "reasoning" as const, text: reasoningText }] : []),
                ...(responseText ? [{ type: "text" as const, text: responseText }] : []),
              ],
            };
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        throw err;
      }

      assistantTurnCountRef.current += 1;

      // ── Hint injection (every 4th turn in auto mode) ────────────────────────
      const shouldInjectHint =
        thinkOverrideRef.current === null &&
        assistantTurnCountRef.current > 0 &&
        assistantTurnCountRef.current % 4 === 0;

      if (shouldInjectHint) {
        const hint = "\n\n---\n*If I'm underperforming, try `/think` for full reasoning mode.*";
        yield {
          content: [
            ...(reasoningText ? [{ type: "reasoning" as const, text: reasoningText }] : []),
            { type: "text" as const, text: responseText + hint },
          ],
        };
      }
    },
  }), []);

  const dictationAdapter = useMemo(() => new PauseDictationAdapter({ lang: "en-US" }), []);
  const runtime = useLocalRuntime(adapter, { adapters: { dictation: dictationAdapter } });

  return (
    <ChatContext.Provider value={{ sessionId, attachedFile, setAttachedFile, toolLogsRef }}>
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </ChatContext.Provider>
  );
}
