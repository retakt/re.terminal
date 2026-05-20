import { isValidObservation } from "./browser-engine-manager.js";

function safeText(value = "", limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalize(value = "") {
  return safeText(value, 1000).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function countPageControls(observation = {}) {
  return {
    links: Array.isArray(observation.links) ? observation.links.length : 0,
    buttons: Array.isArray(observation.buttons) ? observation.buttons.length : 0,
    forms: Array.isArray(observation.forms) ? observation.forms.length : 0,
    inputs: Array.isArray(observation.inputs) ? observation.inputs.length : 0,
    interactiveElements: Array.isArray(observation.interactiveElements) ? observation.interactiveElements.length : 0,
  };
}

function actionResultFromToolResult(result = {}) {
  return result?.actionResult || result?.raw?.actionResult || null;
}

function fillResultFromToolResult(result = {}) {
  const actionResult = actionResultFromToolResult(result);
  return actionResult?.fillResult || (actionResult?.filled || actionResult?.missing ? actionResult : null);
}

function submitResultFromToolResult(result = {}) {
  const actionResult = actionResultFromToolResult(result);
  return actionResult?.submitResult || (actionResult?.action === "submit" ? actionResult : null);
}

function currentUrlFromState(state = {}) {
  return state.currentUrl || state.lastValidObservation?.url || "";
}

function sameNormalizedUrl(left = "", right = "") {
  if (!left || !right) return false;
  try {
    const a = new URL(left);
    const b = new URL(right);
    return `${a.origin}${a.pathname}`.replace(/\/+$/, "") === `${b.origin}${b.pathname}`.replace(/\/+$/, "");
  } catch {
    return safeText(left, 500).replace(/\/+$/, "") === safeText(right, 500).replace(/\/+$/, "");
  }
}

function verifyFocusedObservation({ watcher = {}, command = {}, result = {}, observation = {} }) {
  const focus = normalize(command?.args?.focus || watcher?.command?.args?.focus || "");
  if (!focus || focus === "page") return { ok: true };

  const counts = countPageControls(observation);
  const hasLinks = counts.links > 0 || counts.interactiveElements > 0;
  const hasForms = counts.forms > 0 || counts.inputs > 0;
  const hasActions = counts.links > 0 || counts.buttons > 0 || counts.interactiveElements > 0;

  if (focus === "links" && !hasLinks) {
    return {
      ok: false,
      reason: "The user asked for visible links, but the browser result contained no links or interactive link data.",
      expected: "links",
    };
  }

  if (focus === "forms" && !hasForms) {
    return {
      ok: false,
      reason: "The user asked for forms/fields, but the browser result contained no forms or input data.",
      expected: "forms",
    };
  }

  if ((focus === "actions" || focus === "menu" || focus === "menus") && !hasActions) {
    const engine = safeText(result.engine || observation.engine || "", 80);
    const staticNote = engine === "static_fetch"
      ? " Static HTML fallback is not enough for menu/action questions."
      : "";
    return {
      ok: false,
      reason: `The user asked for menu/action options, but the browser result contained no links, buttons, or interactive elements.${staticNote}`,
      expected: "interactive actions",
    };
  }

  return { ok: true };
}

function verifyNavigation({ command = {}, observation = {} }) {
  const targetUrl = command?.args?.url || "";
  if (!targetUrl) return { ok: true };
  if (sameNormalizedUrl(observation.url || observation.requestedUrl || "", targetUrl)) return { ok: true };
  return {
    ok: false,
    reason: `Navigation did not land on the requested URL. Requested ${targetUrl}, observed ${observation.url || "unknown"}.`,
    expected: targetUrl,
  };
}

function verifyFill({ result = {}, command = {} }) {
  const fillResult = fillResultFromToolResult(result);
  if (!fillResult) {
    return {
      ok: false,
      reason: "The fill command did not return a fill result.",
      expected: "field fill result",
    };
  }

  const requested = Array.isArray(command?.args?.fields) ? command.args.fields.length : 0;
  const filled = Array.isArray(fillResult.filled) ? fillResult.filled.length : 0;
  const missing = Array.isArray(fillResult.missing) ? fillResult.missing.length : 0;

  if (missing > 0) {
    return {
      ok: false,
      needsUser: true,
      reason: `The browser could not find ${missing} requested field(s).`,
      expected: "all requested fields filled",
    };
  }

  if (requested > 0 && filled === 0) {
    return {
      ok: false,
      reason: "The browser did not fill any requested fields.",
      expected: "at least one filled field",
    };
  }

  return { ok: true };
}

function verifySubmit({ result = {} }) {
  const submitResult = submitResultFromToolResult(result);
  if (!submitResult) {
    return {
      ok: false,
      reason: "The submit command did not return a submit result.",
      expected: "submit result",
    };
  }
  if (!submitResult.ok) {
    return {
      ok: false,
      reason: submitResult.error || "The form submit did not complete.",
      expected: "successful submit",
    };
  }
  return { ok: true };
}

export function verifyBrowserResult({
  watcher = {},
  command = {},
  result = {},
  observation = {},
  previousState = {},
} = {}) {
  if (!result?.ok) {
    return {
      ok: false,
      shouldSaveState: false,
      needsUser: result?.status === "needs_user",
      reason: result?.error || result?.blockedReason || "Browser tool did not complete successfully.",
      blockedReason: result?.error || result?.blockedReason || "tool_failed",
      nextSafeAction: currentUrlFromState(previousState)
        ? "Retry with a clearer target, or ask me to observe the current page."
        : "Navigate to a URL first.",
    };
  }

  if (!isValidObservation(observation)) {
    return {
      ok: false,
      shouldSaveState: false,
      reason: observation.error || observation.snapshotError || "Browser result did not include a valid page observation.",
      blockedReason: "invalid_observation",
      nextSafeAction: currentUrlFromState(previousState)
        ? "Retry the action or re-observe the current page."
        : "Navigate to a valid URL first.",
    };
  }

  const checks = [];
  if (watcher.intent === "navigate") checks.push(verifyNavigation({ command, observation }));
  if (watcher.intent === "observe") checks.push(verifyFocusedObservation({ watcher, command, result, observation }));
  if (watcher.intent === "fill_form" || watcher.intent === "fill_and_submit") checks.push(verifyFill({ result, command }));
  if (watcher.intent === "submit_form" || watcher.intent === "fill_and_submit") checks.push(verifySubmit({ result }));

  const failed = checks.find((check) => !check.ok);
  if (failed) {
    return {
      ok: false,
      shouldSaveState: false,
      needsUser: Boolean(failed.needsUser),
      reason: failed.reason || "Browser result did not satisfy the requested intent.",
      blockedReason: "verification_failed",
      expected: failed.expected || "",
      nextSafeAction: failed.needsUser
        ? "Clarify the missing field or target."
        : "Try again with the runtime browser engine available, or ask for a different observable target.",
    };
  }

  return {
    ok: true,
    shouldSaveState: true,
    reason: "Browser result satisfies watcher intent.",
    blockedReason: "",
    nextSafeAction: "",
  };
}
