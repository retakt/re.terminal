const fs = require("fs");

const file = "server/lib/browser-agent.js";
let src = fs.readFileSync(file, "utf8");

const start = src.indexOf('function extractGenericClickTarget(instruction = "")');
const end = src.indexOf("function stableSelectorFromObservation", start);

if (start === -1) {
  throw new Error("Could not find extractGenericClickTarget start marker");
}

if (end === -1 || end <= start) {
  throw new Error("Could not find stableSelectorFromObservation end marker");
}

const replacement = `
function extractGenericClickTarget(instruction = "") {
  const raw = String(instruction || "").trim();
  const quoted = raw.match(/["'](.+?)["']/)?.[1];
  if (quoted) return safeText(quoted, 160);

  const lower = raw.toLowerCase();

  if (
    /\\b(what|which|show|list|tell me|visible|available)\\b.*\\b(button|buttons|link|links|clickable|elements)\\b/.test(lower) ||
    /\\b(what can i click|what to click|buttons to click|links to click)\\b/.test(lower)
  ) {
    return "";
  }

  const actionMatch = raw.match(/(?:try\\s+)?(?:click|clicking|open|press|tap|select|choose)\\s+(?:on\\s+|the\\s+)?(.+)$/i);
  if (actionMatch?.[1]) {
    return safeText(
      actionMatch[1]
        .replace(/\\s+(?:and|then)\\s+(?:read|observe|inspect|tell|show|summarize).*$/i, " ")
        .replace(/\\b(button|link|page|menu|section)\\b/ig, " ")
        .replace(/\\s+/g, " ")
        .trim(),
      160
    );
  }

  return safeText(
    raw
      .replace(/\\b(please|try|execute|click|clicking|open|go to|navigate to|perform|run|press|tap|select|choose|read|observe|inspect|tell|show|the|button|link|on this page|there)\\b/ig, " ")
      .replace(/\\b(and|then)\\b.*$/ig, " ")
      .replace(/\\s+/g, " ")
      .trim(),
    160
  );
}

async function executeGenericVisibleAction(args = {}, state = defaultState(), steps = [], existingObservationResult = null) {
  const observationResult = existingObservationResult || await observePage({ ...args, useExtensions: false }, state);
  const observation = observationResult.observation;
  const pageKey = pageKeyForObservation(null, observation);
  const updated = updateStateFromObservation(state, observation, null, pageKey);

  if (!existingObservationResult) {
    steps.push({
      type: "observe",
      tool: "lightpandaSnapshotCurrent",
      input: {
        currentUrl: explicitNavigationUrlFromArgs(args) || args.currentUrl || state.currentUrl || "",
        useExtensions: false,
      },
      ok: true,
      resultPreview: preview(compactObservation(observation), 900),
    });
  }

  const targetText = extractGenericClickTarget(args.instruction || args.label || args.text || "");

  if (!targetText) {
    return responseBase({
      ok: true,
      status: "success",
      instruction: args.instruction || "",
      state: updated,
      observation,
      extension: null,
      pageKey,
      steps,
      summary: "Observed the current page. Tell me the exact visible button or link text to click.",
      possibleNextActions: [],
      requiresUser: true,
    });
  }

  const clickResult = await lightpandaClickByText({
    url: observation.url || state.currentUrl || "",
    text: targetText,
    waitMs: args.waitMs || "1200",
  });

  const clicked = Boolean(clickResult?.ok && clickResult?.clicked);

  steps.push({
    type: "action",
    tool: "lightpandaClickByText",
    input: {
      url: observation.url || state.currentUrl || "",
      text: targetText,
    },
    ok: clicked,
    resultPreview: preview(clickResult, 900),
  });

  const postObservation = observationFromPageResult(clickResult || {});
  const finalObservation = postObservation.url ? postObservation : observation;
  const finalPageKey = pageKeyForObservation(null, finalObservation);
  const finalState = updateStateFromObservation(updated, finalObservation, null, finalPageKey);

  return responseBase({
    ok: clicked,
    status: clicked ? "success" : "needs_user",
    instruction: args.instruction || "",
    state: finalState,
    observation: finalObservation,
    extension: null,
    pageKey: finalPageKey,
    steps,
    summary: clicked
      ? "Clicked visible text \\"" + targetText + "\\" and observed the result."
      : "I could not find a visible button/link matching \\"" + targetText + "\\" on the current page.",
    possibleNextActions: [],
    requiresUser: true,
    blockedReason: clicked ? "" : "target_not_found",
  });
}

async function executeAction(args = {}, state = loadState(args.sessionId)) {
  const steps = [];
  const useExtensions = boolArg(args.useExtensions, true);

  if (!useExtensions) {
    return executeGenericVisibleAction(args, state, steps);
  }

  const observationResult = await observePage(args, state);

  steps.push({
    type: "observe",
    tool: "lightpandaSnapshotCurrent",
    input: {
      currentUrl: explicitNavigationUrlFromArgs(args) || args.currentUrl || state.currentUrl || "",
      useExtensions,
    },
    ok: true,
    resultPreview: preview(compactObservation(observationResult.observation), 900),
  });

  const extension = extensionFromContext({
    extensionId: args.extensionId,
    observation: observationResult.observation,
    state,
    instruction: args.instruction,
  }) || observationResult.extension;

  if (!extension) {
    return executeGenericVisibleAction(args, state, steps, observationResult);
  }

  const skill = getExtensionSkill(extension.id);
  const pageKey = pageKeyForObservation(skill, observationResult.observation);
  const actionResolution = resolveInstructionAction({
    instruction: args.instruction || args.label || "",
    extensionId: extension.id,
  });

  steps.push({
    type: "plan",
    ok: Boolean(actionResolution.ok),
    resultPreview: preview(actionResolution, 900),
  });

  if (!actionResolution.ok) {
    return executeGenericVisibleAction(args, state, steps, observationResult);
  }

  const action = actionResolution.action;
  const dangerous = actionIsDangerous(action, args.instruction);
  const requiredPhrase = requiredConfirmationPhrase(action);

  if (dangerous) {
    const confirm = args.confirm === true || String(args.confirm || "").toLowerCase() === "true";
    const confirmText = String(args.confirmText || "").trim();

    if (!confirm || confirmText !== requiredPhrase) {
      const updated = updateStateFromObservation(state, observationResult.observation, extension, pageKey);

      return responseBase({
        ok: false,
        status: "blocked",
        instruction: args.instruction || "",
        state: updated,
        observation: observationResult.observation,
        extension,
        pageKey,
        steps,
        summary: "Blocked dangerous action \\"" + (action.label || action.id || "action") + "\\".",
        possibleNextActions: safePossibleNextActions(extension, skill),
        requiresUser: true,
        blockedReason: "Exact confirmation required: " + requiredPhrase,
      });
    }
  }

  if (observationResult.observation.isLoginPage && action.pageKey && !/login/i.test(action.pageKey)) {
    const updated = updateStateFromObservation(state, observationResult.observation, extension, pageKey);

    return responseBase({
      ok: false,
      status: "needs_user",
      instruction: args.instruction || "",
      state: updated,
      observation: observationResult.observation,
      extension,
      pageKey,
      steps,
      summary: "This action belongs to " + displayPageKey(action.pageKey) + ", but the current page appears to be a login page. Login/session is required before I can do this.",
      possibleNextActions: [],
      requiresUser: true,
      blockedReason: "login_required",
    });
  }

  if (!sameKnownPage(action, observationResult.observation, skill, pageKey) && !visibleElementMatchingAction(action, observationResult.observation)) {
    return executeGenericVisibleAction(args, state, steps, observationResult);
  }

  let actionResult = null;
  let clicked = false;
  const targetUrl = actionTargetUrl(action, skill, state);

  if (action.href) {
    actionResult = await lightpandaSnapshotCurrent({
      url: action.href,
      navigate: true,
      waitMs: args.waitMs || "1200",
    });

    clicked = Boolean(actionResult?.ok);

    steps.push({
      type: "action",
      tool: "lightpandaSnapshotCurrent",
      input: {
        url: action.href,
        navigate: true,
      },
      ok: clicked,
      resultPreview: preview(actionResult, 900),
    });
  } else if (action.selector) {
    const selectorReady = await lightpandaWaitForSelector({
      url: targetUrl,
      selector: action.selector,
      waitMs: args.waitMs || "1800",
    });

    steps.push({
      type: "plan",
      tool: "lightpandaWaitForSelector",
      input: {
        url: targetUrl,
        selector: action.selector,
      },
      ok: Boolean(selectorReady?.ok && selectorReady?.found),
      resultPreview: preview(selectorReady, 600),
    });

    if (selectorReady?.ok && selectorReady?.found) {
      actionResult = await lightpandaClickBySelector({
        url: targetUrl,
        selector: action.selector,
        waitMs: args.waitMs || "1200",
      });

      clicked = Boolean(actionResult?.ok && actionResult?.clicked);

      steps.push({
        type: "action",
        tool: "lightpandaClickBySelector",
        input: {
          url: targetUrl,
          selector: action.selector,
        },
        ok: clicked,
        resultPreview: preview(actionResult, 900),
      });
    }

    if (!clicked) {
      const byText = await lightpandaClickByText({
        url: targetUrl,
        text: action.label,
        waitMs: args.waitMs || "1200",
      });

      clicked = Boolean(byText?.ok && byText?.clicked);
      actionResult = byText;

      steps.push({
        type: "retry",
        tool: "lightpandaClickByText",
        input: {
          url: targetUrl,
          text: action.label,
        },
        ok: clicked,
        resultPreview: preview(byText, 900),
      });
    }
  } else {
    const byText = await lightpandaClickByText({
      url: targetUrl || observationResult.observation.url,
      text: action.label,
      waitMs: args.waitMs || "1200",
    });

    clicked = Boolean(byText?.ok && byText?.clicked);
    actionResult = byText;

    steps.push({
      type: "action",
      tool: "lightpandaClickByText",
      input: {
        url: targetUrl || observationResult.observation.url,
        text: action.label,
      },
      ok: clicked,
      resultPreview: preview(byText, 900),
    });
  }

  const postObservation = observationFromPageResult(actionResult || {});
  const finalObservation = postObservation.url ? postObservation : observationResult.observation;
  const finalPageKey = pageKeyForObservation(skill, finalObservation);
  const updated = updateStateFromObservation(state, finalObservation, extension, finalPageKey);

  if (!clicked) {
    return responseBase({
      ok: false,
      status: "failed",
      instruction: args.instruction || "",
      state: {
        ...updated,
        failureCount: Number(updated.failureCount || 0) + 1,
      },
      observation: finalObservation,
      extension,
      pageKey: finalPageKey,
      steps,
      summary: "I could not execute \\"" + (action.label || action.id || "action") + "\\". The target was not found or did not click successfully.",
      possibleNextActions: safePossibleNextActions(extension, skill),
      requiresUser: true,
      blockedReason: "target_not_clicked",
    });
  }

  return responseBase({
    ok: true,
    status: "success",
    instruction: args.instruction || "",
    state: updated,
    observation: finalObservation,
    extension,
    pageKey: finalPageKey,
    steps,
    summary: "Executed \\"" + (action.label || action.id || "action") + "\\".",
    possibleNextActions: safePossibleNextActions(extension, skill),
    requiresUser: true,
  });
}

`;

src = src.slice(0, start) + replacement + src.slice(end);

fs.writeFileSync(file, src, "utf8");
console.log("replaced broken executeAction section cleanly");
