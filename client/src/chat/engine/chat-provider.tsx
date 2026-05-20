// ── Chat Provider (Engine) ───────────────────────────────────────────────────
// Core chat logic — connects @assistant-ui/react runtime to Ollama API

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ChatModelRunOptions,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { PauseDictationAdapter } from "./pause-dictation-adapter";
import { parseSlashCommand } from "./slash-commands";
import {
  MODEL_ID,
  getMalaysiaTime,
  SYSTEM_PROMPT,
  DEV_SYSTEM_PROMPT,
  BROWSER_SYSTEM_PROMPT,
  SCRAPER_SYSTEM_PROMPT,
  DEFAULT_OPTIONS,
  shouldAutoThink,
  shouldEscalateToFullThink,
  shouldTriggerFactcheck,
  preDetectTool,
  generateUUID,
} from "./config";
import { TOOLS } from "../tools/definitions";
import { executeTool } from "../tools/executor";
import { ollamaChatNonStream, ollamaChatStream, ollamaListModels, warmupModels, type OllamaMessage, type OllamaTool } from "../api/ollama";
import { listMcpToolDefinitions, routeMcpIntent } from "../api/mcp";
import { extractMemories, saveFact, searchMemory } from "../api/memory";
import type { AttachedFile, SessionOptions, ToolLog, ChatContextValue, ReasoningLog, ChatActivityStatus, ChatMode, RuntimeContext, AssistantRunLog } from "../types";

// ── Context ───────────────────────────────────────────────────────────────────

const ChatContext = createContext<ChatContextValue | null>(null);
const CHAT_SESSION_ID_KEY = "reterm.chat.sessionId";
const CHAT_HISTORY_PREFIX = "reterm.chat.history.";
const CHAT_TOOL_LOGS_PREFIX = "reterm.chat.toolLogs.";
const CHAT_RUN_LOGS_PREFIX = "reterm.chat.runLogs.";
const CHAT_REASONING_LOGS_PREFIX = "reterm.chat.reasoningLogs.";
const CHAT_MODEL_KEY = "reterm.chat.model";
const CHAT_OPTIONS_KEY = "reterm.chat.options";
const CHAT_MODE_KEY = "reterm.chat.mode";
const CHAT_RUNTIME_PREFIX = "reterm.chat.runtime.";
const MAX_TOOL_LOGS = 80;
const MAX_RUN_LOGS = 40;
const MAX_REASONING_LOGS = 30;

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be inside <ChatProvider>");
  return ctx;
}

type ChatHistoryRepository = Awaited<ReturnType<ThreadHistoryAdapter["load"]>>;
type ChatHistoryItem = Parameters<ThreadHistoryAdapter["append"]>[0];

function safeLocalStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadOrCreateSessionId(initialSessionId?: string) {
  const storage = safeLocalStorage();
  if (initialSessionId) {
    try { storage?.setItem(CHAT_SESSION_ID_KEY, initialSessionId); } catch {}
    return initialSessionId;
  }

  try {
    const stored = storage?.getItem(CHAT_SESSION_ID_KEY);
    if (stored) return stored;
  } catch {}

  const next = generateUUID();
  try { storage?.setItem(CHAT_SESSION_ID_KEY, next); } catch {}
  return next;
}

function historyKey(sessionId: string) {
  return `${CHAT_HISTORY_PREFIX}${sessionId}`;
}

function toolLogsKey(sessionId: string) {
  return `${CHAT_TOOL_LOGS_PREFIX}${sessionId}`;
}

function runLogsKey(sessionId: string) {
  return `${CHAT_RUN_LOGS_PREFIX}${sessionId}`;
}

function reasoningLogsKey(sessionId: string) {
  return `${CHAT_REASONING_LOGS_PREFIX}${sessionId}`;
}

function runtimeContextKey(sessionId: string) {
  return `${CHAT_RUNTIME_PREFIX}${sessionId}`;
}

function reviveMessage(message: any) {
  if (!message || typeof message !== "object") return null;
  const createdAt = message.createdAt ? new Date(message.createdAt) : new Date();
  return {
    ...message,
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
  };
}

function normalizeHistoryItem(item: any): ChatHistoryItem | null {
  const message = reviveMessage(item?.message);
  if (!message?.id || !message.role) return null;
  return {
    parentId: typeof item.parentId === "string" ? item.parentId : null,
    message,
    ...(item.runConfig !== undefined ? { runConfig: item.runConfig } : {}),
  } as ChatHistoryItem;
}

function loadHistory(key: string): ChatHistoryRepository {
  const storage = safeLocalStorage();
  if (!storage) return { messages: [] };

  try {
    const raw = storage.getItem(key);
    if (!raw) return { messages: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.messages)) return { messages: [] };
    const messages = parsed.messages
      .map(normalizeHistoryItem)
      .filter(Boolean) as ChatHistoryRepository["messages"];
    return {
      ...(parsed.headId !== undefined ? { headId: parsed.headId } : {}),
      messages,
      ...(parsed.unstable_resume ? { unstable_resume: true } : {}),
    };
  } catch {
    return { messages: [] };
  }
}

function saveHistory(key: string, repo: ChatHistoryRepository) {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(repo));
  } catch {
    // Local history is a convenience cache; memory/database remains separate.
  }
}

function createLocalHistoryAdapter(key: string): ThreadHistoryAdapter {
  return {
    async load() {
      return loadHistory(key);
    },
    async append(item) {
      const repo = loadHistory(key);
      const normalized = normalizeHistoryItem(item);
      if (!normalized) return;

      const messageId = normalized.message.id;
      const existingIndex = repo.messages.findIndex((entry) => entry.message.id === messageId);
      const messages = [...repo.messages];
      if (existingIndex >= 0) {
        messages[existingIndex] = normalized;
      } else {
        messages.push(normalized);
      }

      saveHistory(key, {
        headId: messageId,
        messages,
      });
    },
  };
}

function loadToolLogs(sessionId: string): ToolLog[] {
  const storage = safeLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(toolLogsKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MAX_TOOL_LOGS);
  } catch {
    return [];
  }
}

function saveToolLogs(sessionId: string, logs: ToolLog[]) {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(toolLogsKey(sessionId), JSON.stringify(logs.slice(-MAX_TOOL_LOGS)));
  } catch {
    // Ignore full localStorage; tool logs can rebuild over time.
  }
}

function loadRunLogs(sessionId: string): AssistantRunLog[] {
  const storage = safeLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(runLogsKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MAX_RUN_LOGS);
  } catch {
    return [];
  }
}

function saveRunLogs(sessionId: string, logs: AssistantRunLog[]) {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(runLogsKey(sessionId), JSON.stringify(logs.slice(-MAX_RUN_LOGS)));
  } catch {}
}

function loadReasoningLogs(sessionId: string): ReasoningLog[] {
  const storage = safeLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(reasoningLogsKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MAX_REASONING_LOGS);
  } catch {
    return [];
  }
}

function saveReasoningLogs(sessionId: string, logs: ReasoningLog[]) {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(reasoningLogsKey(sessionId), JSON.stringify(logs.slice(-MAX_REASONING_LOGS)));
  } catch {}
}

function loadSessionOptions(): SessionOptions {
  const storage = safeLocalStorage();
  try {
    const raw = storage?.getItem(CHAT_OPTIONS_KEY);
    if (!raw) return { ...DEFAULT_OPTIONS };
    return { ...DEFAULT_OPTIONS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

function loadChatMode(): ChatMode {
  const storage = safeLocalStorage();
  const value = storage?.getItem(CHAT_MODE_KEY);
  return value === "dev" || value === "think" || value === "nothink" || value === "auto" || value === "browser" || value === "scraper"
  ? value
  : "auto";
}

function loadRuntimeContext(sessionId: string): RuntimeContext {
  const storage = safeLocalStorage();
  try {
    const raw = storage?.getItem(runtimeContextKey(sessionId));
    if (!raw) return { notes: "", skills: "" };
    const parsed = JSON.parse(raw);
    return {
      notes: String(parsed?.notes || ""),
      skills: String(parsed?.skills || ""),
    };
  } catch {
    return { notes: "", skills: "" };
  }
}

function saveRuntimeContext(sessionId: string, context: RuntimeContext) {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(runtimeContextKey(sessionId), JSON.stringify(context));
  } catch {}
}

function asToolArgs(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      typeof entry === "string" ? entry : JSON.stringify(entry),
    ]),
  );
}

function detectExplicitMemory(text: string) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const markers = [
    "remember",
    "remember that",
    "note",
    "note that",
    "make a note",
    "take a note",
    "keep in mind",
    "save this",
    "save that",
    "save as memory",
    "don't forget",
    "dont forget",
  ];
  const marker = markers.find((item) => lower.includes(item));
  if (!marker) return null;

  let object = trimmed
    .replace(/^(please\s+)?(remember|note that|keep in mind|save this|save that|don't forget|dont forget)\s*[:,]?\s*/i, "")
    .replace(/^(please\s+)?(make a note|take a note|note|remember that|save as memory)\s*[:,]?\s*/i, "")
    .trim();
  if (!object) object = trimmed;

  return {
    type: "fact",
    subject: "user",
    predicate: "asked assistant to remember",
    object,
    summary: object,
    confidence: 1,
    source: "chat.explicit",
  };
}

function forcedSearchTool(text: string, enabled: boolean) {
  if (!enabled) return null;
  const lower = text.toLowerCase();
  const asksSearch = /\b(search|look up|lookup|browse|web|google|find latest|latest|current|today|news|right now)\b/.test(lower);
  if (!asksSearch && !shouldTriggerFactcheck(text)) return null;
  let mode = "factcheck";
  if (/\bnews|announced|released|latest|today|right now|current\b/.test(lower)) mode = "news";
  if (/\breddit|opinions|reviews|discussion\b/.test(lower)) mode = "reddit";
  if (/\bcode|github|stackoverflow|library|api|docs\b/.test(lower)) mode = "code";
  return {
    name: "search_web",
    args: {
      query: text.trim().slice(0, 220),
      mode,
    },
  };
}

function isCasualNoTool(text: string) {
  const lower = text.trim().toLowerCase();
  return /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great|gm|gn)[!.?\s]*$/.test(lower);
}

function shouldAttemptAutonomousMemory(userText: string, assistantText: string) {
  const text = userText.trim();
  if (!text || !assistantText.trim()) return false;
  if (isCasualNoTool(text) || text.length < 18) return false;
  const lower = text.toLowerCase();
  const durableSignals = [
    /\bi\s+(prefer|like|want|need|use|always|usually|never|don't|dont|do not|hate|love)\b/,
    /\bmy\s+(name|email|domain|website|repo|repository|project|server|vps|api|model|workflow|preference|style)\b/,
    /\bwe\s+(decided|use|are using|should use|will use|need to|prefer)\b/,
    /\b(from now on|going forward|default to|keep using|stop using)\b/,
    /\b(error|failed|failure|bug|fix|fixed|workaround|root cause|solution)\b/,
    /\b(config|setting|env|endpoint|token|port|database|falkor|graphiti|ollama|mcp)\b/,
  ];
  return durableSignals.some((pattern) => pattern.test(lower));
}

function runtimeContextPrompt(context: RuntimeContext, mode: ChatMode) {
  const notes = context.notes.trim();
  const skills = context.skills.trim();
  if (!notes && !skills) return "";
  return [
    "",
    "Runtime context for this chat session:",
    notes ? `Notes:\n${notes.slice(0, 4000)}` : "",
    skills ? `${mode === "dev" ? "Dev/Ops skills and operating preferences" : "Skills and preferences"}:\n${skills.slice(0, 4000)}` : "",
    "Use this runtime context when relevant. It is session-local and not permanent memory.",
  ].filter(Boolean).join("\n\n");
}

function extractBrowserTarget(text: string) {
  const url = text.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (url) return url.replace(/[.,;]+$/, "");
  const domain = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>]*)?/i)?.[0];
  if (domain) return domain.replace(/[.,;]+$/, "");
  const quoted = text.match(/["“']([^"”']+)["”']/)?.[1];
  return quoted && /\./.test(quoted) ? quoted.trim() : "";
}

function containerNameCandidate(text: string) {
  const quoted = text.match(/["'`](.+?)["'`]/)?.[1];
  if (quoted) return quoted.trim();
  const exact = text.match(/\b([a-z0-9][a-z0-9_.-]*(?:worker|api|backend|frontend|server|service)[a-z0-9_.-]*)\b/i)?.[1];
  if (exact) return exact;
  if (/\byt\b|\byoutube\b/i.test(text) && /\bworker\b/i.test(text)) return "yt-worker";
  return "";
}



function parseToolJsonResult(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return { ok: false, raw: value };
  }
}

function cleanOneLine(value: unknown, limit = 180) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function listObservedLabels(values: any[] = [], limit = 8) {
  return values
    .map((item) => cleanOneLine(item?.text || item?.label || item?.name || item?.href || item?.selector || ""))
    .filter(Boolean)
    .slice(0, limit);
}

function observationFromBrowserAgent(payload: any) {
  const found = payload?.whatFound;

  if (found?.url || found?.title || found?.links || found?.buttons || found?.forms || found?.interactiveElements) {
    return found;
  }

  if (found?.observed?.url || found?.observed?.title || found?.observed?.links || found?.observed?.buttons) {
    return found.observed;
  }

  const lastObserveStep = Array.isArray(payload?.steps)
    ? [...payload.steps].reverse().find((step: any) => step?.type === "observe")
    : null;

  const previewPayload = lastObserveStep?.resultPreview;
  const parsedPreview = typeof previewPayload === "string"
    ? parseToolJsonResult(previewPayload)
    : previewPayload;

  if (parsedPreview?.url || parsedPreview?.title || parsedPreview?.links || parsedPreview?.buttons) {
    return parsedPreview;
  }

  return null;
}

function formatBrowserAgentDirectResponse(payload: any) {
  const observation = observationFromBrowserAgent(payload);
  const currentUrl = cleanOneLine(payload?.currentUrl || observation?.url || "unknown", 260);
  const currentTitle = cleanOneLine(payload?.currentTitle || observation?.title || "untitled", 180);
  const summary = cleanOneLine(payload?.summary || "", 700);

  const forms = Array.isArray(observation?.forms) ? observation.forms : [];
  const buttons = [
    ...(Array.isArray(observation?.buttons) ? observation.buttons : []),
    ...(Array.isArray(observation?.interactiveElements)
      ? observation.interactiveElements.filter((el: any) => /button/i.test(String(el?.role || el?.tag || "")))
      : []),
  ];
  const links = [
    ...(Array.isArray(observation?.links) ? observation.links : []),
    ...(Array.isArray(observation?.interactiveElements)
      ? observation.interactiveElements.filter((el: any) => el?.href || /link/i.test(String(el?.role || el?.tag || "")))
      : []),
  ];
  const inputs = [
    ...(Array.isArray(observation?.inputs) ? observation.inputs : []),
    ...forms.flatMap((form: any) => Array.isArray(form?.fields) ? form.fields : []),
  ];

  const lines: string[] = [];
  lines.push("**current url/title:** " + currentUrl + " — " + currentTitle);

  if (summary) {
    lines.push("");
    lines.push("**what happened:** " + summary);
  }

  if (payload?.blockedReason) {
    lines.push("");
    lines.push("**blocked:** " + cleanOneLine(payload.blockedReason, 700));
  }

  if (observation?.textPreview || observation?.text) {
    lines.push("");
    lines.push("**page text preview:** " + cleanOneLine(observation.textPreview || observation.text, 900));
  }

  const buttonLabels = listObservedLabels(buttons, 10);
  const linkLabels = listObservedLabels(links, 10);
  const inputLabels = inputs
    .map((field: any) => {
      const label = cleanOneLine(field?.placeholder || field?.ariaLabel || field?.name || field?.id || field?.selector || "");
      const type = cleanOneLine(field?.secret ? "password" : field?.type || "");
      return label ? label + (type ? " (" + type + ")" : "") : "";
    })
    .filter(Boolean)
    .slice(0, 10);

  lines.push("");
  lines.push("**forms/buttons/links actually observed on this page:**");

  if (forms.length) lines.push("- forms: " + forms.length);
  if (inputLabels.length) lines.push("- inputs: " + inputLabels.join(", "));
  if (buttonLabels.length) lines.push("- buttons: " + buttonLabels.join(", "));
  if (linkLabels.length) lines.push("- links: " + linkLabels.join(", "));

  if (!forms.length && !inputLabels.length && !buttonLabels.length && !linkLabels.length) {
    lines.push("- none clearly detected");
  }

  const safeAgentActions = Array.isArray(payload?.possibleNextActions) && payload?.extensionId
    ? payload.possibleNextActions
        .map((action: any) => cleanOneLine(action?.label || action?.text || ""))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  lines.push("");
  lines.push("**possible next actions:**");

  if (safeAgentActions.length) {
    safeAgentActions.forEach((label: string, index: number) => {
      lines.push(String(index + 1) + ". " + label);
    });
  } else {
    lines.push("1. tell me what visible button/link to click");
    lines.push("2. ask me to scrape the current page");
    lines.push("3. give me another URL to navigate");
    lines.push("4. tell me what to learn from this page");
  }

  lines.push("");
  if (payload?.requiresUser || payload?.status === "needs_user" || payload?.status === "blocked") {
    lines.push("I need your next instruction before acting again.");
  } else {
    lines.push("What would you like to do next?");
  }

  return lines.join("\n");
}

function forcedMcpTool(text: string, sessionId: string, enabledTools: OllamaTool[], mode: ChatMode) {
  const lower = text.toLowerCase();
  const hasTool = (name: string) => enabledTools.some((tool) => tool.function.name === name);
  const make = (name: string, args: Record<string, string> = {}) => hasTool(name) ? { name, args } : null;
  const explicitWebIntent = /\b(search|look up|lookup|web search|google|find latest|latest news|current news|news|right now on the web)\b/.test(lower);

  const browserTarget = extractBrowserTarget(text);

  if (mode === "browser" && !explicitWebIntent) {
    const agent = make("mcp__browser_agent__run", {
      sessionId,
      instruction: text.trim(),
    });
    if (agent) return agent;
  }

  const browserishIntent =
    Boolean(browserTarget) ||
    /\b(browser|website|webpage|current page|site skill|site skills|extension|extensions|known actions|available actions|button|link)\b/.test(lower) ||
    /\b(this|that)\s+(button|link|page)\s+(is|opens)\b/.test(lower) ||
    /\bremember\s+(this|that)\s+(button|link|page|action)\b/.test(lower);

  if (!explicitWebIntent && browserishIntent) {
    const agent = make("mcp__browser_agent__run", {
      sessionId,
      instruction: text.trim(),
    });
    if (agent) return agent;

    if (browserTarget && /\b(extension|extensions|site skill|site skills)\b/.test(lower)) {
      return make("mcp__extensions__match_url", { url: browserTarget });
    }
  }

  if ((/\b(lightpanda|browser|open page|open url|visit|navigate|extract page|read webpage|webpage|browse)\b/.test(lower) && browserTarget) || /^https?:\/\//i.test(browserTarget)) {
    return make("mcp__browser__lightpanda_navigate", { url: browserTarget });
  }

  if (explicitWebIntent) {
    return make("mcp__web__search", { query: text.trim().slice(0, 240), limit: "5" });
  }

  if (/\b(docker|container|containers|image|images|volume|volumes)\b/.test(lower)) {
    if (/\b(disk|space|usage|size|df|volume|volumes|image|images|storage|full)\b/.test(lower)) return make("mcp__ops__local_docker_disk_usage");
    if (/\b(ps|list|containers?|running|unhealthy)\b/.test(lower)) return make("mcp__ops__local_docker_containers");
    return make("mcp__ops__local_docker_status");
  }

  if (/\b(worker|service|pm2|process|backend|frontend|api)\b/.test(lower) && /\b(status|logs?|running|health|check|tail)\b/.test(lower)) {
    const name = containerNameCandidate(text);
    if (/\b(log|logs|tail)\b/.test(lower) && name) {
      return make("mcp__ops__local_docker_logs", { name, tail: "120" });
    }
    return make("mcp__ops__local_docker_container_status", name ? { name } : {});
  }

  if (/\b(ollama|model|models|chat-api|chat api|llm api|api health|api probe)\b/.test(lower)) {
    if (/\b(model|models|tags|available)\b/.test(lower)) return make("mcp__ops__ollama_models");
    if (/\b(probe|chat|generate|completion)\b/.test(lower)) return make("mcp__ops__ollama_chat_probe");
    return make("mcp__ops__ollama_health");
  }

  if (/\b(cold start|cold-start|pinger|ping monitor|monitor|health check|health-check)\b/.test(lower)) {
    if (/\b(log|logs|recent|tail)\b/.test(lower)) return make("mcp__ops__monitor_recent_logs");
    if (/\b(run|check|health)\b/.test(lower)) return make("mcp__ops__monitor_health_check");
    return make("mcp__ops__monitor_status");
  }

  if (shouldTriggerFactcheck(text)) {
    return make("mcp__web__search", { query: text.trim().slice(0, 240), limit: "5" });
  }

  if (/\b(memory|remembered|knowledge graph|graphiti|falkor|falkordb)\b/.test(lower)) {
    if (/\b(graph|nodes?|edges?|falkor|falkordb)\b/.test(lower)) return make("mcp__memory__graph_snapshot", { projectId: sessionId });
    return make("mcp__memory__search", { projectId: sessionId, query: text.trim().slice(0, 240) });
  }

  if (/\b(repo|git|commit|diff|branch|status)\b/.test(lower)) {
    if (/\b(diff|changed|changes)\b/.test(lower)) return make("mcp__git__diff_summary");
    if (/\b(commit|history|log)\b/.test(lower)) return make("mcp__git__recent_commits", { limit: "8" });
    return make("mcp__git__status");
  }

  if (/\b(file|folder|directory|workspace|read|list files|search files)\b/.test(lower)) {
    if (/\bread\b/.test(lower)) return make("mcp__local__search_files", { query: text.trim().slice(0, 80), path: "." });
    return make("mcp__local__list_directory", { path: "." });
  }

  return null;
}

  function modeAllowsMcp(mode: ChatMode) {
    return mode === "dev" || mode === "browser" || mode === "scraper";
  }

  function isToolAllowedInMode(name: string, mode: ChatMode, allowWebTools: boolean) {
    const isMcp = name.startsWith("mcp__");
    const isBrowserAgent = name.startsWith("mcp__browser_agent__");
    const isBrowser = name.startsWith("mcp__browser__");
    const isExtension = name.startsWith("mcp__extensions__");
    const isWeb = name === "search_web" || name.startsWith("mcp__web__");

    if (mode === "browser") {
      return isBrowserAgent || isBrowser || isExtension;
    }
    if (mode === "scraper") {
      return name === "mcp__browser__instant_scrape"
        || name === "mcp__browser__lightpanda_action"
        || name === "mcp__browser__lightpanda_navigate"
        || name === "mcp__browser__lightpanda_extract";
    }

    if (mode === "dev") {
      if (isWeb && !allowWebTools) return false;
      return true;
    }

    // Normal modes: no MCP. This prevents random MCP calls.
    if (isMcp) return false;
    if (isWeb) return allowWebTools;
    return true;
  }

function parseRouterJson(content = "") {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

async function routeToolUse(args: {
  model: string;
  text: string;
  tools: OllamaTool[];
  projectId: string;
  signal?: AbortSignal;
}) {
  if (!args.text.trim() || args.tools.length === 0) return null;
  const toolList = args.tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
  const response = await ollamaChatNonStream({
    model: args.model,
    think: false,
    stream: false,
    format: "json",
    projectId: args.projectId,
    signal: args.signal,
    options: { temperature: 0, num_ctx: 4096 },
    messages: [
      {
        role: "system",
        content: [
          "You are a strict tool router for a terminal AI app.",
          "Return JSON only with this shape: {\"answer_directly\":boolean,\"must_call_tools\":boolean,\"tool_candidates\":[{\"name\":\"tool_name\",\"arguments\":{}}],\"risk\":\"low|medium|high\",\"reason\":\"short\"}.",
          "Mandatory tool paths: explicit current web facts/search, memory writes or reads, repo/file questions, local Docker/Ollama/monitor checks, graph/FalkorDB questions.",
          "If a mandatory path applies, set answer_directly false and must_call_tools true.",
          "Only choose tools from the supplied list. Prefer one or two focused tools.",
          "In browser mode, website actions and learned site-skill actions must use mcp__browser_agent__run when available. Do not send action labels as browser URLs.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          user_message: args.text,
          tools: toolList,
        }),
      },
    ],
  });
  return parseRouterJson(response.message?.content || "");
}

function memorySummaryForLog(memory: any) {
  return memory?.summary || memory?.text || memory?.message || memory?.description || memory?.value || memory?.object || "";
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ChatProvider({ children, initialSessionId, sessionName }: { children: ReactNode; initialSessionId?: string; sessionName?: string }) {
  const [sessionId] = useState(() => loadOrCreateSessionId(initialSessionId));
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState("");
  const [activityStatus, setActivityStatus] = useState<ChatActivityStatus>("idle");
  const [chatMode, setChatModeState] = useState<ChatMode>(() => loadChatMode());
  const [selectedModel, setSelectedModelState] = useState(() => {
    const storage = safeLocalStorage();
    return storage?.getItem(CHAT_MODEL_KEY) || MODEL_ID;
  });
  const [sessionOptions, setSessionOptions] = useState<SessionOptions>(() => loadSessionOptions());
  const [runtimeContext, setRuntimeContext] = useState<RuntimeContext>(() => loadRuntimeContext(sessionId));
  const attachedFileRef = useRef<AttachedFile | null>(null);
  attachedFileRef.current = attachedFile;

  // Tool logs — exposed to side panel
  const toolLogsRef = useRef<ToolLog[]>(loadToolLogs(sessionId));
  const runLogsRef = useRef<AssistantRunLog[]>(loadRunLogs(sessionId));
  const reasoningLogsRef = useRef<ReasoningLog[]>(loadReasoningLogs(sessionId));

  // Mutable session options
  const sessionOptionsRef = useRef<SessionOptions>(sessionOptions);
  const selectedModelRef = useRef(selectedModel);
  const chatModeRef = useRef(chatMode);
  const runtimeContextRef = useRef(runtimeContext);
  const thinkOverrideRef = useRef<boolean | null>(null);
  const assistantTurnCountRef = useRef(0);
  const webSearchEnabledRef = useRef<boolean>(true);
  const mcpToolsRef = useRef<OllamaTool[]>([]);

  selectedModelRef.current = selectedModel;
  chatModeRef.current = chatMode;
  runtimeContextRef.current = runtimeContext;
  sessionOptionsRef.current = sessionOptions;

  const persistToolLogs = useCallback(() => {
    saveToolLogs(sessionId, toolLogsRef.current);
  }, [sessionId]);

  const appendToolLogs = useCallback((logs: ToolLog[]) => {
    toolLogsRef.current = [...toolLogsRef.current, ...logs].slice(-MAX_TOOL_LOGS);
    saveToolLogs(sessionId, toolLogsRef.current);
  }, [sessionId]);

  const persistRunLogs = useCallback(() => {
    saveRunLogs(sessionId, runLogsRef.current);
  }, [sessionId]);

  const appendRunLog = useCallback((run: AssistantRunLog) => {
    runLogsRef.current = [...runLogsRef.current, run].slice(-MAX_RUN_LOGS);
    saveRunLogs(sessionId, runLogsRef.current);
  }, [sessionId]);

  const updateRunLog = useCallback((runId: string, updates: Partial<AssistantRunLog>) => {
    const index = runLogsRef.current.findIndex((run) => run.id === runId);
    if (index === -1) return;
    runLogsRef.current[index] = {
      ...runLogsRef.current[index],
      ...updates,
      updatedAt: updates.updatedAt ?? Date.now(),
    };
    saveRunLogs(sessionId, runLogsRef.current);
  }, [sessionId]);

  const clearActivity = useCallback(() => {
    toolLogsRef.current = [];
    runLogsRef.current = [];
    reasoningLogsRef.current = [];
    saveToolLogs(sessionId, []);
    saveRunLogs(sessionId, []);
    saveReasoningLogs(sessionId, []);
  }, [sessionId]);

  const persistReasoningLogs = useCallback(() => {
    saveReasoningLogs(sessionId, reasoningLogsRef.current);
  }, [sessionId]);

  const appendReasoningLog = useCallback((log: ReasoningLog) => {
    reasoningLogsRef.current = [...reasoningLogsRef.current, log].slice(-MAX_REASONING_LOGS);
    saveReasoningLogs(sessionId, reasoningLogsRef.current);
  }, [sessionId]);

  const refreshModels = useCallback(async () => {
    setModelsLoading(true);
    setModelError("");
    try {
      const list = await ollamaListModels();
      setModels(list);
      if (list.length > 0 && !list.includes(selectedModelRef.current)) {
        setSelectedModelState(list[0]);
        selectedModelRef.current = list[0];
        safeLocalStorage()?.setItem(CHAT_MODEL_KEY, list[0]);
      }
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "model refresh failed");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const setSelectedModel = useCallback((model: string) => {
    setSelectedModelState(model);
    selectedModelRef.current = model;
    safeLocalStorage()?.setItem(CHAT_MODEL_KEY, model);
  }, []);

  const setChatMode = useCallback((mode: ChatMode) => {
    setChatModeState(mode);
    chatModeRef.current = mode;
    safeLocalStorage()?.setItem(CHAT_MODE_KEY, mode);
  }, []);

  const updateSessionOptions = useCallback((updates: Partial<SessionOptions>) => {
    setSessionOptions((previous) => {
      const next = { ...previous, ...updates };
      sessionOptionsRef.current = next;
      try { safeLocalStorage()?.setItem(CHAT_OPTIONS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    if (updates.think !== undefined) thinkOverrideRef.current = updates.think;
  }, []);

  const updateRuntimeContext = useCallback((updates: Partial<RuntimeContext>) => {
    setRuntimeContext((previous) => {
      const next = { ...previous, ...updates };
      runtimeContextRef.current = next;
      saveRuntimeContext(sessionId, next);
      return next;
    });
  }, [sessionId]);

  const clearRuntimeContext = useCallback(() => {
    const next = { notes: "", skills: "" };
    setRuntimeContext(next);
    runtimeContextRef.current = next;
    saveRuntimeContext(sessionId, next);
  }, [sessionId]);

  const [flushKey, setFlushKey] = useState(0);

  const clearChatHistory = useCallback(() => {
    const storage = safeLocalStorage();
    if (!storage) return;
    
    // Clear current session specific data (history, logs, context)
    storage.removeItem(historyKey(sessionId));
    storage.removeItem(toolLogsKey(sessionId));
    storage.removeItem(runLogsKey(sessionId));
    storage.removeItem(reasoningLogsKey(sessionId));
    storage.removeItem(runtimeContextKey(sessionId));
    
    // Clear in-memory refs for this session
    toolLogsRef.current = [];
    runLogsRef.current = [];
    reasoningLogsRef.current = [];
    
    // Clear runtime context for this session
    const next = { notes: "", skills: "" };
    setRuntimeContext(next);
    runtimeContextRef.current = next;
    saveRuntimeContext(sessionId, next);
    
    // Force remount of the runtime to load the now-empty history from storage
    // This clears the UI messages without reloading the entire page/app
    setFlushKey(k => k + 1);
  }, [sessionId]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    const handleClear = () => clearActivity();
    window.addEventListener("reterm-activity-clear", handleClear);
    return () => window.removeEventListener("reterm-activity-clear", handleClear);
  }, [clearActivity]);

  useEffect(() => {
    let alive = true;
    listMcpToolDefinitions()
      .then((tools) => {
        if (alive) mcpToolsRef.current = tools;
      })
      .catch((err) => console.warn("MCP tool refresh failed:", err));
    return () => { alive = false; };
  }, []);

  const adapter = useMemo((): ChatModelAdapter => ({
    async *run({ messages, abortSignal }: ChatModelRunOptions) {
      setActivityStatus("loading");
      const file = attachedFileRef.current;
      const currentModel = selectedModelRef.current || MODEL_ID;
      const lastMsg = messages[messages.length - 1];
      const lastText = lastMsg?.content
        .filter((c) => c.type === "text")
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("") ?? "";

      // ── Slash command handling ──────────────────────────────────────────────
      const slash = parseSlashCommand(lastText);
      if (slash) {
        if (slash.modeOverride) {
          setChatMode(slash.modeOverride);
        }
        if (slash.optionOverrides) {
          updateSessionOptions(slash.optionOverrides);
          if ("think" in slash.optionOverrides) {
            thinkOverrideRef.current = slash.modeOverride === "auto" || slash.modeOverride === "dev"
              ? null
              : (slash.optionOverrides.think ?? null);
          }
        }
        if (slash.webSearchOverride !== undefined) {
          webSearchEnabledRef.current = slash.webSearchOverride;
        }
        yield { content: [{ type: "text" as const, text: slash.response }] };
        setActivityStatus("idle");
        return;
      }

      const promptMode = chatModeRef.current;
      void warmupModels({
        model: currentModel,
        includeBrowserAgent: promptMode === "browser",
      }).catch((err) => console.warn("Model warmup failed:", err));

      const runId = generateUUID();
      const runStartedAt = Date.now();
      appendRunLog({
        id: runId,
        status: "running",
        model: currentModel,
        startedAt: runStartedAt,
        updatedAt: runStartedAt,
        userPrompt: lastText.trim().slice(0, 220),
        toolCount: 0,
        errorCount: 0,
        toolsUsed: [],
      });
      const syncRunFromTools = (status: AssistantRunLog["status"]) => {
        const runTools = toolLogsRef.current.filter((log) => log.runId === runId);
        updateRunLog(runId, {
          status,
          durationMs: Date.now() - runStartedAt,
          toolCount: runTools.length,
          errorCount: runTools.filter((log) => log.status === "error").length,
          toolsUsed: Array.from(new Set(runTools.map((log) => log.tool))),
        });
      };

      let memoryContext = "";
      if (lastText.trim()) {
        setActivityStatus("checking-memory");
        try {
          const memories = await searchMemory(sessionId, lastText.trim());
          const relevant = memories
            .filter((memory) => memory.text !== lastText.trim())
            .slice(0, 6);

          if (relevant.length > 0) {
            memoryContext = `\n\nRelevant long-term memory for this chat:\n${JSON.stringify(relevant)}`;
          }
        } catch (err) {
          console.warn("Memory lookup failed:", err);
        }
      }

      const explicitMemory = detectExplicitMemory(lastText);
      if (explicitMemory) {
        const memoryLog: ToolLog = {
          tool: "memory.save_explicit",
          args: {
            projectId: sessionId,
            source: "explicit_user_request",
            summary: explicitMemory.summary,
          },
          result: "",
          status: "running",
          timestamp: Date.now(),
          runId,
          model: currentModel,
          memory: explicitMemory,
        };
        appendToolLogs([memoryLog]);
        setActivityStatus("saving-memory");
        const startedAt = Date.now();
        try {
          const saved = await saveFact(sessionId, explicitMemory);
          if (saved.success && saved.memory) {
            memoryLog.status = "complete";
            memoryLog.durationMs = Date.now() - startedAt;
            memoryLog.memory = saved.memory;
            memoryLog.result = memorySummaryForLog(saved.memory) || "explicit memory saved";
            persistToolLogs();
            syncRunFromTools("running");
            memoryContext += `\n\nJust saved user memory:\n${JSON.stringify(saved.memory)}`;
          } else {
            memoryLog.status = "error";
            memoryLog.durationMs = Date.now() - startedAt;
            memoryLog.result = saved.reason || "explicit memory save failed";
            persistToolLogs();
            syncRunFromTools("running");
            memoryContext += `\n\nExplicit memory save failed. Tell the user exactly: ${memoryLog.result}`;
          }
        } catch (err) {
          memoryLog.status = "error";
          memoryLog.durationMs = Date.now() - startedAt;
          memoryLog.result = err instanceof Error ? err.message : "explicit memory save failed";
          persistToolLogs();
          syncRunFromTools("running");
          memoryContext += `\n\nExplicit memory save failed. Tell the user exactly: ${memoryLog.result}`;
        }
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

      const { think: _think, browserUseExtensions: _browserUseExtensions, ...inferenceOptions } = sessionOptionsRef.current;
      const mode = promptMode;
      const runtime = runtimeContextRef.current;
      const browserUseExtensions = sessionOptionsRef.current.browserUseExtensions !== false;

      // ── Determine think mode ────────────────────────────────────────────────
      let think: boolean;
      if (mode === "dev") {
        think = false;
      } else if (thinkOverrideRef.current !== null) {
        think = thinkOverrideRef.current;
      } else if (assistantTurnCountRef.current >= 2 && shouldEscalateToFullThink(lastText)) {
        think = true;
      } else {
        think = shouldAutoThink(lastText);
      }

      const webSearchEnabled = webSearchEnabledRef.current;

      // ── System prompt ───────────────────────────────────────────────────────
      const basePrompt =
  mode === "dev" ? DEV_SYSTEM_PROMPT :
  mode === "browser" ? BROWSER_SYSTEM_PROMPT :
  mode === "scraper" ? SCRAPER_SYSTEM_PROMPT :
  SYSTEM_PROMPT;
      const systemPromptContent = 
        (sessionName ? `Current Session Topic: "${sessionName}". \n` : "") +
        basePrompt.replace("{MALAYSIA_TIME}", getMalaysiaTime())
        + runtimeContextPrompt(runtime, mode)
        + memoryContext
        + (webSearchEnabled ? "" : "\n\nWeb search is currently DISABLED by the user. Do NOT attempt to use search_web or any search tool. Answer only from your training data.");

      const systemMessage: OllamaMessage = { role: "system", content: systemPromptContent };

      // Filter tools
      const explicitWebRequest = /\b(search|look up|lookup|browse|web|google|find latest|latest news|current news|news|right now on the web)\b/i.test(lastText);
      const allowWebTools = webSearchEnabled && (mode !== "dev" || explicitWebRequest);
          
      const allTools = [
        ...TOOLS,
        ...(modeAllowsMcp(mode) ? mcpToolsRef.current : []),
      ];
      
      const activeTools = allTools.filter((tool) =>
        isToolAllowedInMode(tool.function.name, mode, allowWebTools) &&
        (mode !== "browser" || browserUseExtensions || !tool.function.name.startsWith("mcp__extensions__"))
      );
      
      const activeToolNames = new Set(activeTools.map((tool) => tool.function.name));
      const mcpEnabledForMode = modeAllowsMcp(mode);
      // ── Tool detection ──────────────────────────────────────────────────────
      const factcheckHint = allowWebTools && shouldTriggerFactcheck(lastText)
        ? " [Note: this query may involve current or time-sensitive information — consider using search_web to verify]"
        : "";

      let toolCalls: Array<{ function: { name: string; arguments: Record<string, string> } }> | undefined;
      const allowToolRouting = !isCasualNoTool(lastText);

      if (allowToolRouting && mcpEnabledForMode) {
        setActivityStatus("choosing-tool");
        try {
          const fuzzy = await routeMcpIntent(lastText, sessionId, { mode });
          const fuzzyCandidates = Array.isArray(fuzzy?.tool_candidates) ? fuzzy.tool_candidates : [];
          const fuzzyCalls = fuzzyCandidates
            .filter((candidate: any) => activeToolNames.has(candidate?.name))
            .slice(0, 3)
            .map((candidate: any) => ({
              function: {
                name: String(candidate.name),
                arguments: asToolArgs(candidate.arguments),
              },
            }));
      const fuzzyConfidence = Number(fuzzy?.confidence ?? 1);
      if (fuzzy?.must_call_tools && fuzzyCalls.length > 0 && fuzzyConfidence >= 0.85) {
        toolCalls = fuzzyCalls;
      }
        } catch (err) {
          console.warn("Fuzzy MCP router failed:", err);
        }
      }

      if (allowToolRouting && (!toolCalls || toolCalls.length === 0)) {
        try {
          const routed = await routeToolUse({
            model: currentModel,
            text: lastText + factcheckHint,
            tools: activeTools,
            projectId: sessionId,
            signal: abortSignal,
          });
          const candidates = Array.isArray(routed?.tool_candidates) ? routed.tool_candidates : [];
          const routedCalls = candidates
            .filter((candidate: any) => activeToolNames.has(candidate?.name))
            .slice(0, 3)
            .map((candidate: any) => ({
              function: {
                name: String(candidate.name),
                arguments: asToolArgs(candidate.arguments),
              },
            }));
          if (routed?.must_call_tools && routedCalls.length > 0) {
            toolCalls = routedCalls;
          }
        } catch (err) {
          console.warn("Strict tool router failed:", err);
        }
      }

      if (allowToolRouting && (!toolCalls || toolCalls.length === 0)) {
        const preDetected = preDetectTool(lastText);
        const preDetectedFiltered = preDetected?.name === "search_web" && !webSearchEnabled
          ? null
          : preDetected;

        if (preDetectedFiltered && activeToolNames.has(preDetectedFiltered.name)) {
          toolCalls = [{ function: { name: preDetectedFiltered.name, arguments: preDetectedFiltered.args } }];
        }
      }

      if (allowToolRouting && (!toolCalls || toolCalls.length === 0)) {
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
            model: currentModel,
            messages: toolCheckMessages,
            think: false,
            tools: activeTools,
            options: { ...inferenceOptions, num_ctx: 2048 },
            projectId: sessionId,
            signal: abortSignal,
          });
          toolCalls = toolCheckRes?.message?.tool_calls?.map((call) => ({
            function: {
              name: call.function.name,
              arguments: asToolArgs(call.function.arguments),
            },
          })).filter((call) => activeToolNames.has(call.function.name));
        } catch (err) {
          console.warn("Tool check failed:", err);
        }
      }

        if (allowToolRouting && mcpEnabledForMode && (!toolCalls || toolCalls.length === 0)) {
          const forcedMcp = forcedMcpTool(lastText, sessionId, activeTools, mode);
        if (forcedMcp) {
          toolCalls = [{ function: { name: forcedMcp.name, arguments: forcedMcp.args } }];
        }
      }

      if (allowToolRouting && (!toolCalls || toolCalls.length === 0)) {
        const forced = forcedSearchTool(lastText, allowWebTools);
        if (forced && activeToolNames.has(forced.name)) {
          toolCalls = [{ function: { name: forced.name, arguments: forced.args } }];
        }
      }
      if (mode === "browser" && toolCalls && toolCalls.length > 0) {
        toolCalls = toolCalls.map((call) => call.function.name.startsWith("mcp__browser_agent__")
          ? {
              function: {
                ...call.function,
                arguments: {
                  ...asToolArgs(call.function.arguments),
                  useExtensions: String(browserUseExtensions),
                },
              },
            }
          : call);
      }
      if ((mode === "browser" || mode === "scraper") && toolCalls && toolCalls.length > 1) {
        toolCalls = [toolCalls[0]];
      }
      // ── Execute tools ───────────────────────────────────────────────────────
      let finalMessages: OllamaMessage[] = [systemMessage, ...apiMessages];

      if (toolCalls && toolCalls.length > 0) {
        setActivityStatus("calling-tool");
        // Log tools for side panel
        const toolLogEntries: ToolLog[] = toolCalls.map(tc => ({
          tool: tc.function.name,
          args: asToolArgs(tc.function.arguments),
          result: "",
          status: "running",
          timestamp: Date.now(),
          runId,
          model: currentModel,
        }));
        appendToolLogs(toolLogEntries);
        syncRunFromTools("running");

        const toolResults = await Promise.all(
          toolCalls.map(async (tc) => {
            const logEntry = toolLogEntries.find(
              e => e.tool === tc.function.name && JSON.stringify(e.args) === JSON.stringify(tc.function.arguments)
            );
            const startedAt = Date.now();
            try {
              const result = await executeTool(tc.function.name, tc.function.arguments);
              if (logEntry) { logEntry.result = result; logEntry.status = "complete"; logEntry.durationMs = Date.now() - startedAt; }
              persistToolLogs();
              syncRunFromTools("running");
              return { name: tc.function.name, result, error: false };
            } catch (err: any) {
              const error = err instanceof Error ? err.message : String(err);
              if (logEntry) { logEntry.result = error; logEntry.status = "error"; logEntry.durationMs = Date.now() - startedAt; }
              persistToolLogs();
              syncRunFromTools("running");
              return { name: tc.function.name, result: `Error: ${error}`, error: true };
            }
          })
        );


        const browserAgentResult = mode === "browser"
          ? toolResults.find((tr) => tr.name.startsWith("mcp__browser_agent__"))
          : null;

        if (browserAgentResult && !browserAgentResult.error) {
          const parsed = parseToolJsonResult(browserAgentResult.result);
          const responseText = formatBrowserAgentDirectResponse(parsed);

          syncRunFromTools("success");
          setActivityStatus("idle");

          yield {
            content: [
              { type: "text" as const, text: responseText },
            ],
          };

          return;
        }

        const toolErrors = toolResults.filter((tr) => tr.error);
        if (toolErrors.length > 0) {
          const responseText = [
            "I could not complete this because a required tool failed.",
            "",
            ...toolErrors.flatMap((tr) => [
              `tool: ${tr.name}`,
              `error: ${String(tr.result).replace(/^Error:\s*/i, "")}`,
              "",
            ]),
          ].join("\n").trim();
          syncRunFromTools("failed");
          setActivityStatus("idle");
          yield {
            content: [
              { type: "text" as const, text: responseText },
            ],
          };
          return;
        }

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
      let reasoningLog: ReasoningLog | null = null;

      try {
        for await (const chunk of ollamaChatStream({
          model: currentModel,
          messages: finalMessages,
          think,
          options: { ...inferenceOptions, num_ctx: 4096 },
          projectId: sessionId,
          signal: abortSignal,
        })) {
          const thinking = chunk?.message?.thinking;
          const content = chunk?.message?.content;

          if (thinking) {
            setActivityStatus("reasoning");
            reasoningText += thinking;
            if (!reasoningLog) {
              const now = Date.now();
              reasoningLog = {
                id: generateUUID(),
                title: lastText.trim().slice(0, 80) || "model reasoning",
                text: "",
                status: "running",
                startedAt: now,
                updatedAt: now,
                runId,
                model: currentModel,
              };
              appendReasoningLog(reasoningLog);
            }
            reasoningLog.text = reasoningText;
            reasoningLog.updatedAt = Date.now();
            persistReasoningLogs();
          }
          if (content) {
            setActivityStatus("crafting");
            responseText += content;
          }

          if (content) {
            yield {
              content: [
                { type: "text" as const, text: responseText },
              ],
            };
          }
        }
      } catch (err) {
        setActivityStatus("idle");
        if (err instanceof Error && err.name === "AbortError") return;
        syncRunFromTools("failed");
        throw err;
      }

      if (reasoningLog) {
        reasoningLog.status = "complete";
        reasoningLog.updatedAt = Date.now();
        persistReasoningLogs();
      }

      syncRunFromTools(
        toolLogsRef.current.some((log) => log.runId === runId && log.status === "error") ? "failed" : "success"
      );

      assistantTurnCountRef.current += 1;

      if (!explicitMemory && shouldAttemptAutonomousMemory(lastText, responseText)) {
        setActivityStatus("saving-memory");
        const memoryLog: ToolLog = {
          tool: "memory.extract",
          args: {
            projectId: sessionId,
            model: currentModel,
            source: "chat",
          },
          result: "",
          status: "running",
          timestamp: Date.now(),
          runId,
          model: currentModel,
        };
        appendToolLogs([memoryLog]);
        syncRunFromTools("running");

        void extractMemories(sessionId, currentModel, lastText.trim(), responseText.trim())
          .then((result) => {
            const memories = Array.isArray(result.memories) ? result.memories : [];
            memoryLog.status = "complete";
            memoryLog.durationMs = Date.now() - (memoryLog.timestamp || Date.now());
            memoryLog.memory = memories[0] || null;
            memoryLog.result = memories.length > 0
              ? `${memories.length} autonomous ${memories.length === 1 ? "memory" : "memories"} saved`
              : "no durable memory selected";
            persistToolLogs();
            syncRunFromTools(
              toolLogsRef.current.some((log) => log.runId === runId && log.status === "error") ? "failed" : "success"
            );
            setActivityStatus("idle");
          })
          .catch((err) => {
            memoryLog.status = "error";
            memoryLog.durationMs = Date.now() - (memoryLog.timestamp || Date.now());
            memoryLog.result = err instanceof Error ? err.message : "memory extraction failed";
            persistToolLogs();
            syncRunFromTools("failed");
            setActivityStatus("idle");
          });
      } else {
        setActivityStatus("idle");
      }

      // ── Hint injection (every 4th turn in auto mode) ────────────────────────
      const shouldInjectHint =
        mode !== "dev" &&
        thinkOverrideRef.current === null &&
        assistantTurnCountRef.current > 0 &&
        assistantTurnCountRef.current % 4 === 0;

      if (shouldInjectHint) {
        const hint = "\n\n---\n*If I'm underperforming, try `/think` for full reasoning mode.*";
        yield {
          content: [
            { type: "text" as const, text: responseText + hint },
          ],
        };
      }
    },
  }), [appendReasoningLog, appendRunLog, appendToolLogs, persistReasoningLogs, persistToolLogs, sessionId, setChatMode, updateRunLog, updateSessionOptions]);

  const dictationAdapter = useMemo(() => new PauseDictationAdapter({ lang: "en-US" }), []);
  const historyAdapter = useMemo(() => createLocalHistoryAdapter(historyKey(sessionId)), [sessionId]);
  const runtime = useLocalRuntime(adapter, { adapters: { dictation: dictationAdapter, history: historyAdapter } });

  return (
    <ChatContext.Provider
      value={{
        sessionId,
        attachedFile,
        setAttachedFile,
        toolLogsRef,
        runLogsRef,
        reasoningLogsRef,
        activityStatus,
        persistToolLogs,
        persistRunLogs,
        clearActivity,
        clearChatHistory,
        chatMode,
        setChatMode,
        selectedModel,
        models,
        modelsLoading,
        modelError,
        setSelectedModel,
        refreshModels,
        sessionOptions,
        updateSessionOptions,
        runtimeContext,
        updateRuntimeContext,
        clearRuntimeContext,
      }}
    >
      <AssistantRuntimeProvider key={flushKey} runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </ChatContext.Provider>
  );
}
