import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  lightpandaClickBySelector,
  lightpandaClickByText,
  lightpandaFindInteractiveElements,
  lightpandaSnapshotCurrent,
  lightpandaWaitForSelector,
} from "./lightpanda-client.js";
import {
  getExtension,
  getExtensionSkill,
  listExtensions,
  matchExtensionForUrl,
} from "./extensions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIRM_PREFIX = "I CONFIRM ";
const DEFAULT_SESSION_ID = "default-browser-session";
const DANGEROUS_RE = /\b(login|log\s*in|sign\s*in|submit|save|delete|remove|check\s*out|checkout|emergency|approve|reject|payment|profile\s*update|password|attendance)\b/i;
const SUGGESTION_BLOCK_RE = /\b(login|log\s*in|sign\s*in|submit|save|delete|remove|check\s*out|checkout|emergency|approve|reject|payment|profile\s*update|password)\b/i;

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function boolArg(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "off", "no"].includes(String(value).trim().toLowerCase());
}

function browserAgentRuntimeConfig() {
  const baseUrl = String(
    process.env.BROWSER_AGENT_BASE_URL ||
    process.env.BROWSER_AGENT_API_BASE_URL ||
    process.env.RUNTIME_BROWSER_AGENT_BASE_URL ||
    ""
  ).trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const redactedBaseUrl = baseUrl.replace(/([?&](?:token|key|api_key)=)[^&]+/ig, "$1***");
  const model = String(process.env.BROWSER_AGENT_MODEL || process.env.RUNTIME_BROWSER_AGENT_MODEL || "").trim();
  return {
    enabled: envFlag("BROWSER_AGENT_LLM_ENABLED", false) && Boolean(baseUrl && model),
    baseUrl: redactedBaseUrl,
    model,
    timeoutMs: Math.max(1000, Number(process.env.BROWSER_AGENT_TIMEOUT_MS || 60000)),
    think: envFlag("BROWSER_AGENT_THINK", false),
    strategy: "deterministic-first",
    note: "Runtime LLM is optional; browser_agent uses deterministic safety and action heuristics unless explicitly enabled.",
  };
}

function siteSkillsDir() {
  return path.resolve(__dirname, "..", "config", "site-skills");
}

function agentStateDir() {
  return path.resolve(__dirname, "..", "config", "browser-agent");
}

function nowIso() {
  return new Date().toISOString();
}

function safeId(value, fallback = "item") {
  const id = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return id || fallback;
}

function safeSessionId(value) {
  return safeId(value || DEFAULT_SESSION_ID, DEFAULT_SESSION_ID);
}

function statePath(sessionId) {
  return path.join(agentStateDir(), `${safeSessionId(sessionId)}.json`);
}

function defaultState(sessionId = DEFAULT_SESSION_ID) {
  return {
    sessionId: safeSessionId(sessionId),
    mode: "browser",
    currentUrl: "",
    currentTitle: "",
    currentExtensionId: "",
    currentPageKey: "",
    lastObservation: null,
    pendingInstruction: "",
    pendingAction: null,
    visited: [],
    learnedAliases: [],
    lastToolResults: [],
    failureCount: 0,
    updatedAt: nowIso(),
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function loadState(sessionId = DEFAULT_SESSION_ID) {
  const safeSession = safeSessionId(sessionId);
  return {
    ...defaultState(safeSession),
    ...(readJson(statePath(safeSession)) || {}),
    sessionId: safeSession,
  };
}

function saveState(state) {
  const next = {
    ...defaultState(state?.sessionId || DEFAULT_SESSION_ID),
    ...(state || {}),
    updatedAt: nowIso(),
  };
  writeJson(statePath(next.sessionId), next);
  return next;
}

function safeText(value, limit = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function preview(value, limit = 1200) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function isLikelyUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) return true;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) return false;
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#][^\s]*)?$/i.test(raw);
}

function normalizeUrlInput(value = "") {
  const raw = String(value || "").trim();
  if (!isLikelyUrl(raw)) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function isHttpUrl(value = "") {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function extractUrl(text = "") {
  const raw = String(text || "");
  const url = raw.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (url) return url.replace(/[.,;]+$/, "");
  const domain = raw.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>]*)?/i)?.[0];
  return domain ? domain.replace(/[.,;]+$/, "") : "";
}

function textTokens(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeActionQuery(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(please|execute|click|open|go to|navigate to|perform|run|show|display|the|action|button|link|menu)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayPageKey(pageKey = "") {
  return safeText(pageKey || "current page").replace(/_/g, " ");
}

function domainFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function pathFromUrl(url = "") {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "";
  }
}

function isLoginObservation(observation = {}) {
  const page = observation.page || observation;
  const fields = [
    ...(page.inputs || []),
    ...(page.forms || []).flatMap((form) => form.fields || []),
  ];
  if (fields.some((field) => field.secret || /password/i.test(`${field.type || ""} ${field.name || ""} ${field.id || ""}`))) {
    return true;
  }
  return /\b(login|log in|sign in)\b/i.test(`${page.url || ""} ${page.title || ""} ${page.textPreview || ""}`);
}

function actionIsDangerous(action = {}, instruction = "") {
  if (action.requiresConfirmation) return true;
  return DANGEROUS_RE.test(`${action.label || ""} ${action.kind || ""} ${instruction || ""}`);
}

function requiredConfirmationPhrase(action = {}) {
  return `${CONFIRM_PREFIX}${action.label || action.id || "ACTION"}`;
}

function isProtectedSuggestion(action = {}) {
  const text = `${action.label || ""} ${action.kind || ""}`;
  const looksLikeFormEntry = /\b(application|form)\b/i.test(text) && !/\b(status|details|detail|view|search|read|history|report)\b/i.test(text);
  return actionIsDangerous(action) ||
    SUGGESTION_BLOCK_RE.test(text) ||
    /^form_submit$/i.test(action.kind || "") ||
    looksLikeFormEntry;
}

function publicActionType(action = {}) {
  const text = `${action.kind || ""} ${action.source || ""} ${action.href ? "href" : ""}`.toLowerCase();
  if (/\bsearch\b/.test(text)) return "search";
  if (/\blink|href\b/.test(text)) return "link";
  if (/\bform\b/.test(text)) return "form";
  if (/\bbutton\b/.test(text)) return "button";
  return "action";
}

function safeActionSummary(action = {}) {
  return {
    label: action.label || "",
    type: publicActionType(action),
    requiresConfirmation: Boolean(action.requiresConfirmation),
  };
}

function actionDebugSummary(action = {}) {
  return {
    id: action.id || "",
    label: action.label || "",
    kind: action.kind || "",
    pageKey: action.pageKey || "",
    requiresConfirmation: Boolean(action.requiresConfirmation),
    source: action.source || "",
  };
}

function extensionSummary(extension = null) {
  if (!extension) return null;
  return {
    id: extension.id || "",
    name: extension.name || extension.title || extension.id || "",
    domains: Array.isArray(extension.domains) ? extension.domains : [],
  };
}

function actionsForSkill(skill = {}) {
  const learned = Array.isArray(skill.learnedActions) ? skill.learnedActions : [];
  const imported = Array.isArray(skill.actions) ? skill.actions : [];
  const seen = new Set();
  return [...learned, ...imported].filter((action) => {
    const key = action.id || `${action.label || ""}:${action.pageKey || ""}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function skillFilePath(skillId, existingSkill = null) {
  const sourceFile = existingSkill?.sourceFile && String(existingSkill.sourceFile).endsWith(".json")
    ? existingSkill.sourceFile
    : `${safeId(skillId, "site")}.generated.json`;
  return path.join(siteSkillsDir(), sourceFile);
}

function createSkillForObservation(observation = {}, extensionId = "") {
  const page = observation.page || observation;
  const domain = domainFromUrl(page.url || "");
  const id = safeId(extensionId || domain || "learned_site", "learned_site");
  return {
    id,
    name: domain ? `${domain} Skill` : "Learned Site Skill",
    enabled: true,
    version: "0.1.0",
    source: "browser-agent.learn",
    domains: domain ? [domain] : [],
    updatedAt: nowIso(),
    rules: [
      "Use learned browser-agent actions only on matching domains.",
      "Ask for confirmation before risky or irreversible actions.",
      "Never reveal password values.",
    ],
    pages: {},
    actions: [],
    learnedActions: [],
    aliases: [],
    recipes: [],
  };
}

function pageKeyForObservation(skill = null, observation = {}) {
  const page = observation.page || observation;
  const url = page.url || "";
  const pages = skill?.pages && typeof skill.pages === "object" && !Array.isArray(skill.pages)
    ? skill.pages
    : {};

  if (isLoginObservation(observation)) {
    const loginKey = Object.keys(pages).find((key) => /login/i.test(key));
    if (loginKey) return loginKey;
    return "login_page";
  }

  const currentPath = pathFromUrl(url);
  const entries = Object.entries(pages);
  const exact = entries.find(([, value]) => value?.url && safeText(value.url, 500).replace(/\/+$/, "") === safeText(url, 500).replace(/\/+$/, ""));
  if (exact) return exact[0];

  const pathMatch = entries
    .filter(([, value]) => value?.path && currentPath && currentPath.includes(value.path))
    .sort((a, b) => String(b[1].path || "").length - String(a[1].path || "").length)[0];
  if (pathMatch) return pathMatch[0];

  return safeId(currentPath === "/" ? page.title || "page" : currentPath, "page");
}

function observationFromPageResult(result = {}) {
  const page = result?.page || {};
  const observation = {
    ok: Boolean(result?.ok),
    url: page.url || "",
    title: page.title || "",
    textPreview: safeText(page.text || page.textPreview || "", 2400),
    links: Array.isArray(page.links) ? page.links.slice(0, 80) : [],
    buttons: Array.isArray(page.buttons) ? page.buttons.slice(0, 80) : [],
    inputs: Array.isArray(page.inputs) ? page.inputs.slice(0, 80) : [],
    forms: Array.isArray(page.forms) ? page.forms.slice(0, 20) : [],
    interactiveElements: Array.isArray(page.interactiveElements) ? page.interactiveElements.slice(0, 140) : [],
    stats: page.stats || {},
  };
  observation.isLoginPage = isLoginObservation(observation);
  return observation;
}

async function observePage(args = {}, state = defaultState()) {
  const currentUrl = normalizeUrlInput(args.currentUrl || state.currentUrl || "");
  const result = await lightpandaSnapshotCurrent({
    currentUrl,
    waitMs: args.waitMs || "900",
  });
  const observation = observationFromPageResult(result);
  const useExtensions = boolArg(args.useExtensions, true);
  const matched = !useExtensions
    ? null
    : args.extensionId
    ? getExtension(args.extensionId)
    : isHttpUrl(observation.url)
      ? matchExtensionForUrl(observation.url)
      : null;
  const skill = matched ? getExtensionSkill(matched.id) : null;
  const pageKey = pageKeyForObservation(skill, observation);

  return {
    ok: true,
    observation,
    extension: matched,
    pageKey,
    raw: result,
  };
}

function extensionFromContext({ extensionId = "", observation = null, state = null, instruction = "" } = {}) {
  if (state?.useExtensions === false) return null;
  if (extensionId) return getExtension(extensionId);
  const mentioned = listExtensions().find((extension) => {
    const haystack = [
      extension.id,
      extension.name,
      ...(extension.domains || []),
    ].join(" ").toLowerCase();
    return textTokens(haystack).some((token) => token.length >= 3 && textTokens(instruction).includes(token));
  });
  if (mentioned) return mentioned;
  if (observation?.url) {
    const matched = isHttpUrl(observation.url) ? matchExtensionForUrl(observation.url) : null;
    if (matched) return matched;
  }
  if (!observation?.url && state?.currentExtensionId) return getExtension(state.currentExtensionId);
  return null;
}

function listActionCandidates(extensionId = "") {
  const extensions = extensionId
    ? [getExtension(extensionId)].filter(Boolean)
    : listExtensions();

  return extensions.flatMap((extension) => {
    const skill = getExtensionSkill(extension.id);
    return actionsForSkill(skill).map((action) => ({
      ...action,
      extensionId: extension.id,
      extensionName: extension.name,
    }));
  });
}

function scoreActionForInstruction(action = {}, instruction = "") {
  const query = normalizeActionQuery(instruction);
  const label = normalizeActionQuery(action.label || action.id || "");
  const id = normalizeActionQuery(action.id || "");

  if (!query || !label) return 0;
  if (query === label || query === id) return 1;
  if (label.includes(query)) return 0.94;
  if (query.includes(label)) return 0.9;

  const qTokens = textTokens(query);
  const labelTokens = new Set(textTokens(`${label} ${id} ${action.kind || ""}`));
  if (!qTokens.length || !labelTokens.size) return 0;

  const overlap = qTokens.filter((token) => labelTokens.has(token)).length;
  const coverage = overlap / qTokens.length;
  const density = overlap / Math.max(labelTokens.size, 1);
  return Math.max(coverage * 0.82, (coverage + density) / 2);
}

function resolveInstructionAction({ instruction = "", extensionId = "" } = {}) {
  if (!extensionId) {
    return {
      ok: false,
      reason: "No active extension for the current page.",
      candidates: [],
    };
  }

  const candidates = listActionCandidates(extensionId)
    .map((action) => ({
      action,
      score: scoreActionForInstruction(action, instruction) + (action.source === "browser-agent.learn" ? 0.04 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 0.45) {
    return {
      ok: false,
      reason: "No matching extension action found.",
      candidates: candidates.slice(0, 6).map((entry) => ({
        score: Number(entry.score.toFixed(2)),
        action: actionDebugSummary(entry.action),
      })),
    };
  }

  return {
    ok: true,
    action: best.action,
    score: best.score,
    alternatives: candidates.slice(1, 5).map((entry) => ({
      score: Number(entry.score.toFixed(2)),
      action: actionDebugSummary(entry.action),
    })),
  };
}

function classifyInstruction(instruction = "") {
  const lower = String(instruction || "").toLowerCase();
  if (/\b(this|that)\s+(button|link|page)\s+(is|opens)\b|\bremember\b|\blearn\b|\buse this page for\b/i.test(lower)) {
    return "learn";
  }
  if (/\b(show|list|available|what)\b.*\b(actions?|extensions?|site skills?)\b|\bknown actions\b/i.test(lower)) {
    return "show_actions";
  }
  if (/\b(observe|snapshot|where am i|current page|status)\b/i.test(lower)) {
    return "observe";
  }
  if (extractUrl(instruction) && /\b(open|visit|navigate|go to|load)\b/i.test(lower)) {
    return "navigate";
  }
  return "action";
}

function matchingElementFromObservation(observation = {}, label = "") {
  const wanted = normalizeActionQuery(label);
  if (!wanted) return null;
  const elements = [
    ...(observation.interactiveElements || []),
    ...(observation.buttons || []),
    ...(observation.links || []),
  ];

  const scored = elements
    .map((element) => {
      const text = normalizeActionQuery(`${element.text || ""} ${element.ariaLabel || ""} ${element.name || ""} ${element.id || ""}`);
      if (!text) return null;
      let score = 0;
      if (text === wanted) score = 1;
      else if (text.includes(wanted) || wanted.includes(text)) score = 0.88;
      else {
        const tokens = textTokens(wanted);
        const hay = new Set(textTokens(text));
        score = tokens.length ? tokens.filter((token) => hay.has(token)).length / tokens.length : 0;
      }
      return { element, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score >= 0.5 ? scored[0].element : null;
}

function pageMatchesAction(action = {}, observation = {}, pageKey = "") {
  if (!action.pageKey) return true;
  if (action.pageKey === pageKey) return true;
  const actionPath = pathFromUrl(action.href || "");
  const currentPath = pathFromUrl(observation.url || "");
  return Boolean(actionPath && currentPath && actionPath === currentPath);
}

function selectedSafeActions(extensionId = "") {
  if (!extensionId) return [];
  return listActionCandidates(extensionId)
    .filter((action) => !isProtectedSuggestion(action))
    .slice(0, 12)
    .map(safeActionSummary);
}

function observedFieldsAndButtons(observation = {}) {
  const fields = [
    ...(observation.inputs || []),
    ...(observation.forms || []).flatMap((form) => form.fields || []),
  ].map((field) => ({
    name: field.name || "",
    id: field.id || "",
    type: field.secret ? "password" : field.type || "",
    placeholder: field.placeholder || "",
    required: Boolean(field.required),
    selector: field.selector || "",
  })).slice(0, 30);

  const buttons = [
    ...(observation.buttons || []),
    ...(observation.forms || []).flatMap((form) => form.buttons || []),
  ].map((button) => ({
    text: button.text || "",
    type: button.type || "",
    selector: button.selector || "",
  })).slice(0, 30);

  return { fields, buttons };
}

function inferredLearnLabel(instruction = "", args = {}) {
  if (args.label) return safeText(args.label, 160);
  const patterns = [
    /\bremember\s+(?:this|that)?\s*(?:button|link|page|action)?\s*(?:as|for)\s+["']?(.+?)["']?$/i,
    /\bthis\s+(?:button|link|page|action)\s+(?:is|opens)\s+["']?(.+?)["']?$/i,
    /\bthat\s+(?:button|link|page|action)\s+(?:is|opens)\s+["']?(.+?)["']?$/i,
    /\buse\s+this\s+page\s+for\s+["']?(.+?)["']?$/i,
    /\bremember\s+["']?(.+?)["']?\s+action\b/i,
  ];
  for (const pattern of patterns) {
    const match = String(instruction || "").match(pattern);
    if (match?.[1]) return safeText(match[1].replace(/[.?!]+$/, ""), 160);
  }
  return "";
}

function learnedActionFrom({ label, args = {}, observation = {}, element = null, baseAction = null, confidence = 0.74, success = false } = {}) {
  const page = observation || {};
  const kind = args.kind || baseAction?.kind || element?.role || (element?.href ? "link" : "button");
  const pageKey = args.pageKey || baseAction?.pageKey || page.pageKey || safeId(pathFromUrl(page.url || "") || page.title || "page", "page");
  const selector = args.selector || element?.selector || baseAction?.selector || "";
  const href = args.href || element?.href || baseAction?.href || "";
  const textPattern = args.textPattern || element?.text || label;
  const idBase = baseAction?.id && baseAction.source !== "browser-agent.learn"
    ? `${baseAction.id}_learned`
    : `learned_${pageKey}_${safeId(label, "action")}`;

  return {
    id: safeId(idBase, `learned_${safeId(label, "action")}`),
    label,
    kind,
    domain: domainFromUrl(page.url || href || ""),
    pageKey,
    url: page.url || "",
    title: page.title || "",
    selector,
    fallbackSelectors: [selector, baseAction?.selector].filter(Boolean).filter((value, index, arr) => arr.indexOf(value) === index),
    textPattern,
    href,
    requiresConfirmation: DANGEROUS_RE.test(`${label} ${kind}`),
    source: "browser-agent.learn",
    confidence,
    lastSucceededAt: success ? nowIso() : "",
    successCount: success ? 1 : 0,
    failureCount: 0,
    observedAt: nowIso(),
  };
}

function mergeLearnedAction(skill, learnedAction) {
  const learned = Array.isArray(skill.learnedActions) ? skill.learnedActions : [];
  const index = learned.findIndex((entry) =>
    entry.id === learnedAction.id ||
    (safeText(entry.label).toLowerCase() === safeText(learnedAction.label).toLowerCase() && entry.pageKey === learnedAction.pageKey)
  );
  const previous = index >= 0 ? learned[index] : null;
  const merged = {
    ...(previous || {}),
    ...learnedAction,
    fallbackSelectors: Array.from(new Set([
      ...(previous?.fallbackSelectors || []),
      ...(learnedAction.fallbackSelectors || []),
    ].filter(Boolean))).slice(0, 8),
    successCount: Number(previous?.successCount || 0) + Number(learnedAction.successCount || 0),
    failureCount: Number(previous?.failureCount || 0) + Number(learnedAction.failureCount || 0),
  };

  const nextLearned = [...learned];
  if (index >= 0) nextLearned[index] = merged;
  else nextLearned.push(merged);
  skill.learnedActions = nextLearned.sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
  return merged;
}

function saveLearnedAction({ extensionId = "", observation = {}, action = null, element = null, args = {}, success = false } = {}) {
  const label = safeText(args.label || action?.label || element?.text || args.instruction || "", 160);
  if (!label) throw new Error("learned action label is required");

  const matchedExtension = extensionId ? getExtension(extensionId, { includeDisabled: true }) : observation.url ? matchExtensionForUrl(observation.url) : null;
  const existingSkill = extensionId
    ? getExtensionSkill(extensionId, { includeDisabled: true })
    : matchedExtension ? getExtensionSkill(matchedExtension.id, { includeDisabled: true }) : null;
  if (existingSkill?.enabled === false) {
    throw new Error(`extension is disabled: ${extensionId || matchedExtension?.id || existingSkill.id}`);
  }
  const skillId = matchedExtension?.id || extensionId || safeId(domainFromUrl(observation.url || "") || "learned_site", "learned_site");
  const skill = existingSkill || createSkillForObservation(observation, skillId);
  const pageKey = args.pageKey || action?.pageKey || pageKeyForObservation(skill, observation);
  const learnedAction = learnedActionFrom({
    label,
    args: { ...args, pageKey },
    observation: { ...observation, pageKey },
    element,
    baseAction: action,
    confidence: args.confidence ?? (success ? 0.88 : 0.72),
    success,
  });

  const pages = skill.pages && typeof skill.pages === "object" && !Array.isArray(skill.pages) ? skill.pages : {};
  skill.pages = {
    ...pages,
    [pageKey]: {
      ...(pages[pageKey] || {}),
      key: pageKey,
      url: observation.url || pages[pageKey]?.url || "",
      title: observation.title || pages[pageKey]?.title || "",
      path: pathFromUrl(observation.url || "") || pages[pageKey]?.path || "",
      learnedAt: nowIso(),
    },
  };

  const domain = domainFromUrl(observation.url || learnedAction.href || "");
  if (domain) {
    skill.domains = Array.from(new Set([...(Array.isArray(skill.domains) ? skill.domains : []), domain]));
  }
  skill.aliases = Array.isArray(skill.aliases) ? skill.aliases : [];
  skill.recipes = Array.isArray(skill.recipes) ? skill.recipes : [];
  const merged = mergeLearnedAction(skill, learnedAction);
  skill.updatedAt = nowIso();
  writeJson(skillFilePath(skill.id || skillId, existingSkill), skill);
  return merged;
}

async function learnAction(args = {}, state = defaultState(), existingObservation = null) {
  const instruction = String(args.instruction || "");
  const label = inferredLearnLabel(instruction, args);
  if (!label) {
    return {
      ok: false,
      status: "needs_user",
      summary: "Tell me the action label to remember, for example: remember this button as Pricing.",
      requiresUser: true,
    };
  }

  const observation = existingObservation || state.lastObservation || {};
  const element = args.selector || args.href
    ? null
    : matchingElementFromObservation(observation, label);
  const learned = saveLearnedAction({
    extensionId: args.extensionId || state.currentExtensionId || "",
    observation,
    element,
    args: {
      ...args,
      label,
      selector: args.selector || element?.selector || "",
      href: args.href || element?.href || "",
      textPattern: args.textPattern || element?.text || label,
    },
  });

  return {
    ok: true,
    status: "success",
    learned,
    summary: `Learned "${learned.label}" for ${learned.domain || "this site"}.`,
  };
}

function addStep(steps, step) {
  steps.push({
    ...step,
    resultPreview: step.resultPreview === undefined ? undefined : preview(step.resultPreview, 1400),
  });
}

function updateStateFromObservation(state, observeResult, instruction = "") {
  const observation = observeResult?.observation || null;
  if (!observation) return state;
  const extension = observeResult.extension || null;
  const nextVisited = observation.url
    ? [observation.url, ...(state.visited || []).filter((url) => url !== observation.url)].slice(0, 50)
    : state.visited || [];
  return {
    ...state,
    mode: "browser",
    currentUrl: observation.url || state.currentUrl || "",
    currentTitle: observation.title || state.currentTitle || "",
    currentExtensionId: observation.url ? (extension?.id || "") : (state.currentExtensionId || ""),
    currentPageKey: observeResult.pageKey || state.currentPageKey || "",
    lastObservation: observation,
    pendingInstruction: instruction,
    visited: nextVisited,
  };
}

function runOutput(base = {}) {
  return {
    ok: Boolean(base.ok),
    status: base.status || (base.ok ? "success" : "failed"),
    instruction: base.instruction || "",
    currentUrl: base.currentUrl || "",
    currentTitle: base.currentTitle || "",
    extensionId: base.extensionId || "",
    pageKey: base.pageKey || "",
    steps: base.steps || [],
    summary: base.summary || "",
    whatFound: base.whatFound || null,
    possibleNextActions: base.possibleNextActions || [],
    learned: base.learned || undefined,
    requiresUser: Boolean(base.requiresUser),
    blockedReason: base.blockedReason || undefined,
  };
}

export async function browserAgentObserve(args = {}) {
  const state = loadState(args.sessionId);
  const steps = [];
  try {
    const observed = await observePage(args, state);
    addStep(steps, {
      type: "observe",
      tool: "mcp__browser__lightpanda_action",
      input: { currentUrl: normalizeUrlInput(args.currentUrl || state.currentUrl || "") },
      resultPreview: observed.observation,
      ok: true,
    });
    const nextState = saveState(updateStateFromObservation(state, observed, args.instruction || ""));
    return runOutput({
      ok: true,
      status: "success",
      instruction: args.instruction || "observe",
      currentUrl: nextState.currentUrl,
      currentTitle: nextState.currentTitle,
      extensionId: nextState.currentExtensionId,
      pageKey: nextState.currentPageKey,
      steps,
      summary: `Observed ${nextState.currentTitle || nextState.currentUrl || "the current page"}.`,
      whatFound: nextState.lastObservation,
      possibleNextActions: selectedSafeActions(nextState.currentExtensionId),
    });
  } catch (err) {
    return runOutput({
      ok: false,
      status: "failed",
      instruction: args.instruction || "observe",
      currentUrl: state.currentUrl,
      currentTitle: state.currentTitle,
      extensionId: state.currentExtensionId,
      pageKey: state.currentPageKey,
      steps,
      summary: "Could not observe the browser page.",
      blockedReason: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function browserAgentLearn(args = {}) {
  const state = loadState(args.sessionId);
  const steps = [];
  let observed = null;

  try {
    observed = await observePage(args, state);
    addStep(steps, {
      type: "observe",
      tool: "mcp__browser_agent__observe",
      input: { currentUrl: normalizeUrlInput(args.currentUrl || state.currentUrl || "") },
      resultPreview: observed.observation,
      ok: true,
    });
  } catch (err) {
    addStep(steps, {
      type: "observe",
      tool: "mcp__browser_agent__observe",
      input: {},
      resultPreview: err instanceof Error ? err.message : String(err),
      ok: false,
    });
  }

  const nextState = observed ? updateStateFromObservation(state, observed, args.instruction || "") : state;
  const result = await learnAction(args, nextState, observed?.observation || nextState.lastObservation);
  addStep(steps, {
    type: result.ok ? "learn" : "ask",
    tool: "mcp__browser_agent__learn",
    input: { instruction: args.instruction || "", label: args.label || "" },
    resultPreview: result,
    ok: result.ok,
  });

  const saved = saveState({
    ...nextState,
    learnedAliases: result.learned
      ? [result.learned, ...(nextState.learnedAliases || []).filter((entry) => entry.id !== result.learned.id)].slice(0, 80)
      : nextState.learnedAliases,
  });

  return runOutput({
    ok: result.ok,
    status: result.status,
    instruction: args.instruction || "",
    currentUrl: saved.currentUrl,
    currentTitle: saved.currentTitle,
    extensionId: saved.currentExtensionId,
    pageKey: saved.currentPageKey,
    steps,
    summary: result.summary,
    learned: result.learned,
    requiresUser: result.requiresUser,
    whatFound: saved.lastObservation,
    possibleNextActions: selectedSafeActions(saved.currentExtensionId),
  });
}

async function navigateWithAgent(args, state, steps) {
  const url = normalizeUrlInput(extractUrl(args.instruction || "") || args.currentUrl || "");
  if (!url) {
    return { ok: false, status: "needs_user", summary: "I need a real URL to navigate. Action labels are not URLs.", requiresUser: true };
  }

  const result = await lightpandaSnapshotCurrent({ url, navigate: true, waitMs: args.waitMs || "1200" });
  const observation = observationFromPageResult(result);
  addStep(steps, {
    type: "action",
    tool: "mcp__browser__lightpanda_navigate",
    input: { url },
    resultPreview: observation,
    ok: Boolean(result?.ok),
  });

  return {
    ok: Boolean(result?.ok),
    status: result?.ok ? "success" : "failed",
    observation,
    summary: result?.ok ? `Navigated to ${observation.title || observation.url || url}.` : `Navigation failed for ${url}.`,
  };
}

async function executeResolvedAction({ args, state, observed, extension, pageKey, resolution, steps }) {
  const instruction = String(args.instruction || "");
  const action = resolution.action;

  addStep(steps, {
    type: "plan",
    tool: "mcp__extensions__plan_action",
    input: { extensionId: action.extensionId, label: action.label, actionId: action.id },
    resultPreview: { action: safeActionSummary(action), score: Number(resolution.score.toFixed(2)), alternatives: resolution.alternatives },
    ok: true,
  });

  if (actionIsDangerous(action, instruction)) {
    const requiredPhrase = requiredConfirmationPhrase(action);
    if (args.confirm !== true || String(args.confirmText || "") !== requiredPhrase) {
      return {
        ok: false,
        status: "blocked",
        blockedReason: `Blocked risky action "${action.label}". To continue, type exactly: ${requiredPhrase}`,
        summary: `Blocked risky action "${action.label}".`,
        requiresUser: true,
      };
    }
  }

  if (observed.isLoginPage && action.pageKey && !/login/i.test(action.pageKey)) {
    const needed = displayPageKey(action.pageKey);
    const current = displayPageKey(pageKey || "login");
    return {
      ok: false,
      status: "needs_user",
      summary: `This action requires the ${needed} page, but current page is ${current}. Login/session is required before I can do this.`,
      requiresUser: true,
      whatFound: observedFieldsAndButtons(observed),
    };
  }

  if (!pageMatchesAction(action, observed, pageKey) && action.selector && !action.href) {
    return {
      ok: false,
      status: "needs_user",
      summary: `This action needs the ${displayPageKey(action.pageKey)} page, but I observed ${displayPageKey(pageKey)}.`,
      requiresUser: true,
      whatFound: observedFieldsAndButtons(observed),
    };
  }

  if (action.href) {
    const result = await lightpandaSnapshotCurrent({ url: action.href, navigate: true, waitMs: args.waitMs || "1200" });
    const observation = observationFromPageResult(result);
    addStep(steps, {
      type: "action",
      tool: "mcp__browser__lightpanda_navigate",
      input: { url: action.href, label: action.label },
      resultPreview: observation,
      ok: Boolean(result?.ok),
    });

    if (result?.ok) {
      const learned = saveLearnedAction({
        extensionId: action.extensionId || extension?.id || "",
        observation,
        action,
        element: { href: action.href, text: action.label, role: "link" },
        success: true,
      });
      addStep(steps, {
        type: "learn",
        tool: "browser_agent.learnAction",
        input: { label: action.label, href: action.href },
        resultPreview: learned,
        ok: true,
      });
      return {
        ok: true,
        status: "success",
        observation,
        learned,
        summary: `Opened "${action.label}" and observed ${observation.title || observation.url || "the resulting page"}.`,
      };
    }

    return {
      ok: false,
      status: "failed",
      observation,
      summary: `I tried to open "${action.label}", but the browser did not confirm navigation.`,
    };
  }

  if (action.selector) {
    const waitResult = await lightpandaWaitForSelector({
      currentUrl: observed.url || state.currentUrl || "",
      selector: action.selector,
      waitMs: args.waitMs || "1800",
    }).catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    addStep(steps, {
      type: "action",
      tool: "mcp__browser__wait_for_selector",
      input: { selector: action.selector },
      resultPreview: waitResult,
      ok: Boolean(waitResult?.ok),
    });

    if (waitResult?.ok) {
      const click = await lightpandaClickBySelector({
        currentUrl: observed.url || state.currentUrl || "",
        selector: action.selector,
        text: action.label,
        afterWaitMs: args.afterWaitMs || "900",
      });
      const observation = observationFromPageResult(click);
      addStep(steps, {
        type: "action",
        tool: "mcp__browser__lightpanda_action",
        input: { action: "click", selector: action.selector, label: action.label },
        resultPreview: click.actionResult || click,
        ok: Boolean(click?.ok && click?.actionResult?.ok),
      });

      if (click?.ok && click?.actionResult?.ok) {
        const learned = saveLearnedAction({
          extensionId: action.extensionId || extension?.id || "",
          observation,
          action,
          element: click.actionResult.clicked || { selector: action.selector, text: action.label },
          success: true,
        });
        addStep(steps, {
          type: "learn",
          tool: "browser_agent.learnAction",
          input: { label: action.label, selector: click.actionResult.clicked?.selector || action.selector },
          resultPreview: learned,
          ok: true,
        });
        return {
          ok: true,
          status: "success",
          observation,
          learned,
          summary: `Clicked "${action.label}" successfully.`,
        };
      }
    }
  }

  const visibleMatch = matchingElementFromObservation(observed, action.label);
  if (visibleMatch?.href) {
    const result = await lightpandaSnapshotCurrent({ url: visibleMatch.href, navigate: true, waitMs: args.waitMs || "1200" });
    const observation = observationFromPageResult(result);
    addStep(steps, {
      type: "retry",
      tool: "mcp__browser__lightpanda_navigate",
      input: { href: visibleMatch.href, label: action.label },
      resultPreview: observation,
      ok: Boolean(result?.ok),
    });
    if (result?.ok) {
      const learned = saveLearnedAction({
        extensionId: action.extensionId || extension?.id || "",
        observation,
        action,
        element: visibleMatch,
        success: true,
      });
      return {
        ok: true,
        status: "success",
        observation,
        learned,
        summary: `Opened "${action.label}" using a visible link fallback.`,
      };
    }
  }

  if (visibleMatch?.selector) {
    const click = await lightpandaClickBySelector({
      currentUrl: observed.url || state.currentUrl || "",
      selector: visibleMatch.selector,
      text: action.label,
      afterWaitMs: args.afterWaitMs || "900",
    }).catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    addStep(steps, {
      type: "retry",
      tool: "mcp__browser__lightpanda_action",
      input: { action: "click", selector: visibleMatch.selector, label: action.label },
      resultPreview: click.actionResult || click,
      ok: Boolean(click?.ok && click?.actionResult?.ok),
    });
    if (click?.ok && click?.actionResult?.ok) {
      const observation = observationFromPageResult(click);
      const learned = saveLearnedAction({
        extensionId: action.extensionId || extension?.id || "",
        observation,
        action,
        element: click.actionResult.clicked || visibleMatch,
        success: true,
      });
      return {
        ok: true,
        status: "success",
        observation,
        learned,
        summary: `Clicked "${action.label}" using a visible element fallback.`,
      };
    }
  }

  const textClick = await lightpandaClickByText({
    currentUrl: observed.url || state.currentUrl || "",
    text: action.label,
    afterWaitMs: args.afterWaitMs || "900",
  }).catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  addStep(steps, {
    type: "retry",
    tool: "mcp__browser__click_by_text",
    input: { text: action.label },
    resultPreview: textClick.actionResult || textClick,
    ok: Boolean(textClick?.ok && textClick?.actionResult?.ok),
  });
  if (textClick?.ok && textClick?.actionResult?.ok) {
    const observation = observationFromPageResult(textClick);
    const learned = saveLearnedAction({
      extensionId: action.extensionId || extension?.id || "",
      observation,
      action,
      element: textClick.actionResult.clicked || { text: action.label },
      success: true,
    });
    return {
      ok: true,
      status: "success",
      observation,
      learned,
      summary: `Clicked "${action.label}" using text fallback.`,
    };
  }

  const refreshed = await lightpandaFindInteractiveElements({
    currentUrl: observed.url || state.currentUrl || "",
  }).catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  addStep(steps, {
    type: "retry",
    tool: "mcp__browser__find_interactive_elements",
    input: { label: action.label },
    resultPreview: refreshed,
    ok: Boolean(refreshed?.ok),
  });

  return {
    ok: false,
    status: "needs_user",
    summary: `I found the "${action.label}" action, but could not find a clickable selector or visible text on the current page.`,
    requiresUser: true,
    whatFound: {
      observed: observedFieldsAndButtons(observed),
      interactiveElements: refreshed?.interactiveElements?.slice(0, 30) || observed.interactiveElements?.slice(0, 30) || [],
    },
  };
}

export async function browserAgentRun(args = {}) {
  const instruction = String(args.instruction || "").trim();
  const state = loadState(args.sessionId);
  const steps = [];
  let currentState = {
    ...state,
    useExtensions: boolArg(args.useExtensions, true),
    pendingInstruction: instruction,
    pendingAction: null,
  };

  if (!instruction) {
    return runOutput({
      ok: false,
      status: "needs_user",
      instruction,
      currentUrl: state.currentUrl,
      currentTitle: state.currentTitle,
      extensionId: state.currentExtensionId,
      pageKey: state.currentPageKey,
      summary: "Tell me what browser action to perform.",
      requiresUser: true,
    });
  }

  const maxSteps = Math.max(1, Math.min(Number(args.maxSteps || 6), 10));
  const intent = classifyInstruction(instruction);
  let observedResult = null;

  try {
    observedResult = await observePage(args, currentState);
    addStep(steps, {
      type: "observe",
      tool: "mcp__browser_agent__observe",
      input: { currentUrl: normalizeUrlInput(args.currentUrl || currentState.currentUrl || "") },
      resultPreview: observedResult.observation,
      ok: true,
    });
    currentState = updateStateFromObservation(currentState, observedResult, instruction);
  } catch (err) {
    addStep(steps, {
      type: "observe",
      tool: "mcp__browser_agent__observe",
      input: {},
      resultPreview: err instanceof Error ? err.message : String(err),
      ok: false,
    });
  }

  const observation = observedResult?.observation || currentState.lastObservation || {};
  const extension = extensionFromContext({
    extensionId: args.extensionId || "",
    observation,
    state: currentState,
    instruction,
  });
  const extensionId = extension?.id || args.extensionId || currentState.currentExtensionId || "";
  const skill = extensionId ? getExtensionSkill(extensionId) : null;
  const pageKey = observedResult?.pageKey || pageKeyForObservation(skill, observation);
  currentState.currentExtensionId = observation.url ? extensionId : (extensionId || currentState.currentExtensionId || "");
  currentState.currentPageKey = pageKey || currentState.currentPageKey;

  if (intent === "show_actions") {
    const actions = selectedSafeActions(extensionId);
    const hiddenCount = extensionId
      ? listActionCandidates(extensionId).filter((action) => isProtectedSuggestion(action)).length
      : 0;
    addStep(steps, {
      type: "plan",
      tool: "mcp__extensions__get",
      input: { extensionId },
      resultPreview: { extensionId, safeActions: actions, hiddenProtectedActions: hiddenCount },
      ok: true,
    });
    const saved = saveState(currentState);
    return runOutput({
      ok: true,
      status: "success",
      instruction,
      currentUrl: saved.currentUrl,
      currentTitle: saved.currentTitle,
      extensionId: saved.currentExtensionId,
      pageKey: saved.currentPageKey,
      steps: steps.slice(0, maxSteps),
      summary: extensionId
        ? `Found safe available actions for ${extension?.name || extensionId}.`
        : "No matching extension is active for the current page. Open a supported site or name an extension to inspect its actions.",
      whatFound: extensionId
        ? { extension: extensionSummary(extension), safeActions: actions, hiddenProtectedActions: hiddenCount }
        : { observed: saved.lastObservation, safeActions: [] },
      possibleNextActions: actions,
    });
  }

  if (intent === "learn") {
    const learnedResult = await learnAction(args, currentState, observation);
    addStep(steps, {
      type: learnedResult.ok ? "learn" : "ask",
      tool: "mcp__browser_agent__learn",
      input: { instruction },
      resultPreview: learnedResult,
      ok: learnedResult.ok,
    });
    const saved = saveState({
      ...currentState,
      learnedAliases: learnedResult.learned
        ? [learnedResult.learned, ...(currentState.learnedAliases || []).filter((entry) => entry.id !== learnedResult.learned.id)].slice(0, 80)
        : currentState.learnedAliases,
    });
    return runOutput({
      ok: learnedResult.ok,
      status: learnedResult.status,
      instruction,
      currentUrl: saved.currentUrl,
      currentTitle: saved.currentTitle,
      extensionId: saved.currentExtensionId,
      pageKey: saved.currentPageKey,
      steps: steps.slice(0, maxSteps),
      summary: learnedResult.summary,
      learned: learnedResult.learned,
      requiresUser: learnedResult.requiresUser,
      whatFound: saved.lastObservation,
      possibleNextActions: selectedSafeActions(saved.currentExtensionId),
    });
  }

  if (intent === "observe") {
    const saved = saveState(currentState);
    return runOutput({
      ok: Boolean(observedResult?.ok),
      status: observedResult?.ok ? "success" : "failed",
      instruction,
      currentUrl: saved.currentUrl,
      currentTitle: saved.currentTitle,
      extensionId: saved.currentExtensionId,
      pageKey: saved.currentPageKey,
      steps: steps.slice(0, maxSteps),
      summary: observedResult?.ok ? `Observed ${saved.currentTitle || saved.currentUrl || "the current page"}.` : "Could not observe the current page.",
      whatFound: saved.lastObservation,
      possibleNextActions: selectedSafeActions(saved.currentExtensionId),
    });
  }

  if (intent === "navigate") {
    const nav = await navigateWithAgent(args, currentState, steps);
    if (nav.observation) {
      const matchedExtension = nav.observation.url ? matchExtensionForUrl(nav.observation.url) : null;
      currentState = updateStateFromObservation(currentState, {
        observation: nav.observation,
        extension: matchedExtension,
        pageKey: pageKeyForObservation(matchedExtension ? getExtensionSkill(matchedExtension.id) : null, nav.observation),
      }, instruction);
    }
    const saved = saveState(currentState);
    return runOutput({
      ok: nav.ok,
      status: nav.status,
      instruction,
      currentUrl: saved.currentUrl,
      currentTitle: saved.currentTitle,
      extensionId: saved.currentExtensionId,
      pageKey: saved.currentPageKey,
      steps: steps.slice(0, maxSteps),
      summary: nav.summary,
      requiresUser: nav.requiresUser,
      whatFound: nav.observation || saved.lastObservation,
      possibleNextActions: selectedSafeActions(saved.currentExtensionId),
    });
  }

  const resolution = resolveInstructionAction({ instruction, extensionId });
  if (!resolution.ok) {
    addStep(steps, {
      type: "ask",
      tool: "browser_agent.resolveInstruction",
      input: { instruction, extensionId },
      resultPreview: resolution,
      ok: false,
    });
    const saved = saveState({ ...currentState, failureCount: Number(currentState.failureCount || 0) + 1 });
    return runOutput({
      ok: false,
      status: "needs_user",
      instruction,
      currentUrl: saved.currentUrl,
      currentTitle: saved.currentTitle,
      extensionId: saved.currentExtensionId,
      pageKey: saved.currentPageKey,
      steps: steps.slice(0, maxSteps),
      summary: "I could not map that instruction to a known or learned site action.",
      whatFound: {
        observed: saved.lastObservation,
        candidateActions: resolution.candidates,
      },
      possibleNextActions: selectedSafeActions(saved.currentExtensionId),
      requiresUser: true,
    });
  }

  currentState.pendingAction = safeActionSummary(resolution.action);
  const executed = await executeResolvedAction({
    args,
    state: currentState,
    observed: observation,
    extension,
    pageKey,
    resolution,
    steps,
  });

  if (executed.observation) {
    const matchedExtension = executed.observation.url ? matchExtensionForUrl(executed.observation.url) : extension;
    currentState = updateStateFromObservation(currentState, {
      observation: executed.observation,
      extension: matchedExtension,
      pageKey: pageKeyForObservation(matchedExtension ? getExtensionSkill(matchedExtension.id) : skill, executed.observation),
    }, instruction);
  }

  const saved = saveState({
    ...currentState,
    failureCount: executed.ok ? 0 : Number(currentState.failureCount || 0) + 1,
    learnedAliases: executed.learned
      ? [executed.learned, ...(currentState.learnedAliases || []).filter((entry) => entry.id !== executed.learned.id)].slice(0, 80)
      : currentState.learnedAliases,
    lastToolResults: steps.slice(-8),
  });

  return runOutput({
    ok: executed.ok,
    status: executed.status,
    instruction,
    currentUrl: saved.currentUrl,
    currentTitle: saved.currentTitle,
    extensionId: saved.currentExtensionId,
    pageKey: saved.currentPageKey,
    steps: steps.slice(0, maxSteps),
    summary: executed.summary,
    whatFound: executed.whatFound || saved.lastObservation,
    possibleNextActions: selectedSafeActions(saved.currentExtensionId),
    learned: executed.learned,
    requiresUser: executed.requiresUser,
    blockedReason: executed.blockedReason,
  });
}

export async function browserAgentReset(args = {}) {
  const sessionId = safeSessionId(args.sessionId);
  const file = statePath(sessionId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return {
    ok: true,
    status: "success",
    state: defaultState(sessionId),
  };
}

export async function browserAgentStatus(args = {}) {
  const state = loadState(args.sessionId);
  const extension = state.currentExtensionId ? getExtension(state.currentExtensionId) : null;
  return {
    ok: true,
    status: "success",
    state,
    extension: extensionSummary(extension),
    runtimeModel: browserAgentRuntimeConfig(),
    possibleNextActions: selectedSafeActions(state.currentExtensionId),
  };
}
