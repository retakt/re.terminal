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

function sanitizeLoadedState(state) {
  const currentExtensionId = String(state?.currentExtensionId || "").trim();

  if (currentExtensionId && !getExtension(currentExtensionId)) {
    return {
      ...state,
      currentExtensionId: "",
      currentPageKey: "",
      pendingAction: null,
      lastObservation: null,
      lastToolResults: [],
      failureCount: 0,
    };
  }

  if (state?.currentUrl && !isHttpUrl(state.currentUrl)) {
    return {
      ...state,
      currentUrl: "",
      currentTitle: "",
      currentExtensionId: "",
      currentPageKey: "",
      pendingAction: null,
      lastObservation: null,
      lastToolResults: [],
      failureCount: 0,
    };
  }

  return state;
}

function loadState(sessionId = DEFAULT_SESSION_ID) {
  const safeSession = safeSessionId(sessionId);
  return sanitizeLoadedState({
    ...defaultState(safeSession),
    ...(readJson(statePath(safeSession)) || {}),
    sessionId: safeSession,
  });
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

function explicitNavigationUrlFromArgs(args = {}) {
  const directUrl = normalizeUrlInput(args.url || "");
  if (directUrl) return directUrl;

  const currentUrl = normalizeUrlInput(args.currentUrl || "");
  if (currentUrl) return currentUrl;

  const instructionUrl = normalizeUrlInput(extractUrl(args.instruction || ""));
  if (instructionUrl) return instructionUrl;

  return "";
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
  const explicitUrl = explicitNavigationUrlFromArgs(args);
  const currentUrl = normalizeUrlInput(args.currentUrl || state.currentUrl || "");

  const result = await lightpandaSnapshotCurrent({
    ...(explicitUrl
      ? { url: explicitUrl, navigate: true }
      : { currentUrl }),
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
    extensionId: best.action.extensionId,
    score: Number(best.score.toFixed(2)),
    alternatives: candidates.slice(1, 5).map((entry) => ({
      score: Number(entry.score.toFixed(2)),
      action: actionDebugSummary(entry.action),
    })),
  };
}

function classifyInstruction(instruction = "") {
  const lower = String(instruction || "").toLowerCase();

  if (/\b(reset|clear)\b.*\b(browser agent|browser state|agent state)\b/.test(lower)) return "reset";
  if (/\b(status)\b.*\b(browser agent|agent)\b/.test(lower)) return "status";
  if (/\b(learn|remember|this is|that is|save this action|save as action|use this as|call this)\b/.test(lower)) return "learn";
  if (/\b(scrape|extract table|extract cards|extract data|scraper)\b/.test(lower)) return "scrape";

  // Questions about visible/clickable things are OBSERVE, not execute.
  if (
    /\b(what|which|show|list|tell me|visible|available)\b.*\b(button|buttons|link|links|clickable|elements|actions)\b/.test(lower) ||
    /\b(button|buttons|link|links|clickable elements)\b.*\b(there|visible|available|on this page|on the page)\b/.test(lower) ||
    /\b(what can i click|what to click|buttons to click|links to click)\b/.test(lower)
  ) {
    return "observe";
  }

  if (extractUrl(instruction) && /\b(open|go|visit|navigate|load|observe|inspect|read|view)\b/.test(lower)) return "navigate";
  if (/\b(show|list|what actions|available actions|known actions|extension actions|site actions)\b/.test(lower)) return "show_actions";
  if (/\b(execute|click|open|go to|navigate to|perform|run)\b/.test(lower)) return "execute_action";
  if (/\b(plan|can you|find|where|how)\b/.test(lower)) return "plan_action";
  if (/\b(observe|inspect|read|snapshot|current page)\b/.test(lower)) return "observe";
  if (extractUrl(instruction)) return "navigate";
  return "observe";
}

function compactObservation(observation = {}) {
  return {
    url: observation.url || "",
    title: observation.title || "",
    textPreview: safeText(observation.textPreview || "", 700),
    isLoginPage: Boolean(observation.isLoginPage),
    forms: (observation.forms || []).map((form) => ({
      index: form.index,
      action: form.action || "",
      method: form.method || "",
      selector: form.selector || "",
      fields: (form.fields || []).map((field) => ({
        name: field.name || "",
        id: field.id || "",
        type: field.secret ? "password" : field.type || "",
        placeholder: field.placeholder || "",
        ariaLabel: field.ariaLabel || "",
        selector: field.selector || "",
        secret: Boolean(field.secret),
      })).slice(0, 12),
      buttons: (form.buttons || []).slice(0, 8),
    })).slice(0, 6),
    buttons: (observation.buttons || []).map((button) => ({
      text: button.text || button.label || "",
      selector: button.selector || "",
      tag: button.tag || "",
      type: button.type || "",
    })).slice(0, 16),
    links: (observation.links || []).map((link) => ({
      text: link.text || link.label || "",
      href: link.href || "",
      selector: link.selector || "",
    })).slice(0, 16),
    inputs: (observation.inputs || []).map((input) => ({
      name: input.name || "",
      id: input.id || "",
      type: input.secret ? "password" : input.type || "",
      placeholder: input.placeholder || "",
      ariaLabel: input.ariaLabel || "",
      selector: input.selector || "",
      secret: Boolean(input.secret),
    })).slice(0, 16),
    interactiveElements: (observation.interactiveElements || []).map((el) => ({
      role: el.role || "",
      tag: el.tag || "",
      text: el.text || "",
      selector: el.selector || "",
      href: el.href || "",
      type: el.type || "",
    })).slice(0, 24),
  };
}

function safePossibleNextActions(extension = null, skill = null) {
  if (!extension || !skill) return [];
  return actionsForSkill(skill)
    .filter((action) => !isProtectedSuggestion(action))
    .slice(0, 10)
    .map(safeActionSummary);
}

function updateStateFromObservation(state, observation, extension, pageKey) {
  const visited = Array.from(new Set([
    ...(Array.isArray(state.visited) ? state.visited : []),
    observation.url || "",
  ].filter(Boolean))).slice(-40);

  return saveState({
    ...state,
    currentUrl: isHttpUrl(observation.url) ? observation.url : "",
    currentTitle: observation.title || "",
    currentExtensionId: isHttpUrl(observation.url) ? (extension?.id || "") : "",
    currentPageKey: isHttpUrl(observation.url) ? (pageKey || "") : "",
    lastObservation: isHttpUrl(observation.url) ? compactObservation(observation) : null,
    visited,
  });
}

function responseBase({
  ok = true,
  status = "success",
  instruction = "",
  state,
  observation = null,
  extension = null,
  pageKey = "",
  steps = [],
  summary = "",
  whatFound = null,
  possibleNextActions = [],
  requiresUser = false,
  blockedReason = "",
  learned = null,
} = {}) {
  return {
    ok,
    status,
    instruction,
    currentUrl: observation?.url || state?.currentUrl || "",
    currentTitle: observation?.title || state?.currentTitle || "",
    extensionId: extension?.id || state?.currentExtensionId || "",
    pageKey: pageKey || state?.currentPageKey || "",
    steps,
    summary,
    whatFound: whatFound || (observation ? compactObservation(observation) : null),
    possibleNextActions,
    requiresUser,
    blockedReason,
    learned,
  };
}

async function showActions(args = {}, state = loadState(args.sessionId)) {
  const useExtensions = boolArg(args.useExtensions, true);
  const extension = useExtensions
    ? extensionFromContext({
        extensionId: args.extensionId,
        state,
        instruction: args.instruction,
      })
    : null;
  const extensions = extension ? [extension] : useExtensions ? listExtensions() : [];
  const actions = extensions.flatMap((entry) => {
    const skill = getExtensionSkill(entry.id);
    return actionsForSkill(skill)
      .filter((action) => !isProtectedSuggestion(action))
      .map((action) => ({
        extensionId: entry.id,
        ...safeActionSummary(action),
      }));
  });

  return responseBase({
    status: "success",
    instruction: args.instruction || "",
    state,
    extension,
    steps: [
      {
        type: "plan",
        ok: true,
        resultPreview: preview({ extensions: extensions.map(extensionSummary), actions }, 900),
      },
    ],
    summary: actions.length
      ? "Available safe extension actions are listed."
      : useExtensions
        ? "No enabled extension actions are available for this context."
        : "Extensions are disabled for this run.",
    possibleNextActions: actions,
    requiresUser: true,
  });
}

async function observe(args = {}) {
  const state = loadState(args.sessionId);
  const observationResult = await observePage(args, state);
  const updated = updateStateFromObservation(
    state,
    observationResult.observation,
    observationResult.extension,
    observationResult.pageKey
  );
  const skill = observationResult.extension ? getExtensionSkill(observationResult.extension.id) : null;

  return responseBase({
    status: "success",
    instruction: args.instruction || "observe",
    state: updated,
    observation: observationResult.observation,
    extension: observationResult.extension,
    pageKey: observationResult.pageKey,
    steps: [
      {
        type: "observe",
        tool: "lightpandaSnapshotCurrent",
        input: {
          currentUrl: explicitNavigationUrlFromArgs(args) || args.currentUrl || state.currentUrl || "",
          useExtensions: boolArg(args.useExtensions, true),
        },
        ok: true,
        resultPreview: preview(compactObservation(observationResult.observation), 900),
      },
    ],
    summary: observationResult.observation.url
      ? `Observed ${observationResult.observation.url}.`
      : "Observed the current browser page.",
    possibleNextActions: safePossibleNextActions(observationResult.extension, skill),
    requiresUser: true,
  });
}

function actionTargetUrl(action = {}, skill = null, state = null) {
  if (action.href) return action.href;
  const page = skill?.pages && !Array.isArray(skill.pages) ? skill.pages[action.pageKey] : null;
  return state?.currentUrl || page?.url || "";
}

function sameKnownPage(action = {}, observation = {}, skill = null, pageKey = "") {
  if (!action?.pageKey) return true;
  if (pageKey && pageKey === action.pageKey) return true;

  const targetPage = skill?.pages && !Array.isArray(skill.pages) ? skill.pages[action.pageKey] : null;
  if (!targetPage?.url || !observation?.url) return false;

  const targetPath = pathFromUrl(targetPage.url);
  const currentPath = pathFromUrl(observation.url);
  return Boolean(targetPath && currentPath && currentPath.includes(targetPath));
}

function elementTexts(observation = {}) {
  return [
    ...(observation.buttons || []).map((entry) => entry.text || entry.label || ""),
    ...(observation.links || []).map((entry) => entry.text || entry.label || ""),
    ...(observation.interactiveElements || []).map((entry) => entry.text || entry.label || ""),
  ].map((entry) => safeText(entry, 180)).filter(Boolean);
}

function visibleElementMatchingAction(action = {}, observation = {}) {
  const label = normalizeActionQuery(action.label || "");
  if (!label) return false;
  return elementTexts(observation).some((text) => {
    const normalized = normalizeActionQuery(text);
    return normalized === label || normalized.includes(label) || label.includes(normalized);
  });
}


function extractGenericClickTarget(instruction = "") {
  const raw = String(instruction || "").trim();
  const quoted = raw.match(/["\'](.+?)["\']/)?.[1];
  if (quoted) return safeText(quoted, 160);

  const lower = raw.toLowerCase();

  if (
    /\b(what|which|show|list|tell me|visible|available)\b.*\b(button|buttons|link|links|clickable|elements)\b/.test(lower) ||
    /\b(what can i click|what to click|buttons to click|links to click)\b/.test(lower)
  ) {
    return "";
  }

  return safeText(
    raw
      .replace(/\b(please|execute|click|open|go to|navigate to|perform|run|press|tap|the|button|link|on this page|there)\b/ig, " ")
      .replace(/\s+/g, " ")
      .trim(),
    160
  );
}
async function executeAction(args = {}, state = loadState(args.sessionId)) {
  const steps = [];
  const useExtensions = boolArg(args.useExtensions, true);
  if (!useExtensions) {
    const observationResult = await observePage(args, state);
    const observation = observationResult.observation;
    const updated = updateStateFromObservation(state, observation, null, "");

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

    const targetText = extractGenericClickTarget(args.instruction || args.label || args.text || "");

    if (!targetText) {
      return responseBase({
        ok: true,
        status: "success",
        instruction: args.instruction || "",
        state: updated,
        observation,
        extension: null,
        pageKey: pageKeyForObservation(null, observation),
        steps,
        summary: "Observed the current page. Extensions are disabled, so I will only report real visible elements unless you name a visible button/link to click.",
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
      input: { url: observation.url || state.currentUrl || "", text: targetText },
      ok: clicked,
      resultPreview: preview(clickResult, 900),
    });

    const postObservation = observationFromPageResult(clickResult || {});
    const finalObservation = postObservation.url ? postObservation : observation;
    const finalState = updateStateFromObservation(updated, finalObservation, null, pageKeyForObservation(null, finalObservation));

    return responseBase({
      ok: clicked,
      status: clicked ? "success" : "needs_user",
      instruction: args.instruction || "",
      state: finalState,
      observation: finalObservation,
      extension: null,
      pageKey: pageKeyForObservation(null, finalObservation),
      steps,
      summary: clicked
        ? "Clicked visible text \"" + targetText + "\"."
        : "I could not find a visible button/link matching \"" + targetText + "\" on the current page.",
      possibleNextActions: [],
      requiresUser: true,
      blockedReason: clicked ? "" : "target_not_found",
    });
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

  let extension = extensionFromContext({
    extensionId: args.extensionId,
    observation: observationResult.observation,
    state,
    instruction: args.instruction,
  }) || observationResult.extension;

  if (!extension) {
    const updated = updateStateFromObservation(state, observationResult.observation, null, "");
    return responseBase({
      ok: false,
      status: "needs_user",
      instruction: args.instruction || "",
      state: updated,
      observation: observationResult.observation,
      extension: null,
      pageKey: "",
      steps,
      summary: "No active extension matches the current page or instruction.",
      possibleNextActions: [],
      requiresUser: true,
    });
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
      summary: actionResolution.reason || "No matching action was found.",
      possibleNextActions: safePossibleNextActions(extension, skill),
      requiresUser: true,
    });
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
        summary: `Blocked dangerous action "${action.label}".`,
        possibleNextActions: safePossibleNextActions(extension, skill),
        requiresUser: true,
        blockedReason: `Exact confirmation required: ${requiredPhrase}`,
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
      summary: `This action belongs to ${displayPageKey(action.pageKey)}, but the current page appears to be a login page. Login/session is required before I can do this.`,
      possibleNextActions: [],
      requiresUser: true,
      blockedReason: "login_required",
    });
  }

  if (!sameKnownPage(action, observationResult.observation, skill, pageKey) && !visibleElementMatchingAction(action, observationResult.observation)) {
    const targetUrl = actionTargetUrl(action, skill, state);
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
      summary: `The current page does not appear to contain "${action.label}". Navigate to the correct page first.`,
      possibleNextActions: [
        ...(targetUrl ? [{ label: `Navigate to ${displayPageKey(action.pageKey)}`, type: "link", requiresConfirmation: false }] : []),
        ...safePossibleNextActions(extension, skill),
      ].slice(0, 8),
      requiresUser: true,
      blockedReason: "wrong_page",
    });
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
      input: { url: action.href, navigate: true },
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
      input: { url: targetUrl, selector: action.selector },
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
        input: { url: targetUrl, selector: action.selector },
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
        input: { url: targetUrl, text: action.label },
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
      input: { url: targetUrl || observationResult.observation.url, text: action.label },
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
      summary: `I could not execute "${action.label}". The target was not found or did not click successfully.`,
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
    summary: `Executed "${action.label}".`,
    possibleNextActions: safePossibleNextActions(extension, skill),
    requiresUser: true,
  });
}

function stableSelectorFromObservation(observation = {}, label = "") {
  const query = normalizeActionQuery(label);
  const candidates = [
    ...(observation.buttons || []),
    ...(observation.links || []),
    ...(observation.interactiveElements || []),
  ];

  const scored = candidates
    .map((entry) => {
      const text = normalizeActionQuery(entry.text || entry.label || entry.name || "");
      const score = text === query ? 1 : text.includes(query) || query.includes(text) ? 0.85 : 0;
      return { entry, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.entry;
  return {
    selector: best?.selector || "",
    href: best?.href || "",
    textPattern: best?.text || best?.label || label || "",
  };
}

function mergeLearnedAction(skill, learnedAction) {
  const existing = Array.isArray(skill.learnedActions) ? skill.learnedActions : [];
  const index = existing.findIndex((entry) =>
    entry.id === learnedAction.id ||
    normalizeActionQuery(entry.label) === normalizeActionQuery(learnedAction.label)
  );

  const nextLearned = [...existing];
  if (index >= 0) {
    nextLearned[index] = {
      ...nextLearned[index],
      ...learnedAction,
      successCount: Number(nextLearned[index].successCount || 0) + 1,
      failureCount: Number(nextLearned[index].failureCount || 0),
      updatedAt: nowIso(),
    };
  } else {
    nextLearned.push(learnedAction);
  }

  return {
    ...skill,
    learnedActions: nextLearned,
    updatedAt: nowIso(),
  };
}

function extractLearnLabel(args = {}) {
  const explicit = safeText(args.label || "", 160);
  if (explicit) return explicit;
  const text = String(args.instruction || "");
  const quoted = text.match(/["'`](.+?)["'`]/)?.[1];
  if (quoted) return safeText(quoted, 160);
  const named = text.match(/\b(?:as|called|named|is)\s+(.+)$/i)?.[1];
  return safeText(named || text.replace(/\b(remember|learn|this|that|button|link|action|as|called|named|is)\b/ig, " "), 160);
}

async function learn(args = {}) {
  const state = loadState(args.sessionId);
  const observationResult = await observePage(args, state);
  const observation = observationResult.observation;
  const extension = extensionFromContext({
    extensionId: args.extensionId,
    observation,
    state,
    instruction: args.instruction,
  }) || observationResult.extension;

  const label = extractLearnLabel(args);
  if (!label) {
    const updated = updateStateFromObservation(state, observation, extension, observationResult.pageKey);
    return responseBase({
      ok: false,
      status: "needs_user",
      instruction: args.instruction || "",
      state: updated,
      observation,
      extension,
      pageKey: observationResult.pageKey,
      steps: [{ type: "learn", ok: false, resultPreview: "No label found." }],
      summary: "Tell me what name to save for this button/link/action.",
      requiresUser: true,
    });
  }

  const existingSkill = extension ? getExtensionSkill(extension.id) : null;
  const skill = existingSkill || createSkillForObservation(observation, args.extensionId);
  const pageKey = pageKeyForObservation(skill, observation);
  const picked = {
    selector: safeText(args.selector || "", 240),
    href: safeText(args.href || "", 500),
    textPattern: safeText(args.textPattern || "", 240),
    ...stableSelectorFromObservation(observation, label),
  };

  const learnedAction = {
    id: `learned_${safeId(pageKey)}_${safeId(label)}`,
    label,
    kind: picked.href ? "link" : "button",
    domain: domainFromUrl(observation.url),
    pageKey,
    url: observation.url || "",
    title: observation.title || "",
    selector: picked.selector || "",
    textPattern: picked.textPattern || label,
    href: picked.href || "",
    requiresConfirmation: DANGEROUS_RE.test(label),
    source: "browser-agent.learn",
    confidence: picked.selector || picked.href ? 0.82 : 0.55,
    lastSucceededAt: nowIso(),
    successCount: 1,
    failureCount: 0,
  };

  const nextSkill = mergeLearnedAction(skill, learnedAction);
  if (!nextSkill.pages || Array.isArray(nextSkill.pages)) nextSkill.pages = {};
  nextSkill.pages[pageKey] = {
    ...(nextSkill.pages[pageKey] || {}),
    key: pageKey,
    url: observation.url || "",
    title: observation.title || "",
    path: pathFromUrl(observation.url),
    lastObservedAt: nowIso(),
  };
  if (!nextSkill.domains?.length && domainFromUrl(observation.url)) {
    nextSkill.domains = [domainFromUrl(observation.url)];
  }

  writeJson(skillFilePath(nextSkill.id, existingSkill), nextSkill);

  const updated = saveState({
    ...updateStateFromObservation(state, observation, getExtension(nextSkill.id), pageKey),
    learnedAliases: [
      ...(Array.isArray(state.learnedAliases) ? state.learnedAliases : []),
      {
        label,
        extensionId: nextSkill.id,
        actionId: learnedAction.id,
        learnedAt: nowIso(),
      },
    ].slice(-80),
  });

  return responseBase({
    ok: true,
    status: "success",
    instruction: args.instruction || "",
    state: updated,
    observation,
    extension: getExtension(nextSkill.id),
    pageKey,
    steps: [
      {
        type: "learn",
        ok: true,
        resultPreview: preview(learnedAction, 900),
      },
    ],
    summary: `Learned "${label}" for ${domainFromUrl(observation.url) || "this site"}.`,
    possibleNextActions: [{ label, type: publicActionType(learnedAction), requiresConfirmation: learnedAction.requiresConfirmation }],
    requiresUser: true,
    learned: learnedAction,
  });
}

async function navigate(args = {}) {
  return observe(args);
}

export async function browserAgentObserve(args = {}) {
  return observe(args);
}

export async function browserAgentLearn(args = {}) {
  return learn(args);
}

export async function browserAgentReset(args = {}) {
  const sessionId = safeSessionId(args.sessionId || DEFAULT_SESSION_ID);
  const file = statePath(sessionId);
  try {
    fs.unlinkSync(file);
  } catch {}
  return {
    ok: true,
    status: "success",
    sessionId,
    state: defaultState(sessionId),
    summary: "Browser agent state reset.",
  };
}

export async function browserAgentStatus(args = {}) {
  const sessionId = safeSessionId(args.sessionId || DEFAULT_SESSION_ID);
  return {
    ok: true,
    status: "success",
    sessionId,
    state: loadState(sessionId),
    runtime: browserAgentRuntimeConfig(),
  };
}

export async function browserAgentRun(args = {}) {
  const sessionId = safeSessionId(args.sessionId || DEFAULT_SESSION_ID);
  const state = loadState(sessionId);
  const instruction = String(args.instruction || "").trim();
  const kind = classifyInstruction(instruction);

  const baseArgs = {
    ...args,
    sessionId,
    instruction,
  };

  if (kind === "reset") return browserAgentReset(baseArgs);
  if (kind === "status") return browserAgentStatus(baseArgs);
  if (kind === "learn") return learn(baseArgs);
  if (kind === "navigate") return navigate(baseArgs);
  if (kind === "observe") return observe(baseArgs);
  if (kind === "show_actions") return showActions(baseArgs, state);
  if (kind === "execute_action") return executeAction(baseArgs, state);
  if (kind === "plan_action") {
    const observationResult = await observePage(baseArgs, state);
    const extension = extensionFromContext({
      extensionId: args.extensionId,
      observation: observationResult.observation,
      state,
      instruction,
    }) || observationResult.extension;
    const skill = extension ? getExtensionSkill(extension.id) : null;
    const pageKey = pageKeyForObservation(skill, observationResult.observation);
    const updated = updateStateFromObservation(state, observationResult.observation, extension, pageKey);
    const actionResolution = extension
      ? resolveInstructionAction({ instruction, extensionId: extension.id })
      : { ok: false, reason: "No active extension matched this page or instruction." };

    return responseBase({
      ok: Boolean(actionResolution.ok),
      status: actionResolution.ok ? "success" : "needs_user",
      instruction,
      state: updated,
      observation: observationResult.observation,
      extension,
      pageKey,
      steps: [
        {
          type: "observe",
          tool: "lightpandaSnapshotCurrent",
          ok: true,
          resultPreview: preview(compactObservation(observationResult.observation), 800),
        },
        {
          type: "plan",
          ok: Boolean(actionResolution.ok),
          resultPreview: preview(actionResolution, 900),
        },
      ],
      summary: actionResolution.ok
        ? `Planned "${actionResolution.action.label}".`
        : actionResolution.reason || "Could not plan an action.",
      possibleNextActions: extension && skill ? safePossibleNextActions(extension, skill) : [],
      requiresUser: true,
    });
  }

  return observe(baseArgs);
}