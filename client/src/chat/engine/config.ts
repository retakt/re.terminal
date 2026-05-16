// ── Chat configuration ──────────────────────────────────────────────────────

export const MODEL_ID = import.meta.env.VITE_MODEL_ID ?? "joe-speedboat/Gemma-4-Uncensored-HauhauCS-Aggressive:e4b";

// ── Malaysia time helper ──────────────────────────────────────────────────────

export function getMalaysiaTime(): string {
  const now = new Date();
  const myt = new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(now);
  return `${myt} (MYT, UTC+8)`;
}

// ── System prompt ─────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `Your name is Re:Ai. You were fine-tuned by Takt Akira.
Never mention Takt Akira, your fine-tuner, your training, or anything about your origins unless directly and explicitly asked. Even then, only say your name is Re:Ai. Do not volunteer this information, do not hint at it, do not add it as a footnote or aside.
Be helpful, direct, and concise.
Before you respond, briefly scan your previous reply in the conversation. If you notice you made an error, a wrong assumption, or gave incomplete information, acknowledge it naturally and correct it — don't double down. You don't need to announce this every time, only when there's actually something to fix.
The current time is: {MALAYSIA_TIME}. Malaysia is UTC+8, which is 8 hours ahead of GMT. Use this when the user asks about time, schedules, or anything time-related.
You have access to a web search tool with these modes — use them proactively:
- factcheck: quick 2-result verify. Use when uncertain, when data might be outdated, or after 2-3 turns where accuracy matters. Do not wait to be asked.
- general: 5-result search. Use when user explicitly asks to search.
- news: current events, recent announcements. Use for anything time-sensitive.
- reddit: opinions, recommendations, community discussions. Use when user wants real experiences or reviews.
- wiki: encyclopedic facts, definitions. Use for "what is X" type questions.
- code: programming questions, libraries, errors. Use for technical lookups.
You are not always right. Your training has a cutoff. When in doubt, search.`;

// ── Inference presets ─────────────────────────────────────────────────────────

import type { SessionOptions } from "../types";

export const BALANCED_OPTIONS: SessionOptions = {
  think: false,
  temperature: 0.3,
  top_k: 15,
  top_p: 1.0,
};

export const FULL_THINK_OPTIONS: SessionOptions = {
  think: true,
  temperature: 1,
  top_k: 64,
  top_p: 0.95,
};

export const NO_THINK_OPTIONS: SessionOptions = {
  think: false,
  temperature: 0.3,
  top_k: 15,
  top_p: 1.0,
};

export const DEFAULT_OPTIONS = BALANCED_OPTIONS;

// ── Auto-think detection ──────────────────────────────────────────────────────

const THINK_KEYWORDS = [
  "explain", "why", "how", "because", "reason", "think", "figure",
  "prove", "proof", "derive", "logic", "infer", "conclude",
  "calculate", "compute", "solve", "math", "equation", "formula",
  "convert", "estimate", "percentage", "probability",
  "code", "debug", "fix", "error", "function", "algorithm",
  "implement", "build", "script", "program", "bug", "issue",
  "what is", "what are", "what was", "what were", "who is", "who are",
  "when did", "where is", "which", "define", "definition",
  "summarize", "summary", "tldr", "brief", "overview", "recap",
  "write", "rewrite", "rephrase", "paraphrase", "draft", "compose",
  "generate", "create", "make", "translate",
  "brainstorm", "ideas", "suggest", "recommend", "options", "alternatives",
  "list", "give me", "tell me", "show me",
  "analyze", "analyse", "compare", "difference", "extract", "identify",
  "classify", "categorize", "evaluate", "review", "assess",
  "riddle", "puzzle", "story", "poem", "joke", "creative",
  "help me", "can you", "could you", "please", "how do i", "how to",
];

export function shouldAutoThink(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower.length > 120) return true;
  if ((lower.match(/[.!?]/g) ?? []).length >= 2) return true;
  if (THINK_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  return false;
}

// ── Client-side tool pre-detection ───────────────────────────────────────────

interface PreDetectedTool {
  name: string;
  args: Record<string, string>;
}

export function preDetectTool(text: string): PreDetectedTool | null {
  const lower = text.toLowerCase().trim();

  const weatherMatch = lower.match(/(?:weather|temperature|forecast|rain|humid|hot|cold)\s+(?:in|at|for)\s+([a-z\s]+?)(?:\?|$|,|\.|today|now|right)/);
  if (weatherMatch) {
    const city = weatherMatch[1].trim();
    if (city.length > 1 && city.length < 40) return { name: "get_weather", args: { city } };
  }

  const timeMatch = lower.match(/(?:what(?:'s| is) the )?time\s+(?:in|at)\s+([a-z\s/]+?)(?:\?|$|,|\.)/);
  if (timeMatch) {
    const place = timeMatch[1].trim();
    const tzMap: Record<string, string> = {
      "tokyo": "Asia/Tokyo", "japan": "Asia/Tokyo",
      "london": "Europe/London", "uk": "Europe/London",
      "new york": "America/New_York", "nyc": "America/New_York",
      "los angeles": "America/Los_Angeles", "la": "America/Los_Angeles",
      "paris": "Europe/Paris", "france": "Europe/Paris",
      "sydney": "Australia/Sydney", "australia": "Australia/Sydney",
      "dubai": "Asia/Dubai", "uae": "Asia/Dubai",
      "singapore": "Asia/Singapore",
      "kuala lumpur": "Asia/Kuala_Lumpur", "kl": "Asia/Kuala_Lumpur", "malaysia": "Asia/Kuala_Lumpur",
      "jakarta": "Asia/Jakarta", "indonesia": "Asia/Jakarta",
      "beijing": "Asia/Shanghai", "shanghai": "Asia/Shanghai", "china": "Asia/Shanghai",
      "seoul": "Asia/Seoul", "korea": "Asia/Seoul",
      "mumbai": "Asia/Kolkata", "india": "Asia/Kolkata",
      "moscow": "Europe/Moscow", "russia": "Europe/Moscow",
      "berlin": "Europe/Berlin", "germany": "Europe/Berlin",
    };
    const tz = tzMap[place] ?? "Asia/Kuala_Lumpur";
    return { name: "get_time", args: { timezone: tz } };
  }

  const fxMatch = lower.match(/(?:convert\s+)?(\d+\s+)?([a-z]{3})\s+(?:to|in)\s+([a-z]{3})(?:\?|$|\s)/);
  if (fxMatch) {
    const from = fxMatch[2].toUpperCase();
    const to = fxMatch[3].toUpperCase();
    const currencies = ["USD","EUR","GBP","JPY","MYR","SGD","AUD","CNY","KRW","THB","IDR","INR","CAD","CHF","HKD","TWD","BTC","ETH"];
    if (currencies.includes(from) && currencies.includes(to)) {
      return { name: "get_exchange_rate", args: { from, to } };
    }
  }

  return null;
}

// ── Factcheck triggers ────────────────────────────────────────────────────────

const FACTCHECK_TRIGGERS = [
  "latest", "current", "today", "right now", "recent", "just released",
  "new version", "update", "this year", "2025", "2026",
  "price", "cost", "how much", "rate", "stock", "crypto", "bitcoin",
  "exchange rate", "currency",
  "score", "result", "winner", "who won", "standings", "match", "game",
  "tournament", "league",
  "is it true", "did they", "have they", "has it", "what happened",
  "is he still", "is she still", "does it still", "is it still",
  "news", "announced", "released", "launched",
];

export function shouldTriggerFactcheck(text: string): boolean {
  const lower = text.toLowerCase();
  return FACTCHECK_TRIGGERS.some((kw) => lower.includes(kw));
}

// ── Retry signals ─────────────────────────────────────────────────────────────

const RETRY_SIGNALS = [
  "again", "still", "wrong", "incorrect", "not right", "that's not",
  "thats not", "no that", "not what", "doesn't work", "doesnt work",
  "same issue", "same problem", "same error", "try again", "not correct",
  "you said", "you told", "you were", "you got", "that was wrong",
  "still not", "still wrong", "still broken", "still failing",
  "not working", "didn't work", "didnt work", "failed again",
  "nope", "nah", "no it", "not it", "nothing changed", "nothing works",
  "its same", "it's same", "same thing", "same result", "still same",
  "didn't fix", "didnt fix", "not fixed", "still broken", "still there",
  "still happening", "still occurs", "still getting", "still seeing",
  "doesn't help", "doesnt help", "didn't help", "didnt help",
  "no change", "no difference", "no effect", "no luck",
  "not working still", "still not working", "still not fixed",
];

export function shouldEscalateToFullThink(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return RETRY_SIGNALS.some((s) => lower.includes(s));
}

// ── UUID generator ────────────────────────────────────────────────────────────

export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
