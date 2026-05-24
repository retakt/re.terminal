const ALLOWED_INTENTS = new Set([
  "navigate",
  "observe",
  "click_or_open",
  "fill_form",
  "submit_form",
  "fill_and_submit",
  "prepare_form_submission",
  "submit_prepared_form",
  "scrape",
  "show_actions",
  "reset",
  "status",
  "unknown",
]);

const ALLOWED_TOOLS = new Set([
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
  "browserReset",
  "browserStatus",
  "unknown",
]);

const ALLOWED_REVIEWER_STATUSES = new Set([
  "approved",
  "repaired",
  "rejected",
  "needs_user",
]);

const ALLOWED_RESULT_STATUSES = new Set([
  "normalized",
  "failed",
]);

const INTENT_TOOL = {
  navigate: "browserNavigate",
  observe: "browserObserve",
  click_or_open: "browserClickByText",
  fill_form: "browserFillFields",
  submit_form: "browserSubmitForm",
  fill_and_submit: "browserFillAndSubmit",
  prepare_form_submission: "browserPrepareFormSubmission",
  submit_prepared_form: "browserSubmitPreparedForm",
  scrape: "browserScrape",
  show_actions: "browserShowActions",
  reset: "browserReset",
  status: "browserStatus",
  unknown: "unknown",
};

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function safeText(value = "", limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? Math.max(0, Math.min(1, n / 100)) : Math.max(0, Math.min(1, n));
}

function normalizeIntent(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  return ALLOWED_INTENTS.has(raw) ? raw : "unknown";
}

function normalizeTool(value = "", intent = "unknown") {
  const raw = String(value || "").trim();
  if (ALLOWED_TOOLS.has(raw)) return raw;
  return INTENT_TOOL[normalizeIntent(intent)] || "unknown";
}

function normalizeRisk(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  return ["low", "medium", "high", "unknown"].includes(raw) ? raw : "unknown";
}

function normalizeStatus(value = "", allowed = new Set(), fallback = "") {
  const raw = String(value || "").trim().toLowerCase();
  return allowed.has(raw) ? raw : fallback;
}

function normalizeFields(fields = []) {
  return arrayOrEmpty(fields).map((field) => {
    const entry = objectOrEmpty(field);
    const label = safeText(entry.label || entry.name || entry.id || entry.selector || "field", 160);
    const secret = entry.secret === true || /\b(password|pass|pwd|otp|code|pin|secret|token)\b/i.test(label);
    return {
      label,
      value: secret ? "[redacted]" : safeText(entry.value ?? "", 500),
      secret,
      source: safeText(entry.source || "", 80),
    };
  });
}

export function normalizeBrowserCommand(value = {}, fallbackIntent = "unknown") {
  const command = objectOrEmpty(value);
  const args = objectOrEmpty(command.args);

  const intent = normalizeIntent(command.intent || fallbackIntent);
  const tool = normalizeTool(command.tool || command.name, intent);

  return {
    intent,
    tool,
    args: {
      ...args,
      ...(Array.isArray(args.fields) ? { fields: normalizeFields(args.fields) } : {}),
    },
    url: safeText(command.url || args.url || args.currentUrl || "", 500),
    target: safeText(command.target || command.text || args.text || args.label || "", 300),
    fields: normalizeFields(command.fields || args.fields || []),
    notes: safeText(command.notes || command.reason || "", 700),
  };
}

export function normalizePlannerProposal(value = {}, fallbackReason = "Planner did not return a proposal.") {
  const proposal = objectOrEmpty(value);
  const intent = normalizeIntent(proposal.intent || proposal.proposedCommand?.intent || proposal.command?.intent);
  const command = normalizeBrowserCommand(
    proposal.proposedCommand || proposal.command || {},
    intent,
  );

  const status = proposal.status === "needs_user" ? "needs_user" : "proposed";

  return {
    status,
    userIntent: safeText(proposal.userIntent || proposal.intent || "", 500),
    risk: normalizeRisk(proposal.risk),
    backend: safeText(proposal.backend || "auto", 80),
    proposedCommand: command,
    requiresConfirmation: proposal.requiresConfirmation === true,
    messageToReviewer: safeText(
      proposal.messageToReviewer ||
      proposal.reason ||
      fallbackReason,
      900,
    ),
    messageToMain: safeText(
      proposal.messageToMain ||
      proposal.reason ||
      fallbackReason,
      900,
    ),
    reason: safeText(proposal.reason || fallbackReason, 900),
    confidence: normalizeConfidence(proposal.confidence),
  };
}

export function normalizeReviewerDecision(value = {}, fallbackReason = "Reviewer did not return a valid decision.") {
  const decision = objectOrEmpty(value);
  const status = normalizeStatus(decision.status, ALLOWED_REVIEWER_STATUSES, "rejected");
  const approved = decision.approved === true || status === "approved" || status === "repaired";
  const approvedCommand = normalizeBrowserCommand(
    decision.approvedCommand || decision.command || {},
    decision.approvedCommand?.intent || decision.intent || "unknown",
  );

  return {
    status,
    approved,
    messageToPlanner: safeText(decision.messageToPlanner || decision.reason || fallbackReason, 1000),
    messageToExecutor: safeText(decision.messageToExecutor || decision.reason || "", 1000),
    approvedCommand,
    messageToMain: safeText(decision.messageToMain || decision.reason || fallbackReason, 1000),
    reason: safeText(decision.reason || fallbackReason, 1000),
    confidence: normalizeConfidence(decision.confidence),
  };
}

export function normalizeExecutorDryRun(value = {}, fallbackReason = "Executor did not return a valid dry-run result.") {
  const result = objectOrEmpty(value);
  const toolPlan = arrayOrEmpty(result.toolPlan).map((step) => {
    const entry = objectOrEmpty(step);
    return {
      tool: normalizeTool(entry.tool || "unknown"),
      args: objectOrEmpty(entry.args),
      purpose: safeText(entry.purpose || entry.reason || "", 300),
    };
  });

  return {
    status: "dry_run",
    executed: false,
    wouldExecute: safeText(result.wouldExecute || fallbackReason, 900),
    toolPlan,
    result: safeText(result.result || "no browser action executed in Step 2", 900),
    messageToResultReviewer: safeText(result.messageToResultReviewer || fallbackReason, 900),
  };
}

export function normalizeResultReview(value = {}, fallbackReason = "Result reviewer did not return a valid result.") {
  const review = objectOrEmpty(value);
  const status = normalizeStatus(review.status, ALLOWED_RESULT_STATUSES, "failed");

  return {
    status,
    success: review.success === true,
    normalizedResult: safeText(review.normalizedResult || fallbackReason, 1000),
    messageToPlanner: safeText(review.messageToPlanner || review.reason || fallbackReason, 1000),
    messageToMain: safeText(review.messageToMain || review.normalizedResult || fallbackReason, 1000),
    reason: safeText(review.reason || fallbackReason, 1000),
  };
}

export function normalizeMainHandoff(value = {}, fallbackSummary = "Browser pipeline completed.") {
  const handoff = objectOrEmpty(value);

  return {
    summary: safeText(handoff.summary || fallbackSummary, 1200),
    nextSafeAction: safeText(handoff.nextSafeAction || "Continue with the next architecture step.", 900),
    needsUser: handoff.needsUser === true,
  };
}

export function browserPipelineSchemaSummary() {
  return {
    plannerProposal: {
      status: "proposed|needs_user",
      userIntent: "string",
      risk: "low|medium|high|unknown",
      backend: "string",
      proposedCommand: {
        intent: [...ALLOWED_INTENTS],
        tool: [...ALLOWED_TOOLS],
        args: "object",
        url: "string",
        target: "string",
        fields: "array",
        notes: "string",
      },
      requiresConfirmation: "boolean",
      messageToReviewer: "string",
      messageToMain: "string",
      reason: "string",
      confidence: "0..1",
    },
    reviewerDecision: {
      status: [...ALLOWED_REVIEWER_STATUSES],
      approved: "boolean",
      messageToPlanner: "string",
      messageToExecutor: "string",
      approvedCommand: "BrowserCommand",
      messageToMain: "string",
      reason: "string",
      confidence: "0..1",
    },
    executorDryRun: {
      status: "dry_run",
      executed: false,
      wouldExecute: "string",
      toolPlan: "array",
      result: "string",
      messageToResultReviewer: "string",
    },
    resultReview: {
      status: [...ALLOWED_RESULT_STATUSES],
      success: "boolean",
      normalizedResult: "string",
      messageToPlanner: "string",
      messageToMain: "string",
      reason: "string",
    },
    mainHandoff: {
      summary: "string",
      nextSafeAction: "string",
      needsUser: "boolean",
    },
  };
}
