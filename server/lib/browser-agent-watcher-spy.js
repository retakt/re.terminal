function safeText(value = "", limit = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanPlaywrightSummary(value = "", limit = 900) {
  const raw = String(value || "");

  const pageUrl = raw.match(/Page URL:\s*([^\n]+)/i)?.[1]?.trim() || "";
  const pageTitle = raw.match(/Page Title:\s*([^\n]+)/i)?.[1]?.trim() || "";
  const clickPrefix = raw.match(/Click succeeded using [^.]+\./i)?.[0] || "";

  if (pageTitle && pageUrl) {
    return safeText([clickPrefix, `${pageTitle} — ${pageUrl}`].filter(Boolean).join(" "), limit);
  }

  if (pageUrl) return safeText([clickPrefix, pageUrl].filter(Boolean).join(" "), limit);
  if (pageTitle) return safeText([clickPrefix, pageTitle].filter(Boolean).join(" "), limit);

  return safeText(
    raw
      .replace(/###\s*Snapshot[\s\S]*$/i, "")
      .replace(/###\s*Ran Playwright code[\s\S]*?###\s*Page\s*-?/i, "")
      .replace(/\[Snapshot\]\([^)]*\)/gi, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/Page URL:\s*[^\n]+/gi, "")
      .replace(/Page Title:\s*[^\n]+/gi, ""),
    limit,
  );
}

export function pageSummaryFromObservation(observation = {}, fallback = "") {
  const title = safeText(observation?.title || "", 160);
  const url = safeText(observation?.url || "", 300);

  if (title && url) return `${title} — ${url}`;
  if (url) return url;
  if (title) return title;

  return cleanPlaywrightSummary(
    observation?.textPreview || observation?.text || fallback || "Browser task finished.",
    500,
  );
}

export function cleanBrowserAgentTraceSummary(value = "") {
  if (typeof value === "string") return cleanPlaywrightSummary(value);
  if (value === null || value === undefined) return "";

  if (Array.isArray(value)) {
    return value.map((item) => cleanBrowserAgentTraceSummary(item)).filter(Boolean).join(" | ");
  }

  if (typeof value === "object") {
    if (value.error) return safeText(value.error, 700);

    if (value.url || value.title) {
      return pageSummaryFromObservation(value);
    }

    if (typeof value.summary === "string" && value.summary.trim()) {
      return cleanPlaywrightSummary(value.summary);
    }

    const command = value.command || value.approvedCommand || null;
    const args = command?.args || value.args || {};

    const direct = [
      value.reason,
      value.messageToChecker,
      value.messageToUser,
      value.evidence,
      value.repairInstruction,
      value.notes,
      command?.notes,
    ].find((item) => typeof item === "string" && item.trim());

    if (direct) return safeText(direct, 900);

    if (command?.tool) {
      const target = args.text || args.label || args.buttonText || args.url || args.currentUrl || "";
      const ref = args.ref ? ` ref=${args.ref}` : "";
      return [command.tool, target ? `target=${target}` : "", ref].filter(Boolean).join(" ");
    }

    try {
      return safeText(JSON.stringify(value), 700);
    } catch {
      return "";
    }
  }

  return safeText(value, 700);
}

function extractSimpleUserDetails(text = "") {
  const raw = String(text || "");
  const nameMatch = raw.match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/);
  const ageMatch = raw.match(/\b(?:age\s*)?(\d{1,3})\b/);
  const gender =
    /\b(f|female|woman|girl)\b/i.test(raw) ? "Female" :
    /\b(m|male|man|boy)\b/i.test(raw) ? "Male" :
    "";

  return {
    firstName: nameMatch?.[1] || "",
    lastName: nameMatch?.[2] || "",
    gender,
    age: ageMatch?.[1] || "",
  };
}

function formAssistSummaryFromObservation({
  originalInstruction = "",
  finalObservation = null,
  lastStep = null,
} = {}) {
  const stepText = [
    originalInstruction,
    lastStep?.step?.instruction,
    lastStep?.step?.successCriteria,
  ].map((value) => String(value || "")).join(" ");

  if (!/\b(form|fill plan|suggested fill|what can be filled|missing fields|required|optional)\b/i.test(stepText)) {
    return "";
  }

  const inputs = Array.isArray(finalObservation?.inputs) ? finalObservation.inputs : [];
  const buttons = Array.isArray(finalObservation?.buttons) ? finalObservation.buttons : [];
  if (!inputs.length) return "";

  const details = extractSimpleUserDetails(originalInstruction);
  const required = inputs.filter((field) => field.required);
  const has = (pattern) => inputs.some((field) =>
    pattern.test([field.label, field.name, field.id, field.type, field.role].map((v) => String(v || "")).join(" "))
  );

  const canFill = [];
  if (details.firstName && has(/first.?name|firstname/i)) canFill.push(`First name: ${details.firstName}`);
  if (details.lastName && has(/last.?name|lastname/i)) canFill.push(`Last name: ${details.lastName}`);
  if (details.gender && has(/sex|gender/i)) canFill.push(`Gender/Sex: ${details.gender}`);

  const missing = [];
  if (has(/exp|experience/i)) {
    missing.push(details.age
      ? `Years of experience: missing — age ${details.age} is not the same as experience`
      : "Years of experience");
  }
  if (has(/date|datepicker/i)) missing.push("Date");
  if (has(/profession/i)) missing.push("Profession, for example Manual Tester or Automation Tester");
  if (has(/tool/i)) missing.push("Automation tool, for example QTP, Selenium IDE, or Selenium WebDriver");
  if (has(/photo|file/i)) missing.push("Photo/file upload path, if needed");
  if (has(/continent/i)) missing.push("Continent");
  if (has(/selenium.?commands/i)) missing.push("Selenium command category");

  const submitButton = buttons.find((button) => /submit/i.test(String(button.text || button.label || button.id || button.name || "")));

  return [
    "I inspected the form and did not fill or submit anything.",
    "",
    canFill.length
      ? `Can confidently fill: ${canFill.join("; ")}.`
      : "I could not confidently fill any personal fields from the provided details.",
    missing.length
      ? `Still need: ${missing.join("; ")}.`
      : "No obvious missing fields found from the visible controls.",
    required.length
      ? `Required fields visible: ${required.map((field) => field.label || field.name || field.id || field.selector || "unnamed field").join(", ")}.`
      : "No fields were marked required in the visible metadata.",
    submitButton ? "Submit button exists, but I will not click it unless you explicitly ask." : "",
  ].filter(Boolean).join("\n");
}

export function finalBrowserAgentUserSummary({
  passedAllSteps = false,
  stoppedReason = "",
  finalObservation = null,
  lastStep = null,
  originalInstruction = "",
  stepResults = [],
} = {}) {
  if (stoppedReason) return stoppedReason;

  const formAssistSummary = formAssistSummaryFromObservation({
    originalInstruction,
    finalObservation,
    lastStep,
    stepResults,
  });

  if (formAssistSummary) return formAssistSummary;

  const where = pageSummaryFromObservation(finalObservation || {}, lastStep?.summary || "");

  if (passedAllSteps) return `Done. Final page: ${where}`;
  return lastStep?.summary || where || "Browser task finished.";
}

export function inferWatcherUserBehavior(args = {}, instruction = "") {
  const raw = safeText(
    args.userBehavior || args.userTone || args.interactionTone || args.userContext || "",
    700,
  );

  const lower = `${raw} ${instruction}`.toLowerCase();
  const signals = [];

  if (["fuck", "wtf", "stupid", "angry", "furious", "annoyed", "frustrated", "mad", "upset"].some((word) => lower.includes(word))) {
    signals.push("frustrated_or_urgent");
  }

  if (["quick", "fast", "hurry", "just do", "only tell"].some((word) => lower.includes(word))) {
    signals.push("wants_direct_answer");
  }

  return {
    raw,
    signals,
    responseStyle: signals.length
      ? "direct, no fluff, state what worked, what failed, and one next action"
      : "concise, useful, mention final result and optional next step",
  };
}

export function buildWatcherSpyReport({
  instruction = "",
  stepResults = [],
  trace = [],
  finalObservation = null,
  stoppedReason = "",
  args = {},
  passedAllSteps = false,
} = {}) {
  const userBehavior = inferWatcherUserBehavior(args, instruction);
  const lastStep = stepResults.at(-1) || null;
  const failedStep = stepResults.find((step) => !step.ok) || null;

  const repairs = trace
    .filter((entry) => /repair|repaired/i.test(`${entry.status || ""} ${entry.role || ""}`))
    .map((entry) => ({
      role: entry.role,
      step: entry.step,
      status: entry.status,
      summary: safeText(entry.summary || "", 500),
    }));

  const slowAgents = trace
    .filter((entry) => Number(entry.durationMs || 0) >= 15000)
    .map((entry) => ({
      role: entry.role,
      step: entry.step,
      model: entry.model || "",
      durationMs: entry.durationMs,
      tokens: entry.tokens,
    }));

  const keyEvents = trace
    .filter((entry) => [
      "main_orchestrator",
      "gemma_step_agent",
      "gemma_checker",
      "playwright_controller",
      "gemma_result_checker",
      "final_verifier",
    ].includes(entry.role))
    .map((entry) => ({
      role: entry.role,
      step: entry.step,
      status: entry.status,
      ok: entry.ok,
      tool: entry.tool || "",
      summary: safeText(entry.summary || "", 500),
    }));

  return {
    visibility: "internal_only",
    role: "third_party_watcher_spy",
    status: passedAllSteps ? "completed" : "incomplete",
    completed: stepResults.filter((step) => step.ok).length,
    total: stepResults.length || 0,
    finalPage: pageSummaryFromObservation(finalObservation || {}, lastStep?.summary || ""),
    failedStep: failedStep
      ? {
          stepNumber: failedStep.stepNumber,
          instruction: failedStep.step?.instruction || "",
          status: failedStep.status || "",
          summary: failedStep.summary || "",
        }
      : null,
    repairs,
    slowAgents,
    keyEvents,
    userBehavior,
    responseGuidanceForMain: userBehavior.responseStyle,
    privateNotesForMain: [
      stoppedReason ? "Task stopped before all steps completed." : "",
      repairs.length ? "Some command repair happened; mention only if useful." : "",
      slowAgents.length ? "Some agents were slow; do not mention unless user asks about performance." : "",
      userBehavior.signals.includes("frustrated_or_urgent") ? "User may prefer direct answer and minimal details." : "",
    ].filter(Boolean),
    avoidInUserAnswer: [
      "raw snapshots",
      "full YAML",
      "internal refs unless needed",
      "long token/debug details unless user asks",
      "watcher identity",
      "private watcher notes",
    ],
  };
}
