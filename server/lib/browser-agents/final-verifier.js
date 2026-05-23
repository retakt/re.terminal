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
- Be strictly grounded in originalInstruction, stepResults, finalObservation, and watcherSideReport.
- Do not rewrite history. If the user opened example.com and ended on IANA, say they ended on IANA; do not say they opened IANA.
- Prefer this success style: "Done. Final page: <title> — <url>".
- Mention repairs only when useful to the user.
- If something is incomplete, clearly say what is missing.
- If not all steps passed, success must be false.

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
