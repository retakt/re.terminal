"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ChatModelRunOptions } from "@assistant-ui/react";
import { PauseDictationAdapter } from "./lib/pause-dictation-adapter";
import type { AttachedFile } from "./types";

// ── Config ────────────────────────────────────────────────────────────────────
const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:11434`.replace(/^wss?/, "http");
const SEARXNG_URL = import.meta.env.VITE_SEARXNG_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8080`.replace(/^wss?/, "http");
const MODEL_ID = import.meta.env.VITE_MODEL_ID ?? "llama3.1";

// ── Time helper ───────────────────────────────────────────────────────────────
function getMalaysiaTime(): string {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(new Date());
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_weather",
      description: "Get current weather for any city.",
      parameters: {
        type: "object", required: ["city"],
        properties: { city: { type: "string", description: "City name" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_exchange_rate",
      description: "Get live currency exchange rates.",
      parameters: {
        type: "object", required: ["from", "to"],
        properties: {
          from: { type: "string", description: "Source currency code" },
          to: { type: "string", description: "Target currency code" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_time",
      description: "Get current time in any timezone.",
      parameters: {
        type: "object", required: ["timezone"],
        properties: { timezone: { type: "string", description: "IANA timezone" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_web",
      description: "Search the web. Modes: factcheck, general, news, reddit, wiki, code.",
      parameters: {
        type: "object", required: ["query", "mode"],
        properties: {
          query: { type: "string", description: "Search query" },
          mode: { type: "string", description: "Search mode" },
        },
      },
    },
  },
];

// ── Tool executors ────────────────────────────────────────────────────────────
async function executeTool(name: string, args: Record<string, string>): Promise<string> {
  try {
    switch (name) {
      case "get_weather": {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(args.city ?? "Kuala Lumpur")}?format=j1`, {
          headers: { "Accept": "application/json" },
        });
        if (!res.ok) return `Could not fetch weather for ${args.city}.`;
        const data = await res.json();
        const current = data.current_condition?.[0];
        if (!current) return `No weather data for ${args.city}.`;
        return `Weather in ${args.city}: ${current.weatherDesc?.[0]?.value}, ${current.temp_C}°C (feels ${current.FeelsLikeC}°C), humidity ${current.humidity}%, wind ${current.windspeedKmph} km/h`;
      }
      case "get_exchange_rate": {
        const res = await fetch(`https://open.er-api.com/v6/latest/${args.from?.toUpperCase() ?? "MYR"}`);
        if (!res.ok) return `Could not fetch rates for ${args.from}.`;
        const data = await res.json();
        const rate = data.rates?.[args.to?.toUpperCase() ?? "USD"];
        return rate ? `1 ${args.from} = ${rate.toFixed(4)} ${args.to}` : `Currency ${args.to} not found.`;
      }
      case "get_time": {
        try {
          return new Intl.DateTimeFormat("en-US", {
            timeZone: args.timezone,
            weekday: "long", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, timeZoneName: "short",
          }).format(new Date());
        } catch {
          return `Unknown timezone: ${args.timezone}`;
        }
      }
      case "search_web": {
        try {
          const mode = args.mode ?? "general";
          const limit = { general: 5, factcheck: 2, news: 3, reddit: 3, wiki: 2, code: 3 }[mode] ?? 5;
          const res = await fetch(`${SEARXNG_URL}/search?q=${encodeURIComponent(args.query ?? "")}&format=json&language=en`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) return "Search unavailable.";
          const data = await res.json();
          const results = (data.results ?? [])
            .filter((r: any) => r.title && r.url && r.content)
            .slice(0, limit)
            .map((r: any, i: number) => `[${i + 1}] ${r.title} — ${String(r.content).slice(0, 300)} (${r.url})`)
            .join("\n");
          return results || "No search results.";
        } catch {
          return "Search failed.";
        }
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Tool error: ${err}`;
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Re, an AI assistant in re.Term.
Be helpful, direct, and concise.
Current time: {TIME} (MYT, UTC+8).
You have access to tools: get_weather, get_exchange_rate, get_time, search_web.
Use them when relevant. Be honest about limitations.`;

// ── Session options ───────────────────────────────────────────────────────────
interface SessionOptions {
  think: boolean;
  temperature: number;
  top_k: number;
}

const DEFAULT_OPTIONS: SessionOptions = { think: false, temperature: 0.3, top_k: 15 };
const THINK_OPTIONS: SessionOptions = { think: true, temperature: 1, top_k: 64 };

// ── Auto-think detection ──────────────────────────────────────────────────────
const THINK_KEYWORDS = [
  "explain", "why", "how", "because", "reason", "prove", "calculate", "solve",
  "code", "debug", "fix", "implement", "build", "what is", "summarize", "analyze",
  "compare", "write", "rewrite", "brainstorm", "riddle", "puzzle",
];

function shouldAutoThink(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower.length > 120) return true;
  if ((lower.match(/[.!?]/g) ?? []).length >= 2) return true;
  return THINK_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── Slash command parser ──────────────────────────────────────────────────────
interface SlashResult {
  response: string;
  optionOverrides?: Partial<SessionOptions>;
  webSearchOverride?: boolean;
}

function parseSlashCommand(text: string): SlashResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
  switch (cmd.toLowerCase()) {
    case "think":
      return { response: "✓ Full thinking **enabled**. Use `/nothink` or `/auto` to change.", optionOverrides: THINK_OPTIONS };
    case "nothink":
      return { response: "✓ Thinking **disabled**. Instant responses. Use `/think` or `/auto` to change.", optionOverrides: { think: false, temperature: 0.3, top_k: 15 } };
    case "auto":
      return { response: "✓ **Auto mode**. Re will think when needed.", optionOverrides: { ...DEFAULT_OPTIONS } };
    case "temp": {
      const val = parseFloat(args[0] ?? "");
      if (isNaN(val) || val < 0 || val > 2) return { response: "Usage: `/temp <0.0–2.0>`" };
      return { response: `✓ Temperature set to **${val}**.`, optionOverrides: { temperature: val } };
    }
    case "topk": {
      const val = parseInt(args[0] ?? "", 10);
      if (isNaN(val) || val < 1) return { response: "Usage: `/topk <integer>`" };
      return { response: `✓ top_k set to **${val}**.`, optionOverrides: { top_k: val } };
    }
    case "help":
      return {
        response: ["**Commands:**", "- `/think` — full reasoning", "- `/nothink` — instant replies", "- `/auto` — smart auto (default)", "- `/temp <0-2>` — temperature", "- `/topk <int>` — top_k sampling", "", "**Tools:** weather, exchange rates, time, web search"].join("\n"),
      };
    default:
      return { response: `Unknown: \`/${cmd}\`. Type \`/help\`.` };
  }
}

// ── UUID generator ────────────────────────────────────────────────────────────
function generateUUID(): string {
  return crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Context ───────────────────────────────────────────────────────────────────
interface ChatContextValue {
  sessionId: string;
  attachedFile: AttachedFile | null;
  setAttachedFile: (f: AttachedFile | null) => void;
  // Expose tool logs for the side panel
  toolLogsRef: React.MutableRefObject<Array<{ tool: string; args: Record<string, string>; result: string; status: "running" | "complete" | "error" }> >;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be inside <ChatProvider>");
  return ctx;
}

export function ChatProvider({ children, initialSessionId }: { children: ReactNode; initialSessionId?: string }) {
  const sessionId = initialSessionId ?? generateUUID();
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const attachedFileRef = useRef<AttachedFile | null>(null);
  attachedFileRef.current = attachedFile;

  // Tool logs — exposed to side panel
  const toolLogsRef = useRef<Array<{ tool: string; args: Record<string, string>; result: string; status: "running" | "complete" | "error" }> >([]);

  // Mutable session options
  const sessionOptionsRef = useRef<SessionOptions>({ ...DEFAULT_OPTIONS });
  const thinkOverrideRef = useRef<boolean | null>(null);
  const assistantTurnCountRef = useRef(0);

  const adapter = useMemo((): ChatModelAdapter => ({
    async *run({ messages, abortSignal }: ChatModelRunOptions) {
      const file = attachedFileRef.current;
      const lastMsg = messages[messages.length - 1];
      const lastText = lastMsg?.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";

      // Slash commands
      const slash = parseSlashCommand(lastText);
      if (slash) {
        if (slash.optionOverrides) {
          Object.assign(sessionOptionsRef.current, slash.optionOverrides);
          if ("think" in slash.optionOverrides) {
            const cmd = lastText.trim().slice(1).split(/\s+/)[0].toLowerCase();
            thinkOverrideRef.current = cmd === "auto" ? null : (slash.optionOverrides.think ?? null);
          }
        }
        yield { content: [{ type: "text" as const, text: slash.response }] };
        return;
      }

      // Build Ollama messages
      const apiMessages = messages.map((m, i) => {
        const textContent = m.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
        if (i === messages.length - 1 && file) {
          if (file.type === "text") {
            return { role: m.role, content: `[File: ${file.name}]\n\`\`\`\n${file.content}\n\`\`\`\n\n${textContent}` };
          } else if (file.type === "image") {
            return { role: m.role, content: textContent || "Describe this image.", images: [file.base64] };
          }
        }
        return { role: m.role, content: textContent };
      });

      // Clear attachment immediately
      setAttachedFile(null);

      const { think: _think, ...inferenceOptions } = sessionOptionsRef.current;
      const think = thinkOverrideRef.current ?? shouldAutoThink(lastText);

      const systemMessage = {
        role: "system",
        content: SYSTEM_PROMPT.replace("{TIME}", getMalaysiaTime()),
      };

      // ── Tool check pass ──────────────────────────────────────────────────────
      const recentMessages = apiMessages.slice(-3);
      const toolCheckRes = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: [systemMessage, ...recentMessages],
          stream: false,
          think: false,
          tools: TOOLS,
          options: { ...inferenceOptions, num_ctx: 2048 },
        }),
        signal: abortSignal,
      });

      let toolCalls: Array<{ function: { name: string; arguments: Record<string, string> } }> | undefined;
      if (toolCheckRes.ok) {
        const toolCheckData = await toolCheckRes.json();
        toolCalls = toolCheckData?.message?.tool_calls;
      }

      // ── Execute tools if called ──────────────────────────────────────────────
      let finalMessages = [systemMessage, ...apiMessages];
      if (toolCalls && toolCalls.length > 0) {
        // Log tools for side panel
        const toolLogEntries = toolCalls.map(tc => ({
          tool: tc.function.name,
          args: tc.function.arguments,
          result: "",
          status: "running" as const,
        }));
        toolLogsRef.current = [...toolLogsRef.current, ...toolLogEntries];

        const toolResults = await Promise.all(
          toolCalls.map(async (tc) => {
            const logEntry = toolLogEntries.find(e => e.tool === tc.function.name && JSON.stringify(e.args) === JSON.stringify(tc.function.arguments));
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
          ...toolResults.map((tr) => ({ role: "tool", tool_name: tr.name, content: tr.result })),
        ];
      }

      // ── Final streaming response ──────────────────────────────────────────────
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: finalMessages,
          stream: true,
          think,
          options: { ...inferenceOptions, num_ctx: 4096 },
        }),
        signal: abortSignal,
      });

      if (!response.ok) throw new Error(`Ollama error ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");

      let reasoningText = "";
      let responseText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed);
            const thinking = chunk?.message?.thinking as string | undefined;
            const content = chunk?.message?.content as string | undefined;
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
          } catch { /* skip */ }
        }
      }
      assistantTurnCountRef.current += 1;
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
