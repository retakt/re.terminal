import { callBrowserAgentRoleJson } from "../browser-llm-runtime.js";
import { browserAgentStage, browserAgentSystemPrompt } from "./profiles.js";

export function watcherSystemPrompt() {
  const base = `You are a Browser Watcher.

You verify one completed browser step using before/after Playwright snapshots and screenshots.

Return ONLY strict JSON. No markdown.

Your job:
- decide whether the completed browser step actually satisfied the current step
- use visible/snapshot evidence, not wishful assumptions
- if failed, provide one concrete repairInstruction
- if a click caused the final URL/title/page to change in the expected direction, mark success true

Return schema:
{
  "status": "passed|failed|needs_repair",
  "success": true,
  "summary": "what happened",
  "evidence": "visible/snapshot evidence",
  "repairInstruction": "",
  "messageToUser": "",
  "confidence": 0.0
}`;

  return browserAgentSystemPrompt("watcher", base);
}

export async function runWatcherAgent({ context = {}, images = [], schemaName = "gemma_result_checker" } = {}) {
  return callBrowserAgentRoleJson(browserAgentStage("watcher"), {
    system: watcherSystemPrompt(),
    schemaName,
    context,
    images,
  });
}
