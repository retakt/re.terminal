import {
  browserAgentRuntimeConfig,
  callBrowserAgentRoleJson,
  emptyBrowserAgentTokenUsage,
} from "./browser-llm-runtime.js";
import {
  capturePlaywrightMcpSnapshot,
  compactSnapshotForModel,
  executePlaywrightMcpBrowserCommand,
  probePlaywrightUiState,
  scoutPlaywrightControlTarget,
  snapshotImagesForModel,
  dismissPlaywrightBlockingUi,
  activatePlaywrightControlByText,
  togglePlaywrightOpenCollapse,
} from "./browser-playwright-mcp-bridge.js";
import {
  compactBrowserStateForModel,
  getBrowserState,
} from "./browser-state-provider.js";

import {
  BROWSER_AGENT_ARCHITECTURE,
  runCheckerAgent,
  runFinalVerifierAgent,
  runOrchestratorAgent,
  runStepAgent,
  runWatcherAgent,
  resolveBrowserAgentProfile,
} from "./browser-agents/index.js";
import {
  buildWatcherSpyReport,
  cleanBrowserAgentTraceSummary,
  finalBrowserAgentUserSummary,
  pageSummaryFromObservation,
} from "./browser-agent-watcher-spy.js";

const SUPPORTED_TOOLS = new Set([
  "browserNavigate",
  "browserObserve",
  "browserClickByText",
  "browserFillFields",
  "browserSubmitForm",
  "browserFillAndSubmit",
  "browserScrape",
  "browserShowActions",
  "browserReset",
  "browserStatus",
]);

function safeText(value = "", limit = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function nowMs() {
  return performance.now();
}

function roundMs(value = 0) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function envInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function isReportOnlyStep(step = {}) {
  const action = String(step.expectedAction || "").toLowerCase();
  const text = String(step.instruction || "").toLowerCase();
  return action === "report" || /\b(report|tell me|summarize|final state|final url|final title)\b/.test(text);
}

function normalizeHttpUrl(value = "") {
  const raw = String(value || "").trim().replace(/[.,;:!?]+$/g, "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) return "";
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#][^\s]*)?$/i.test(raw)) return `https://${raw}`;
  return "";
}

function extractUrlFromText(value = "") {
  const raw = String(value || "");
  const explicit = raw.match(/https?:\/\/[^\s)"'<>]+/i)?.[0];
  if (explicit) return normalizeHttpUrl(explicit);
  const domain = raw.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)"'<>]*)?/i)?.[0];
  return normalizeHttpUrl(domain || "");
}

function targetUrlForStep(step = {}, originalInstruction = "") {
  return extractUrlFromText([
    step.instruction,
    step.successCriteria,
    step.target,
    step.url,
    originalInstruction,
  ].filter(Boolean).join(" "));
}

function isNavigationStep(step = {}) {
  const action = String(step.expectedAction || "").toLowerCase();
  const text = String(step.instruction || "").toLowerCase();
  return action === "navigate" || /\b(open|visit|navigate|go to|load|browse)\b/.test(text);
}

function hasMutatingBrowserIntent(text = "") {
  return /\b(click|press|tap|fill|type|submit|login|log in|sign in|checkout|pay|delete|remove|approve|reject|upload|download|save|change|update)\b/i
    .test(String(text || ""));
}

function isObserveOnlyStep(step = {}) {
  const action = String(step.expectedAction || "").toLowerCase();
  const text = String(step.instruction || "").toLowerCase();

  if (hasMutatingBrowserIntent(text)) return false;
  if ([
    "observe",
    "inspect",
    "read",
    "check",
    "scrape",
    "extract",
    "summarize",
    "unknown",
  ].includes(action)) {
    if (/\b(click|press|tap|fill|type|submit)\b/.test(text)) return false;
    if (/\b(observe|inspect|check|look|read|review|analyze page|what is on|what's on|scrape|extract|summarize|title|link count|form count|first\s+\d+\s+link|first\s+five\s+link|link texts?|forms?|links?)\b/.test(text)) return true;
  }

  return /\b(observe|inspect|check|look|read|review|analyze page|what is on|what's on|scrape|extract|summarize|title|link count|form count|first\s+\d+\s+link|first\s+five\s+link|link texts?)\b/.test(text);
}

function isScrapeLikeStep(step = {}) {
  const action = String(step.expectedAction || "").toLowerCase();
  const text = String(step.instruction || "").toLowerCase();
  if (hasMutatingBrowserIntent(text)) return false;
  return action === "scrape" ||
    action === "extract" ||
    /\b(scrape|extract|table|tables|cards|repeated groups|link count|form count|first\s+\d+\s+link|first\s+five\s+link|link texts?)\b/.test(text);
}

function isReadOnlyBrowserPlan(steps = [], originalInstruction = "") {
  if (hasMutatingBrowserIntent(originalInstruction) && !/\bdo not click|don't click|dont click|no click|without clicking\b/i.test(originalInstruction)) {
    return false;
  }

  return steps.every((step) => {
    const action = String(step.expectedAction || "").toLowerCase();
    const text = String(step.instruction || "").toLowerCase();
    if (isReportOnlyStep(step) || isNavigationStep(step)) return true;
    if (/\b(observe|inspect|check|read|scrape|extract|summarize|report)\b/.test(text)) return true;
    return ["observe", "report", "read", "scrape", "extract", "unknown"].includes(action) && !hasMutatingBrowserIntent(text);
  });
}

function firstLinkTexts(observation = {}, limit = 5) {
  return (Array.isArray(observation.links) ? observation.links : [])
    .map((link) => safeText(link.text || link.label || link.name || link.href || "", 140))
    .filter(Boolean)
    .slice(0, limit);
}

function detailedReportSummaryFromObservation(observation = {}, step = {}, originalInstruction = "") {
  const title = observation.title || "";
  const url = observation.url || "";
  const stats = observation.stats || {};
  const links = Array.isArray(observation.links) ? observation.links.length : Number(stats.links || 0);
  const forms = Array.isArray(observation.forms) ? observation.forms.length : Number(stats.forms || 0);
  const firstLinks = firstLinkTexts(observation, 5);

  const wantsLinks = /\b(first\s+\d+\s+link|first\s+five\s+link|links?|link texts?)\b/i
    .test(`${step.instruction || ""} ${originalInstruction || ""}`);

  const parts = [
    title ? `Title: ${title}` : "",
    url ? `URL: ${url}` : "",
    Number.isFinite(links) ? `Links: ${links}` : "",
    Number.isFinite(forms) ? `Forms: ${forms}` : "",
  ].filter(Boolean);

  if (wantsLinks && firstLinks.length) {
    parts.push(`First ${firstLinks.length} links: ${firstLinks.join(" | ")}`);
  }

  return parts.length ? parts.join(" — ") : pageSummaryFromObservation(observation);
}

function normalizedTargetText(value = "") {
  const raw = safeText(value, 240);
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const left = words.slice(0, half).join(" ");
    const right = words.slice(half).join(" ");
    if (left && left.toLowerCase() === right.toLowerCase()) {
      return left.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    }
  }
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanClickTargetText(value = "") {
  return safeText(value, 160)
    .replace(/^on\s+/i, "")
    .replace(/^a\s+/i, "")
    .replace(/^an\s+/i, "")
    .replace(/^the\s+/i, "")
    .replace(/\s+(?:link|button|tab|menuitem|anchor)$/i, "")
    .replace(/\b(after clicking|after click|report|then).*$/i, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim();
}

function extractClickTargetText(step = {}, originalInstruction = "") {
  const stepText = String(step.instruction || "");

  const quotedStep = stepText.match(/["'“”]([^"'“”]+)["'“”]/)?.[1];
  if (quotedStep) return cleanClickTargetText(quotedStep);

  const stepMatch = stepText.match(/\b(?:click|press|tap)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:[.!?]|\s+after\b|\s+then\b|$)/i);
  if (stepMatch?.[1]) {
    const cleaned = cleanClickTargetText(stepMatch[1]);
    if (cleaned && !/^https?:\/\//i.test(cleaned)) return cleaned;
  }

  const text = String(originalInstruction || "");
  const quoted = text.match(/["'“”]([^"'“”]+)["'“”]/)?.[1];
  if (quoted) return cleanClickTargetText(quoted);

  const match = text.match(/\b(?:click|press|tap)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:[.!?]|\s+after\b|\s+then\b|$)/i);
  if (match?.[1]) {
    const cleaned = cleanClickTargetText(match[1]);
    if (cleaned && !/^https?:\/\//i.test(cleaned)) return cleaned;
  }

  return "";
}

function absoluteHrefFromState(href = "", baseUrl = "") {
  const raw = String(href || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, baseUrl || undefined).href;
  } catch {
    return normalizeHttpUrl(raw);
  }
}

function isClickStep(step = {}) {
  const action = String(step.expectedAction || "").toLowerCase();
  const text = String(step.instruction || "").toLowerCase();
  return action === "click" || /\b(click|press|tap)\b/.test(text);
}

function isButtonIntentStep(step = {}) {
  const action = String(step.expectedAction || "").toLowerCase();
  const text = String(step.instruction || "").toLowerCase();
  if (action !== "click" && !/\b(click|press|tap)\b/.test(text)) return false;
  return /\b(button|modal|collapse|dropdown|toggle|data-bs-target|data-target|popup|dialog|accordion|launch demo|open demo)\b/i
    .test(text);
}

function isExplicitLinkNavigationIntent(step = {}) {
  const text = String(step.instruction || "").toLowerCase();
  return /\b(link|href|anchor|url|navigate|go to|open link|visit)\b/i.test(text) &&
    !/\b(button|modal|collapse|dropdown|toggle|data-bs-target|data-target|popup|dialog|accordion)\b/i.test(text);
}

function samePageAnchorHref(href = "", baseUrl = "") {
  const raw = String(href || "").trim();
  if (!raw) return false;
  try {
    const target = new URL(raw, baseUrl || undefined);
    const base = new URL(baseUrl || target.href);
    return Boolean(target.hash) &&
      target.origin === base.origin &&
      target.pathname.replace(/\/$/, "") === base.pathname.replace(/\/$/, "");
  } catch {
    return raw.startsWith("#");
  }
}

function isPlainHrefLinkCandidate(entry = {}) {
  const href = String(entry.href || "").trim();
  if (!href) return false;

  const kind = String(entry.kind || "").toLowerCase();
  const selector = String(entry.selector || "").toLowerCase();
  const attrs = entry.attrs && typeof entry.attrs === "object" ? entry.attrs : {};

  const attrValue = (...names) => names
    .map((name) => safeText(attrs[name] || "", 120))
    .find(Boolean) || "";

  const role = safeText(entry.role || attrValue("role"), 80).toLowerCase();
  const hasControlAttrs = Boolean(
    attrValue("data-bs-toggle", "data-toggle", "dataBsToggle", "dataToggle") ||
    attrValue("data-bs-target", "data-target", "dataBsTarget", "dataTarget") ||
    attrValue("aria-controls", "ariaControls") ||
    role === "button"
  );

  const looksLikeAnchor = kind === "link" ||
    /^a(?:[.#[:\s]|$)/i.test(selector) ||
    /a\s*\[href/i.test(selector);

  const selectorLooksControl = /\[(?:data-bs-toggle|data-bs-target|data-target|aria-controls|role=['"]?button)/i
    .test(selector);

  return looksLikeAnchor && !hasControlAttrs && !selectorLooksControl;
}

function buttonIntentScoreAdjustment(entry = {}, step = {}, baseUrl = "") {
  if (!isButtonIntentStep(step)) return 0;

  const kind = String(entry.kind || "").toLowerCase();
  const href = String(entry.href || "");
  const selector = String(entry.selector || "").toLowerCase();
  const text = String(entry.text || entry.label || entry.name || "").toLowerCase();

  let score = 0;
  if (kind === "button" || !href) score += 0.35;
  if (/button|data-bs-target|data-target|aria-controls|modal|collapse/.test(selector)) score += 0.25;
  if (/button|modal|collapse|toggle|launch demo/.test(text)) score += 0.15;

  if (kind === "link" && href) score -= 0.35;
  if (samePageAnchorHref(href, baseUrl)) score -= 0.45;

  return score;
}

function tokenSetFromNormalized(value = "") {
  return new Set(String(value || "").split(/\s+/).filter(Boolean));
}

function lightpandaClickScore(candidate = {}, targetText = "", totalCandidates = 0) {
  const wanted = normalizedTargetText(targetText);
  const rawLabel = candidate.text || candidate.label || candidate.name || "";
  const label = normalizedTargetText(rawLabel);
  const href = normalizedTargetText(candidate.href || "");

  if (!wanted || !label) return 0;

  if (label === wanted) return 1;

  const wantedTokens = tokenSetFromNormalized(wanted);
  const labelTokens = tokenSetFromNormalized(label);

  // For short targets like "new", never substring-match "news".
  if (wanted.length <= 3 || wantedTokens.size === 1) {
    const only = Array.from(wantedTokens)[0] || wanted;
    if (labelTokens.has(only)) return 0.96;
    return 0;
  }

  if (label.includes(wanted) || wanted.includes(label)) return 0.92;

  if (
    /\bmore information\b/i.test(targetText) &&
    /\blearn more\b/i.test(rawLabel)
  ) {
    return 0.88;
  }

  if (href && Array.from(wantedTokens).some((part) => part.length >= 4 && href.includes(part))) {
    return 0.74;
  }

  if (totalCandidates === 1 && candidate.href && /\b(more|information|details|continue|open|link)\b/i.test(targetText)) {
    return 0.72;
  }

  return 0;
}

function syntheticStepPlanFromLightpandaClick({ step = {}, beforeState = null, originalInstruction = "" } = {}) {
  if (!beforeState || beforeState.ok !== true || !isClickStep(step)) return null;

  const targetText = extractClickTargetText(step, originalInstruction);
  if (!targetText) return null;

  const links = Array.isArray(beforeState.links) ? beforeState.links : [];
  const buttons = Array.isArray(beforeState.buttons) ? beforeState.buttons : [];
  const interactive = Array.isArray(beforeState.interactiveElements) ? beforeState.interactiveElements : [];

  const candidates = [
    ...links.map((entry) => ({ ...entry, kind: "link", preferred: 0.04 })),
    ...buttons.map((entry) => ({ ...entry, kind: "button", preferred: 0.02 })),
    ...interactive.map((entry) => ({ ...entry, kind: entry.href ? "link" : "interactive", preferred: entry.href ? 0.03 : 0 })),
  ];

  const ranked = candidates
    .map((entry) => ({
      entry,
      score: lightpandaClickScore(entry, targetText, candidates.length) + Number(entry.preferred || 0),
    }))
    .filter((item) => item.score >= 0.7)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.entry;
  if (!best) return null;

  if (isButtonIntentStep(step) && best.kind === "link" && !isExplicitLinkNavigationIntent(step)) {
    return null;
  }

  const href = absoluteHrefFromState(best.href || "", beforeState.url || "");
  const visibleText = safeText(best.text || best.label || best.name || targetText, 180);
  const selector = safeText(best.selector || "", 320);
  const ref = safeText(best.ref || "", 120);

  if (href && best.kind === "link") {
    return {
      status: "ready",
      syntheticSource: "lightpanda_click_planner",
      command: {
        intent: "click_link_via_href",
        tool: "browserNavigate",
        args: {
          url: href,
          sourceText: visibleText,
          sourceRef: ref,
          sourceSelector: selector,
        },
        notes: `Lightpanda resolved the click target "${targetText}" to link "${visibleText}" and href ${href}.`,
      },
      reason: `Lightpanda resolved click target "${targetText}" to link "${visibleText}".`,
      messageToChecker: "",
      messageToUser: "",
      confidence: ranked[0].score,
    };
  }

  return {
    status: "ready",
    syntheticSource: "lightpanda_click_planner",
    command: {
      intent: "click",
      tool: "browserClickByText",
      args: {
        text: visibleText,
        ref,
        selector,
      },
      notes: `Lightpanda resolved the click target "${targetText}" to visible control "${visibleText}".`,
    },
    reason: `Lightpanda resolved click target "${targetText}" to visible control "${visibleText}".`,
    messageToChecker: "",
    messageToUser: "",
    confidence: ranked[0].score,
  };
}

function lightpandaCandidateFromCommand(beforeState = null, command = {}) {
  if (!beforeState || beforeState.ok !== true || !command || typeof command !== "object") return null;

  const args = command.args || {};
  const wantedRef = safeText(args.ref || args.selector || args.sourceRef || args.sourceSelector || "", 220);
  const wantedText = normalizedTargetText(args.text || args.label || args.buttonText || args.sourceText || "");
  const baseUrl = beforeState.url || "";

  const candidates = [
    ...(Array.isArray(beforeState.links) ? beforeState.links : []).map((entry) => ({ ...entry, kind: "link" })),
    ...(Array.isArray(beforeState.buttons) ? beforeState.buttons : []).map((entry) => ({ ...entry, kind: "button" })),
    ...(Array.isArray(beforeState.interactiveElements) ? beforeState.interactiveElements : []).map((entry) => ({ ...entry, kind: entry.href ? "link" : "interactive" })),
  ];

  const byRef = candidates.find((entry) => {
    if (!wantedRef) return false;
    return [entry.ref, entry.selector, entry.id, entry.name]
      .map((value) => safeText(value || "", 320))
      .some((value) => value && value === wantedRef);
  });

  if (byRef) return {
    ...byRef,
    href: absoluteHrefFromState(byRef.href || "", baseUrl),
    matchedBy: "ref",
  };

  if (!wantedText) return null;

  const ranked = candidates
    .map((entry) => ({
      entry,
      score: lightpandaClickScore(entry, wantedText, candidates.length),
    }))
    .filter((item) => item.score >= 0.86)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.entry || null;
  if (!best) return null;

  return {
    ...best,
    href: absoluteHrefFromState(best.href || "", baseUrl),
    matchedBy: "text",
  };
}

function compactClickCandidatesForStep({ step = {}, beforeState = null, originalInstruction = "", limit = 12 } = {}) {
  if (!beforeState || beforeState.ok !== true) return [];

  const targetText = extractClickTargetText(step, originalInstruction);
  const candidates = [
    ...(Array.isArray(beforeState.links) ? beforeState.links : []).map((entry) => ({ ...entry, kind: "link" })),
    ...(Array.isArray(beforeState.buttons) ? beforeState.buttons : []).map((entry) => ({ ...entry, kind: "button" })),
    ...(Array.isArray(beforeState.interactiveElements) ? beforeState.interactiveElements : []).map((entry) => ({ ...entry, kind: entry.href ? "link" : "interactive" })),
  ];

  const visibleCandidates = isButtonIntentStep(step) && !isExplicitLinkNavigationIntent(step)
    ? candidates.filter((entry) => !isPlainHrefLinkCandidate(entry))
    : candidates;

  return visibleCandidates
    .map((entry) => ({
      ref: safeText(entry.ref || "", 80),
      selector: safeText(entry.selector || "", 180),
      kind: safeText(entry.kind || "", 40),
      text: safeText(entry.text || entry.label || entry.name || "", 140),
      href: absoluteHrefFromState(entry.href || "", beforeState.url || ""),
      score: lightpandaClickScore(entry, targetText, visibleCandidates.length) +
        buttonIntentScoreAdjustment(entry, step, beforeState.url || ""),
    }))
    .filter((entry) => entry.text || entry.href || entry.ref || entry.selector)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, limit);
}

function compactPageStateForStepAgent({ step = {}, beforeState = null, originalInstruction = "" } = {}) {
  const base = compactBrowserStateForModel(beforeState, {
    textLimit: 500,
    markdownLimit: 300,
    linkLimit: 8,
    buttonLimit: 8,
    inputLimit: 8,
    formLimit: 3,
    candidateLimit: 12,
  });

  if (isClickStep(step)) {
    return {
      ...base,
      clickTarget: extractClickTargetText(step, originalInstruction),
      clickCandidates: compactClickCandidatesForStep({
        step,
        beforeState,
        originalInstruction,
        limit: 12,
      }),
      clickIntent: {
        buttonLike: isButtonIntentStep(step),
        explicitLinkNavigation: isExplicitLinkNavigationIntent(step),
      },
      instruction: isButtonIntentStep(step)
        ? "For button/modal/collapse/toggle click steps, prefer real buttons or non-href controls from clickCandidates/snapshot. Do not choose navigation links or section anchors just because their text is related. Use browserClickByText for the visible button/control."
        : "For click steps, choose only from clickCandidates when possible. If a matching link has href and the user asked for a link/navigation, prefer browserNavigate with args.url.",
    };
  }

  return base;
}

function bestLightpandaClickCandidateForStep({ step = {}, beforeState = null, originalInstruction = "" } = {}) {
  if (!beforeState || beforeState.ok !== true || !isClickStep(step)) return null;

  const targetText = extractClickTargetText(step, originalInstruction);
  const candidates = [
    ...(Array.isArray(beforeState.buttons) ? beforeState.buttons : []).map((entry) => ({ ...entry, kind: "button" })),
    ...(Array.isArray(beforeState.interactiveElements) ? beforeState.interactiveElements : []).map((entry) => ({ ...entry, kind: entry.href ? "link" : "interactive" })),
    ...(Array.isArray(beforeState.links) ? beforeState.links : []).map((entry) => ({ ...entry, kind: "link" })),
  ];

  const executableCandidates = isButtonIntentStep(step) && !isExplicitLinkNavigationIntent(step)
    ? candidates.filter((entry) => !isPlainHrefLinkCandidate(entry))
    : candidates;

  const ranked = executableCandidates
    .map((entry) => ({
      entry,
      score:
        lightpandaClickScore(entry, targetText, executableCandidates.length) +
        buttonIntentScoreAdjustment(entry, step, beforeState.url || ""),
    }))
    .filter((item) => item.score >= 0.55)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.entry || null;
}

function supervisedScoutRepairTarget(value = "") {
  const raw = safeText(value, 240);
  const repaired = raw
    .replace(/\b(click|press|tap|select|choose|open|launch)\b/ig, " ")
    .replace(/\b(button|link|control|element|field|item|option)\b/ig, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!repaired || repaired.toLowerCase() === raw.toLowerCase()) return "";
  if (repaired.length < 3) return "";
  return repaired;
}

function shouldUsePlaywrightControlScout({ step = {}, beforeState = null, originalInstruction = "" } = {}) {
  if (!envFlag("BROWSER_AGENT_PLAYWRIGHT_CONTROL_SCOUT", true)) return false;
  if (!isButtonIntentStep(step) || isExplicitLinkNavigationIntent(step)) return false;

  const candidate = bestLightpandaClickCandidateForStep({ step, beforeState, originalInstruction });
  if (!candidate) return true;
  if (isPlainHrefLinkCandidate(candidate)) return true;

  const selector = safeText(candidate.selector || "", 500);
  const attrs = candidate.attrs && typeof candidate.attrs === "object" ? candidate.attrs : {};
  const hasControlAttrs = Boolean(
    attrs["data-bs-toggle"] ||
    attrs["data-toggle"] ||
    attrs["data-bs-target"] ||
    attrs["data-target"] ||
    attrs["aria-controls"] ||
    attrs.role === "button"
  );

  return !selector && !hasControlAttrs;
}

function controlScoutCoreText(value = "") {
  return normalizedTargetText(value)
    .replace(/\b(click|press|tap|select|choose|open)\b/g, " ")
    .replace(/\b(button|link|control|element|field|item|option)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function playwrightSnapshotRefScout({ snapshot = null, step = {}, originalInstruction = "" } = {}) {
  const raw = String(snapshot?.text || snapshot?.dom?.rawText || snapshot?.dom?.textPreview || "");
  if (!raw.trim()) return null;

  const targetText = extractClickTargetText(step, originalInstruction) || step.instruction || "";
  const wanted = normalizedTargetText(targetText);
  const wantedCore = controlScoutCoreText(targetText);

  const lines = raw.split(/\r?\n/);
  const scored = [];

  for (const line of lines) {
    const ref = String(line.match(/\[ref=([^\]]+)\]/i)?.[1] || "").trim();
    if (!ref) continue;

    const lineNorm = normalizedTargetText(line);
    const lineCore = controlScoutCoreText(line);

    const isButtonLike = /\bbutton\b/i.test(line) || /\brole=["']?button/i.test(line);
    const isPlainLink = /\blink\b/i.test(line) && !isButtonLike;

    let score = 0;
    if (wanted && lineNorm.includes(wanted)) score += 120;
    if (wantedCore && lineNorm.includes(wantedCore)) score += 110;
    if (wantedCore && lineCore.includes(wantedCore)) score += 105;
    if (isButtonLike) score += 35;
    if (isPlainLink) score -= 80;
    if (/tooltip/i.test(line)) score -= 80;

    if (score >= 120) {
      scored.push({
        ref,
        score,
        line: safeText(line, 500),
        text: safeText(targetText, 240),
        selector: "",
        source: "playwright_snapshot_ref",
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

function syntheticStepPlanFromPlaywrightScout({ scout = null, step = {}, currentUrl = "", originalInstruction = "" } = {}) {
  if (!scout || scout.ok !== true || (!scout.selector && !scout.ref)) return null;
  const requestedText = extractClickTargetText(step, originalInstruction) || step.instruction || "";
  const hasSelector = Boolean(scout.selector);
  const hasRef = Boolean(scout.ref);
  return {
    status: "ready",
    syntheticSource: "playwright_control_scout",
    command: {
      intent: "click_or_open",
      tool: "browserClickByText",
      args: {
        currentUrl,
        text: safeText(scout.text || requestedText, 240),
        selector: safeText(scout.selector || "", 500),
        ref: safeText(scout.ref || "", 180),
        selectorOnly: hasSelector,
        requireSelector: hasSelector,
        refOnly: !hasSelector && hasRef,
        requireRef: !hasSelector && hasRef,
        scout: {
          score: Number(scout.score || 0),
          targetText: safeText(scout.targetText || requestedText, 240),
          heading: safeText(scout.selected?.heading || "", 180),
          tag: safeText(scout.selected?.tag || "", 80),
          role: safeText(scout.selected?.role || "", 80),
          dataToggle: safeText(scout.selected?.dataToggle || "", 120),
          dataTarget: safeText(scout.selected?.dataTarget || "", 180),
          ariaControls: safeText(scout.selected?.ariaControls || "", 180),
        },
      },
      notes: "Playwright control scout selected concrete selector-only target: " + safeText(scout.selector || "", 500),
    },
    reason: "Playwright control scout found a concrete visible control matching the button/modal intent.",
    messageToChecker: "",
    messageToUser: "",
    confidence: 0.94,
  };
}

function playwrightScoutEvidenceCheckerForStep({ stepPlan = {}, step = {} } = {}) {
  if (!stepPlan || stepPlan.syntheticSource !== "playwright_control_scout") return null;
  if (!isButtonIntentStep(step) || isExplicitLinkNavigationIntent(step)) return null;

  const command = stepPlan.command || null;
  const selector = safeText(command?.args?.selector || "", 500);
  const ref = safeText(command?.args?.ref || "", 180);
  if (!command || command.tool !== "browserClickByText" || (!selector && !ref)) return null;

  return {
    status: "approved_playwright_scout",
    approved: true,
    command,
    reason: "Local Playwright control scout approved selector-only click on a real visible control.",
    repairInstruction: "",
    messageToUser: "",
    confidence: Math.max(0.9, Number(stepPlan.confidence || 0.9)),
  };
}

function commandWithLightpandaExecutionTarget(command = {}, { step = {}, beforeState = null, originalInstruction = "", currentUrl = "" } = {}) {
  if (!command || typeof command !== "object") return command;
  if (!isButtonIntentStep(step)) return command;

  if (
    command.args?.selectorOnly === true ||
    command.args?.requireSelector === true ||
    command.args?.refOnly === true ||
    command.args?.requireRef === true
  ) {
    return {
      ...command,
      tool: "browserClickByText",
      args: {
        ...(command.args || {}),
        currentUrl: currentUrl || command.args?.currentUrl || "",
      },
      notes: safeText([
        command.notes,
        "Preserved selector-only scout command for button/modal/collapse intent.",
      ].filter(Boolean).join(" "), 500),
    };
  }

  const requestedText = extractClickTargetText(step, originalInstruction) || step.instruction || "";
  const candidate = bestLightpandaClickCandidateForStep({ step, beforeState, originalInstruction });
  if (!candidate) {
    if (command.tool === "browserNavigate" || !isExplicitLinkNavigationIntent(step)) {
      return {
        intent: "click",
        tool: "browserClickByText",
        args: {
          currentUrl,
          text: requestedText,
        },
        notes: "Button intent forced real click by requested text; no acceptable Lightpanda candidate was available.",
      };
    }
    return command;
  }

  const href = absoluteHrefFromState(candidate.href || "", beforeState?.url || "");
  if (href && !isExplicitLinkNavigationIntent(step) && isPlainHrefLinkCandidate(candidate)) {
    return {
      intent: "click",
      tool: "browserClickByText",
      args: {
        currentUrl,
        text: requestedText,
      },
      notes: "Button intent rejected a plain href/navigation link and fell back to the requested visible control text.",
    };
  }

  if (href && candidate.kind === "link" && !isExplicitLinkNavigationIntent(step)) {
    // Control-like links with button attrs may still be clicked, but plain href links are rejected above.
    return {
      intent: "click",
      tool: "browserClickByText",
      args: {
        currentUrl,
        text: safeText(candidate.text || candidate.label || requestedText, 180),
        ref: "",
        lpRef: safeText(candidate.ref || "", 120),
        selector: safeText(candidate.selector || "", 500),
        attrs: candidate.attrs && typeof candidate.attrs === "object" ? candidate.attrs : {},
      },
      notes: "Button intent preserved as a real click using raw Lightpanda selector/text, not lp_ref.",
    };
  }

  return {
    ...command,
    intent: command.intent || "click",
    tool: "browserClickByText",
    args: {
      ...(command.args || {}),
      currentUrl: currentUrl || command.args?.currentUrl || "",
      text: safeText(candidate.text || candidate.label || command.args?.text || extractClickTargetText(step, originalInstruction), 180),
      ref: "",
      lpRef: safeText(candidate.ref || command.args?.ref || "", 120),
      selector: safeText(candidate.selector || command.args?.selector || "", 500),
      attrs: candidate.attrs && typeof candidate.attrs === "object" ? candidate.attrs : {},
    },
    notes: safeText([
      command.notes,
      `Lightpanda execution target: ${safeText(candidate.text || candidate.label || "", 180)} lpRef=${safeText(candidate.ref || "", 120)} selector=${safeText(candidate.selector || "", 220)}`,
    ].filter(Boolean).join(" "), 500),
  };
}

function lightpandaEvidenceCheckerForStep({ stepPlan = {}, beforeState = null, step = {} } = {}) {
  const command = stepPlan?.command || null;
  if (!command || typeof command !== "object") return null;

  const tool = String(command.tool || "");
  if (tool !== "browserClickByText" && tool !== "browserNavigate") return null;

  const args = command.args || {};

  if (tool === "browserNavigate") {
    const url = args.url || args.href || args.targetUrl || "";
    if (!url) return null;

    if (isButtonIntentStep(step) && !isExplicitLinkNavigationIntent(step)) {
      return {
        status: "rejected",
        approved: false,
        command: null,
        reason: "Button/modal/collapse click intent cannot be satisfied by browserNavigate. A real Playwright click is required.",
        repairInstruction: "Use browserClickByText on the actual visible button/control.",
        messageToUser: "",
        confidence: 0.9,
      };
    }

    return {
      status: "approved",
      approved: true,
      command: {
        ...command,
        args: {
          ...args,
          url,
        },
      },
      reason: "Local Lightpanda evidence checker approved safe navigation URL from the agent command.",
      repairInstruction: "",
      messageToUser: "",
      confidence: Math.max(0.86, Number(stepPlan.confidence || 0.86)),
    };
  }

  const candidate = lightpandaCandidateFromCommand(beforeState, command);
  if (!candidate) return null;

  if (
    candidate.href &&
    candidate.kind === "link" &&
    isButtonIntentStep(step) &&
    !isExplicitLinkNavigationIntent(step)
  ) {
    return null;
  }

  if (candidate.href && candidate.kind === "link") {
    return {
      status: "repaired",
      approved: true,
      command: {
        intent: "click_link_via_href",
        tool: "browserNavigate",
        args: {
          url: candidate.href,
          sourceText: safeText(candidate.text || candidate.label || args.text || "", 180),
          sourceRef: safeText(candidate.ref || args.ref || "", 120),
          sourceSelector: safeText(candidate.selector || args.selector || "", 320),
        },
        notes: `Local Lightpanda evidence checker converted selected link "${safeText(candidate.text || args.text || "", 180)}" to href ${candidate.href}.`,
      },
      reason: `AI selected Lightpanda ${candidate.matchedBy} ${safeText(candidate.ref || candidate.text || "", 180)}; local evidence checker verified href ${candidate.href}.`,
      repairInstruction: "",
      messageToUser: "",
      confidence: Math.max(0.9, Number(stepPlan.confidence || 0.9)),
    };
  }

  return {
    status: "approved",
    approved: true,
    command,
    reason: "Local Lightpanda evidence checker approved selected DOM candidate.",
    repairInstruction: "",
    messageToUser: "",
    confidence: Math.max(0.86, Number(stepPlan.confidence || 0.86)),
  };
}


function isLowRiskAutoCheckCommand(command = {}, step = {}) {
  const tool = String(command?.tool || "");
  const text = String(step?.instruction || "");
  if (/\b(submit|pay|payment|delete|remove|approve|reject|password|otp|login|sign in|checkout)\b/i.test(text)) return false;
  if (isButtonIntentStep(step) && tool === "browserNavigate") return false;
  return ["browserNavigate", "browserObserve", "browserStatus", "browserShowActions"].includes(tool);
}

function syntheticApprovedChecker(stepPlan = {}) {
  return {
    status: "approved",
    approved: true,
    command: stepPlan.command || null,
    reason: "Low-risk browser command auto-approved to avoid redundant checker call.",
    repairInstruction: "",
    messageToUser: "",
    confidence: Number(stepPlan.confidence || 0.9),
  };
}


function strictSnapshotLineForRef(snapshot = null, ref = "") {
  const raw = String(snapshot?.text || snapshot?.dom?.rawText || snapshot?.dom?.textPreview || "");
  if (!raw || !ref) return "";
  const needle = "[ref=" + ref + "]";
  return raw.split(/\r?\n/).find((line) => String(line || "").includes(needle)) || "";
}

function strictVisibleTextFromSnapshotLine(line = "") {
  const quoted = String(line || "").match(/"([^"]+)"/);
  if (quoted?.[1]) return safeText(quoted[1], 240);
  return safeText(String(line || "").replace(/\[ref=[^\]]+\]/g, "").replace(/^[-\s]+/, ""), 240);
}

function strictSnapshotClickApproval({ command = {}, before = null } = {}) {
  const args = command.args || {};
  const ref = safeText(args.ref || args.selector || "", 180);
  const text = safeText(args.text || args.label || args.buttonText || "", 240);

  if (!ref || !text) {
    return {
      ok: false,
      reason: "Click fallback blocked: command needs both snapshot ref and visible text.",
    };
  }

  const line = strictSnapshotLineForRef(before?.snapshot || null, ref);
  if (!line) {
    return {
      ok: false,
      reason: "Click fallback blocked: ref was not found in the current snapshot.",
    };
  }

  if (!/\b(link|button|menuitem|option|checkbox|radio|tab)\b/i.test(line)) {
    return {
      ok: false,
      reason: "Click fallback blocked: ref exists but is not clearly clickable in the snapshot.",
    };
  }

  const visible = strictVisibleTextFromSnapshotLine(line);
  if (!visible || visible.toLowerCase() !== text.toLowerCase()) {
    return {
      ok: false,
      reason: "Click fallback blocked: command text does not exactly match snapshot visible text.",
      visible,
      requested: text,
    };
  }

  return {
    ok: true,
    visible,
    line: safeText(line, 500),
  };
}


function checkerFallbackAfterModelError({ checkerCall = null } = {}) {
  if (!checkerCall || checkerCall.ok !== false) return null;

  const error = String(checkerCall.error || "");
  if (!/invalid JSON|BROWSER_AGENT_LLM_INVALID_JSON/i.test(error)) return null;

  return {
    status: "blocked_checker_invalid_json",
    approved: false,
    command: null,
    reason: "Checker returned invalid JSON. Browser action blocked so the agent does not click without valid checker approval.",
    repairInstruction: "Retry the checker or ask the step agent to produce a simpler command.",
    messageToUser: "",
    confidence: 0.2,
  };
}

function isInvalidJsonCheckerError(callResult = null) {
  return Boolean(
    callResult &&
    callResult.ok === false &&
    /invalid JSON|BROWSER_AGENT_LLM_INVALID_JSON/i.test(String(callResult.error || ""))
  );
}

function syntheticPassedResult({ execution = {}, step = {}, command = {} } = {}) {
  const observation = observationFromExecution(execution);
  const where = [observation.title, observation.url].filter(Boolean).join(" — ");
  return {
    status: "passed",
    success: execution?.ok === true,
    summary: execution?.ok === true
      ? `Low-risk step passed. ${where}`.trim()
      : execution?.error || "Low-risk step failed.",
    evidence: where || execution?.actionResult?.text || "",
    repairInstruction: "",
    messageToUser: "",
    confidence: execution?.ok === true ? 0.95 : 0.4,
    command,
    step,
  };
}

function isSensitiveStep(step = {}) {
  return /\b(submit|pay|payment|delete|remove|approve|reject|password|otp|login|sign in|checkout|profile update|attendance|payroll)\b/i
    .test(String(step?.instruction || ""));
}

function isVisualStep(step = {}) {
  return /\b(visual|visually|screenshot|screen|image|picture|photo|see|look|appearance|layout|color|canvas|chart|graph|map|modal|popup|captcha|qr)\b/i
    .test(String(step?.instruction || ""));
}

function shouldCapturePlaywrightBeforeSnapshot({ step = {}, beforeState = null } = {}) {
  const policy = String(process.env.BROWSER_AGENT_BEFORE_SNAPSHOT_POLICY || "on_demand").trim().toLowerCase();

  if (policy === "always") return true;
  if (policy === "never") return false;
  if (envFlag("BROWSER_AGENT_FORCE_PLAYWRIGHT_BEFORE_SNAPSHOT", false)) return true;

  if (!beforeState || beforeState.ok !== true) return true;
  if (isSensitiveStep(step)) return true;
  if (isVisualStep(step)) return true;
  if (isButtonIntentStep(step)) return true;

  // Fast snapshot checker depends on Playwright MCP snapshot refs.
  if (envFlag("BROWSER_AGENT_FAST_SNAPSHOT_CHECKER", false)) return true;

  return false;
}

function snapshotTextForFastChecker(snapshot = null) {
  return String(snapshot?.text || snapshot?.dom?.rawText || snapshot?.dom?.textPreview || "");
}

function snapshotLineForRef(snapshot = null, ref = "") {
  const raw = snapshotTextForFastChecker(snapshot);
  if (!raw || !ref) return "";
  const needle = "[ref=" + ref + "]";
  return raw.split(/\r?\n/).find((line) => String(line || "").includes(needle)) || "";
}

function visibleTextFromSnapshotLine(line = "") {
  const quoted = String(line || "").match(/"([^"]+)"/);
  if (quoted?.[1]) return safeText(quoted[1], 240);
  return safeText(String(line || "").replace(/\[ref=[^\]]+\]/g, "").replace(/^[-\s]+/, ""), 240);
}

function fastSnapshotCheckerForStep({ stepPlan = {}, step = {}, before = null } = {}) {
  if (!envFlag("BROWSER_AGENT_FAST_SNAPSHOT_CHECKER", false)) return null;
  if (isSensitiveStep(step)) return null;

  const command = stepPlan?.command || null;
  if (!command || typeof command !== "object") return null;

  const tool = String(command.tool || "");
  if (tool !== "browserClickByText") return null;

  const snapshot = before?.snapshot || null;
  const raw = snapshotTextForFastChecker(snapshot);
  if (!raw.trim()) return null;

  const args = command.args || {};
  const ref = safeText(args.ref || args.selector || "", 180);
  const text = safeText(args.text || args.label || args.buttonText || "", 240);
  if (!ref && !text) return null;

  let visible = "";
  let status = "auto_approved_snapshot_crosscheck";
  let reason = "Snapshot checker confirmed the non-sensitive click target before model checker was needed.";

  if (ref) {
    const line = snapshotLineForRef(snapshot, ref);
    if (!line) return null;
    visible = visibleTextFromSnapshotLine(line);
  } else if (text && raw.toLowerCase().includes(text.toLowerCase())) {
    visible = text;
  } else {
    return null;
  }

  const nextArgs = { ...args };
  if (visible) nextArgs.text = visible;

  if (visible && text && visible.toLowerCase() !== text.toLowerCase()) {
    status = "auto_repaired_snapshot_crosscheck";
    reason = "Snapshot checker replaced the command text with the visible page text for the same target/ref.";
  }

  return {
    status,
    approved: true,
    command: {
      ...command,
      args: nextArgs,
      notes: safeText([
        command.notes,
        visible ? "Snapshot-confirmed visible target: " + visible : "",
      ].filter(Boolean).join(" "), 500),
    },
    reason,
    repairInstruction: "",
    messageToUser: "",
    confidence: Math.max(0.85, Number(stepPlan.confidence || 0.85)),
  };
}

function expectedUiKindForStep(step = {}, command = {}) {
  const haystack = [
    step.instruction,
    step.successCriteria,
    step.expectedAction,
    command?.intent,
    command?.notes,
    command?.args?.text,
    command?.args?.scout?.targetText,
    command?.args?.scout?.dataToggle,
    command?.args?.scout?.dataTarget,
    command?.args?.scout?.ariaControls,
  ].map((item) => String(item || "")).join(" ").toLowerCase();

  if (/\b(close|closed|dismiss|cancel|hide|hidden|not visible|not open)\b/.test(haystack) || /\b(no element|same toggle again)\b/.test(haystack)) {
    return "";
  }

  if (/\b(modal|dialog|popup)\b/.test(haystack)) return "modal";
  if (/\b(dropdown|menu)\b/.test(haystack)) return "dropdown";
  if (/\b(collapse|accordion|expand)\b/.test(haystack)) return "collapse";
  return "";
}

async function deterministicUiStateResultCheck({ step = {}, command = {}, execution = null, currentUrl = "", currentState = {} } = {}) {
  if (!execution || execution.ok !== true) return null;

  const kind = expectedUiKindForStep(step, command);
  if (!kind) return null;

  const uiState = await probePlaywrightUiState({
    currentUrl: execution.observation?.url || currentUrl || "",
    navigate: false,
  }, currentState).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  }));

  const success =
    (kind === "modal" && (uiState.modalOpen || uiState.dialogOpen)) ||
    (kind === "dropdown" && uiState.dropdownOpen) ||
    (kind === "collapse" && uiState.collapseOpen);

  if (!success) return null;

  return {
    status: "passed",
    success: true,
    summary: `Detected opened ${kind} UI after the click.`,
    evidence: safeText(JSON.stringify({
      modalOpen: uiState.modalOpen,
      dialogOpen: uiState.dialogOpen,
      dropdownOpen: uiState.dropdownOpen,
      collapseOpen: uiState.collapseOpen,
      dialogs: Array.isArray(uiState.dialogs) ? uiState.dialogs.slice(0, 2) : [],
      modalBackdrops: Array.isArray(uiState.modalBackdrops) ? uiState.modalBackdrops.slice(0, 2) : [],
      dropdowns: Array.isArray(uiState.dropdowns) ? uiState.dropdowns.slice(0, 2) : [],
      collapses: Array.isArray(uiState.collapses) ? uiState.collapses.slice(0, 2) : [],
    }), 1400),
    repairInstruction: "",
    messageToUser: "",
    confidence: 0.96,
    deterministic: true,
    uiKind: kind,
    uiState,
  };
}

function activeWatcherHardTextV4(step = {}) {
  return [
    step.instruction,
    step.successCriteria,
    step.expectedAction,
  ].map((value) => String(value || "")).join(" ").toLowerCase();
}

function activeWatcherReadOnlyInspectionStepV5(step = {}) {
  if (isNavigationStep(step)) return false;

  const action = String(step.expectedAction || "").toLowerCase();
  const instruction = String(step.instruction || "").toLowerCase();
  const criteria = String(step.successCriteria || "").toLowerCase();
  const text = [instruction, criteria, action].join(" ");

  const isObserveOrReport = action === "observe" || action === "report";
  const asksToRead =
    /\b(inspect|report|list|show|summarize|read|describe|extract|find)\b/.test(instruction);

  const asksForPageData =
    /\b(title|control|controls|button|buttons|demo button|link|links|content|sentence|text|page|body text|first visible|first two|first three)\b/.test(text);

  const explicitLiveVerify =
    /\b(verify|check|confirm)\b/.test(instruction) &&
    /\b(opened|open|closed|close|hidden|shown|visible|not visible|not open|expanded|collapsed)\b/.test(text);

  return (isObserveOrReport || asksToRead) && asksForPageData && !explicitLiveVerify;
}

function activeWatcherReadOnlyInspectionStepV6(step = {}) {
  if (isNavigationStep(step)) return false;

  const action = String(step.expectedAction || "").toLowerCase();
  const instruction = String(step.instruction || "").toLowerCase();
  const criteria = String(step.successCriteria || "").toLowerCase();
  const text = [instruction, criteria, action].join(" ");

  const readLike =
    action === "observe" ||
    action === "report" ||
    /\b(inspect|report|find|show|list|read|describe|extract)\b/.test(instruction);

  const asksForData =
    /\b(title|control|controls|button|buttons|demo button|link|links|content|sentence|text|body|body text|page|first visible|first two|first three)\b/.test(text);

  const explicitVerify =
    /\b(verify|check|confirm)\b/.test(instruction) &&
    /\b(opened|open|closed|close|hidden|shown|not visible|not open|expanded|collapsed)\b/.test(text);

  return readLike && asksForData && !explicitVerify;
}

function activeWatcherHardVerifyKindV4(step = {}) {
  if (isNavigationStep(step)) return null;

  // Read-only discovery/report steps must stay in Lightpanda/reporting.
  // Watcher only owns explicit live UI state verification.
  if (activeWatcherReadOnlyInspectionStepV6(step)) return null;

  // Read-only scrape/report/list/find steps belong to Lightpanda/normal observe.
  // Watcher should only consume explicit live UI state verification.
  if (activeWatcherReadOnlyInspectionStepV5(step)) return null;

  const action = String(step.expectedAction || "").toLowerCase();
  const instruction = String(step.instruction || "").toLowerCase();
  const criteria = String(step.successCriteria || "").toLowerCase();
  const text = [instruction, criteria].join(" ");

  const isVerifyLike =
    action === "observe" ||
    action === "report" ||
    /\b(verify|check|confirm)\b/.test(instruction);

  if (!isVerifyLike) return null;

  let uiKind = "";
  if (/\b(modal|dialog|popup|overlay)\b/.test(text)) uiKind = "modal";
  else if (/\b(dropdown|menu)\b/.test(text)) uiKind = "dropdown";
  else if (/\b(offcanvas|drawer|panel)\b/.test(text)) uiKind = "offcanvas";
  else if (/\b(collapse|accordion)\b/.test(text)) uiKind = "collapse";

  if (!uiKind) return null;

  if (/\b(closed|close|dismissed|gone|hidden|not visible|not open|does not contain|no element|collapsed)\b/.test(text)) {
    return { uiKind, expected: "closed" };
  }

  if (/\b(opened|open|visible|shown|appeared|contains|expanded)\b/.test(text)) {
    return { uiKind, expected: "opened" };
  }

  return null;
}


function activeWatcherCollapseToggleAgainStepV4(step = {}) {
  if (isNavigationStep(step)) return false;

  const text = activeWatcherHardTextV4(step);

  return /\b(collapse|accordion|toggle)\b/.test(text) &&
    (
      /\b(same toggle again|toggle again|click .*again|again)\b/.test(text) ||
      /\b(close|closed|hide|hidden|not visible|not open|no element|collapsed)\b/.test(text)
    );
}

function activeWatcherHardCloseStepV4(step = {}) {
  if (isNavigationStep(step)) return false;

  const text = activeWatcherHardTextV4(step);

  return /\b(close|dismiss|cancel|exit|hide|x|esc|escape)\b/.test(text) &&
    !/\b(save|submit|confirm|apply|ok|login|delete|purchase|pay)\b/.test(text);
}

function activeWatcherUiOpenStateV4(uiState = {}, uiKind = "") {
  if (uiKind === "modal") return Boolean(uiState.modalOpen || uiState.dialogOpen || uiState.blockingOpen);
  if (uiKind === "dropdown") return Boolean(uiState.dropdownOpen);
  if (uiKind === "offcanvas") return Boolean(uiState.offcanvasOpen || uiState.blockingOpen);
  if (uiKind === "collapse") return Boolean(uiState.collapseOpen);
  return Boolean(uiState.blockingOpen);
}


function activeWatcherLiveUiReportStepV10(step = {}) {
  if (isNavigationStep(step)) return null;

  const action = String(step.expectedAction || "").toLowerCase();
  const instruction = String(step.instruction || "").toLowerCase();
  const criteria = String(step.successCriteria || "").toLowerCase();
  const text = [instruction, criteria, action].join(" ");

  const readLike =
    action === "observe" ||
    action === "report" ||
    /\b(inspect|report|read|describe|extract|show)\b/.test(instruction);

  if (!readLike) return null;

  if (/\bmodal\b/.test(text) && /\b(title|body|body text|content|text)\b/.test(text)) {
    return { uiKind: "modal" };
  }

  if (/\bcollapse\b/.test(text) && /\b(sentence|content|text|body)\b/.test(text)) {
    return { uiKind: "collapse" };
  }

  return null;
}

function activeWatcherSentenceFromTextV10(value = "") {
  const clean = safeText(value || "", 1200)
    .replace(/\b(Close|Save changes)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "";
  return clean.match(/[^.?!]{8,260}[.?!]/)?.[0]?.trim() || clean.slice(0, 260);
}

function activeWatcherModalReportSummaryV10(uiState = {}) {
  const dialog = Array.isArray(uiState.dialogs) ? uiState.dialogs[0] : null;
  const raw = safeText(dialog?.text || "", 1200).replace(/\s+/g, " ").trim();

  if (!raw) return "Modal content: not found in live UI state.";

  const titleMatch = raw.match(/^(.*?)(?=\s+Woo-hoo|\s+Close|\s+Save changes|$)/i);
  const title = safeText(titleMatch?.[1] || "Modal", 180).trim();
  const withoutTitle = title ? raw.replace(title, " ") : raw;
  const body = activeWatcherSentenceFromTextV10(withoutTitle);

  return [
    title ? `Modal title: ${title}` : "",
    body ? `Modal body: ${body}` : "",
  ].filter(Boolean).join(" — ") || `Modal content: ${raw}`;
}

function activeWatcherCollapseReportSummaryV10(uiState = {}) {
  const collapse = Array.isArray(uiState.collapses) ? uiState.collapses[0] : null;
  const sentence = activeWatcherSentenceFromTextV10(collapse?.text || "");
  return sentence
    ? `First sentence: ${sentence}`
    : "First sentence: not found in live collapse UI state.";
}

async function activeWatcherReportLiveUiContentV10({ step = {}, stepNumber = 0, currentUrl = "", currentTitle = "", currentState = {}, trace = [] } = {}) {
  const report = activeWatcherLiveUiReportStepV10(step);
  if (!report) return null;

  const uiState = await probePlaywrightUiState({
    currentUrl,
    navigate: false,
  }, currentState).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  }));

  const modalOpen = Boolean(uiState.modalOpen || uiState.dialogOpen);
  const collapseOpen = Boolean(uiState.collapseOpen);

  if (report.uiKind === "modal" && !modalOpen) return null;
  if (report.uiKind === "collapse" && !collapseOpen) return null;

  const summary = report.uiKind === "modal"
    ? activeWatcherModalReportSummaryV10(uiState)
    : activeWatcherCollapseReportSummaryV10(uiState);

  trace.push(traceEntry({
    role: "watcher",
    title: "Active watcher live UI report",
    step: stepNumber,
    status: "reported_live_ui_content",
    input: step,
    output: {
      uiKind: report.uiKind,
      modalOpen,
      collapseOpen,
      dialogs: Array.isArray(uiState.dialogs) ? uiState.dialogs.slice(0, 1) : [],
      collapses: Array.isArray(uiState.collapses) ? uiState.collapses.slice(0, 1) : [],
      error: uiState.error || "",
    },
    summary,
    tool: "browserObserve",
    ok: true,
  }));

  return {
    handled: true,
    stepResult: {
      stepNumber,
      step,
      ok: true,
      repaired: false,
      status: "passed",
      summary,
      url: uiState.url || currentUrl,
      title: uiState.title || currentTitle,
      command: {
        intent: "report_live_ui_content",
        tool: "browserObserve",
        args: {
          currentUrl,
          uiKind: report.uiKind,
          navigate: false,
        },
        notes: "Active watcher reported currently open UI content from live Playwright state instead of Lightpanda page scrape.",
      },
      finalObservation: {
        url: uiState.url || currentUrl,
        title: uiState.title || currentTitle,
        textPreview: summary,
        uiState,
      },
    },
    finalObservation: {
      url: uiState.url || currentUrl,
      title: uiState.title || currentTitle,
      textPreview: summary,
      uiState,
    },
  };
}


async function activeWatcherHardUiStepV4({ step = {}, stepNumber = 0, currentUrl = "", currentTitle = "", currentState = {}, trace = [] } = {}) {
  if (isNavigationStep(step)) return null;

  const liveUiReportV10 = await activeWatcherReportLiveUiContentV10({
    step,
    stepNumber,
    currentUrl,
    currentTitle,
    currentState,
    trace,
  });

  if (liveUiReportV10?.handled) {
    return liveUiReportV10;
  }

  const verify = activeWatcherHardVerifyKindV4(step);

  if (verify) {
    const uiState = await probePlaywrightUiState({
      currentUrl,
      navigate: false,
    }, currentState).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }));

    const open = activeWatcherUiOpenStateV4(uiState, verify.uiKind);
    const passed = verify.expected === "opened" ? open : !open;

    const summary = passed
      ? `Active watcher verified ${verify.uiKind} ${verify.expected} using live Playwright UI state.`
      : `Active watcher could not verify ${verify.uiKind} ${verify.expected}; live state says open=${open}.`;

    trace.push(traceEntry({
      role: "watcher",
      title: "Active watcher hard UI step",
      step: stepNumber,
      status: passed ? "passed_ui_state" : "failed_ui_state",
      input: step,
      output: {
        expected: verify.expected,
        uiKind: verify.uiKind,
        modalOpen: Boolean(uiState.modalOpen),
        dialogOpen: Boolean(uiState.dialogOpen),
        dropdownOpen: Boolean(uiState.dropdownOpen),
        offcanvasOpen: Boolean(uiState.offcanvasOpen),
        collapseOpen: Boolean(uiState.collapseOpen),
        blockingOpen: Boolean(uiState.blockingOpen),
        dialogs: Array.isArray(uiState.dialogs) ? uiState.dialogs.slice(0, 2) : [],
        error: uiState.error || "",
      },
      summary,
      tool: "browserObserve",
      ok: passed,
    }));

    return {
      handled: true,
      stepResult: {
        stepNumber,
        step,
        ok: passed,
        repaired: false,
        status: passed ? "passed" : "failed",
        summary,
        url: uiState.url || currentUrl,
        title: uiState.title || currentTitle,
        command: {
          intent: "verify_live_ui_state",
          tool: "browserObserve",
          args: {
            currentUrl,
            uiKind: verify.uiKind,
            expected: verify.expected,
            navigate: false,
          },
          notes: "Active watcher consumed this UI verification step before Lightpanda/LLM could disturb live UI.",
        },
        finalObservation: {
          url: uiState.url || currentUrl,
          title: uiState.title || currentTitle,
          textPreview: summary,
          uiState,
        },
      },
      finalObservation: {
        url: uiState.url || currentUrl,
        title: uiState.title || currentTitle,
        textPreview: summary,
        uiState,
      },
    };
  }

  if (activeWatcherCollapseToggleAgainStepV4(step)) {
    const before = await probePlaywrightUiState({
      currentUrl,
      navigate: false,
    }, currentState).catch(() => null);

    if (before?.collapseOpen) {
      const toggled = await togglePlaywrightOpenCollapse({
        currentUrl,
        navigate: false,
      }, currentState).catch((err) => ({
        ok: false,
        toggled: false,
        method: "error",
        error: err instanceof Error ? err.message : String(err),
      }));

      const after = await probePlaywrightUiState({
        currentUrl,
        navigate: false,
      }, currentState).catch(() => null);

      const passed = toggled?.ok === true && !after?.collapseOpen;
      const summary = passed
        ? `Active watcher closed the current collapse using ${toggled.method || "collapse toggle"}.`
        : "Active watcher clicked the current collapse toggle again, but the collapse remained open.";

      trace.push(traceEntry({
        role: "watcher",
        title: "Active watcher hard UI step",
        step: stepNumber,
        status: passed ? "closed_collapse_ui" : "failed_to_close_collapse_ui",
        input: step,
        output: {
          toggled,
          before,
          after,
          openAfter: Boolean(after?.collapseOpen),
        },
        summary,
        tool: "browserObserve",
        ok: passed,
      }));

      return {
        handled: true,
        stepResult: {
          stepNumber,
          step,
          ok: passed,
          repaired: false,
          status: passed ? "passed" : "failed",
          summary,
          url: after?.url || currentUrl,
          title: after?.title || currentTitle,
          command: {
            intent: "close_active_collapse_ui",
            tool: "browserObserve",
            args: {
              currentUrl,
              method: toggled?.method || "",
            },
            notes: "Active watcher consumed a same-toggle-again collapse step against live UI before Step Agent/Lightpanda could misroute it.",
          },
        },
        finalObservation: {
          url: after?.url || currentUrl,
          title: after?.title || currentTitle,
          textPreview: summary,
          uiState: after,
        },
      };
    }
  }

  if (activeWatcherHardCloseStepV4(step)) {
    const before = await probePlaywrightUiState({
      currentUrl,
      navigate: false,
    }, currentState).catch(() => null);

    const openBefore = Boolean(
      before?.modalOpen ||
      before?.dialogOpen ||
      before?.blockingOpen ||
      before?.dropdownOpen ||
      before?.offcanvasOpen ||
      before?.popoverOpen
    );

    if (!openBefore) {
      const summary = "No active blocking UI was open; close/dismiss step treated as already clear.";

      trace.push(traceEntry({
        role: "watcher",
        title: "Active watcher hard UI step",
        step: stepNumber,
        status: "already_clear",
        input: step,
        output: { openBefore: false },
        summary,
        tool: "browserObserve",
        ok: true,
      }));

      return {
        handled: true,
        stepResult: {
          stepNumber,
          step,
          ok: true,
          repaired: false,
          status: "passed",
          summary,
          url: currentUrl,
          title: currentTitle,
          command: {
            intent: "close_active_blocking_ui",
            tool: "browserObserve",
            args: { currentUrl, method: "already_clear" },
            notes: "Active watcher prevented generic close from becoming a page/global link click.",
          },
        },
        finalObservation: {
          url: currentUrl,
          title: currentTitle,
          textPreview: summary,
        },
      };
    }

    const dismissed = await dismissPlaywrightBlockingUi({
      currentUrl,
      navigate: false,
    }, currentState).catch((err) => ({
      ok: false,
      dismissed: false,
      method: "error",
      error: err instanceof Error ? err.message : String(err),
    }));

    const after = await probePlaywrightUiState({
      currentUrl,
      navigate: false,
    }, currentState).catch(() => null);

    const openAfter = Boolean(
      after?.modalOpen ||
      after?.dialogOpen ||
      after?.blockingOpen ||
      after?.dropdownOpen ||
      after?.offcanvasOpen ||
      after?.popoverOpen
    );

    const passed = dismissed?.ok === true && !openAfter;
    const summary = passed
      ? `Active watcher closed the current blocking UI using ${dismissed.method || "dismiss"}.`
      : "Active watcher tried to close the current blocking UI but it remained open.";

    trace.push(traceEntry({
      role: "watcher",
      title: "Active watcher hard UI step",
      step: stepNumber,
      status: passed ? "closed_blocking_ui" : "failed_to_close_blocking_ui",
      input: step,
      output: {
        dismissed,
        openBefore,
        openAfter,
        after,
      },
      summary,
      tool: "browserObserve",
      ok: passed,
    }));

    return {
      handled: true,
      stepResult: {
        stepNumber,
        step,
        ok: passed,
        repaired: false,
        status: passed ? "passed" : "failed",
        summary,
        url: after?.url || currentUrl,
        title: after?.title || currentTitle,
        command: {
          intent: "close_active_blocking_ui",
          tool: "browserObserve",
          args: {
            currentUrl,
            method: dismissed?.method || "",
          },
          notes: "Active watcher consumed this generic close step against live UI before Step Agent/Lightpanda could misroute it.",
        },
      },
      finalObservation: {
        url: after?.url || currentUrl,
        title: after?.title || currentTitle,
        textPreview: summary,
        uiState: after,
      },
    };
  }

  return null;
}


function isSnapshotResultAutoPassCommand(command = {}, step = {}, execution = {}) {
  const tool = String(command?.tool || "");
  if (isSensitiveStep(step)) return false;
  if (isButtonIntentStep(step)) return false;
  if (execution?.ok !== true) return false;
  if (execution?.error) return false;
  if (/###\\s*Error|invalid_type|expected .* received/i.test(String(execution?.actionResult?.text || ""))) return false;

  const observation = observationFromExecution(execution);
  const hasSnapshotEvidence = Boolean(observation?.url || observation?.title || observation?.textPreview);

  if (["browserNavigate", "browserObserve", "browserStatus", "browserShowActions"].includes(tool)) {
    return hasSnapshotEvidence;
  }

  if (tool === "browserClickByText") {
    const beforeUrl = String(command?.args?.currentUrl || "");
    const afterUrl = String(observation?.url || "");
    return hasSnapshotEvidence && Boolean(afterUrl && beforeUrl && afterUrl !== beforeUrl);
  }

  return false;
}

function extractHttpUrl(text = "") {
  const raw = String(text || "");
  const match = raw.match(/https?:\/\/[^\s"'<>)}\]]+/i)?.[0] || "";
  return match.replace(/[.,;:!?]+$/g, "");
}

function syntheticStepPlanForLowRisk(step = {}, currentUrl = "", originalInstruction = "") {
  const action = String(step.expectedAction || "").toLowerCase();
  const instruction = String(step.instruction || "");

  if (action === "navigate" || /\b(open|navigate|visit|go to)\b/i.test(instruction)) {
    const url = extractHttpUrl(instruction) || extractHttpUrl(originalInstruction);
    if (url) {
      return {
        status: "ready",
        command: {
          intent: "navigate",
          tool: "browserNavigate",
          args: { url },
          notes: "Synthetic low-risk navigation command from orchestrator step.",
        },
        reason: "Navigation step can be executed directly without another model call.",
        messageToChecker: "",
        messageToUser: "",
        confidence: 1,
      };
    }
  }

  if (action === "observe" || /\b(verify|confirm|observe|inspect|check|look)\b/i.test(instruction)) {
    return {
      status: "ready",
      command: {
        intent: "observe",
        tool: "browserObserve",
        args: { currentUrl, focus: "page" },
        notes: "Synthetic low-risk observation command from orchestrator step.",
      },
      reason: "Observation step can be executed directly without another model call.",
      messageToChecker: "",
      messageToUser: "",
      confidence: 1,
    };
  }

  return null;
}

function stageLog(stage = "", data = {}) {
  if (!["1", "true", "yes", "on"].includes(String(process.env.BROWSER_AGENT_TRACE_STDOUT || "").toLowerCase())) return;
  const safe = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (typeof value === "string") safe[key] = value.slice(0, 600);
    else safe[key] = value;
  }
  console.log("[browser-orchestrator]", stage, JSON.stringify(safe));
}

function compactState(state = {}) {
  const observation = state.lastValidObservation || state.lastObservation || null;
  return {
    sessionId: state.sessionId || "",
    currentUrl: state.currentUrl || observation?.url || "",
    currentTitle: state.currentTitle || observation?.title || "",
    lastObservation: observation
      ? {
          url: observation.url || "",
          title: observation.title || "",
          textPreview: safeText(observation.textPreview || observation.text || "", 1800),
        }
      : null,
  };
}

function observationFromPageState(pageState = null) {
  if (!pageState || pageState.ok !== true) return null;
  return {
    ok: true,
    url: pageState.url || "",
    title: pageState.title || "",
    text: pageState.text || pageState.textPreview || "",
    textPreview: pageState.textPreview || pageState.text || "",
    markdown: pageState.markdown || "",
    links: Array.isArray(pageState.links) ? pageState.links : [],
    buttons: Array.isArray(pageState.buttons) ? pageState.buttons : [],
    inputs: Array.isArray(pageState.inputs) ? pageState.inputs : [],
    forms: Array.isArray(pageState.forms) ? pageState.forms : [],
    interactiveElements: Array.isArray(pageState.interactiveElements) ? pageState.interactiveElements : [],
    stats: pageState.stats || {},
    engine: pageState.engine || "lightpanda_cdp",
    source: pageState.source || "lightpanda_read_only",
    extractionPath: pageState.extractionPath || "",
    extractionSources: Array.isArray(pageState.extractionSources) ? pageState.extractionSources : [],
    extractionCapabilities: pageState.extractionCapabilities || {},
  };
}


function stepReportTextV5(step = {}, originalInstruction = "") {
  // Use only the current step for detailed read-only reporting.
  // Do not include the full original instruction, otherwise every step
  // inherits every report request.
  return [
    step.instruction,
    step.successCriteria,
    step.expectedAction,
  ].map((value) => String(value || "")).join(" ").toLowerCase();
}

function observationItemLabelV5(item = {}) {
  return safeText(
    item.text ||
    item.label ||
    item.name ||
    item.title ||
    item.ariaLabel ||
    item.alt ||
    item.value ||
    item.selector ||
    item.href ||
    "",
    180
  ).replace(/\s+/g, " ").trim();
}

function uniqueNonEmptyV5(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const clean = safeText(value || "", 220).replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }

  return result;
}

function observationControlsForReportV5(observation = {}, step = {}, limit = 3) {
  const text = stepReportTextV5(step);
  const wantsCollapse = /\b(collapse|accordion)\b/.test(text);
  const wantsDropdown = /\b(dropdown|menu)\b/.test(text);
  const wantsModal = /\b(modal|dialog|popup)\b/.test(text);
  const wantsOffcanvas = /\b(offcanvas|drawer|panel)\b/.test(text);

  const items = [
    ...(Array.isArray(observation.buttons) ? observation.buttons : []),
    ...(Array.isArray(observation.interactiveElements) ? observation.interactiveElements : []),
    ...(Array.isArray(observation.links) ? observation.links : []),
  ];

  const scored = items.map((item) => {
    const label = observationItemLabelV5(item);
    const haystack = [
      label,
      item.selector,
      item.role,
      item.type,
      item.href,
      item.id,
      item.className,
      item.attrs ? JSON.stringify(item.attrs) : "",
    ].map((value) => String(value || "")).join(" ").toLowerCase();

    let score = 0;
    if (label) score += 20;
    if (/\bbutton\b/.test(haystack) || item.role === "button") score += 25;

    if (wantsCollapse && /\b(collapse|toggle|accordion|expanded|aria-controls|data-bs-toggle|data-toggle)\b/.test(haystack)) score += 90;
    if (wantsDropdown && /\b(dropdown|menu|data-bs-toggle|data-toggle)\b/.test(haystack)) score += 90;
    if (wantsModal && /\b(modal|dialog|launch|data-bs-target|data-target)\b/.test(haystack)) score += 90;
    if (wantsOffcanvas && /\b(offcanvas|drawer|data-bs-target|data-target)\b/.test(haystack)) score += 90;

    const lowerLabel = String(label || "").toLowerCase();
    if (/^link with href$/.test(lowerLabel)) score -= 120;
    if (/browse .*docs navigation/.test(lowerLabel)) score -= 120;
    if (lowerLabel === "bootstrap") score -= 100;
    if (!label.trim()) score -= 120;

    return { label, score, haystack };
  }).filter((item) => item.label);

  scored.sort((a, b) => b.score - a.score);

  const useful = scored
    .filter((item) => {
      if (item.score < 30) return false;

      const label = String(item.label || "").toLowerCase();
      const haystack = String(item.haystack || "").toLowerCase();

      if (/^link with href$/.test(label)) return false;
      if (/browse .*docs navigation/.test(label)) return false;
      if (label === "bootstrap") return false;

      if (wantsCollapse) {
        return /\btoggle\b|\bcollapse\b|\baccordion\b/.test(label) ||
          /data-bs-toggle|data-toggle|aria-controls|collapse/.test(haystack);
      }

      if (wantsDropdown) {
        return /\bdropdown\b|\bmenu\b/.test(label) ||
          /dropdown|data-bs-toggle|data-toggle/.test(haystack);
      }

      if (wantsModal) {
        return /\bmodal\b|\bdialog\b|\blaunch\b/.test(label) ||
          /modal|dialog|data-bs-target|data-target/.test(haystack);
      }

      if (wantsOffcanvas) {
        return /\boffcanvas\b|\bdrawer\b|\bpanel\b/.test(label) ||
          /offcanvas|data-bs-target|data-target/.test(haystack);
      }

      return true;
    })
    .map((item) => item.label);

  return uniqueNonEmptyV5(useful).slice(0, limit);
}

function observationFirstSentenceForReportV5(observation = {}) {
  const raw = [
    observation.text,
    observation.textPreview,
    observation.markdown,
  ].map((value) => String(value || "")).join("\n");

  const clean = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "";

  const preferred = clean.match(/Some placeholder content[^.?!]*[.?!]/i)?.[0];
  if (preferred) return safeText(preferred, 280);

  const sentence = clean.match(/[^.?!]{20,280}[.?!]/)?.[0] || "";
  return safeText(sentence.trim(), 280);
}

function detailedStepReportSummaryFromObservation(observation = {}, step = {}, originalInstruction = "") {
  const base = detailedReportSummaryFromObservation(observation, step, originalInstruction);
  const text = stepReportTextV5(step, originalInstruction);
  const parts = [base];

  if (/\b(first three|visible .*controls|controls|buttons)\b/.test(text)) {
    const controls = observationControlsForReportV5(observation, step, 3);
    if (controls.length) {
      parts.push("Controls: " + controls.join(" | "));
    } else {
      parts.push("Controls: not found in current observation");
    }
  }

  if (/\b(first sentence|opened .*content|collapse content|body text)\b/.test(text)) {
    const sentence = observationFirstSentenceForReportV5(observation);
    if (sentence) {
      parts.push("First sentence: " + sentence);
    } else {
      parts.push("First sentence: not found in current observation");
    }
  }

  if (/\b(final page title|page title|title)\b/.test(text) && observation.title) {
    const titlePart = "Page title: " + safeText(observation.title, 180);
    if (!parts.some((part) => String(part).includes(titlePart))) parts.push(titlePart);
  }

  return safeText(uniqueNonEmptyV5(parts).join(" — "), 1800);
}


function pageStateTraceSummary(pageState = null) {
  if (!pageState) return "No Lightpanda page state was captured.";
  if (pageState.ok !== true) return pageState.error || "Lightpanda page state was unavailable.";
  const counts = pageState.stats || {};
  return [
    "Lightpanda read-only state",
    pageState.title || pageState.url || "",
    `links=${Number(counts.links || 0)}`,
    `buttons=${Number(counts.buttons || 0)}`,
    `inputs=${Number(counts.inputs || 0)}`,
    `forms=${Number(counts.forms || 0)}`,
  ].filter(Boolean).join(" — ");
}

function usageOf(callResult) {
  return callResult?.call?.usage || callResult?.usage || null;
}

function thinkingOf(callResult) {
  return safeText(callResult?.call?.thinking || "", 1200);
}

function traceValueSummary(value = "") {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => traceValueSummary(item)).filter(Boolean).join(" | ");

  if (typeof value === "object") {
    const command = value.command || value.approvedCommand || null;
    const args = command?.args || value.args || {};

    const direct = [
      value.summary,
      value.reason,
      value.messageToChecker,
      value.messageToUser,
      value.evidence,
      value.repairInstruction,
      value.notes,
      command?.notes,
    ].find((item) => typeof item === "string" && item.trim());

    if (direct) return direct;

    if (command?.tool) {
      const target = args.text || args.label || args.buttonText || args.url || args.currentUrl || "";
      const ref = args.ref ? " ref=" + args.ref : "";
      return [command.tool, target ? "target=" + target : "", ref].filter(Boolean).join(" ");
    }

    if (value.url || value.title) {
      return [value.title, value.url].filter(Boolean).join(" — ");
    }

    try {
      return safeText(JSON.stringify(value), 700);
    } catch {
      return "";
    }
  }

  return String(value || "");
}

function checkerDecisionForExecution(checker = {}, checkerCall = null) {
  if (checkerCall && checkerCall.ok === false) {
    return { ok: false, reason: checkerCall.error || "Checker model call failed." };
  }

  const status = String(checker?.status || "").toLowerCase();
  const hasCommand = Boolean(checker?.command && typeof checker.command === "object" && checker.command.tool);

  if (status === "rejected" || status === "needs_user") {
    return { ok: false, reason: checker.reason || checker.messageToUser || "Step was not approved." };
  }

  if (status === "repaired") {
    return hasCommand
      ? { ok: true, repaired: true, reason: checker.reason || checker.repairInstruction || "" }
      : { ok: false, reason: checker.reason || "Checker said repaired but returned no command." };
  }

  if (checker?.approved === false) {
    return { ok: false, reason: checker.reason || checker.messageToUser || "Step was not approved." };
  }

  return { ok: true, repaired: false, reason: checker.reason || "" };
}

function agentTraceLabel(role = "", title = "") {
  const labels = {
    main_orchestrator: "Orchestrator",
    gemma_step_agent: "Step Agent",
    gemma_step_agent_repair: "Step Agent Repair",
    gemma_checker: "Checker",
    playwright_controller: "Playwright Executor",
    gemma_result_checker: "Watcher",
    gemma_result_checker_repair: "Watcher Repair",
    report_step_observe: "Reporter",
    repair_loop: "Repair Loop",
    final_verifier: "Main Response",
  };

  return labels[role] || title || role || "Agent";
}

function agentTraceKind(role = "") {
  if (role === "main_orchestrator") return "orchestrator";
  if (role.includes("step_agent")) return "step_agent";
  if (role.includes("checker") && !role.includes("result")) return "checker";
  if (role === "playwright_controller") return "playwright_executor";
  if (role.includes("result_checker")) return "watcher";
  if (role === "final_verifier") return "main_response";
  if (role === "report_step_observe") return "reporter";
  if (role === "repair_loop") return "repair";
  return "agent";
}

function shortModelLabel(model = "") {
  const raw = safeText(model, 180);
  if (!raw) return "";

  return raw
    .replace(/^joe-speedboat\//i, "")
    .replace(/Gemma-4-Uncensored-HauhauCS-Aggressive/i, "Gemma-4")
    .replace(/:latest$/i, "")
    .replace(/qwen3\.5:(\d+b)/i, "qwen3.5:$1");
}

function agentTraceProfileId(role = "") {
  const map = {
    main_orchestrator: "orchestrator",
    gemma_step_agent: "stepAgent",
    gemma_step_agent_repair: "stepAgent",
    gemma_checker: "checker",
    playwright_controller: "",
    gemma_result_checker: "watcher",
    gemma_result_checker_repair: "watcher",
    report_step_observe: "reporter",
    final_verifier: "finalVerifier",
  };

  return map[role] || "";
}

function agentTraceProfile(role = "") {
  const id = agentTraceProfileId(role);
  if (!id) return null;
  return resolveBrowserAgentProfile(id);
}

function traceEntry({
  role = "",
  title = "",
  model = "",
  status = "",
  step = null,
  input = "",
  output = "",
  summary = "",
  tool = "",
  ok = null,
  usage = null,
  reasoning = "",
} = {}) {
  const modelValue = model || usage?.model || "";
  const label = agentTraceLabel(role, title);
  const profile = agentTraceProfile(role);

  return {
    role,
    title: label,
    roleLabel: label,
    agentName: label,
    agentKind: agentTraceKind(role),
    agentProfile: profile,
    personality: profile?.personality || "",
    skills: profile?.skills || [],
    settings: profile?.settings || {},
    model: modelValue,
    modelLabel: shortModelLabel(modelValue),
    status,
    step,
    tool,
    ok,
    durationMs: usage?.totalDurationMs || null,
    tokens: usage?.totalTokens || null,
    input,
    output,
    summary: safeText(summary || cleanBrowserAgentTraceSummary(output), 1000),
    reasoning: safeText(reasoning, 1200),
  };
}

async function safeRole(label, fn) {
  const started = Date.now();
  stageLog(`${label}:start`);
  try {
    const call = await fn();
    stageLog(`${label}:done`, {
      ms: Date.now() - started,
      model: call?.usage?.model || "",
      tokens: call?.usage?.totalTokens || 0,
      preview: call?.rawContent || call?.data || "",
    });
    return { ok: true, call, label };
  } catch (err) {
    stageLog(`${label}:error`, {
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      preview: err?.contentPreview || "",
    });
    return {
      ok: false,
      call: null,
      label,
      error: err instanceof Error ? err.message : String(err),
      usage: err?.usage || null,
      contentPreview: err?.contentPreview || "",
    };
  }
}

function stepHaystackForTailCompletion(step = {}) {
  return [
    step.instruction,
    step.expectedAction,
    step.successCriteria,
  ].map((value) => String(value || "")).join(" ").toLowerCase();
}

function hasTailStep(steps = [], pattern) {
  return steps.some((step) => pattern.test(stepHaystackForTailCompletion(step)));
}

function pushTailStepIfMissing(steps = [], pattern, step = {}) {
  if (!hasTailStep(steps, pattern)) {
    steps.push(step);
  }
}

function completeLongInstructionTailSteps(steps = [], originalInstruction = "") {
  const text = String(originalInstruction || "").toLowerCase();
  const next = [...steps];

  const mentionsModalFlow =
    /\/components\/modal\//.test(text) ||
    /\bmodal\b/.test(text) ||
    /\blaunch demo modal\b/.test(text);

  if (!mentionsModalFlow) return next;

  if (/\b(inspect|report|find|show|list)\b[\s\S]{0,80}\bmodal\b[\s\S]{0,80}\b(button|demo button)\b/.test(text)) {
    pushTailStepIfMissing(next, /\b(inspect|report|find|show|list)\b.*\bmodal\b.*\b(button|demo button)\b/, {
      instruction: "inspect and report the first visible modal demo button",
      expectedAction: "observe",
      successCriteria: "first visible modal demo button is reported",
    });
  }

  if (/\b(click|press|tap)\b[\s\S]{0,80}\blaunch demo modal\b/.test(text)) {
    pushTailStepIfMissing(next, /\bclick\b.*\blaunch demo modal\b|\blaunch demo modal\b.*\bclicked\b/, {
      instruction: "click the Launch demo modal button",
      expectedAction: "click",
      successCriteria: "Launch demo modal button clicked successfully",
    });
  }

  if (/\bverify\b[\s\S]{0,80}\bmodal\b[\s\S]{0,80}\b(open|opened|visible|shown)\b|\bverify it opened\b/.test(text)) {
    pushTailStepIfMissing(next, /\bverify\b.*\bmodal\b.*\b(open|opened|visible|shown)\b|\bverify it opened\b/, {
      instruction: "verify the modal opened",
      expectedAction: "observe",
      successCriteria: "modal is opened",
    });
  }

  if (/\breport\b[\s\S]{0,100}\bmodal\b[\s\S]{0,100}\b(title|body text|body)\b/.test(text)) {
    pushTailStepIfMissing(next, /\breport\b.*\bmodal\b.*\b(title|body|body text)\b/, {
      instruction: "report the modal title and body text",
      expectedAction: "observe",
      successCriteria: "modal title and body text are reported",
    });
  }

  if (/\bclose\b[\s\S]{0,80}\bmodal\b|\bclose it\b/.test(text)) {
    pushTailStepIfMissing(next, /\bclose\b.*\bmodal\b|\bclose it\b/, {
      instruction: "close the modal",
      expectedAction: "click",
      successCriteria: "modal is closed",
    });
  }

  if (/\bverify\b[\s\S]{0,80}\bmodal\b[\s\S]{0,80}\b(close|closed|hidden|gone)\b|\bverify it closed\b/.test(text)) {
    pushTailStepIfMissing(next, /\bverify\b.*\bmodal\b.*\b(close|closed|hidden|gone)\b|\bverify it closed\b/, {
      instruction: "verify the modal closed",
      expectedAction: "observe",
      successCriteria: "modal is closed",
    });
  }

  if (/\breport\b[\s\S]{0,80}\bfinal page title\b/.test(text)) {
    pushTailStepIfMissing(next, /\breport\b.*\bfinal page title\b/, {
      instruction: "report the final page title",
      expectedAction: "report",
      successCriteria: "final page title is reported",
    });
  }

  return next;
}

function normalizeSteps(plan = {}, fallbackInstruction = "") {
  const rawSteps = Array.isArray(plan?.steps) ? plan.steps : [];
  const steps = rawSteps
    .map((step) => {
      if (typeof step === "string") {
        return { instruction: safeText(step, 700), expectedAction: "unknown", successCriteria: "" };
      }
      return {
        instruction: safeText(step?.instruction || step?.step || step?.text || "", 700),
        expectedAction: safeText(step?.expectedAction || step?.action || "unknown", 80),
        successCriteria: safeText(step?.successCriteria || step?.criteria || "", 500),
      };
    })
    .filter((step) => step.instruction);

  const normalized = steps.length
    ? steps
    : [{ instruction: fallbackInstruction, expectedAction: "unknown", successCriteria: "The requested browser task is completed." }];

  return ensureBrowserTaskTailStepsV6(
    completeLongInstructionTailSteps(normalized, fallbackInstruction),
    fallbackInstruction
  );
}


function ensureBrowserTaskTailStepsV6(steps = [], originalInstruction = "") {
  const text = String(originalInstruction || "").toLowerCase();
  const out = Array.isArray(steps) ? [...steps] : [];

  const stepText = (step = {}) => [
    step.instruction,
    step.expectedAction,
    step.successCriteria,
  ].map((value) => String(value || "")).join(" ").toLowerCase();

  const has = (pattern) => out.some((step) => pattern.test(stepText(step)));
  const add = (pattern, step) => {
    if (!has(pattern)) out.push(step);
  };

  const modalFlow = /\/components\/modal\//.test(text) ||
    /\blaunch demo modal\b/.test(text) ||
    /\bmodal\b/.test(text);

  if (modalFlow) {
    if (/\b(inspect|report|find|show|list)\b[\s\S]{0,100}\bmodal\b[\s\S]{0,100}\b(button|demo button)\b/.test(text)) {
      add(/\b(inspect|report|find|show|list)\b.*\bmodal\b.*\b(button|demo button)\b/, {
        instruction: "inspect and report the first visible modal demo button",
        expectedAction: "observe",
        successCriteria: "first visible modal demo button is reported",
      });
    }

    if (/\b(click|press|tap)\b[\s\S]{0,100}\blaunch demo modal\b/.test(text)) {
      add(/\b(click|press|tap)\b.*\blaunch demo modal\b/, {
        instruction: "click the Launch demo modal button",
        expectedAction: "click",
        successCriteria: "Launch demo modal button clicked successfully",
      });
    }

    if (/\bverify\b[\s\S]{0,100}\bmodal\b[\s\S]{0,100}\b(open|opened|visible|shown)\b/.test(text)) {
      add(/\bverify\b.*\bmodal\b.*\b(open|opened|visible|shown)\b/, {
        instruction: "verify the modal opened",
        expectedAction: "observe",
        successCriteria: "modal is opened",
      });
    }

    if (/\breport\b[\s\S]{0,120}\bmodal\b[\s\S]{0,120}\b(title|body|body text)\b/.test(text)) {
      add(/\breport\b.*\bmodal\b.*\b(title|body|body text)\b/, {
        instruction: "report the modal title and body text",
        expectedAction: "observe",
        successCriteria: "modal title and body text are reported",
      });
    }

    if (/\bclose\b[\s\S]{0,80}\bmodal\b|\bclose it\b/.test(text)) {
      add(/\bclose\b.*\bmodal\b|\bclose it\b/, {
        instruction: "close the modal",
        expectedAction: "click",
        successCriteria: "modal is closed",
      });
    }

    if (/\bverify\b[\s\S]{0,100}\bmodal\b[\s\S]{0,100}\b(close|closed|hidden|gone)\b|\bverify it closed\b/.test(text)) {
      add(/\bverify\b.*\bmodal\b.*\b(close|closed|hidden|gone)\b|\bverify it closed\b/, {
        instruction: "verify the modal closed",
        expectedAction: "observe",
        successCriteria: "modal is closed",
      });
    }
  }

  if (/\breport\b[\s\S]{0,100}\bfinal page title\b/.test(text)) {
    add(/\breport\b.*\bfinal page title\b/, {
      instruction: "report the final page title",
      expectedAction: "report",
      successCriteria: "final page title is reported",
    });
  }

  return out;
}

function ensureBrowserTaskTailStepsV8(steps = [], originalInstruction = "") {
  const text = String(originalInstruction || "").toLowerCase();
  const out = Array.isArray(steps) ? [...steps] : [];

  const stepText = (step = {}) => [
    step.instruction,
    step.expectedAction,
    step.successCriteria,
  ].map((value) => String(value || "")).join(" ").toLowerCase();

  const has = (pattern) => out.some((step) => pattern.test(stepText(step)));
  const add = (pattern, step) => {
    if (!has(pattern)) out.push(step);
  };

  const hasModalFlow =
    /\/components\/modal\//.test(text) ||
    /\blaunch demo modal\b/.test(text) ||
    /\bmodal\b/.test(text);

  if (hasModalFlow) {
    if (/\b(inspect|report|find|show|list)\b[\s\S]{0,140}\bmodal\b[\s\S]{0,140}\b(button|demo button)\b/.test(text)) {
      add(/\b(inspect|report|find|show|list)\b.*\bmodal\b.*\b(button|demo button)\b/, {
        instruction: "inspect and report the first visible modal demo button",
        expectedAction: "observe",
        successCriteria: "first visible modal demo button is reported",
      });
    }

    if (/\b(click|press|tap)\b[\s\S]{0,140}\blaunch demo modal\b/.test(text)) {
      add(/\b(click|press|tap)\b.*\blaunch demo modal\b/, {
        instruction: "click the Launch demo modal button",
        expectedAction: "click",
        successCriteria: "Launch demo modal button clicked successfully",
      });
    }

    if (/\bverify\b[\s\S]{0,140}\bmodal\b[\s\S]{0,140}\b(open|opened|visible|shown)\b/.test(text)) {
      add(/\bverify\b.*\bmodal\b.*\b(open|opened|visible|shown)\b/, {
        instruction: "verify the modal opened",
        expectedAction: "observe",
        successCriteria: "modal is opened",
      });
    }

    if (/\breport\b[\s\S]{0,160}\bmodal\b[\s\S]{0,160}\b(title|body|body text)\b/.test(text)) {
      add(/\breport\b.*\bmodal\b.*\b(title|body|body text)\b/, {
        instruction: "report the modal title and body text",
        expectedAction: "observe",
        successCriteria: "modal title and body text are reported",
      });
    }

    if (/\bclose\b[\s\S]{0,120}\bmodal\b|\bclose it\b/.test(text)) {
      add(/\bclose\b.*\bmodal\b|\bclose it\b/, {
        instruction: "close the modal",
        expectedAction: "click",
        successCriteria: "modal is closed",
      });
    }

    if (/\bverify\b[\s\S]{0,140}\bmodal\b[\s\S]{0,140}\b(close|closed|hidden|gone)\b|\bverify it closed\b/.test(text)) {
      add(/\bverify\b.*\bmodal\b.*\b(close|closed|hidden|gone)\b|\bverify it closed\b/, {
        instruction: "verify the modal closed",
        expectedAction: "observe",
        successCriteria: "modal is closed",
      });
    }
  }

  if (/\breport\b[\s\S]{0,140}\bfinal page title\b/.test(text)) {
    add(/\breport\b.*\bfinal page title\b/, {
      instruction: "report the final page title",
      expectedAction: "report",
      successCriteria: "final page title is reported",
    });
  }

  return out;
}


function normalizeCommandArgsForTool(tool = "", rawArgs = {}, currentUrl = "") {
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
    ? { ...rawArgs }
    : {};

  if (tool === "browserNavigate") {
    const url = args.url || args.href || args.targetUrl || args.target || "";
    if (url) args.url = url;
    delete args.href;
    delete args.targetUrl;
  }

  if (tool === "browserClickByText") {
    if (!args.text && args.label) args.text = args.label;
    if (!args.text && args.buttonText) args.text = args.buttonText;
    if (!args.ref && args.sourceRef) args.ref = args.sourceRef;
    if (!args.selector && args.sourceSelector) args.selector = args.sourceSelector;
  }

  if (currentUrl && tool !== "browserNavigate") {
    args.currentUrl = args.currentUrl || currentUrl;
  }

  return args;
}

function normalizeCommand(value = {}, currentUrl = "") {
  const command = value?.command || value?.approvedCommand || value || {};
  const tool = String(command.tool || "").trim();

  if (!SUPPORTED_TOOLS.has(tool)) {
    return {
      ok: false,
      command: null,
      error: `Unsupported or missing tool: ${tool || "<missing>"}`,
    };
  }

  return {
    ok: true,
    command: {
      intent: safeText(command.intent || "unknown", 80),
      tool,
      args: normalizeCommandArgsForTool(tool, command.args, currentUrl),
      notes: safeText(command.notes || "", 500),
    },
    error: "",
  };
}
function commandHasFields(command = {}) {
  return Array.isArray(command.args?.fields) && command.args.fields.length > 0;
}

function isSubmitLikeClickCommand(command = {}) {
  if (!command || command.tool !== "browserClickByText") return false;
  const text = safeText(command.args?.text || command.args?.label || command.args?.buttonText || "", 120).toLowerCase();
  return /login|log in|sign in|submit|continue|next/.test(text);
}

function commandWithFreshFillBeforeSubmit(clickCommand = {}, lastFillCommand = null) {
  if (!lastFillCommand || !commandHasFields(lastFillCommand) || !isSubmitLikeClickCommand(clickCommand)) return clickCommand;
  return {
    ...clickCommand,
    intent: "fill_and_submit",
    tool: "browserFillAndSubmit",
    args: {
      ...(clickCommand.args || {}),
      fields: lastFillCommand.args.fields,
      text: clickCommand.args?.text || clickCommand.args?.label || clickCommand.args?.buttonText || "Login",
    },
    notes: "Re-filled verified fields immediately before submit.",
  };
}

function redactedBrowserFieldValue(field = {}) {
  const haystack = [field.label, field.name, field.id, field.placeholder, field.selector, field.type].map((item) => String(item || "")).join(" ").toLowerCase();
  if (/password|passcode|pin|otp|token|secret/.test(haystack) || field.secret === true) return "[redacted]";
  const value = String(field.value ?? "");
  return value.length > 120 ? value.slice(0, 117) + "..." : value;
}

function browserCommandFieldsForTrace(command = {}) {
  const fields = Array.isArray(command.args?.fields) ? command.args.fields : [];
  return fields.map((field) => ({
    label: safeText(field.label || field.name || field.id || field.placeholder || "field", 120),
    target: safeText(field.ref || field.selector || field.target || "", 120),
    type: safeText(field.type || "textbox", 80),
    valuePreview: redactedBrowserFieldValue(field),
  }));
}

function browserExecutionUiDetails(command = {}, execution = {}) {
  const action = execution.actionResult || {};
  const tool = command.tool || "";
  if (tool === "browserFillFields" || tool === "browserFillAndSubmit") {
    const formFillOk = action.formFill?.ok === true;
    const domFallbackOk = action.domFallback?.ok === true;
    const typeOk = Array.isArray(action.results) && action.results.length > 0 && action.results.every((result) => result?.ok === true);
    const verifyOk = action.verify?.ok === true;
    return { kind: "fill", strategy: verifyOk ? "verified_fill" : domFallbackOk ? "dom_fill_fallback" : typeOk ? "browser_type" : formFillOk ? "browser_fill_form" : "fill_failed", formFillOk, typeOk, domFallbackOk, verifyOk, fields: browserCommandFieldsForTrace(command) };
  }
  if (tool === "browserClickByText" || tool === "browserSubmitForm") return { kind: "click", strategy: "browser_click", target: safeText(command.args?.text || command.args?.label || command.args?.buttonText || "", 160), ref: safeText(command.args?.ref || command.args?.selector || command.args?.target || "", 160) };
  if (tool === "browserNavigate") return { kind: "navigate", strategy: "browser_navigate", url: safeText(command.args?.url || "", 260) };
  return null;
}

function browserExecutionTraceSummary(command = {}, execution = {}) {
  const details = browserExecutionUiDetails(command, execution);
  const page = cleanBrowserAgentTraceSummary({ summary: execution.actionResult?.text || "", url: execution.observation?.url || "", title: execution.observation?.title || "" });
  if (!details) return execution.error || page;
  if (details.kind === "fill") {
    const fields = (details.fields || []).map((field) => field.label + (field.target ? " [" + field.target + "]" : "") + (field.valuePreview ? "=" + field.valuePreview : "")).join(", ");
    return ["playwright:fill via=" + details.strategy + (fields ? " fields: " + fields : ""), page, execution.error || ""].filter(Boolean).join(" — ");
  }
  if (details.kind === "click") return ["playwright:click target=" + (details.target || "") + (details.ref ? " [" + details.ref + "]" : ""), page, execution.error || ""].filter(Boolean).join(" — ");
  if (details.kind === "navigate") return ["playwright:navigate " + (details.url || ""), page, execution.error || ""].filter(Boolean).join(" — ");
  return execution.error || page;
}

function isSyncSensitiveExecutionCommand(command = {}) {
  return [
    "browserClickByText",
    "browserFillFields",
    "browserSubmitForm",
    "browserFillAndSubmit",
  ].includes(String(command?.tool || ""));
}

function watcherStepHistory(stepResults = []) {
  return (Array.isArray(stepResults) ? stepResults : []).map((item) => ({
    stepNumber: item.stepNumber || null,
    instruction: safeText(item.step?.instruction || "", 240),
    expectedAction: safeText(item.step?.expectedAction || "", 80),
    ok: item.ok === true,
    status: safeText(item.status || "", 80),
    summary: safeText(item.summary || "", 500),
    url: safeText(item.url || "", 500),
    title: safeText(item.title || "", 240),
    command: item.command ? {
      intent: safeText(item.command.intent || "", 80),
      tool: safeText(item.command.tool || "", 80),
      args: item.command.args || {},
    } : null,
  }));
}

function watcherRecentTrace(trace = [], limit = 14) {
  return (Array.isArray(trace) ? trace : [])
    .slice(-limit)
    .map((entry) => ({
      role: safeText(entry.role || "", 80),
      step: entry.step ?? null,
      status: safeText(entry.status || "", 80),
      ok: entry.ok,
      tool: safeText(entry.tool || "", 80),
      summary: safeText(entry.summary || "", 500),
    }));
}

function watcherHybridContext({ stepResults = [], trace = [], beforeState = null, currentUrl = "", currentTitle = "" } = {}) {
  return {
    currentUrl: safeText(currentUrl || "", 500),
    currentTitle: safeText(currentTitle || "", 240),
    stepHistory: watcherStepHistory(stepResults),
    recentTrace: watcherRecentTrace(trace),
    lightpanda: beforeState ? {
      ok: beforeState.ok === true,
      url: safeText(beforeState.url || "", 500),
      title: safeText(beforeState.title || "", 240),
      source: safeText(beforeState.source || "", 120),
      engine: safeText(beforeState.engine || "", 120),
      stats: beforeState.stats || {},
    } : null,
    policy: {
      lightpandaRole: "read_only_dom_intelligence",
      playwrightRole: "executor",
      syncRepairInstruction: "SYNC_PLAYWRIGHT_TO_LIGHTPANDA_AND_RETRY: <beforeState.url>",
    },
  };
}

function watcherSyncRepairInstruction({ command = {}, beforeState = null, execution = {} } = {}) {
  const url = safeText(beforeState?.url || "", 500);
  if (!url) return "";
  if (!isSyncSensitiveExecutionCommand(command)) return "";
  if (execution?.ok === true && !execution?.error) return "";
  return `SYNC_PLAYWRIGHT_TO_LIGHTPANDA_AND_RETRY: ${url}`;
}

function parseWatcherSyncRepairInstruction(value = "") {
  const raw = String(value || "");
  const match = raw.match(/SYNC_PLAYWRIGHT_TO_LIGHTPANDA_AND_RETRY:\s*(https?:\/\/\S+)/i);
  return match?.[1] ? { url: match[1].replace(/[.,;:!?]+$/g, "") } : null;
}

function watcherResultOrFallback({ resultCheck = {}, resultCheckCall = null, execution = {}, step = {}, command = {}, beforeState = null } = {}) {
  const hasData = resultCheck && typeof resultCheck === "object" && Object.keys(resultCheck).length > 0;
  if (hasData) return resultCheck;

  const actionSummary = browserExecutionTraceSummary(command, execution);
  const callError = safeText(resultCheckCall?.error || "", 500);
  const stepName = safeText(step?.instruction || "browser step", 240);
  const syncRepair = watcherSyncRepairInstruction({ command, beforeState, execution });

  return {
    status: execution.ok === true ? "needs_repair" : "failed",
    success: false,
    summary: "Watcher returned no valid decision for: " + stepName + ". " + (actionSummary || callError || "Verification was inconclusive."),
    evidence: actionSummary || callError || "No watcher JSON was available.",
    repairInstruction: syncRepair || (
      command.tool === "browserFillFields" || command.tool === "browserFillAndSubmit"
        ? "Re-fill the fields with verified typing, then submit only after values are confirmed."
        : "Retry the step with a more specific target and verify the result."
    ),
    messageToUser: "",
    confidence: 0.1,
  };
}


function observationFromExecution(execution = null, fallback = {}) {
  return execution?.observation || {
    ok: Boolean(fallback?.snapshot),
    url: fallback?.snapshot?.url || "",
    title: fallback?.snapshot?.title || "",
    textPreview: fallback?.snapshot?.text || fallback?.snapshot?.dom?.textPreview || "",
    engine: "playwright_mcp",
    links: [],
    buttons: [],
    inputs: [],
    forms: [],
    interactiveElements: [],
    stats: {},
  };
}

function tokenUsageFromTrace(trace = []) {
  const totalTokens = trace.reduce((sum, entry) => sum + Number(entry.tokens || 0), 0);
  return {
    totalTokens,
    planner: trace.find((entry) => entry.role === "main_orchestrator") || null,
    reporter: trace.find((entry) => entry.role === "final_verifier") || null,
  };
}

export async function runBrowserAgentOrchestrator(args = {}) {
  const startedAt = nowMs();
  const instruction = String(args.instruction || "").trim();
  const state = args.state || {};
  const runtime = browserAgentRuntimeConfig({ display: true });
  const maxSteps = Math.max(1, Math.min(envInt("BROWSER_AGENT_MAX_SEQUENCE_STEPS", 8), 12));
  const maxRepairAttempts = Math.max(0, Math.min(envInt("BROWSER_AGENT_REPAIR_ATTEMPTS", 1), 3));

  const trace = [];
  const stepResults = [];

  if (!instruction) {
    return {
      ok: false,
      status: "needs_user",
      instruction,
      summary: "Browser instruction is empty.",
      requiresUser: true,
      blockedReason: "empty_instruction",
      nextSafeAction: "Tell me what browser task you want.",
      runtime,
      runtimeTiming: { totalMs: roundMs(nowMs() - startedAt), pipelineMs: roundMs(nowMs() - startedAt), mainModelMs: 0 },
      tokenUsage: emptyBrowserAgentTokenUsage(),
      agentTrace: trace,
    };
  }

  const orchestratorCall = await safeRole("main_orchestrator", () => runOrchestratorAgent({
    originalInstruction: instruction,
    currentState: compactState(state),
  }));


  const orchestratorPlan = orchestratorCall.call?.data || {
    status: "ready",
    userIntent: instruction,
    steps: [{ instruction, expectedAction: "unknown", successCriteria: "" }],
    confidence: 0.5,
  };

  const normalizedSteps = normalizeSteps(orchestratorPlan, instruction);
  const stepsWithTail = ensureBrowserTaskTailStepsV8(normalizedSteps, instruction);
  const steps = stepsWithTail.slice(0, Math.max(maxSteps, stepsWithTail.length));
  const orchestratorHasExecutableSteps = steps.some((step) => {
    const action = String(step.expectedAction || "").toLowerCase();
    const stepText = String(step.instruction || "").trim();
    return Boolean(stepText) && action !== "needs_user";
  });
  const normalizedOrchestratorStatus =
    orchestratorPlan.status === "needs_user" && orchestratorHasExecutableSteps
      ? "ready"
      : (orchestratorPlan.status || (orchestratorCall.ok ? "ready" : "failed"));

  trace.push(traceEntry({
    role: "main_orchestrator",
    title: "Main model intent orchestrator",
    status: normalizedOrchestratorStatus,
    input: instruction,
    output: {
      ...orchestratorPlan,
      status: normalizedOrchestratorStatus,
      originalStatus: orchestratorPlan.status || "",
      steps,
    },
    summary: orchestratorPlan.userIntent || "",
    ok: orchestratorCall.ok,
    usage: usageOf(orchestratorCall),
    reasoning: thinkingOf(orchestratorCall),
  }));

  let currentState = state;
  let currentUrl = args.currentUrl || state.currentUrl || state.lastValidObservation?.url || "";
  let currentTitle = args.currentTitle || state.currentTitle || state.lastValidObservation?.title || "";
  let finalObservation = null;
  let stoppedReason = "";
  let lastSuccessfulFillCommand = null;
  const readOnlyBrowserPlan = isReadOnlyBrowserPlan(steps, instruction);

  for (let index = 0; index < steps.length; index += 1) {
    const stepNumber = index + 1;
    const step = steps[index];

    trace.push(traceEntry({
      role: "sequence_step",
      title: `Step ${stepNumber}`,
      status: "started",
      step: stepNumber,
      input: step.instruction,
      summary: step.successCriteria || step.expectedAction || "",
      ok: null,
    }));

    // ACTIVE_WATCHER_HARD_UI_STEP_V4
    // This must run before Lightpanda/page-state/snapshot work. Verification
    // and generic close/dismiss steps should be fully consumed by the live watcher.
    const activeWatcherHardV4 = await activeWatcherHardUiStepV4({
      step,
      stepNumber,
      currentUrl,
      currentTitle,
      currentState,
      trace,
    });

    if (activeWatcherHardV4?.handled) {
      const stepResult = activeWatcherHardV4.stepResult;
      currentUrl = stepResult?.url || currentUrl;
      currentTitle = stepResult?.title || currentTitle;
      finalObservation = activeWatcherHardV4.finalObservation || finalObservation;
      stepResults.push(stepResult);

      if (!stepResult?.ok) {
        stoppedReason = stepResult?.summary || "Active watcher hard UI step failed.";
        break;
      }

      continue;
    }

    const stepTargetUrl = targetUrlForStep(step, instruction);
    const shouldLightpandaReadStepTarget =
      !currentUrl &&
      stepTargetUrl &&
      (readOnlyBrowserPlan || isNavigationStep(step) || isClickStep(step));

    const lightpandaReadUrl = currentUrl || (shouldLightpandaReadStepTarget ? stepTargetUrl : "");

    const scrapeLikeStep = isScrapeLikeStep(step);

    let beforeState = null;
    try {
      beforeState = await getBrowserState({
        ...args,
        state: currentState,
        ...(currentUrl ? { currentUrl } : lightpandaReadUrl ? { url: lightpandaReadUrl } : { currentUrl }),
        navigate: Boolean(!currentUrl && lightpandaReadUrl),
        includeScrape: Boolean(args.includeScrape || scrapeLikeStep),
        stateMode: scrapeLikeStep ? "scrape" : args.stateMode,
        waitMs: args.waitMs || "700",
      });
    } catch (err) {
      beforeState = {
        ok: false,
        status: "failed",
        source: "lightpanda_read_only",
        engine: "lightpanda_cdp",
        url: currentUrl || "",
        title: currentTitle || "",
        error: err instanceof Error ? err.message : String(err),
        links: [],
        buttons: [],
        inputs: [],
        forms: [],
        interactiveElements: [],
        candidates: [],
        stats: {},
      };
    }

    trace.push(traceEntry({
      role: "lightpanda_state_provider",
      title: "Lightpanda state provider",
      step: stepNumber,
      status: beforeState?.ok === true ? "observed" : "unavailable",
      input: {
        currentUrl,
        readUrl: lightpandaReadUrl,
        readOnly: true,
      },
      output: compactBrowserStateForModel(beforeState, {
        textLimit: scrapeLikeStep ? 1400 : 900,
        markdownLimit: scrapeLikeStep ? 1400 : 900,
        linkLimit: scrapeLikeStep ? 20 : 12,
        buttonLimit: 12,
        inputLimit: 12,
        formLimit: 4,
        candidateLimit: scrapeLikeStep ? 40 : 24,
        tableLimit: scrapeLikeStep ? 6 : 2,
        groupLimit: scrapeLikeStep ? 4 : 1,
      }),
      summary: pageStateTraceSummary(beforeState),
      tool: "browserObserve",
      ok: beforeState?.ok === true,
    }));

    if (
      (readOnlyBrowserPlan || envFlag("BROWSER_AGENT_LIGHTPANDA_NAVIGATION_PREREAD_PASS", true)) &&
      isNavigationStep(step) &&
      beforeState?.ok === true &&
      !currentUrl &&
      lightpandaReadUrl
    ) {
      const observation = observationFromPageState(beforeState);
      currentUrl = observation?.url || lightpandaReadUrl || currentUrl;
      currentTitle = observation?.title || currentTitle;
      finalObservation = observation || finalObservation;

      const summary = detailedStepReportSummaryFromObservation(observation || {}, step, instruction);

      trace.push(traceEntry({
        role: "report_step_observe",
        title: "Lightpanda read-only navigation",
        step: stepNumber,
        status: "passed",
        input: step,
        output: {
          url: currentUrl,
          title: currentTitle,
          textPreview: safeText(observation?.textPreview || observation?.text || "", 900),
          links: Array.isArray(observation?.links) ? observation.links.slice(0, scrapeLikeStep ? 10 : 5).map((link) => link.text || link.href || "") : [],
          tables: Array.isArray(beforeState?.tables) ? beforeState.tables.slice(0, 3) : [],
          repeatedGroups: Array.isArray(beforeState?.repeatedGroups) ? beforeState.repeatedGroups.slice(0, 2) : [],
          stats: observation?.stats || {},
        },
        summary,
        tool: "browserObserve",
        ok: true,
      }));

      stepResults.push({
        stepNumber,
        step,
        ok: true,
        repaired: false,
        status: "passed",
        summary,
        url: currentUrl,
        title: currentTitle,
        command: { intent: "read_navigation", tool: "browserObserve", args: { currentUrl } },
      });

      continue;
    }

    if (
      envFlag("BROWSER_AGENT_LIGHTPANDA_OBSERVE_FAST_PATH", true) &&
      isObserveOnlyStep(step) &&
      beforeState?.ok === true
    ) {
      const observation = observationFromPageState(beforeState);
      currentUrl = observation?.url || currentUrl;
      currentTitle = observation?.title || currentTitle;
      finalObservation = observation || finalObservation;

      const summary = detailedStepReportSummaryFromObservation(observation || {}, step, instruction);

      trace.push(traceEntry({
        role: "report_step_observe",
        title: "Lightpanda observe fast path",
        step: stepNumber,
        status: "passed",
        input: step,
        output: {
          url: observation?.url || "",
          title: observation?.title || "",
          textPreview: safeText(observation?.textPreview || observation?.text || "", 900),
          links: Array.isArray(observation?.links) ? observation.links.slice(0, 5).map((link) => link.text || link.href || "") : [],
          stats: observation?.stats || {},
        },
        summary,
        tool: scrapeLikeStep ? "lightpandaScrape" : "lightpandaObserve",
        ok: true,
      }));

      stepResults.push({
        stepNumber,
        step,
        ok: true,
        repaired: false,
        status: "passed",
        summary,
        url: currentUrl,
        title: currentTitle,
        command: {
          intent: scrapeLikeStep ? "scrape" : "observe",
          tool: scrapeLikeStep ? "lightpandaScrape" : "lightpandaObserve",
          args: { currentUrl },
        },
      });

      continue;
    }

    const captureBeforeSnapshot = shouldCapturePlaywrightBeforeSnapshot({ step, beforeState });
    let before = null;

    if (captureBeforeSnapshot) {
      try {
        before = await capturePlaywrightMcpSnapshot({
          ...args,
          currentUrl,
          label: `step_${stepNumber}_before`,
          navigate: Boolean(currentUrl),
        }, currentState);
      } catch (err) {
        before = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          snapshot: null,
          observation: null,
        };
      }
    } else {
      before = {
        ok: true,
        status: "skipped",
        skipped: true,
        reason: "Skipped Playwright before snapshot because Lightpanda read-only page state is available.",
        snapshot: null,
        observation: observationFromPageState(beforeState),
        error: "",
      };
    }

    let playwrightScout = null;

    if (shouldUsePlaywrightControlScout({ step, beforeState, originalInstruction: instruction })) {
      const scoutTargetText = extractClickTargetText(step, instruction) || step.instruction || "";
      try {
        playwrightScout = await scoutPlaywrightControlTarget({
          ...args,
          currentUrl,
          targetText: scoutTargetText,
          intent: step.instruction || "",
          navigate: Boolean(currentUrl),
        }, currentState);
      } catch (err) {
        playwrightScout = {
          ok: false,
          status: "failed",
          targetText: scoutTargetText,
          selector: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      trace.push(traceEntry({
        role: "playwright_controller",
        title: "Playwright control scout",
        step: stepNumber,
        status: playwrightScout?.ok === true ? "found" : "not_found",
        input: {
          targetText: scoutTargetText,
          currentUrl,
          intent: step.instruction || "",
        },
        output: {
          selector: playwrightScout?.selector || "",
          text: playwrightScout?.text || "",
          score: playwrightScout?.score || 0,
          targetCore: playwrightScout?.targetCore || "",
          selected: playwrightScout?.selected || null,
          candidates: Array.isArray(playwrightScout?.candidates) ? playwrightScout.candidates.slice(0, 8) : [],
          error: playwrightScout?.error || "",
        },
        summary: playwrightScout?.ok === true
          ? "Playwright scout found selector-only control: " + safeText(playwrightScout.selector || "", 220)
          : "Playwright scout found no reliable selector-only control.",
        tool: "browserObserve",
        ok: playwrightScout?.ok === true,
      }));

      if (playwrightScout?.ok !== true) {
        const repairedScoutTarget = supervisedScoutRepairTarget(scoutTargetText);
        if (repairedScoutTarget) {
          trace.push(traceEntry({
            role: "pipeline_supervisor",
            title: "Live scout supervisor",
            step: stepNumber,
            status: "repairing_target",
            input: {
              failedTargetText: scoutTargetText,
              scoutError: playwrightScout?.error || "",
            },
            output: {
              repairedTargetText: repairedScoutTarget,
              reason: "Removed generic action/control words before falling back to LLM agents.",
            },
            summary: `Scout failed for "${scoutTargetText}". Retrying with "${repairedScoutTarget}".`,
            tool: "browserObserve",
            ok: null,
          }));

          try {
            const retryScout = await scoutPlaywrightControlTarget({
              ...args,
              currentUrl,
              targetText: repairedScoutTarget,
              intent: step.instruction || "",
              navigate: false,
            }, currentState);

            trace.push(traceEntry({
              role: "playwright_controller",
              title: "Playwright control scout retry",
              step: stepNumber,
              status: retryScout?.ok === true ? "found" : "not_found",
              input: {
                targetText: repairedScoutTarget,
                currentUrl,
                intent: step.instruction || "",
              },
              output: {
                selector: retryScout?.selector || "",
                text: retryScout?.text || "",
                score: retryScout?.score || 0,
                targetCore: retryScout?.targetCore || "",
                selected: retryScout?.selected || null,
                candidates: Array.isArray(retryScout?.candidates) ? retryScout.candidates.slice(0, 8) : [],
                error: retryScout?.error || "",
              },
              summary: retryScout?.ok === true
                ? "Supervisor retry found selector-only control: " + safeText(retryScout.selector || "", 220)
                : "Supervisor retry found no reliable selector-only control.",
              tool: "browserObserve",
              ok: retryScout?.ok === true,
            }));

            if (retryScout?.ok === true) {
              playwrightScout = {
                ...retryScout,
                supervisedRepair: {
                  from: scoutTargetText,
                  to: repairedScoutTarget,
                  reason: "generic_control_word_removed",
                },
              };
            }
          } catch (err) {
            trace.push(traceEntry({
              role: "pipeline_supervisor",
              title: "Live scout supervisor",
              step: stepNumber,
              status: "repair_failed",
              input: repairedScoutTarget,
              output: {
                error: err instanceof Error ? err.message : String(err),
              },
              summary: "Supervisor scout retry failed.",
              tool: "browserObserve",
              ok: false,
            }));
          }
        }
      }
    }

    if (
      playwrightScout &&
      playwrightScout.ok !== true &&
      isButtonIntentStep(step) &&
      !isExplicitLinkNavigationIntent(step)
    ) {
      let snapshotRefScout = null;
      try {
        const scoutSnapshot = before?.snapshot?.text
          ? before
          : await capturePlaywrightMcpSnapshot({
              ...args,
              currentUrl,
              label: `step_${stepNumber}_snapshot_ref_scout`,
              navigate: false,
            }, currentState);

        snapshotRefScout = playwrightSnapshotRefScout({
          snapshot: scoutSnapshot?.snapshot || null,
          step,
          originalInstruction: instruction,
        });
      } catch {}

      if (snapshotRefScout?.ref) {
        playwrightScout = {
          ok: true,
          status: "found",
          engine: "playwright_mcp",
          targetText: snapshotRefScout.text || extractClickTargetText(step, instruction) || step.instruction || "",
          selector: "",
          ref: snapshotRefScout.ref,
          text: snapshotRefScout.text || extractClickTargetText(step, instruction) || "",
          score: snapshotRefScout.score || 0,
          selected: snapshotRefScout,
          snapshotRefFallback: true,
        };

        trace.push(traceEntry({
          role: "playwright_controller",
          title: "Playwright snapshot-ref scout",
          step: stepNumber,
          status: "found",
          input: {
            targetText: playwrightScout.targetText,
            currentUrl,
          },
          output: snapshotRefScout,
          summary: "Snapshot-ref scout found concrete Playwright ref: " + safeText(snapshotRefScout.ref || "", 120),
          tool: "browserObserve",
          ok: true,
        }));
      }
    }

    if (
      playwrightScout &&
      playwrightScout.ok !== true &&
      isButtonIntentStep(step) &&
      !isExplicitLinkNavigationIntent(step)
    ) {
      stoppedReason = [
        "Playwright Scout could not lock a concrete selector for this button/modal/collapse target.",
        "Loose text click fallback was blocked to avoid clicking ads, docs links, or unrelated controls.",
        playwrightScout.error ? "Scout error: " + playwrightScout.error : "",
      ].filter(Boolean).join(" ");

      trace.push(traceEntry({
        role: "pipeline_supervisor",
        title: "Live scout supervisor",
        step: stepNumber,
        status: "blocked_loose_fallback",
        input: {
          step,
          scout: {
            targetText: playwrightScout.targetText || "",
            targetCore: playwrightScout.targetCore || "",
            error: playwrightScout.error || "",
            candidates: Array.isArray(playwrightScout.candidates)
              ? playwrightScout.candidates.slice(0, 8)
              : [],
          },
        },
        output: {
          decision: "blocked",
          reason: stoppedReason,
        },
        summary: stoppedReason,
        tool: "browserObserve",
        ok: false,
      }));

      stepResults.push({
        stepNumber,
        step,
        ok: false,
        repaired: false,
        status: "scout_not_found",
        summary: stoppedReason,
        url: currentUrl,
        title: currentTitle,
        command: {
          intent: "click_or_open",
          tool: "browserClickByText",
          args: {
            currentUrl,
            text: extractClickTargetText(step, instruction) || step.instruction || "",
            selectorRequired: true,
          },
          notes: "Blocked because Scout did not provide a concrete selector.",
        },
      });

      break;
    }

    const beforeImages = snapshotImagesForModel(before?.snapshot);
    const compactBeforeState = compactBrowserStateForModel(beforeState);

    if (envFlag("BROWSER_AGENT_REPORT_STEP_FAST_PATH", true) && isReportOnlyStep(step)) {
      const observation = observationFromPageState(beforeState) || before?.observation || observationFromExecution(null, before);
      currentUrl = observation.url || currentUrl;
      currentTitle = observation.title || currentTitle;
      finalObservation = observation;

      const summary = detailedStepReportSummaryFromObservation(observation, step, instruction);

      trace.push(traceEntry({
        role: "report_step_observe",
        title: "Report step observer",
        step: stepNumber,
        status: "passed",
        input: step,
        output: {
          url: observation.url || "",
          title: observation.title || "",
          textPreview: safeText(observation.textPreview || observation.text || "", 900),
          links: Array.isArray(observation.links) ? observation.links.slice(0, 5).map((link) => link.text || link.href || "") : [],
          stats: observation.stats || {},
        },
        summary,
        tool: "browserObserve",
        ok: true,
      }));

      stepResults.push({
        stepNumber,
        step,
        ok: true,
        repaired: false,
        status: "passed",
        summary,
        url: currentUrl,
        title: currentTitle,
        command: { intent: "observe", tool: "browserObserve", args: { currentUrl } },
      });

      continue;
    }

    let stepAgentCall = null;
    let stepPlan = syntheticStepPlanFromPlaywrightScout({
      scout: playwrightScout,
      step,
      currentUrl,
      originalInstruction: instruction,
    });

    if (!stepPlan) {
      stepPlan = envFlag("BROWSER_AGENT_SYNTHETIC_LOW_RISK_STEPS", true)
        ? syntheticStepPlanForLowRisk(step, currentUrl, instruction)
        : null;
    }

    const lightpandaClickPlannerMode = String(process.env.BROWSER_AGENT_LIGHTPANDA_CLICK_PLANNER_MODE || "fallback").trim().toLowerCase();

    if (
      !stepPlan &&
      envFlag("BROWSER_AGENT_LIGHTPANDA_CLICK_PLANNER", true) &&
      lightpandaClickPlannerMode === "before_agent"
    ) {
      stepPlan = syntheticStepPlanFromLightpandaClick({
        step,
        beforeState,
        originalInstruction: instruction,
      });
    }

    if (stepPlan) {
      trace.push(traceEntry({
        role: "gemma_step_agent",
        title: "Gemma step agent",
        step: stepNumber,
        status: "synthetic_ready",
        input: step,
        output: stepPlan,
        summary: stepPlan.reason || "",
        tool: stepPlan.command?.tool || "",
        ok: true,
      }));
    } else {
      stepAgentCall = await safeRole(`gemma_step_agent_step_${stepNumber}`, () => runStepAgent({
        schemaName: "gemma_step_agent",
        images: beforeImages,
        context: {
          originalInstruction: instruction,
          fullPlan: { ...orchestratorPlan, steps },
          stepNumber,
          step,
          currentUrl,
          currentTitle,
          currentState: compactState(currentState),
          pageState: compactPageStateForStepAgent({
            step,
            beforeState,
            originalInstruction: instruction,
          }),
          snapshot: compactSnapshotForModel(before?.snapshot),
        },
      }));


      stepPlan = stepAgentCall.call?.data || {};
      trace.push(traceEntry({
        role: "gemma_step_agent",
        title: "Gemma step agent",
        step: stepNumber,
        status: stepPlan.status || (stepAgentCall.ok ? "ready" : "failed"),
        input: step,
        output: stepPlan,
        summary: stepPlan.reason || stepPlan.messageToChecker || "",
        tool: stepPlan.command?.tool || "",
        ok: stepAgentCall.ok,
        usage: usageOf(stepAgentCall),
        reasoning: thinkingOf(stepAgentCall),
      }));

      const agentProducedExecutableCommand = Boolean(
        stepAgentCall.ok === true &&
        stepPlan &&
        typeof stepPlan === "object" &&
        stepPlan.command &&
        stepPlan.command.tool
      );

      if (
        activeWatcherHardCloseStepV4(step) &&
        !agentProducedExecutableCommand
      ) {
        stepPlan = {
          status: "needs_runtime_watcher",
          command: null,
          reason: "Generic close/dismiss step must be handled by active watcher against live Playwright UI, not by Lightpanda link navigation.",
          messageToChecker: "",
          messageToUser: "",
          confidence: 1,
        };
      } else if (
        !agentProducedExecutableCommand &&
        envFlag("BROWSER_AGENT_LIGHTPANDA_CLICK_PLANNER", true) &&
        lightpandaClickPlannerMode !== "off"
      ) {
        const fallbackStepPlan = syntheticStepPlanFromLightpandaClick({
          step,
          beforeState,
          originalInstruction: instruction,
        });

        if (fallbackStepPlan) {
          stepPlan = fallbackStepPlan;
          trace.push(traceEntry({
            role: "gemma_step_agent",
            title: "Lightpanda fallback planner",
            step: stepNumber,
            status: "synthetic_ready",
            input: step,
            output: stepPlan,
            summary: stepPlan.reason || "",
            tool: stepPlan.command?.tool || "",
            ok: true,
          }));
        }
      }
    }

    let checkerCall = null;
    let checker = null;

    const snapshotChecker = fastSnapshotCheckerForStep({ stepPlan, step, before });
    const playwrightScoutChecker = playwrightScoutEvidenceCheckerForStep({ stepPlan, step });
    const lightpandaEvidenceChecker = envFlag("BROWSER_AGENT_LIGHTPANDA_EVIDENCE_CHECKER", true)
      ? lightpandaEvidenceCheckerForStep({ stepPlan, beforeState, step })
      : null;

    if (playwrightScoutChecker) {
      checker = playwrightScoutChecker;
      trace.push(traceEntry({
        role: "gemma_checker",
        title: "Playwright scout checker",
        step: stepNumber,
        status: checker.status,
        input: stepPlan,
        output: checker,
        summary: checker.reason || "",
        tool: checker.command?.tool || stepPlan.command?.tool || "",
        ok: true,
      }));
    } else if (lightpandaEvidenceChecker) {
      checker = lightpandaEvidenceChecker;
      trace.push(traceEntry({
        role: "gemma_checker",
        title: "Lightpanda evidence checker",
        step: stepNumber,
        status: checker.status,
        input: stepPlan,
        output: checker,
        summary: checker.reason || "",
        tool: checker.command?.tool || stepPlan.command?.tool || "",
        ok: true,
      }));
    } else if (
      envFlag("BROWSER_AGENT_LIGHTPANDA_CLICK_PLANNER_AUTO_APPROVE", true) &&
      stepPlan?.syntheticSource === "lightpanda_click_planner" &&
      isLowRiskAutoCheckCommand(stepPlan.command, step)
    ) {
      checker = syntheticApprovedChecker({
        ...stepPlan,
        reason: stepPlan.reason || "Lightpanda resolved a safe link target.",
      });
      trace.push(traceEntry({
        role: "gemma_checker",
        title: "Lightpanda command checker",
        step: stepNumber,
        status: "auto_approved",
        input: stepPlan,
        output: checker,
        summary: stepPlan.reason || checker.reason,
        tool: checker.command?.tool || stepPlan.command?.tool || "",
        ok: true,
      }));
    } else if (envFlag("BROWSER_AGENT_SKIP_LOW_RISK_CHECKER", true) && isLowRiskAutoCheckCommand(stepPlan.command, step)) {
      checker = syntheticApprovedChecker(stepPlan);
      trace.push(traceEntry({
        role: "gemma_checker",
        title: "Gemma command checker",
        step: stepNumber,
        status: "auto_approved",
        input: stepPlan,
        output: checker,
        summary: checker.reason,
        tool: checker.command?.tool || stepPlan.command?.tool || "",
        ok: true,
      }));
    } else if (snapshotChecker) {
      checker = snapshotChecker;
      trace.push(traceEntry({
        role: "gemma_checker",
        title: "Snapshot command checker",
        step: stepNumber,
        status: checker.status,
        input: stepPlan,
        output: checker,
        summary: checker.reason || checker.repairInstruction || checker.messageToUser || "",
        tool: checker.command?.tool || stepPlan.command?.tool || "",
        ok: true,
      }));
    } else {
      checkerCall = await safeRole("gemma_checker", () => runCheckerAgent({
        schemaName: "gemma_checker",
        images: beforeImages,
        context: {
          originalInstruction: instruction,
          fullPlan: { ...orchestratorPlan, steps },
          stepNumber,
          step,
          currentUrl,
          currentTitle,
          pageState: compactBeforeState,
          snapshot: compactSnapshotForModel(before?.snapshot),
          proposedCommand: stepPlan.command || null,
        },
      }));

      if (isInvalidJsonCheckerError(checkerCall) && envFlag("BROWSER_AGENT_CHECKER_RETRY_ON_INVALID_JSON", true)) {
        checkerCall = await safeRole("gemma_checker_retry", () => runCheckerAgent({
          schemaName: "gemma_checker_retry",
          images: [],
          context: {
            originalInstruction: instruction,
            fullPlan: { ...orchestratorPlan, steps },
            stepNumber,
            step,
            currentUrl,
            currentTitle,
            pageState: compactPageStateForStepAgent({
              step,
              beforeState,
              originalInstruction: instruction,
            }),
            snapshot: compactSnapshotForModel(before?.snapshot),
            proposedCommand: stepPlan.command || null,
            retryReason: "Previous checker call returned invalid JSON. Return only strict JSON matching the checker schema.",
          },
        }));
      }


      checker = checkerCall.call?.data || {};
      const checkerFallback = checkerFallbackAfterModelError({ checkerCall, stepPlan, step, before });
      if (checkerFallback) {
        checker = checkerFallback;
        checkerCall = {
          ...checkerCall,
          ok: true,
          error: "",
        };
      }
      trace.push(traceEntry({
        role: "gemma_checker",
        title: "Gemma command checker",
        step: stepNumber,
        status: checker.status || (checkerCall.ok ? "checked" : "failed"),
        input: stepPlan,
        output: checker,
        summary: checker.reason || checker.repairInstruction || checker.messageToUser || "",
        tool: checker.command?.tool || stepPlan.command?.tool || "",
        ok: checkerDecisionForExecution(checker, checkerCall).ok,
        usage: usageOf(checkerCall),
        reasoning: thinkingOf(checkerCall),
      }));
    }

    const checkerDecision = checkerDecisionForExecution(checker, checkerCall);
    if (!checkerDecision.ok) {
      stoppedReason = checkerDecision.reason || "Step was not approved.";
      stepResults.push({ stepNumber, step, ok: false, status: "not_approved", summary: stoppedReason });
      break;
    }

    const normalized = normalizeCommand(checker.command || stepPlan.command, currentUrl);
    if (!normalized.ok) {
      stoppedReason = normalized.error;
      stepResults.push({ stepNumber, step, ok: false, status: "bad_command", summary: normalized.error });
      break;
    }

    const targetAdjustedCommand = commandWithLightpandaExecutionTarget(normalized.command, {
      step,
      beforeState,
      originalInstruction: instruction,
      currentUrl,
    });

    if (targetAdjustedCommand !== normalized.command) {
      trace.push(traceEntry({
        role: "playwright_controller",
        title: "Lightpanda execution target",
        step: stepNumber,
        status: "prepared",
        input: normalized.command,
        output: targetAdjustedCommand,
        summary: "Prepared real Playwright click target from Lightpanda DOM evidence for button-like intent.",
        tool: targetAdjustedCommand.tool,
        ok: null,
      }));
    }

    const executionCommand = commandWithFreshFillBeforeSubmit(targetAdjustedCommand, lastSuccessfulFillCommand);

    if (executionCommand !== normalized.command) {
      trace.push(traceEntry({
        role: "playwright_controller",
        title: "Playwright browser controller",
        step: stepNumber,
        status: "prepared",
        input: normalized.command,
        output: executionCommand,
        summary: "Re-filling verified form fields immediately before submit.",
        tool: executionCommand.tool,
        ok: null,
      }));
    }

    let execution = await executePlaywrightMcpBrowserCommand({
      command: executionCommand,
      args: { ...args, currentUrl },
      state: currentState,
      beforeSnapshot: before?.snapshot || null,
      beforeObservation: observationFromPageState(beforeState),
      skipBeforeSnapshot: !captureBeforeSnapshot && beforeState?.ok === true,
    });

    trace.push(traceEntry({
      role: "playwright_controller",
      title: "Playwright browser controller",
      step: stepNumber,
      status: execution.status || "executed",
      input: executionCommand,
      output: {
        url: execution.observation?.url || "",
        title: execution.observation?.title || "",
        error: execution.error || "",
        summary: execution.actionResult?.text || "",
        actionDetails: browserExecutionUiDetails(executionCommand, execution),
      },
      summary: browserExecutionTraceSummary(executionCommand, execution),
      tool: executionCommand.tool,
      ok: execution.ok === true,
    }));

    let resultCheckCall = null;
    let resultCheck = null;

    const deterministicUiCheckV2 = await deterministicUiStateResultCheck({
      step,
      command: executionCommand,
      execution,
      currentUrl,
      currentState,
    });

    if (deterministicUiCheckV2?.success === true) {
      resultCheck = deterministicUiCheckV2;
      trace.push(traceEntry({
        role: "gemma_result_checker",
        title: "Deterministic UI result checker",
        step: stepNumber,
        status: "auto_passed_ui_state",
        input: {
          step,
          command: executionCommand,
          executionStatus: execution.status,
        },
        output: resultCheck,
        summary: resultCheck.summary || resultCheck.evidence || "",
        ok: true,
      }));
    } else {

    const deterministicUiCheck = await deterministicUiStateResultCheck({
      step,
      command: executionCommand,
      execution,
      currentUrl,
      currentState,
    });

    if (deterministicUiCheck?.success === true) {
      resultCheck = deterministicUiCheck;
      trace.push(traceEntry({
        role: "gemma_result_checker",
        title: "Deterministic UI result checker",
        step: stepNumber,
        status: "auto_passed_ui_state",
        input: {
          step,
          command: executionCommand,
          executionStatus: execution.status,
        },
        output: resultCheck,
        summary: resultCheck.summary || resultCheck.evidence || "",
        ok: true,
      }));
    } else if (
      (envFlag("BROWSER_AGENT_SKIP_LOW_RISK_RESULT_CHECKER", true) && isLowRiskAutoCheckCommand(normalized.command, step)) ||
      (envFlag("BROWSER_AGENT_SNAPSHOT_RESULT_FAST_PATH", true) && isSnapshotResultAutoPassCommand(normalized.command, step, execution))
    ) {
      resultCheck = syntheticPassedResult({ execution, step, command: executionCommand });
      trace.push(traceEntry({
        role: "gemma_result_checker",
        title: "Gemma result checker",
        step: stepNumber,
        status: "auto_passed",
        input: {
          step,
          command: executionCommand,
          executionStatus: execution.status,
        },
        output: resultCheck,
        summary: resultCheck.summary || resultCheck.evidence || "",
        ok: resultCheck.success === true,
      }));
    } else {
      const resultImages = snapshotImagesForModel(execution.beforeSnapshot || before?.snapshot, execution.afterSnapshot);
      const liveUiStateAfterExecution = await probePlaywrightUiState({
        currentUrl: execution.observation?.url || currentUrl || "",
        navigate: false,
      }, currentState).catch((err) => ({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }));

      resultCheckCall = await safeRole("gemma_result_checker", () => runWatcherAgent({
        schemaName: "gemma_result_checker",
        images: resultImages,
        context: {
          originalInstruction: instruction,
          fullPlan: { ...orchestratorPlan, steps },
          stepNumber,
          step,
          command: normalized.command,
          browserExecution: {
            ok: execution.ok,
            status: execution.status,
            error: execution.error || "",
            observation: observationFromExecution(execution),
          },
          beforeState: compactBeforeState,
          liveUiStateAfterExecution,
          watcherContext: watcherHybridContext({
            stepResults,
            trace,
            beforeState,
            currentUrl,
            currentTitle,
          }),
          beforeSnapshot: compactSnapshotForModel(execution.beforeSnapshot || before?.snapshot),
          afterSnapshot: compactSnapshotForModel(execution.afterSnapshot),
        },
      }));


      resultCheck = watcherResultOrFallback({
        resultCheck: resultCheckCall.call?.data || {},
        resultCheckCall,
        execution,
        step,
        command: executionCommand,
        beforeState,
      });
      trace.push(traceEntry({
        role: "gemma_result_checker",
        title: "Gemma result checker",
        step: stepNumber,
        status: resultCheck.status || (resultCheckCall.ok ? "checked" : "failed"),
        input: {
          step,
          command: executionCommand,
          executionStatus: execution.status,
        },
        output: resultCheck,
        summary: resultCheck.summary || resultCheck.evidence || resultCheck.repairInstruction || "",
        ok: resultCheck.success === true,
        usage: usageOf(resultCheckCall),
        reasoning: thinkingOf(resultCheckCall),
      }));
    }


    }
    let repaired = false;
    const initialSyncRepair = parseWatcherSyncRepairInstruction(resultCheck?.repairInstruction || "");
    const effectiveRepairAttempts = initialSyncRepair ? Math.max(1, maxRepairAttempts) : maxRepairAttempts;

    for (let repairAttempt = 0; repairAttempt < effectiveRepairAttempts; repairAttempt += 1) {
      if (resultCheck.success === true) break;
      if (!resultCheck.repairInstruction) break;

      repaired = true;
      trace.push(traceEntry({
        role: "repair_loop",
        title: `Repair attempt ${repairAttempt + 1}`,
        step: stepNumber,
        status: "started",
        input: resultCheck.repairInstruction,
        summary: resultCheck.repairInstruction,
        ok: null,
      }));

      const syncRepair = parseWatcherSyncRepairInstruction(resultCheck.repairInstruction);
      if (syncRepair) {
        const syncCommand = {
          intent: "sync_playwright_to_lightpanda",
          tool: "browserNavigate",
          args: { url: syncRepair.url },
          notes: "Watcher requested Playwright sync to Lightpanda URL before retrying the original action.",
        };

        const syncExecution = await executePlaywrightMcpBrowserCommand({
          command: syncCommand,
          args: { ...args, currentUrl: syncRepair.url },
          state: currentState,
          beforeObservation: observationFromPageState(beforeState),
          skipBeforeSnapshot: true,
        });

        trace.push(traceEntry({
          role: "playwright_controller",
          title: "Playwright sync controller",
          step: stepNumber,
          status: syncExecution.status || "synced",
          input: syncCommand,
          output: {
            url: syncExecution.observation?.url || "",
            title: syncExecution.observation?.title || "",
            error: syncExecution.error || "",
            summary: syncExecution.actionResult?.text || "",
            actionDetails: browserExecutionUiDetails(syncCommand, syncExecution),
          },
          summary: "Watcher sync: " + browserExecutionTraceSummary(syncCommand, syncExecution),
          tool: syncCommand.tool,
          ok: syncExecution.ok === true,
        }));

        if (!syncExecution.ok) {
          execution = syncExecution;
          resultCheck = watcherResultOrFallback({
            resultCheck: {},
            resultCheckCall,
            execution,
            step,
            command: syncCommand,
            beforeState,
          });
          continue;
        }

        execution = await executePlaywrightMcpBrowserCommand({
          command: executionCommand,
          args: { ...args, currentUrl: syncRepair.url },
          state: currentState,
          beforeSnapshot: syncExecution.afterSnapshot || null,
          beforeObservation: observationFromPageState(beforeState),
        });

        trace.push(traceEntry({
          role: "playwright_controller",
          title: "Playwright retry controller",
          step: stepNumber,
          status: execution.status || "retried",
          input: executionCommand,
          output: {
            url: execution.observation?.url || "",
            title: execution.observation?.title || "",
            error: execution.error || "",
            summary: execution.actionResult?.text || "",
            actionDetails: browserExecutionUiDetails(executionCommand, execution),
          },
          summary: "Watcher retry: " + browserExecutionTraceSummary(executionCommand, execution),
          tool: executionCommand.tool,
          ok: execution.ok === true,
        }));

        const retryCheckCall = await safeRole("gemma_result_checker_repair", () => runWatcherAgent({
          schemaName: "gemma_result_checker_repair",
          images: snapshotImagesForModel(execution.beforeSnapshot, execution.afterSnapshot),
          context: {
            originalInstruction: instruction,
            fullPlan: { ...orchestratorPlan, steps },
            stepNumber,
            step,
            command: executionCommand,
            browserExecution: {
              ok: execution.ok,
              status: execution.status,
              error: execution.error || "",
              observation: observationFromExecution(execution),
            },
            beforeState: compactBeforeState,
            watcherContext: watcherHybridContext({
              stepResults,
              trace,
              beforeState,
              currentUrl: execution.observation?.url || syncRepair.url,
              currentTitle: execution.observation?.title || currentTitle,
            }),
            beforeSnapshot: compactSnapshotForModel(execution.beforeSnapshot),
            afterSnapshot: compactSnapshotForModel(execution.afterSnapshot),
            repairKind: "watcher_sync_retry",
          },
        }));

        resultCheckCall = retryCheckCall;
        resultCheck = watcherResultOrFallback({
          resultCheck: retryCheckCall.call?.data || {},
          resultCheckCall: retryCheckCall,
          execution,
          step,
          command: executionCommand,
          beforeState,
        });

        trace.push(traceEntry({
          role: "gemma_result_checker_repair",
          title: "Watcher sync retry checker",
          step: stepNumber,
          status: resultCheck.status || (retryCheckCall.ok ? "checked" : "failed"),
          input: executionCommand,
          output: resultCheck,
          summary: resultCheck.summary || resultCheck.evidence || resultCheck.repairInstruction || "",
          ok: resultCheck.success === true,
          usage: usageOf(retryCheckCall),
          reasoning: thinkingOf(retryCheckCall),
        }));

        continue;
      }

      const repairAgentCall = await safeRole("gemma_step_agent_repair", () => runStepAgent({
        schemaName: "gemma_step_agent_repair",
        images: snapshotImagesForModel(execution.afterSnapshot),
        context: {
          originalInstruction: instruction,
          stepNumber,
          step,
          previousCommand: normalized.command,
          failure: resultCheck,
          repairInstruction: resultCheck.repairInstruction,
          currentUrl: execution.observation?.url || currentUrl,
          currentTitle: execution.observation?.title || currentTitle,
          snapshot: compactSnapshotForModel(execution.afterSnapshot),
        },
      }));


      const repairPlan = repairAgentCall.call?.data || {};
      const repairCommand = normalizeCommand(repairPlan.command, execution.observation?.url || currentUrl);

      trace.push(traceEntry({
        role: "gemma_step_agent_repair",
        title: "Gemma repair agent",
        step: stepNumber,
        status: repairPlan.status || (repairAgentCall.ok ? "ready" : "failed"),
        input: resultCheck.repairInstruction,
        output: repairPlan,
        summary: repairPlan.reason || "",
        tool: repairPlan.command?.tool || "",
        ok: repairAgentCall.ok && repairCommand.ok,
        usage: usageOf(repairAgentCall),
        reasoning: thinkingOf(repairAgentCall),
      }));

      if (!repairCommand.ok) break;

      execution = await executePlaywrightMcpBrowserCommand({
        command: repairCommand.command,
        args: { ...args, currentUrl: execution.observation?.url || currentUrl },
        state: currentState,
        beforeSnapshot: execution.afterSnapshot || null,
      });

      const repairCheckCall = await safeRole("gemma_result_checker_repair", () => runWatcherAgent({
        schemaName: "gemma_result_checker_repair",
        images: snapshotImagesForModel(execution.beforeSnapshot, execution.afterSnapshot),
        context: {
          originalInstruction: instruction,
          stepNumber,
          step,
          command: repairCommand.command,
          browserExecution: {
            ok: execution.ok,
            status: execution.status,
            error: execution.error || "",
            observation: observationFromExecution(execution),
          },
          beforeState: compactBeforeState,
          watcherContext: watcherHybridContext({
            stepResults,
            trace,
            beforeState,
            currentUrl: execution.observation?.url || currentUrl,
            currentTitle: execution.observation?.title || currentTitle,
          }),
          beforeSnapshot: compactSnapshotForModel(execution.beforeSnapshot),
          afterSnapshot: compactSnapshotForModel(execution.afterSnapshot),
        },
      }));


      resultCheckCall = repairCheckCall;
      resultCheck = watcherResultOrFallback({
        resultCheck: repairCheckCall.call?.data || {},
        resultCheckCall: repairCheckCall,
        execution,
        step,
        command: repairCommand.command,
        beforeState,
      });

      trace.push(traceEntry({
        role: "gemma_result_checker_repair",
        title: "Gemma repair result checker",
        step: stepNumber,
        status: resultCheck.status || (repairCheckCall.ok ? "checked" : "failed"),
        input: repairCommand.command,
        output: resultCheck,
        summary: resultCheck.summary || resultCheck.evidence || "",
        ok: resultCheck.success === true,
        usage: usageOf(repairCheckCall),
        reasoning: thinkingOf(repairCheckCall),
      }));
    }

    const observation = observationFromExecution(execution);
    currentUrl = observation.url || currentUrl;
    currentTitle = observation.title || currentTitle;
    finalObservation = observation;

    const stepOk = execution.ok === true && resultCheck.success === true;
    stepResults.push({
      stepNumber,
      step,
      ok: stepOk,
      repaired,
      status: stepOk ? "passed" : "failed",
      summary: resultCheck.summary || execution.error || execution.actionResult?.text || "",
      url: currentUrl,
      title: currentTitle,
      command: executionCommand,
    });

    if (stepOk && commandHasFields(executionCommand)) {
      lastSuccessfulFillCommand = {
        ...executionCommand,
        tool: "browserFillFields",
      };
    }

    if (!stepOk) {
      stoppedReason = resultCheck.repairInstruction || resultCheck.summary || execution.error || "Step failed verification.";
      break;
    }
  }

  const passedAllSteps = stepResults.length === steps.length && stepResults.every((step) => step.ok);
  const watcherSideReport = buildWatcherSpyReport({
    instruction,
    stepResults,
    trace,
    finalObservation,
    stoppedReason,
    args,
    passedAllSteps,
  });
  let finalCall = null;
  let final = null;

  if (envFlag("BROWSER_AGENT_FINAL_VERIFIER_ENABLED", false)) {
    finalCall = await safeRole("final_verifier", () => runFinalVerifierAgent({
      schemaName: "final_verifier",
      context: {
        originalInstruction: instruction,
        orchestratorPlan: { ...orchestratorPlan, steps },
        stepResults,
        stoppedReason,
        finalObservation,
        watcherSideReport,
        userBehavior: watcherSideReport.userBehavior,
        responseGuidanceForMain: watcherSideReport.responseGuidanceForMain,
        trace: trace.map((entry) => ({
          role: entry.role,
          step: entry.step,
          status: entry.status,
          ok: entry.ok,
          summary: entry.summary,
          tool: entry.tool,
          output: entry.output && typeof entry.output === "object" ? {
            error: entry.output.error || "",
            actionDetails: entry.output.actionDetails || null,
          } : null,
        })),
      },
    }));


    final = finalCall.call?.data || {
      success: passedAllSteps,
      summary: finalBrowserAgentUserSummary({ passedAllSteps, stoppedReason, finalObservation, lastStep: stepResults.at(-1) }),
      needsUser: Boolean(stoppedReason),
      nextSafeAction: stoppedReason || "Continue with the next browser instruction.",
      missingSteps: [],
      reason: stoppedReason || "",
    };
  } else {
    const lastStep = stepResults.at(-1) || {};
    final = {
      success: passedAllSteps,
      summary: finalBrowserAgentUserSummary({ passedAllSteps, stoppedReason, finalObservation, lastStep }),
      needsUser: Boolean(stoppedReason) || !passedAllSteps,
      nextSafeAction: stoppedReason || "Continue with the next browser instruction.",
      missingSteps: passedAllSteps ? [] : steps.slice(stepResults.length).map((step) => step.instruction),
      reason: stoppedReason || "",
    };
  }

  if (!passedAllSteps && final?.success === true) {
    final = {
      ...final,
      success: false,
      needsUser: true,
      summary: stoppedReason || final.summary || "Browser task incomplete.",
      reason: stoppedReason || final.reason || "Not all browser steps passed.",
    };
  }

  if (passedAllSteps && final?.success !== true) {
    const lastStep = stepResults.at(-1) || {};
    final = {
      ...final,
      success: true,
      needsUser: false,
      summary: finalBrowserAgentUserSummary({
        passedAllSteps,
        stoppedReason: "",
        finalObservation,
        lastStep,
      }),
      missingSteps: [],
      reason: "",
      verifierOverridden: true,
      verifierOriginal: {
        success: final?.success,
        summary: final?.summary || "",
        reason: final?.reason || "",
        missingSteps: Array.isArray(final?.missingSteps) ? final.missingSteps : [],
      },
    };

    trace.push(traceEntry({
      role: "final_verifier",
      title: "Final verifier false-negative guard",
      status: "overrode_false_negative",
      input: {
        passedAllSteps,
        originalFinal: final.verifierOriginal,
      },
      output: final,
      summary: "All browser steps passed; overrode final verifier false negative.",
      ok: true,
    }));
  }

  trace.push(traceEntry({
    role: "final_verifier",
    title: "Final verifier",
    status: final.success ? (finalCall ? "verified" : "synthetic_verified") : "incomplete",
    input: {
      originalInstruction: instruction,
      stepResults,
    },
    output: final,
    summary: final.summary || final.reason || "",
    ok: final.success === true,
    usage: usageOf(finalCall),
    reasoning: thinkingOf(finalCall),
  }));

  const ok = final.success === true && stepResults.length === steps.length && stepResults.every((step) => step.ok);
  const timing = {
    totalMs: roundMs(nowMs() - startedAt),
    pipelineMs: roundMs(nowMs() - startedAt),
    mainModelMs: 0,
  };

  return {
    ok,
    status: ok ? "success" : stoppedReason ? "partial" : "failed",
    instruction,
    currentUrl,
    currentTitle,
    extensionId: "",
    pageKey: "",
    engine: "playwright_mcp",
    summary: final.summary || stoppedReason || "Browser task finished.",
    browserSummary: final.summary || stoppedReason || "Browser task finished.",
    whatFound: finalObservation
      ? {
          ok: Boolean(finalObservation.ok),
          url: finalObservation.url || "",
          title: finalObservation.title || "",
          textPreview: safeText(finalObservation.textPreview || finalObservation.text || "", 1800),
          engine: finalObservation.engine || "playwright_mcp",
        }
      : null,
    observedControls: {
      forms: Array.isArray(finalObservation?.forms) ? finalObservation.forms.length : 0,
      inputs: Array.isArray(finalObservation?.inputs) ? finalObservation.inputs.slice(0, 20) : [],
      buttons: Array.isArray(finalObservation?.buttons) ? finalObservation.buttons.slice(0, 20) : [],
      links: Array.isArray(finalObservation?.links) ? finalObservation.links.slice(0, 20) : [],
    },
    possibleNextActions: [],
    requiresUser: final.needsUser === true || !ok,
    blockedReason: ok ? "" : (stoppedReason || final.reason || ""),
    nextSafeAction: final.nextSafeAction || "Continue with the next browser instruction.",
    watcher: watcherSideReport,
    planner: orchestratorPlan,
    reporter: final,
    filledFields: [],
    missingFields: [],
    submitStatus: "",
    runtime,
    runtimeTiming: timing,
    tokenUsage: tokenUsageFromTrace(trace),
    agentTrace: trace,
    sequence: {
      completed: stepResults.filter((step) => step.ok).length,
      total: steps.length,
      stoppedAt: ok ? null : stepResults.length,
      items: stepResults.map((step) => ({
        index: step.stepNumber - 1,
        instruction: step.step.instruction,
        ok: step.ok,
        status: step.status,
        summary: step.summary,
        currentUrl: step.url || "",
        currentTitle: step.title || "",
        blockedReason: step.ok ? "" : stoppedReason,
      })),
    },
    pipeline: {
      architecture: BROWSER_AGENT_ARCHITECTURE,
      dryRun: false,
      runtime,
      agentTrace: trace,
      browserExecution: finalObservation
        ? {
            ok,
            status: ok ? "executed" : "partial",
            executed: true,
            tool: stepResults.at(-1)?.command?.tool || "",
            engine: "playwright_mcp",
            observation: finalObservation,
            summary: final.summary || "",
          }
        : null,
    },
  };
}
