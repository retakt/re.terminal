const FAILURE_KIND_VALUES = [
  "none",
  "playwright_out_of_sync",
  "no_prepared_form_session",
  "field_value_mismatch",
  "field_value_not_confirmed",
  "html_validation_failed",
  "validation_error_visible",
  "submit_no_state_change",
  "post_submit_snapshot_missing",
  "tool_script_error",
  "overlay_intercepted",
  "unknown",
];

export const BROWSER_FAILURE_KINDS = new Set(FAILURE_KIND_VALUES);

const REPAIR_TOOL_VALUES = new Set([
  "browserNavigate",
  "browserObserve",
  "browserClickByText",
  "browserFillFields",
  "browserSubmitForm",
  "browserFillAndSubmit",
  "browserPrepareFormSubmission",
  "browserSubmitPreparedForm",
  "browserScrape",
  "browserShowActions",
]);

export function isExecutableBrowserRepairCommand(command = null) {
  return Boolean(
    command &&
    typeof command === "object" &&
    !Array.isArray(command) &&
    typeof command.tool === "string" &&
    REPAIR_TOOL_VALUES.has(command.tool)
  );
}

export function normalizeBrowserFailureKind(value = "") {
  const kind = String(value || "").trim().toLowerCase();
  return BROWSER_FAILURE_KINDS.has(kind) ? kind : "unknown";
}

export function isSubmitLikeBrowserTool(tool = "") {
  return [
    "browserSubmitPreparedForm",
    "browserSubmitForm",
    "browserFillAndSubmit",
  ].includes(String(tool || ""));
}

export function isStateChangingBrowserTool(tool = "") {
  return [
    "browserClickByText",
    "browserFillFields",
    "browserSubmitForm",
    "browserFillAndSubmit",
    "browserPrepareFormSubmission",
    "browserSubmitPreparedForm",
  ].includes(String(tool || ""));
}

function safeText(value = "", limit = 2000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function textFromResult({ result = {}, execution = {}, command = {} } = {}) {
  const action = asObject(execution.actionResult);
  const formTool = asObject(action.formTool || execution.formTool);
  return [
    result.failureKind,
    result.status,
    result.summary,
    result.evidence,
    result.repairInstruction,
    execution.error,
    action.error,
    action.text,
    formTool.reason,
    command.tool,
  ].map((value) => typeof value === "string" ? value : JSON.stringify(value || ""))
    .join(" ")
    .toLowerCase();
}

export function inferBrowserFailureKind({ result = {}, execution = {}, command = {}, beforeState = null } = {}) {
  if (result?.success === true) return "none";

  const text = textFromResult({ result, execution, command });
  const tool = String(command?.tool || "");

  const explicit = normalizeBrowserFailureKind(result?.failureKind || "");
  if (explicit !== "unknown") {
    if (
      explicit === "tool_script_error" &&
      !/syntaxerror|referenceerror|typeerror|invalid regular expression|tool script|evaluate.*failed/.test(text)
    ) {
      // Watchers sometimes over-label normal fill verification failures as tool code errors.
      // Only preserve tool_script_error for actual executor/code/evaluate failures.
    } else {
      return explicit;
    }
  }

  if (/fill failed verification|field verification failed|fill failed|missing values|field_empty|not filled/.test(text)) {
    return "field_value_not_confirmed";
  }

  if (/sync_playwright_to_lightpanda_and_retry|playwright.*sync|out of sync|browser context was not on/.test(text)) {
    return "playwright_out_of_sync";
  }

  if (/no prepared form session|run browserprepareformsubmission first/.test(text)) {
    return "no_prepared_form_session";
  }

  if (/field_value_mismatch|actual.*expected|expected.*actual|default value|placeholder/.test(text)) {
    return "field_value_mismatch";
  }

  if (/value_not_confirmed|field_empty|required_values_not_confirmed|date.*not.*filled|not confirmed/.test(text)) {
    return "field_value_not_confirmed";
  }

  if (/checkvalidity|validationmessage|html validation|prepared_form_validation_failed|invalidcontrols/.test(text)) {
    return "html_validation_failed";
  }

  if (/invalid-feedback|validation error|visible validation|aria-invalid|role=.alert/.test(text)) {
    return "validation_error_visible";
  }

  if (/syntaxerror|referenceerror|typeerror|invalid regular expression|tool script|evaluate.*failed/.test(text)) {
    return "tool_script_error";
  }

  if (/overlay|intercept|blocked|modal backdrop|click intercepted/.test(text)) {
    return "overlay_intercepted";
  }

  if (isSubmitLikeBrowserTool(tool) && execution?.ok === true && result?.success !== true) {
    return "submit_no_state_change";
  }

  if (isSubmitLikeBrowserTool(tool) && !execution?.afterSnapshot && !execution?.observation) {
    return "post_submit_snapshot_missing";
  }

  if (beforeState?.url && execution?.ok !== true && isStateChangingBrowserTool(tool)) {
    return "playwright_out_of_sync";
  }

  return "unknown";
}

export function normalizeBrowserRepairPlan(plan = null, fallback = {}) {
  const raw = asObject(plan);
  const rawCommands = Array.isArray(raw.commands) ? raw.commands.filter(Boolean) : [];
  const commands = rawCommands.filter(isExecutableBrowserRepairCommand);
  const invalidCommands = rawCommands.filter((command) => !isExecutableBrowserRepairCommand(command));
  const strategy = safeText(raw.strategy || fallback.strategy || (commands.length ? "deterministic" : "escalate"), 80);
  return {
    strategy,
    maxAttempts: Math.max(0, Math.min(2, Number(raw.maxAttempts ?? fallback.maxAttempts ?? 2))),
    commands,
    invalidCommands,
    retryOriginal: Boolean(raw.retryOriginal ?? fallback.retryOriginal ?? false),
    requiresWatcherVerification: raw.requiresWatcherVerification !== false,
    reason: safeText(raw.reason || fallback.reason || "", 500),
  };
}

export function normalizeBrowserRepairResult({ result = {}, execution = {}, command = {}, step = {}, beforeState = null } = {}) {
  const raw = asObject(result);
  const failureKind = inferBrowserFailureKind({ result: raw, execution, command, beforeState });
  const failureDetails = {
    ...(asObject(raw.failureDetails)),
    tool: command?.tool || raw.failureDetails?.tool || "",
    intent: command?.intent || "",
    url: execution?.observation?.url || beforeState?.url || "",
    title: execution?.observation?.title || beforeState?.title || "",
    error: safeText(execution?.error || raw.error || "", 900),
    summary: safeText(raw.summary || execution?.actionResult?.text || "", 1400),
    stepInstruction: safeText(step?.instruction || "", 400),
  };

  return {
    status: raw.status || (raw.success === true ? "passed" : failureKind === "unknown" ? "failed" : "needs_repair"),
    success: raw.success === true,
    summary: safeText(raw.summary || execution?.actionResult?.text || "", 2000),
    evidence: raw.evidence ?? "",
    repairInstruction: safeText(raw.repairInstruction || "", 1200),
    messageToUser: safeText(raw.messageToUser || "", 1000),
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0,
    failureKind,
    failureDetails,
    repairable: raw.success !== true && failureKind !== "none" && failureKind !== "tool_script_error",
    repairPlan: normalizeBrowserRepairPlan(raw.repairPlan, {
      strategy: raw.success === true ? "none" : "deterministic",
      maxAttempts: 2,
      requiresWatcherVerification: true,
    }),
  };
}

export function hasBrowserRepairCommands(plan = null) {
  return Array.isArray(plan?.commands) &&
    plan.commands.some((command) => isExecutableBrowserRepairCommand(command));
}
