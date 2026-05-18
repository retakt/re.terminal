// Slash command parser

import type { ChatMode, SessionOptions } from "../types";
import { BALANCED_OPTIONS, DEV_OPTIONS, FULL_THINK_OPTIONS, NO_THINK_OPTIONS } from "./config";

export interface SlashResult {
  isCommand: true;
  response: string;
  optionOverrides?: Partial<SessionOptions>;
  modeOverride?: ChatMode;
  webSearchOverride?: boolean;
}

export function parseSlashCommand(text: string): SlashResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [cmd, ...args] = trimmed.slice(1).split(/\s+/);

  switch (cmd.toLowerCase()) {
    case "dev":
      return {
        isCommand: true,
        response: "Dev/Ops mode enabled. MCP-first, concise, raw tool errors shown directly.",
        modeOverride: "dev",
        optionOverrides: { ...DEV_OPTIONS },
      };
    case "think":
      return {
        isCommand: true,
        response: "Full thinking mode enabled. Use `/nothink`, `/auto`, or `/dev` to change.",
        modeOverride: "think",
        optionOverrides: { ...FULL_THINK_OPTIONS },
      };
    case "nothink":
      return {
        isCommand: true,
        response: "No-think mode enabled. Fast replies, no forced reasoning.",
        modeOverride: "nothink",
        optionOverrides: { ...NO_THINK_OPTIONS },
      };
    case "auto":
      return {
        isCommand: true,
        response: "Auto mode enabled. Normal assistant behavior restored.",
        modeOverride: "auto",
        optionOverrides: { ...BALANCED_OPTIONS },
      };
    case "temp": {
      const val = parseFloat(args[0] ?? "");
      if (isNaN(val) || val < 0 || val > 2) {
        return { isCommand: true, response: "Usage: `/temp <0.0-2.0>`" };
      }
      return {
        isCommand: true,
        response: `Temperature set to ${val}.`,
        optionOverrides: { temperature: val },
      };
    }
    case "topk": {
      const val = parseInt(args[0] ?? "", 10);
      if (isNaN(val) || val < 1) {
        return { isCommand: true, response: "Usage: `/topk <integer>`" };
      }
      return {
        isCommand: true,
        response: `top_k set to ${val}.`,
        optionOverrides: { top_k: val },
      };
    }
    case "dweb":
      return {
        isCommand: true,
        response: "Web search disabled. Use `/eweb` to re-enable.",
        webSearchOverride: false,
      };
    case "eweb":
      return {
        isCommand: true,
        response: "Web search enabled for explicit current-web requests.",
        webSearchOverride: true,
      };
    case "help":
    case "?":
      return {
        isCommand: true,
        response: [
          "**commands:**",
          "- `/dev` - Dev/Ops mode: MCP-first, concise, raw errors",
          "- `/think` - force full reasoning mode",
          "- `/nothink` - fastest replies, no forced reasoning",
          "- `/auto` - normal assistant mode",
          "- `/temp <0-2>` - set temperature",
          "- `/topk <int>` - set top_k sampling",
          "- `/dweb` - disable web search",
          "- `/eweb` - enable web search for explicit current-web requests",
          "- `/help` - show this list",
        ].join("\n"),
      };
    default:
      return {
        isCommand: true,
        response: `Unknown command \`/${cmd}\`. Type \`/help\` for available commands.`,
      };
  }
}
