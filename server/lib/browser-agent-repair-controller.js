import {
  hasBrowserRepairCommands,
  inferBrowserFailureKind,
  normalizeBrowserRepairPlan,
} from "./browser-agent-repair-schema.js";

function safeText(value = "", limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function currentUrlFromContext(context = {}) {
  return safeText(
    context.currentUrl ||
    context.execution?.observation?.url ||
    context.beforeState?.url ||
    context.command?.args?.currentUrl ||
    "",
    500
  );
}

function originalCommandWithUrl(context = {}) {
  const command = asObject(context.command);
  const currentUrl = currentUrlFromContext(context);

  return {
    ...command,
    args: {
      ...(asObject(command.args)),
      ...(currentUrl && command.tool !== "browserNavigate" ? { currentUrl } : {}),
    },
  };
}

function syncCommand(context = {}) {
  const url = currentUrlFromContext(context);
  if (!url) return null;

  return {
    intent: "sync_playwright_to_lightpanda",
    tool: "browserNavigate",
    args: { url },
    notes: "Repair controller synced Playwright to the current URL before retrying.",
  };
}

function prepareCommand(context = {}) {
  const currentUrl = currentUrlFromContext(context);
  const originalInstruction = safeText(context.originalInstruction || "", 1200);
  const stepInstruction = safeText(context.step?.instruction || "", 500);

  return {
    intent: "prepare_form_submission",
    tool: "browserPrepareFormSubmission",
    args: {
      ...(currentUrl ? { currentUrl } : {}),
      formIntent: originalInstruction || stepInstruction,
      stepInstruction,
    },
    notes: "Repair controller prepared the visible form before retrying submit.",
  };
}

function observeCommand(context = {}) {
  const currentUrl = currentUrlFromContext(context);

  return {
    intent: "observe_after_repair",
    tool: "browserObserve",
    args: {
      ...(currentUrl ? { currentUrl } : {}),
      focus: "page",
    },
    notes: "Repair controller captured fresh Playwright evidence.",
  };
}

function commandList(...items) {
  return items.filter((item) => item && item.tool);
}

export function buildBrowserRepairPlan(context = {}) {
  const result = asObject(context.resultCheck);

  const failureKind = inferBrowserFailureKind({
    result,
    execution: context.execution,
    command: context.command,
    step: context.step,
    beforeState: context.beforeState,
  });

  const supplied = normalizeBrowserRepairPlan(result.repairPlan, {
    strategy: "deterministic",
    maxAttempts: 2,
    requiresWatcherVerification: true,
  });

  if (hasBrowserRepairCommands(supplied)) {
    return {
      ...supplied,
      failureKind,
      source: "watcher_repair_plan",
    };
  }

  const original = originalCommandWithUrl(context);
  const sync = syncCommand(context);
  const observe = observeCommand(context);

  if (failureKind === "playwright_out_of_sync") {
    return {
      failureKind,
      source: "deterministic_repair_controller",
      strategy: "sync_and_retry_original",
      maxAttempts: 2,
      retryOriginal: false,
      requiresWatcherVerification: true,
      reason: "Playwright appears out of sync with the current URL.",
      commands: commandList(sync, original),
    };
  }

  if (failureKind === "no_prepared_form_session") {
    const commands = original.tool === "browserPrepareFormSubmission"
      ? commandList(sync, original)
      : commandList(prepareCommand(context), original);

    return {
      failureKind,
      source: "deterministic_repair_controller",
      strategy: original.tool === "browserPrepareFormSubmission"
        ? "sync_and_retry_prepare_form"
        : "prepare_form_then_retry_submit",
      maxAttempts: 2,
      retryOriginal: false,
      requiresWatcherVerification: true,
      reason: original.tool === "browserPrepareFormSubmission"
        ? "Form prepare did not produce a usable session; sync and retry prepare."
        : "Submit was requested before a prepared form session existed.",
      commands,
    };
  }

  if ([
    "field_value_mismatch",
    "field_value_not_confirmed",
    "html_validation_failed",
    "validation_error_visible",
  ].includes(failureKind)) {
    return {
      failureKind,
      source: "deterministic_repair_controller",
      strategy: "reprepare_form_and_retry_submit_if_needed",
      maxAttempts: 2,
      retryOriginal: false,
      requiresWatcherVerification: true,
      reason: "Form fields or validation state were not confirmed.",
      commands: ["browserFillFields", "browserFillAndSubmit"].includes(original.tool)
        ? commandList(original, observe)
        : original.tool === "browserSubmitPreparedForm"
          ? commandList(prepareCommand(context), original, observe)
          : commandList(prepareCommand(context), observe),
    };
  }

  if (failureKind === "submit_no_state_change" || failureKind === "post_submit_snapshot_missing") {
    return {
      failureKind,
      source: "deterministic_repair_controller",
      strategy: "capture_post_submit_evidence",
      maxAttempts: 1,
      retryOriginal: false,
      requiresWatcherVerification: true,
      reason: "Submit-like action needs fresh post-submit evidence before passing.",
      commands: commandList(observe),
    };
  }

  if (failureKind === "overlay_intercepted") {
    return {
      failureKind,
      source: "deterministic_repair_controller",
      strategy: "observe_overlay_then_retry_original",
      maxAttempts: 1,
      retryOriginal: false,
      requiresWatcherVerification: true,
      reason: "A blocking overlay may have intercepted the action.",
      commands: commandList(observe, original),
    };
  }

  if (failureKind === "tool_script_error") {
    return {
      failureKind,
      source: "deterministic_repair_controller",
      strategy: "escalate_tool_script_error",
      maxAttempts: 0,
      retryOriginal: false,
      requiresWatcherVerification: true,
      reason: "Executor script failed; avoid blind retries of broken code.",
      commands: [],
    };
  }

  return {
    failureKind,
    source: "deterministic_repair_controller",
    strategy: "no_deterministic_repair",
    maxAttempts: 0,
    retryOriginal: false,
    requiresWatcherVerification: true,
    reason: "No deterministic repair is available for this failure kind.",
    commands: [],
  };
}

export function shouldUseBrowserRepairPlan(plan = null) {
  return hasBrowserRepairCommands(plan) && Number(plan.maxAttempts || 0) > 0;
}
