const fs = require("fs");

const file = "server/lib/browser-agent.js";
let src = fs.readFileSync(file, "utf8");

const classifyReplacement = [
  'function classifyInstruction(instruction = "") {',
  '  const lower = String(instruction || "").toLowerCase();',
  '',
  '  if (/\\b(reset|clear)\\b.*\\b(browser agent|browser state|agent state)\\b/.test(lower)) return "reset";',
  '  if (/\\b(status)\\b.*\\b(browser agent|agent)\\b/.test(lower)) return "status";',
  '  if (/\\b(learn|remember|this is|that is|save this action|save as action|use this as|call this)\\b/.test(lower)) return "learn";',
  '  if (/\\b(scrape|extract table|extract cards|extract data|scraper)\\b/.test(lower)) return "scrape";',
  '',
  '  // Questions about visible/clickable things are OBSERVE, not execute.',
  '  if (',
  '    /\\b(what|which|show|list|tell me|visible|available)\\b.*\\b(button|buttons|link|links|clickable|elements|actions)\\b/.test(lower) ||',
  '    /\\b(button|buttons|link|links|clickable elements)\\b.*\\b(there|visible|available|on this page|on the page)\\b/.test(lower) ||',
  '    /\\b(what can i click|what to click|buttons to click|links to click)\\b/.test(lower)',
  '  ) {',
  '    return "observe";',
  '  }',
  '',
  '  if (extractUrl(instruction) && /\\b(open|go|visit|navigate|load|observe|inspect|read|view)\\b/.test(lower)) return "navigate";',
  '  if (/\\b(show|list|what actions|available actions|known actions|extension actions|site actions)\\b/.test(lower)) return "show_actions";',
  '  if (/\\b(execute|click|open|go to|navigate to|perform|run)\\b/.test(lower)) return "execute_action";',
  '  if (/\\b(plan|can you|find|where|how)\\b/.test(lower)) return "plan_action";',
  '  if (/\\b(observe|inspect|read|snapshot|current page)\\b/.test(lower)) return "observe";',
  '  if (extractUrl(instruction)) return "navigate";',
  '  return "observe";',
  '}'
].join("\n");

const classifyRegex = /function classifyInstruction\(instruction = ""\) \{[\s\S]*?\n\}/;
if (!classifyRegex.test(src)) {
  throw new Error("Could not find classifyInstruction() in browser-agent.js");
}
src = src.replace(classifyRegex, classifyReplacement);

if (!src.includes('function extractGenericClickTarget(instruction = "")')) {
  const helper = [
    '',
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
    '  return safeText(',
    '    raw',
    '      .replace(/\\b(please|execute|click|open|go to|navigate to|perform|run|press|tap|the|button|link|on this page|there)\\b/ig, " ")',
    '      .replace(/\\s+/g, " ")',
    '      .trim(),',
    '    160',
    '  );',
    '}',
    ''
  ].join("\n");

  const marker = 'async function executeAction(args = {}, state = loadState(args.sessionId)) {';
  if (!src.includes(marker)) {
    throw new Error("Could not find executeAction() marker");
  }
  src = src.replace(marker, helper + marker);
}

const noExtensionsRegex = /  if \(!useExtensions\) \{\r?\n\s*return responseBase\(\{\r?\n\s*ok: false,\r?\n\s*status: "blocked",[\s\S]*?blockedReason: "extensions_disabled",\r?\n\s*\}\);\r?\n\s*\}\r?\n\r?\n/;

const newNoExtensionsBlock = [
  '  if (!useExtensions) {',
  '    const observationResult = await observePage(args, state);',
  '    const observation = observationResult.observation;',
  '    const updated = updateStateFromObservation(state, observation, null, "");',
  '',
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
  '',
  '    const targetText = extractGenericClickTarget(args.instruction || args.label || args.text || "");',
  '',
  '    if (!targetText) {',
  '      return responseBase({',
  '        ok: true,',
  '        status: "success",',
  '        instruction: args.instruction || "",',
  '        state: updated,',
  '        observation,',
  '        extension: null,',
  '        pageKey: pageKeyForObservation(null, observation),',
  '        steps,',
  '        summary: "Observed the current page. Extensions are disabled, so I will only report real visible elements unless you name a visible button/link to click.",',
  '        possibleNextActions: [],',
  '        requiresUser: true,',
  '      });',
  '    }',
  '',
  '    const clickResult = await lightpandaClickByText({',
  '      url: observation.url || state.currentUrl || "",',
  '      text: targetText,',
  '      waitMs: args.waitMs || "1200",',
  '    });',
  '',
  '    const clicked = Boolean(clickResult?.ok && clickResult?.clicked);',
  '',
  '    steps.push({',
  '      type: "action",',
  '      tool: "lightpandaClickByText",',
  '      input: { url: observation.url || state.currentUrl || "", text: targetText },',
  '      ok: clicked,',
  '      resultPreview: preview(clickResult, 900),',
  '    });',
  '',
  '    const postObservation = observationFromPageResult(clickResult || {});',
  '    const finalObservation = postObservation.url ? postObservation : observation;',
  '    const finalState = updateStateFromObservation(updated, finalObservation, null, pageKeyForObservation(null, finalObservation));',
  '',
  '    return responseBase({',
  '      ok: clicked,',
  '      status: clicked ? "success" : "needs_user",',
  '      instruction: args.instruction || "",',
  '      state: finalState,',
  '      observation: finalObservation,',
  '      extension: null,',
  '      pageKey: pageKeyForObservation(null, finalObservation),',
  '      steps,',
  '      summary: clicked',
  '        ? "Clicked visible text \\"" + targetText + "\\"."',
  '        : "I could not find a visible button/link matching \\"" + targetText + "\\" on the current page.",',
  '      possibleNextActions: [],',
  '      requiresUser: true,',
  '      blockedReason: clicked ? "" : "target_not_found",',
  '    });',
  '  }',
  ''
].join("\n");

if (!noExtensionsRegex.test(src)) {
  console.log("extensions-disabled block not found. It may already be patched.");
} else {
  src = src.replace(noExtensionsRegex, newNoExtensionsBlock);
}

fs.writeFileSync(file, src, "utf8");
console.log("fixed browser-agent visible-element observe routing");
