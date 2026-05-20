const fs = require("fs");

const file = "server/lib/browser-agent.js";
let src = fs.readFileSync(file, "utf8");

const start = src.indexOf('function extractGenericClickTarget(instruction = "")');
const end = src.indexOf('async function executeAction(args = {}, state = loadState(args.sessionId))');
if (start === -1 || end === -1 || end <= start) {
  throw new Error("Could not find extractGenericClickTarget/executeAction section");
}

const replacement = [
  'function extractGenericClickTarget(instruction = "") {',
  '  const raw = String(instruction || "").trim();',
  '  const quoted = raw.match(/["\\\'](.+?)["\\\']/)?.[1];',
  '  if (quoted) return safeText(quoted, 160);',
  '',
  '  const lower = raw.toLowerCase();',
  '',
  '  if (',
  '    /\\b(what|which|show|list|tell me|visible|available)\\b.*\\b(button|buttons|link|links|clickable|elements)\\b/.test(lower) ||',
  '    /\\b(what can i click|what to click|buttons to click|links to click)\\b/.test(lower)',
  '  ) {',
  '    return "";',
  '  }',
  '',
  '  const actionMatch = raw.match(/(?:try\\s+)?(?:click|clicking|open|press|tap)\\s+(?:on\\s+|the\\s+)?(.+)$/i);',
  '  if (actionMatch?.[1]) {',
  '    return safeText(',
  '      actionMatch[1]',
  '        .replace(/\\s+(?:and|then)\\s+(?:read|observe|inspect|tell|show|summarize).*$/i, " ")',
  '        .replace(/\\b(button|link|page|menu|section)\\b/ig, " ")',
  '        .replace(/\\s+/g, " ")',
  '        .trim(),',
  '      160',
  '    );',
  '  }',
  '',
  '  return safeText(',
  '    raw',
  '      .replace(/\\b(please|try|execute|click|clicking|open|go to|navigate to|perform|run|press|tap|read|observe|inspect|tell|show|the|button|link|on this page|there)\\b/ig, " ")',
  '      .replace(/\\b(and|then)\\b.*$/ig, " ")',
  '      .replace(/\\s+/g, " ")',
  '      .trim(),',
  '    160',
  '  );',
  '}',
  '',
  'async function executeGenericVisibleAction(args = {}, state = defaultState(), steps = [], existingObservationResult = null) {',
  '  const observationResult = existingObservationResult || await observePage({ ...args, useExtensions: false }, state);',
  '  const observation = observationResult.observation;',
  '  const updated = updateStateFromObservation(state, observation, null, pageKeyForObservation(null, observation));',
  '',
  '  if (!existingObservationResult) {',
  '    steps.push({',
  '      type: "observe",',
  '      tool: "lightpandaSnapshotCurrent",',
  '      input: {',
  '        currentUrl: explicitNavigationUrlFromArgs(args) || args.currentUrl || state.currentUrl || "",',
  '        useExtensions: false,',
  '      },',
  '      ok: true,',
  '      resultPreview: preview(compactObservation(observation), 900),',
  '    });',
  '  }',
  '',
  '  const targetText = extractGenericClickTarget(args.instruction || args.label || args.text || "");',
  '',
  '  if (!targetText) {',
  '    return responseBase({',
  '      ok: true,',
  '      status: "success",',
  '      instruction: args.instruction || "",',
  '      state: updated,',
  '      observation,',
  '      extension: null,',
  '      pageKey: pageKeyForObservation(null, observation),',
  '      steps,',
  '      summary: "Observed the current page. Tell me the exact visible button or link text to click.",',
  '      possibleNextActions: [],',
  '      requiresUser: true,',
  '    });',
  '  }',
  '',
  '  const clickResult = await lightpandaClickByText({',
  '    url: observation.url || state.currentUrl || "",',
  '    text: targetText,',
  '    waitMs: args.waitMs || "1200",',
  '  });',
  '',
  '  const clicked = Boolean(clickResult?.ok && clickResult?.clicked);',
  '',
  '  steps.push({',
  '    type: "action",',
  '    tool: "lightpandaClickByText",',
  '    input: { url: observation.url || state.currentUrl || "", text: targetText },',
  '    ok: clicked,',
  '    resultPreview: preview(clickResult, 900),',
  '  });',
  '',
  '  const postObservation = observationFromPageResult(clickResult || {});',
  '  const finalObservation = postObservation.url ? postObservation : observation;',
  '  const finalState = updateStateFromObservation(updated, finalObservation, null, pageKeyForObservation(null, finalObservation));',
  '',
  '  return responseBase({',
  '    ok: clicked,',
  '    status: clicked ? "success" : "needs_user",',
  '    instruction: args.instruction || "",',
  '    state: finalState,',
  '    observation: finalObservation,',
  '    extension: null,',
  '    pageKey: pageKeyForObservation(null, finalObservation),',
  '    steps,',
  '    summary: clicked',
  '      ? "Clicked visible text \\"" + targetText + "\\" and observed the result."',
  '      : "I could not find a visible button/link matching \\"" + targetText + "\\" on the current page.",',
  '    possibleNextActions: [],',
  '    requiresUser: true,',
  '    blockedReason: clicked ? "" : "target_not_found",',
  '  });',
  '}',
  ''
].join("\n");

src = src.slice(0, start) + replacement + src.slice(end);

const noExtStart = src.indexOf('  if (!useExtensions) {', src.indexOf('async function executeAction'));
if (noExtStart === -1) {
  throw new Error("Could not find initial !useExtensions block");
}
const afterNoExt = src.indexOf('  const observationResult = await observePage(args, state);', noExtStart);
if (afterNoExt === -1) {
  throw new Error("Could not find observationResult after !useExtensions block");
}
src = src.slice(0, noExtStart) +
  '  if (!useExtensions) return executeGenericVisibleAction(args, state, steps);\\n' +
  src.slice(afterNoExt);

const oldNoExtensionReturn = [
  '  if (!extension) {',
  '    const updated = updateStateFromObservation(state, observationResult.observation, null, "");',
  '    return responseBase({',
  '      ok: false,',
  '      status: "needs_user",',
  '      instruction: args.instruction || "",',
  '      state: updated,',
  '      observation: observationResult.observation,',
  '      extension: null,',
  '      pageKey: "",',
  '      steps,',
  '      summary: "No active extension matches the current page or instruction.",',
  '      possibleNextActions: [],',
  '      requiresUser: true,',
  '    });',
  '  }'
].join("\n");

const newNoExtensionReturn = [
  '  if (!extension) {',
  '    return executeGenericVisibleAction(args, state, steps, observationResult);',
  '  }'
].join("\n");

if (!src.includes(oldNoExtensionReturn)) {
  throw new Error("Could not find no-extension return block");
}
src = src.replace(oldNoExtensionReturn, newNoExtensionReturn);

fs.writeFileSync(file, src, "utf8");
console.log("patched browser-agent generic click fallback");
