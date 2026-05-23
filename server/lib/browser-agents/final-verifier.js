import { callBrowserAgentRoleJson } from "../browser-llm-runtime.js";
import { browserAgentStage, browserAgentSystemPrompt } from "./profiles.js";

export function finalVerifierSystemPrompt() {
  const base = `You are the Final Browser Verifier.

You compare the original user request against the full browser-agent trace.
You decide whether the user's original intent was satisfied.
You write the final user-facing answer.

Return ONLY strict JSON. No markdown.

Rules:
- Keep summary short and human-readable.
- Do not dump raw snapshots.
- Mention the final title and URL when useful.
- If something is incomplete, clearly say what is missing.

Return schema:
{
  "success": true,
  "summary": "final answer to user",
  "needsUser": false,
  "nextSafeAction": "next safe action",
  "missingSteps": [],
  "reason": ""
}`;

  return browserAgentSystemPrompt("finalVerifier", base);
}

export async function runFinalVerifierAgent({ context = {}, images = [], schemaName = "final_verifier" } = {}) {
  return callBrowserAgentRoleJson(browserAgentStage("finalVerifier"), {
    system: finalVerifierSystemPrompt(),
    schemaName,
    context,
    images,
  });
}
