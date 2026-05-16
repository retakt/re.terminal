// ── Slash command parser ──────────────────────────────────────────────────────

import type { SessionOptions } from "../types";
import { FULL_THINK_OPTIONS, NO_THINK_OPTIONS, BALANCED_OPTIONS } from "./config";

export interface SlashResult {
  isCommand: true;
  response: string;
  optionOverrides?: Partial<SessionOptions>;
  webSearchOverride?: boolean;
}

export function parseSlashCommand(text: string): SlashResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [cmd, ...args] = trimmed.slice(1).split(/\s+/);

  switch (cmd.toLowerCase()) {
    case "think":
      return {
        isCommand: true,
        response: "✓ Full thinking mode **enabled**. Re will reason deeply. Use `/nothink` or `/auto` to go back.",
        optionOverrides: { ...FULL_THINK_OPTIONS },
      };
    case "nothink":
      return {
        isCommand: true,
        response: "✓ Thinking **disabled**. Re will respond instantly. Use `/think` or `/auto` to change.",
        optionOverrides: { ...NO_THINK_OPTIONS },
      };
    case "auto":
      return {
        isCommand: true,
        response: "✓ **Auto mode** enabled. Re will think only when the query needs it.",
        optionOverrides: { ...BALANCED_OPTIONS },
      };
    case "temp": {
      const val = parseFloat(args[0] ?? "");
      if (isNaN(val) || val < 0 || val > 2)
        return { isCommand: true, response: "Usage: `/temp <0.0–2.0>`" };
      return {
        isCommand: true,
        response: `✓ Temperature set to **${val}**.`,
        optionOverrides: { temperature: val },
      };
    }
    case "topk": {
      const val = parseInt(args[0] ?? "", 10);
      if (isNaN(val) || val < 1)
        return { isCommand: true, response: "Usage: `/topk <integer>`" };
      return {
        isCommand: true,
        response: `✓ top_k set to **${val}**.`,
        optionOverrides: { top_k: val },
      };
    }
    case "dweb":
      return {
        isCommand: true,
        response: "✓ Web search **disabled**. Re will answer from training data only. Use `/eweb` to re-enable.",
        webSearchOverride: false,
      };
    case "eweb":
      return {
        isCommand: true,
        response: "✓ Web search **enabled**. Re will search the web when needed.",
        webSearchOverride: true,
      };
    case "help":
    case "?":
      return {
        isCommand: true,
        response: [
          "**commands:**",
          "- `/think` — force full reasoning mode",
          "- `/nothink` — force no reasoning, fastest replies",
          "- `/auto` — auto mode (thinks only for complex queries) ← default",
          "- `/temp <0–2>` — set temperature",
          "- `/topk <int>` — set top_k sampling",
          "- `/dweb` — web search disabled (training data)",
          "- `/eweb` — web search enabled",
          "- `/help` — show this list",
          "",
          "**built-in tools (Re uses these automatically):**",
          "- Weather — ask about weather in any city",
          "- Exchange rate — ask to convert currencies",
          "- Time — ask what time it is anywhere",
          "- Web search — modes: general, factcheck, news, reddit, wiki, code",
        ].join("\n"),
      };
    default:
      return {
        isCommand: true,
        response: `Unknown command \`/${cmd}\`. Type \`/help\` for available commands.`,
      };
  }
}
