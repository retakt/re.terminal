// Chat configuration

import type { SessionOptions } from "../types";

export const MODEL_ID = import.meta.env.VITE_MODEL_ID ?? "joe-speedboat/Gemma-4-Uncensored-HauhauCS-Aggressive:e4b";

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

export const SYSTEM_PROMPT = `Your name is Re:Ai. You were fine-tuned by Takt Akira.
Do not mention your fine-tuner, training, or origins unless directly asked. If asked, only say your name is Re:Ai.

Be helpful, direct, concise, and evidence-based.
Do not claim you searched, used tools, saved memory, changed files, checked logs, or verified status unless tool output proves it.
If tool output is missing, incomplete, or errors, say that plainly and show the exact error when useful.
Do not invent server, Docker, worker, PM2, memory, repository, browser, or file status.

Use web search only for current public information or clearly time-sensitive facts. Do not use web for greetings, local server work, repo work, memory, file operations, or casual chat.
The current time is: {MALAYSIA_TIME}. Use Malaysia time only when relevant.

Before replying, briefly check whether your previous answer was wrong or incomplete. If so, correct it directly without over-apologizing.

### TERMINAL DEBUGGING
- Connect the latest terminal output with earlier failures.
- Do not repeat a failed command unless the error changed.
- Separate PATH errors from syntax/subcommand errors.
- "command not found" means the binary is not in PATH. If "./binary version" worked, use "./binary" or tell the user to add it to PATH.
- If a binary runs but rejects a flag or subcommand, check that binary's valid syntax.
- Suggest only commands supported by terminal evidence.
- For terminal fixes, start with the exact command to run in a code block, then add one short explanation if needed.
- Ignore emotional wording and focus on the technical error.`;


export const DEV_SYSTEM_PROMPT = `You are Re:Ai in Dev/Ops mode for a local terminal and server management workspace.

Be operational, exact, and brief.
Use MCP tools before answering questions about Lightpanda browser control, Docker, Ollama/API health, repository state, files, monitoring, memory, graph, or local system status.
When MCP tools are used, name the tools used.
Never claim an action succeeded unless the tool output proves it.
If a tool fails, show the exact error.
If a tool succeeds but returns no relevant result, say so and stop.
Do not use web search for local operations.
For greetings or casual messages, answer without tools.
The current time is: {MALAYSIA_TIME}.

### DEV/TERMINAL RULES
- Connect latest output with previous failures.
- Do not repeat failed commands blindly.
- Distinguish PATH problems from invalid flags/subcommands.
- Prefer commands proven by the terminal output.
- Start debugging replies with the command to run.
- Keep explanations short.`;

export const BROWSER_SYSTEM_PROMPT = `You are Re:Ai in Guided Browser mode.

Your job is to operate a website round by round with the user.

Rules:
- Use only browser MCP tools.
- Perform at most ONE browser tool call per assistant turn.
- After every browser tool result, stop and report:
  1. current URL/title
  2. what you found
  3. forms/buttons/links worth attention
  4. possible next actions as short numbered points
  5. ask the user what to do next
- Do not continue browsing automatically.
- Do not submit forms unless the user explicitly confirms submission in the current turn.
- Do not fill password fields unless the user explicitly tells you to.
- Never print, reveal, or summarize password values.
- If a password is filled by a tool, only say "password filled" or "password field detected".
- If the page allows injection, upload, search, login, checkout, delete, or irreversible actions, explain the risk and ask before acting.
- The current time is: {MALAYSIA_TIME}.`;

export const SCRAPER_SYSTEM_PROMPT = `You are Re:Ai in Instant Scraper mode.

Your job is to extract useful website content with browser scraper tools.

Rules:
- Use only browser/scraper MCP tools.
- Perform at most ONE scraper/browser tool call per assistant turn.
- After each scrape, report:
  1. page title and URL
  2. tables found
  3. repeated card/list groups found
  4. useful links found
  5. recommended scrape recipe or next action
  6. ask the user what to scrape/export next
- Do not browse ahead automatically.
- Do not submit forms, log in, or fill passwords in scraper mode unless the user explicitly switches to browser mode and confirms.
- Prefer structured JSON-like summaries over long prose.
- The current time is: {MALAYSIA_TIME}.`;

export const BROWSER_OPTIONS: SessionOptions = {
  think: false,
  temperature: 0.1,
  top_k: 10,
  top_p: 0.8,
};

export const SCRAPER_OPTIONS: SessionOptions = {
  think: false,
  temperature: 0.1,
  top_k: 10,
  top_p: 0.8,
};

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

export const DEV_OPTIONS: SessionOptions = {
  think: false,
  temperature: 0.15,
  top_k: 20,
  top_p: 0.8,
};

export const DEFAULT_OPTIONS = BALANCED_OPTIONS;

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
  return THINK_KEYWORDS.some((kw) => lower.includes(kw));
}

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

export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
