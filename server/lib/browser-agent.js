import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  browserClickByHref,
  browserClickBySelector,
  browserClickByText,
  browserFillAndSubmit,
  browserFillFields,
  browserHealth,
  browserNavigate,
  browserObserve,
  browserSubmitForm,
  isValidObservation,
} from "./browser-engine-manager.js";
import {
  redactCommand,
  watchBrowserInstruction,
} from "./browser-runtime-watcher.js";
import {
  planBrowserTask,
  summarizeTaskSequence,
} from "./browser-task-runner.js";
import { verifyBrowserResult } from "./browser-result-verifier.js";
import { adviseBrowserFailure } from "./browser-error-advisor.js";
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
  const configured = envFlag("BROWSER_AGENT_LLM_ENABLED", false) && Boolean(baseUrl && model);
  return {
    configured,
    enabled: false,
    used: false,
    baseUrl: redactedBaseUrl,
    model,
    timeoutMs: Math.max(1000, Number(process.env.BROWSER_AGENT_TIMEOUT_MS || 60000)),
    think: envFlag("BROWSER_AGENT_THINK", false),
    strategy: "deterministic-only",
    note: configured
      ? "Runtime model is configured but not used; browser_agent currently uses deterministic watcher/planner code only."
      : "Browser_agent currently uses deterministic watcher/planner code only.",
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
    lastValidObservation: null,
    lastFailedObservation: null,
    pendingForm: null,
    activeEngine: "",
    engineFailures: {},
    pendingInstruction: "",
    pendingAction: null,
    lastIntent: "",
    lastCommand: null,
    lastToolResult: null,
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

function redactPersistedValue(value, pathParts = []) {
  if (Array.isArray(value)) return value.map((entry, index) => redactPersistedValue(entry, [...pathParts, String(index)]));
  if (!value || typeof value !== "object") {
    const keyPath = pathParts.join(".");
    if (/\b(password|pass|pwd|otp|code|pin|secret)\b/i.test(keyPath) && typeof value === "string") {
      return "[redacted]";
    }
    return typeof value === "string" ? redactInstructionSecrets(value) : value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const nextPath = [...pathParts, key];
    const secretKey = /\b(password|pass|pwd|otp|code|pin|secret)\b/i.test(nextPath.join("."));
    if (secretKey && typeof entry === "string") return [key, "[redacted]"];
    if (key === "value" && value.secret === true) return [key, "[redacted]"];
    return [key, redactPersistedValue(entry, nextPath)];
  }));
}

function sanitizeLoadedState(state) {
  const currentExtensionId = String(state?.currentExtensionId || "").trim();

  if (currentExtensionId && !getExtension(currentExtensionId)) {
    return {
      ...state,
      currentExtensionId: "",
      currentPageKey: "",
      pendingAction: null,
      lastObservation: isValidObservation(state?.lastValidObservation) ? state.lastValidObservation : null,
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
      lastObservation: isValidObservation(state?.lastValidObservation) ? state.lastValidObservation : null,
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
  const redacted = redactPersistedValue(next);
  writeJson(statePath(next.sessionId), redacted);
  return redacted;
}

function safeText(value, limit = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function nowMs() {
  return performance.now();
}

function roundMs(value = 0) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function browserAgentTokenUsage(reason = "No browser-agent model was used; watcher/planner decisions are deterministic JS plus browser tool output.") {
  return {
    stage: "browser_agent",
    model: "",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    watcher: {
      type: "deterministic",
      used: false,
      model: "",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      reason,
    },
    mainModel: {
      used: false,
      model: "",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      reason,
    },
  };
}

function redactInstructionSecrets(value = "") {
  return String(value || "").replace(
    /\b(password|pass|pwd|otp|code|pin)\b(?:\s*(?:is|[:=])\s*|[_\s-]+)(?:"[^"]*"|'[^']*'|[^\s,;]+)/ig,
    (match, label) => `${label}: [redacted]`
  );
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
  const combined = `${page.url || ""} ${page.title || ""} ${page.textPreview || ""}`;
  if (/\b(logout|dashboard|main attendance|payroll|my profile|notifications|leave application)\b/i.test(combined)) {
    return false;
  }
  const fields = [
    ...(page.inputs || []),
    ...(page.forms || []).flatMap((form) => form.fields || []),
  ];
  if (fields.some((field) => field.secret || /password/i.test(`${field.type || ""} ${field.name || ""} ${field.id || ""}`))) {
    return true;
  }
  return /\b(login|log in|sign in)\b/i.test(combined);
}

function looksLikeLoginStep(step = {}) {
  const instruction = `${step.instruction || ""} ${step.kind || ""}`;
  return /\b(login|log\s*in|sign\s*in|fill_and_submit)\b/i.test(instruction) &&
    /\b(username|user\s*name|user\s*id|employee\s*id|email|password|pass|pwd)\b/i.test(instruction);
}

function resultObservation(result = {}) {
  return result.whatFound || result.observation || result.state?.lastValidObservation || {};
}

function resultLooksAuthenticated(result = {}) {
  const page = resultObservation(result);
  if (!page || isLoginObservation(page)) return false;
  const combined = `${result.currentUrl || ""} ${result.currentTitle || ""} ${page.url || ""} ${page.title || ""} ${page.textPreview || ""}`;
  if (/\/(?:index|dashboard|home|attendance|profile|admin)(?:[/?#]|$)/i.test(combined)) return true;
  return /\b(logout|dashboard|main attendance|attendance|payroll|my profile|notifications|leave application)\b/i.test(combined) ||
    /(首页|平台设置|玩家资金|玩家管理|登出|退出|仪表盘)/i.test(combined);
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
  const page = result?.observation || result?.page || {};
  const observation = {
    ok: Boolean(result?.ok),
    url: page.url || "",
    title: page.title || "",
    textPreview: safeText(page.text || page.textPreview || "", 2400),
    markdown: safeText(page.markdown || "", 12000),
    accessibility: page.accessibility || null,
    links: Array.isArray(page.links) ? page.links.slice(0, 80) : [],
    buttons: Array.isArray(page.buttons) ? page.buttons.slice(0, 80) : [],
    inputs: Array.isArray(page.inputs) ? page.inputs.slice(0, 80) : [],
    forms: Array.isArray(page.forms) ? page.forms.slice(0, 20) : [],
    interactiveElements: Array.isArray(page.interactiveElements) ? page.interactiveElements.slice(0, 140) : [],
    stats: page.stats || {},
    requestedUrl: page.requestedUrl || result?.requestedUrl || "",
    engine: page.engine || result?.engine || "",
    extractionPath: page.extractionPath || "",
    extractionSources: Array.isArray(page.extractionSources) ? page.extractionSources : [],
    extractionCapabilities: page.extractionCapabilities || {},
    error: page.error || result?.error || "",
    snapshotError: page.snapshotError || result?.snapshotError || "",
    extractionErrors: page.extractionErrors || result?.extractionErrors || [],
  };
  observation.isLoginPage = isLoginObservation(observation);
  return observation;
}

async function observePage(args = {}, state = defaultState()) {
  const explicitUrl = explicitNavigationUrlFromArgs(args);
  const currentUrl = normalizeUrlInput(args.currentUrl || state.currentUrl || state.lastValidObservation?.url || "");

  const result = explicitUrl
    ? await browserNavigate({
        ...args,
        url: explicitUrl,
        waitMs: args.waitMs || "900",
      })
    : await browserObserve({
        ...args,
        currentUrl,
        lastValidObservation: state.lastValidObservation,
        state,
        waitMs: args.waitMs || "900",
      });

  const observation = observationFromPageResult(result);
  if (!result?.ok || !isValidObservation(observation)) {
    return {
      ok: false,
      status: result?.status || "failed",
      observation,
      extension: null,
      pageKey: "",
      raw: result,
      error: result?.error || observation.error || observation.snapshotError || "Browser observation failed.",
      previousCurrentUrl: state.currentUrl || state.lastValidObservation?.url || "",
    };
  }

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
    status: "success",
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
  if (/\b(read|view|open|go to|visit)\s+(?:the\s+)?(?:about|contact|pricing|blog|docs|home|login|sign in)(?:\s+page)?\b/.test(lower)) return "execute_action";
  if (/\b(show|list|what actions|available actions|known actions|extension actions|site actions)\b/.test(lower)) return "show_actions";
  if (/\b(execute|click|clicking|press|tap|select|choose|open|go to|navigate to|perform|run)\b/.test(lower) || /\btry\s+clicking\b/.test(lower)) return "execute_action";
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
    engine: observation.engine || "",
    extractionPath: observation.extractionPath || "",
    extractionSources: Array.isArray(observation.extractionSources) ? observation.extractionSources.slice(0, 8) : [],
    extractionCapabilities: observation.extractionCapabilities || {},
    requestedUrl: observation.requestedUrl || "",
    error: observation.error || observation.snapshotError || "",
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

function safePossibleNextActions(extension = null, skill = null, observation = null) {
  if (!extension || !skill) return [];
  if (observation?.isLoginPage) return [];
  return actionsForSkill(skill)
    .filter((action) => !isProtectedSuggestion(action))
    .slice(0, 10)
    .map(safeActionSummary);
}

function recordFailedObservation(state, observation = {}, details = {}) {
  const engine = observation.engine || details.engine || "unknown";
  const engineFailures = {
    ...(state.engineFailures && typeof state.engineFailures === "object" && !Array.isArray(state.engineFailures)
      ? state.engineFailures
      : {}),
    [engine]: {
      at: nowIso(),
      error: details.error || observation.error || observation.snapshotError || "Invalid browser observation.",
      requestedUrl: observation.requestedUrl || details.requestedUrl || "",
    },
  };

  return saveState({
    ...state,
    lastFailedObservation: {
      ...compactObservation(observation),
      at: nowIso(),
      previousCurrentUrl: state.currentUrl || state.lastValidObservation?.url || "",
    },
    engineFailures,
    failureCount: Number(state.failureCount || 0) + 1,
  });
}

function updateStateFromObservation(state, observation, extension, pageKey) {
  if (!isValidObservation(observation)) {
    return recordFailedObservation(state, observation);
  }

  const visited = Array.from(new Set([
    ...(Array.isArray(state.visited) ? state.visited : []),
    observation.url || "",
  ].filter(Boolean))).slice(-40);
  const compact = compactObservation(observation);

  return saveState({
    ...state,
    currentUrl: observation.url,
    currentTitle: observation.title || "",
    currentExtensionId: extension?.id || "",
    currentPageKey: pageKey || "",
    lastObservation: compact,
    lastValidObservation: compact,
    activeEngine: observation.engine || state.activeEngine || "",
    visited,
    failureCount: 0,
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
  watcher = null,
  filledFields = [],
  missingFields = [],
  submitStatus = "",
  nextSafeAction = "",
  diagnostics = null,
  runtimeTiming = null,
  tokenUsage = null,
} = {}) {
  const observationIsValid = observation && isValidObservation(observation);
  return {
    ok,
    status,
    instruction: redactInstructionSecrets(instruction),
    currentUrl: observationIsValid ? observation.url : state?.currentUrl || state?.lastValidObservation?.url || state?.lastFailedObservation?.url || "",
    currentTitle: observationIsValid ? observation.title || state?.currentTitle || "" : state?.currentTitle || state?.lastValidObservation?.title || state?.lastFailedObservation?.title || "",
    extensionId: observationIsValid ? (extension?.id || state?.currentExtensionId || "") : state?.currentExtensionId || "",
    pageKey: observationIsValid ? (pageKey || state?.currentPageKey || "") : state?.currentPageKey || "",
    engine: observationIsValid
      ? (observation.engine || state?.activeEngine || "")
      : state?.lastFailedObservation?.engine || state?.activeEngine || "",
    state,
    steps,
    summary,
    whatFound: whatFound || (observationIsValid ? compactObservation(observation) : null),
    lastFailedObservation: state?.lastFailedObservation || null,
    engineFailures: state?.engineFailures || {},
    possibleNextActions,
    requiresUser,
    blockedReason,
    learned,
    watcher,
    filledFields,
    missingFields,
    submitStatus,
    nextSafeAction,
    diagnostics,
    runtimeTiming,
    tokenUsage: tokenUsage || browserAgentTokenUsage(),
  };
}

function redactedFields(fields = []) {
  return (Array.isArray(fields) ? fields : []).map((field) => {
    const label = field.label || field.name || field.id || field.selector || "field";
    const secret = Boolean(field.secret) || /\b(password|pass|pwd|otp|code|pin)\b/i.test(String(label));
    return {
      ...field,
      label,
      secret,
      value: secret ? "[redacted]" : field.value,
    };
  });
}

function actionResultFromToolResult(result = {}) {
  return result?.actionResult || result?.raw?.actionResult || null;
}

function filledFieldsFromResult(result = {}, command = {}) {
  const actionResult = actionResultFromToolResult(result);
  const filled = actionResult?.filled || actionResult?.fillResult?.filled || [];
  if (Array.isArray(filled) && filled.length) {
    return filled.map((field) => ({
      label: field.key || field.label || "field",
      type: field.type || "",
      value: field.redacted ? "[redacted]" : field.valuePreview || "",
      secret: Boolean(field.redacted),
    }));
  }
  return result?.ok ? redactedFields(command?.args?.fields || []) : [];
}

function missingFieldsFromResult(result = {}) {
  const actionResult = actionResultFromToolResult(result);
  const missing = actionResult?.missing || actionResult?.fillResult?.missing || [];
  return Array.isArray(missing)
    ? missing.map((field) => safeText(field.key || field.label || field.name || field.selector || "field", 120)).filter(Boolean)
    : [];
}

function submitStatusFromResult(result = {}) {
  const actionResult = actionResultFromToolResult(result);
  const submit = actionResult?.submitResult || (actionResult?.action === "submit" ? actionResult : null);
  if (!submit) return "";
  if (submit.ok) return submit.submitted ? `submitted via ${submit.submitted}` : "submitted";
  return submit.error || "submit failed";
}

function pendingFormFromResult(result = {}, previousPending = null) {
  const missing = missingFieldsFromResult(result);
  if (!missing.length) return null;
  return {
    expectedField: missing[0],
    expectedFields: missing,
    missingFields: missing,
    lastPrompt: `Missing field: ${missing[0]}`,
    createdAt: nowIso(),
  };
}

function compactToolResult(result = {}, command = {}) {
  return {
    ok: Boolean(result?.ok),
    status: result?.status || "",
    action: result?.action || command?.tool || "",
    engine: result?.engine || "",
    extractionPath: result?.observation?.extractionPath || "",
    currentUrl: result?.currentUrl || result?.observation?.url || "",
    currentTitle: result?.currentTitle || result?.observation?.title || "",
    error: result?.error || "",
    filledFields: filledFieldsFromResult(result, command),
    missingFields: missingFieldsFromResult(result),
    submitStatus: submitStatusFromResult(result),
  };
}

async function executeWatcherCommand(command = {}, args = {}, state = defaultState()) {
  const tool = command?.tool || "";
  const activeEnginePriority = state.activeEngine === "chrome_cdp"
    ? ["chrome_cdp", "lightpanda_cdp", "static_fetch"]
    : state.activeEngine === "lightpanda_cdp"
      ? ["lightpanda_cdp", "chrome_cdp", "static_fetch"]
      : null;
  const commandArgs = {
    ...(command?.args || {}),
    sessionId: state.sessionId || args.sessionId,
    instruction: args.instruction || "",
    useExtensions: boolArg(args.useExtensions, true),
    ...(activeEnginePriority && tool !== "browserNavigate" ? { enginePriority: activeEnginePriority } : {}),
    ...(args.waitMs ? { waitMs: args.waitMs } : {}),
    ...(args.afterWaitMs ? { afterWaitMs: args.afterWaitMs } : {}),
    ...(args.pageSettleMs ? { pageSettleMs: args.pageSettleMs } : {}),
    ...(args.pageSettlePollMs ? { pageSettlePollMs: args.pageSettlePollMs } : {}),
    ...(args.extensionId ? { extensionId: args.extensionId } : {}),
  };

  if (tool === "browserNavigate") return browserNavigate(commandArgs);
  if (tool === "browserObserve") return browserObserve({ ...commandArgs, lastValidObservation: state.lastValidObservation, state });
  if (tool === "browserClickByText") {
    return browserClickByText({
      ...commandArgs,
      observation: isValidObservation(state.lastValidObservation) ? state.lastValidObservation : null,
      state,
      waitMs: args.waitMs || "1200",
    });
  }
  if (tool === "browserFillFields") return browserFillFields(commandArgs);
  if (tool === "browserSubmitForm") return browserSubmitForm(commandArgs);
  if (tool === "browserFillAndSubmit") return browserFillAndSubmit(commandArgs);
  if (tool === "browserScrape") return browserObserve({ ...commandArgs, lastValidObservation: state.lastValidObservation, state });
  if (tool === "browserLearn") return learn({ ...args, ...commandArgs });
  if (tool === "browserShowActions") return showActions({ ...args, ...commandArgs }, state);
  if (tool === "browserReset") return browserAgentReset({ ...args, sessionId: state.sessionId });
  if (tool === "browserStatus") return browserAgentStatus({ ...args, sessionId: state.sessionId });
  return browserObserve({ ...commandArgs, lastValidObservation: state.lastValidObservation, state });
}

function stepsFromWatcherResult(watcher = {}, result = {}, command = {}) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  return [
    {
      type: "watch",
      tool: "watchBrowserInstruction",
      ok: Boolean(watcher.ok && !watcher.needsUser),
      intent: watcher.intent,
      confidence: watcher.confidence,
      risk: watcher.risk,
      resultPreview: preview({
        intent: watcher.intent,
        reason: watcher.reason,
        command: redactCommand(command),
      }, 900),
    },
    ...steps,
  ];
}

async function browserAgentRunTaskPlan(args = {}, taskPlan = { steps: [] }) {
  const startedAt = Number(args._runStartedAt || nowMs());
  const sessionId = safeSessionId(args.sessionId || DEFAULT_SESSION_ID);
  const results = [];
  let currentUrl = args.currentUrl || "";
  let last = null;
  const sequence = Array.isArray(taskPlan.steps) ? taskPlan.steps : [];

  for (let index = 0; index < sequence.length; index += 1) {
    const step = sequence[index] || {};
    const stepInstruction = step.instruction || "";

    if (index > 0 && last && looksLikeLoginStep(step) && resultLooksAuthenticated(last)) {
      const skippedSummary = "Already on an authenticated page after navigation; skipped the login form step.";
      const skippedTiming = {
        totalMs: 0,
        taskPlanningMs: 0,
        watcherMs: 0,
        browserToolMs: 0,
        verificationMs: 0,
        stateMs: 0,
        mainModelMs: 0,
      };
      results.push({
        index: index + 1,
        kind: step.kind || "",
        instruction: redactInstructionSecrets(stepInstruction),
        ok: true,
        status: "success",
        summary: skippedSummary,
        currentUrl: currentUrl || last.currentUrl || "",
        blockedReason: "",
        runtimeTiming: skippedTiming,
        tokenUsage: browserAgentTokenUsage(),
      });
      last = {
        ...last,
        ok: true,
        status: "success",
        summary: skippedSummary,
      };
      continue;
    }

    const stepResult = await browserAgentRun({
      ...args,
      sessionId,
      instruction: stepInstruction,
      currentUrl,
      _skipTaskPlan: true,
    });

    results.push({
      index: index + 1,
      kind: step.kind || "",
      instruction: redactInstructionSecrets(stepInstruction),
      ok: Boolean(stepResult.ok),
      status: stepResult.status || "",
      summary: stepResult.summary || "",
      currentUrl: stepResult.currentUrl || "",
      blockedReason: stepResult.blockedReason || "",
      runtimeTiming: stepResult.runtimeTiming || null,
      tokenUsage: stepResult.tokenUsage || null,
    });

    last = stepResult;
    currentUrl = stepResult.currentUrl || stepResult.state?.currentUrl || stepResult.state?.lastValidObservation?.url || currentUrl;

    if (!stepResult.ok || stepResult.status === "needs_user" || stepResult.status === "blocked") {
      return {
        ...stepResult,
        instruction: redactInstructionSecrets(args.instruction || sequence.map((item) => item.instruction).join(" then ")),
        status: stepResult.status || "failed",
        summary: summarizeTaskSequence(results, stepResult.summary || stepResult.blockedReason || ""),
        runtimeTiming: summarizeSequenceTiming(startedAt, args._taskPlanningMs, results),
        tokenUsage: browserAgentTokenUsage(),
        sequence: {
          completed: results.filter((item) => item.ok).length,
          total: sequence.length,
          stoppedAt: index + 1,
          items: results,
          planner: taskPlan.reason || "",
        },
        nextSafeAction: stepResult.nextSafeAction || "Clarify or retry the stopped step.",
      };
    }
  }

  return {
    ...(last || {}),
    instruction: redactInstructionSecrets(args.instruction || sequence.map((item) => item.instruction).join(" then ")),
    ok: Boolean(last?.ok),
    status: last?.status || "success",
    summary: summarizeTaskSequence(results, last?.summary || ""),
    runtimeTiming: summarizeSequenceTiming(startedAt, args._taskPlanningMs, results),
    tokenUsage: browserAgentTokenUsage(),
    sequence: {
      completed: sequence.length,
      total: sequence.length,
      stoppedAt: null,
      items: results,
      planner: taskPlan.reason || "",
    },
  };
}

function summarizeSequenceTiming(startedAt, taskPlanningMs = 0, results = []) {
  const stepTimings = results.map((item) => item.runtimeTiming || {});
  const sum = (key) => roundMs(stepTimings.reduce((total, timing) => total + Number(timing?.[key] || 0), 0));
  return {
    totalMs: roundMs(nowMs() - startedAt),
    taskPlanningMs: roundMs(taskPlanningMs),
    watcherMs: sum("watcherMs"),
    browserToolMs: sum("browserToolMs"),
    verificationMs: sum("verificationMs"),
    stateMs: sum("stateMs"),
    mainModelMs: 0,
    steps: results.map((item) => ({
      index: item.index,
      kind: item.kind,
      totalMs: roundMs(item.runtimeTiming?.totalMs || 0),
      watcherMs: roundMs(item.runtimeTiming?.watcherMs || 0),
      browserToolMs: roundMs(item.runtimeTiming?.browserToolMs || 0),
      verificationMs: roundMs(item.runtimeTiming?.verificationMs || 0),
    })),
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

  if (!observationResult.ok) {
    const failedState = recordFailedObservation(state, observationResult.observation, {
      error: observationResult.error,
      requestedUrl: observationResult.observation?.requestedUrl,
      engine: observationResult.observation?.engine,
    });

    return responseBase({
      ok: false,
      status: observationResult.status || "failed",
      instruction: args.instruction || "observe",
      state: failedState,
      observation: null,
      steps: observationResult.raw?.steps || [
        {
          type: "observe",
          tool: "browserObserve",
          ok: false,
          error: observationResult.error,
          previousCurrentUrl: observationResult.previousCurrentUrl,
        },
      ],
      summary: `Browser observation failed and state was not updated. Previous valid URL: ${observationResult.previousCurrentUrl || "none"}.`,
      possibleNextActions: [],
      requiresUser: true,
      blockedReason: observationResult.error || "observation_failed",
    });
  }

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
    steps: observationResult.raw?.steps || [
      {
        type: "observe",
        tool: "browserObserve",
        engine: observationResult.observation.engine || "",
        input: {
          currentUrl: explicitNavigationUrlFromArgs(args) || args.currentUrl || state.currentUrl || state.lastValidObservation?.url || "",
          useExtensions: boolArg(args.useExtensions, true),
        },
        ok: true,
        resultPreview: preview(compactObservation(observationResult.observation), 900),
      },
    ],
    summary: observationResult.observation.url
      ? `Observed ${observationResult.observation.url} with ${observationResult.observation.engine || "browser engine"}.`
      : "Observed the current browser page.",
    possibleNextActions: safePossibleNextActions(observationResult.extension, skill, observationResult.observation),
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
  const quoted = raw.match(/["'](.+?)["']/)?.[1];
  if (quoted) return safeText(quoted, 160);

  const lower = raw.toLowerCase();

  if (
    /\b(what|which|show|list|tell me|visible|available)\b.*\b(button|buttons|link|links|clickable|elements)\b/.test(lower) ||
    /\b(what can i click|what to click|buttons to click|links to click)\b/.test(lower)
  ) {
    return "";
  }

  const actionMatch = raw.match(/(?:try\s+)?(?:click|clicking|open|press|tap|select|choose)\s+(?:on\s+|the\s+)?(.+)$/i);
  if (actionMatch?.[1]) {
    return safeText(
      actionMatch[1]
        .replace(/\s+(?:and|then)\s+(?:read|observe|inspect|tell|show|summarize).*$/i, " ")
        .replace(/\b(button|link|page|menu|section)\b/ig, " ")
        .replace(/\s+/g, " ")
        .trim(),
      160
    );
  }

  return safeText(
    raw
      .replace(/\b(please|try|execute|click|clicking|open|go to|navigate to|perform|run|press|tap|select|choose|read|observe|inspect|tell|show|the|button|link|on this page|there)\b/ig, " ")
      .replace(/\b(and|then)\b.*$/ig, " ")
      .replace(/\s+/g, " ")
      .trim(),
    160
  );
}

async function executeGenericVisibleAction(args = {}, state = defaultState(), steps = [], existingObservationResult = null) {
  const effectiveCurrentUrl = normalizeUrlInput(
    explicitNavigationUrlFromArgs(args) ||
    args.currentUrl ||
    state.currentUrl ||
    state.lastValidObservation?.url ||
    ""
  );

  if (!effectiveCurrentUrl) {
    return responseBase({
      ok: false,
      status: "needs_user",
      instruction: args.instruction || "",
      state,
      steps,
      summary: "No valid current page is loaded.",
      possibleNextActions: [],
      requiresUser: true,
      blockedReason: "no_valid_current_page",
    });
  }

  const observationResult = existingObservationResult?.ok
    ? existingObservationResult
    : await observePage({ ...args, currentUrl: effectiveCurrentUrl, useExtensions: false }, state);

  if (!observationResult.ok || !isValidObservation(observationResult.observation)) {
    const failedState = recordFailedObservation(state, observationResult.observation, {
      error: observationResult.error,
      requestedUrl: effectiveCurrentUrl,
    });

    return responseBase({
      ok: false,
      status: "failed",
      instruction: args.instruction || "",
      state: failedState,
      observation: null,
      steps: [
        ...steps,
        ...(observationResult.raw?.steps || [{
          type: "observe",
          tool: "browserObserve",
          ok: false,
          error: observationResult.error,
        }]),
      ],
      summary: "Could not observe the current page, so I did not click anything or change browser state.",
      possibleNextActions: [],
      requiresUser: true,
      blockedReason: observationResult.error || "observation_failed",
    });
  }

  const observation = observationResult.observation;
  const pageKey = pageKeyForObservation(null, observation);
  const updated = updateStateFromObservation(state, observation, null, pageKey);

  if (!existingObservationResult) {
    steps.push({
      type: "observe",
      tool: "browserObserve",
      engine: observation.engine || "",
      input: {
        currentUrl: effectiveCurrentUrl,
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

  const clickResult = await browserClickByText({
    currentUrl: observation.url || effectiveCurrentUrl,
    text: targetText,
    observation,
    state: updated,
    waitMs: args.waitMs || "1200",
  });

  const clicked = Boolean(clickResult?.ok && clickResult?.status === "success");

  steps.push({
    type: "action",
    tool: clickResult?.matchedElement?.href ? "browserClickByHref" : "browserClickByText",
    engine: clickResult?.engine || "",
    input: {
      url: observation.url || effectiveCurrentUrl,
      text: targetText,
      href: clickResult?.matchedElement?.href || clickResult?.targetHref || "",
    },
    ok: clicked,
    resultPreview: preview(clickResult, 900),
  });

  const postObservation = observationFromPageResult(clickResult || {});
  const finalObservation = isValidObservation(postObservation) ? postObservation : observation;
  const finalPageKey = pageKeyForObservation(null, finalObservation);
  const finalState = clicked
    ? updateStateFromObservation(updated, finalObservation, null, finalPageKey)
    : recordFailedObservation(updated, postObservation, {
        error: clickResult?.error || clickResult?.blockedReason || "target_not_found",
        requestedUrl: observation.url || effectiveCurrentUrl,
      });

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
      ? "Clicked visible text \"" + targetText + "\" and observed the result."
      : "I could not find or click a visible button/link matching \"" + targetText + "\" on the current page.",
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

  if (!observationResult.ok || !isValidObservation(observationResult.observation)) {
    const failedState = recordFailedObservation(state, observationResult.observation, {
      error: observationResult.error,
      requestedUrl: observationResult.observation?.requestedUrl,
    });

    return responseBase({
      ok: false,
      status: observationResult.status || "failed",
      instruction: args.instruction || "",
      state: failedState,
      observation: null,
      steps: observationResult.raw?.steps || [
        {
          type: "observe",
          tool: "browserObserve",
          ok: false,
          error: observationResult.error,
        },
      ],
      summary: "Could not observe the current page, so I did not execute the requested action.",
      possibleNextActions: [],
      requiresUser: true,
      blockedReason: observationResult.error || "observation_failed",
    });
  }

  steps.push({
    type: "observe",
    tool: "browserObserve",
    engine: observationResult.observation.engine || "",
    input: {
      currentUrl: explicitNavigationUrlFromArgs(args) || args.currentUrl || state.currentUrl || state.lastValidObservation?.url || "",
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
  const observedState = updateStateFromObservation(state, observationResult.observation, extension, pageKey);
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
      return responseBase({
        ok: false,
        status: "blocked",
        instruction: args.instruction || "",
        state: observedState,
        observation: observationResult.observation,
        extension,
        pageKey,
        steps,
        summary: "Blocked dangerous action \"" + (action.label || action.id || "action") + "\".",
        possibleNextActions: safePossibleNextActions(extension, skill, observationResult.observation),
        requiresUser: true,
        blockedReason: "Exact confirmation required: " + requiredPhrase,
      });
    }
  }

  if (observationResult.observation.isLoginPage && action.pageKey && !/login/i.test(action.pageKey)) {
    return responseBase({
      ok: false,
      status: "needs_user",
      instruction: args.instruction || "",
      state: observedState,
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
  const targetUrl = actionTargetUrl(action, skill, {
    ...observedState,
    currentUrl: observationResult.observation.url || observedState.currentUrl || observedState.lastValidObservation?.url || "",
  });

  if (action.href) {
    actionResult = await browserClickByHref({
      currentUrl: observationResult.observation.url || targetUrl,
      href: action.href,
      waitMs: args.waitMs || "1200",
    });

    clicked = Boolean(actionResult?.ok && actionResult?.status === "success");

    steps.push({
      type: "action",
      tool: "browserClickByHref",
      engine: actionResult?.engine || "",
      input: {
        href: action.href,
      },
      ok: clicked,
      resultPreview: preview(actionResult, 900),
    });
  } else if (action.selector) {
    actionResult = await browserClickBySelector({
      currentUrl: targetUrl || observationResult.observation.url,
      selector: action.selector,
      waitMs: args.waitMs || "1200",
    });

    clicked = Boolean(actionResult?.ok && actionResult?.status === "success");

    steps.push({
      type: "action",
      tool: "browserClickBySelector",
      engine: actionResult?.engine || "",
      input: {
        url: targetUrl,
        selector: action.selector,
      },
      ok: clicked,
      resultPreview: preview(actionResult, 900),
    });

    if (!clicked) {
      const byText = await browserClickByText({
        currentUrl: targetUrl || observationResult.observation.url,
        text: action.label,
        observation: observationResult.observation,
        waitMs: args.waitMs || "1200",
      });

      clicked = Boolean(byText?.ok && byText?.status === "success");
      actionResult = byText;

      steps.push({
        type: "retry",
        tool: byText?.matchedElement?.href ? "browserClickByHref" : "browserClickByText",
        engine: byText?.engine || "",
        input: {
          url: targetUrl,
          text: action.label,
        },
        ok: clicked,
        resultPreview: preview(byText, 900),
      });
    }
  } else {
    const byText = await browserClickByText({
      currentUrl: targetUrl || observationResult.observation.url,
      text: action.label,
      observation: observationResult.observation,
      waitMs: args.waitMs || "1200",
    });

    clicked = Boolean(byText?.ok && byText?.status === "success");
    actionResult = byText;

    steps.push({
      type: "action",
      tool: byText?.matchedElement?.href ? "browserClickByHref" : "browserClickByText",
      engine: byText?.engine || "",
      input: {
        url: targetUrl || observationResult.observation.url,
        text: action.label,
      },
      ok: clicked,
      resultPreview: preview(byText, 900),
    });
  }

  const postObservation = observationFromPageResult(actionResult || {});
  const finalObservation = isValidObservation(postObservation) ? postObservation : observationResult.observation;
  const finalPageKey = pageKeyForObservation(skill, finalObservation);
  const updated = clicked
    ? updateStateFromObservation(observedState, finalObservation, extension, finalPageKey)
    : recordFailedObservation(observedState, postObservation, {
        error: actionResult?.error || actionResult?.blockedReason || "target_not_clicked",
        requestedUrl: targetUrl || observationResult.observation.url,
      });

  if (!clicked) {
    return responseBase({
      ok: false,
      status: "failed",
      instruction: args.instruction || "",
      state: updated,
      observation: null,
      extension,
      pageKey: finalPageKey,
      steps,
      summary: "I could not execute \"" + (action.label || action.id || "action") + "\". The target was not found or did not click successfully.",
      possibleNextActions: safePossibleNextActions(extension, skill, finalObservation),
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
    summary: "Executed \"" + (action.label || action.id || "action") + "\".",
    possibleNextActions: safePossibleNextActions(extension, skill, finalObservation),
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

  if (!observationResult.ok || !isValidObservation(observation)) {
    const failedState = recordFailedObservation(state, observation, {
      error: observationResult.error,
      requestedUrl: observation?.requestedUrl,
    });

    return responseBase({
      ok: false,
      status: observationResult.status || "failed",
      instruction: args.instruction || "",
      state: failedState,
      observation: null,
      steps: observationResult.raw?.steps || [
        {
          type: "observe",
          tool: "browserObserve",
          ok: false,
          error: observationResult.error,
        },
      ],
      summary: "Could not observe a valid page, so I did not learn an action.",
      possibleNextActions: [],
      requiresUser: true,
      blockedReason: observationResult.error || "observation_failed",
    });
  }

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
    browserHealth: await browserHealth({ mode: args.mode || "browser" }),
  };
}

export async function browserAgentDiagnose(args = {}) {
  const sessionId = safeSessionId(args.sessionId || DEFAULT_SESSION_ID);
  const state = loadState(sessionId);
  const instruction = String(args.instruction || state.pendingInstruction || "").trim();
  const browserResult = typeof args.browserResult === "string"
    ? (() => {
        try { return JSON.parse(args.browserResult); } catch { return { ok: false, error: args.browserResult }; }
      })()
    : args.browserResult && typeof args.browserResult === "object"
      ? args.browserResult
      : null;
  const error = String(args.error || browserResult?.error || browserResult?.blockedReason || "").trim();
  const watcher = browserResult?.watcher || (instruction
    ? watchBrowserInstruction({
        sessionId,
        rawUserMessage: instruction,
        currentState: state,
        lastValidObservation: state.lastValidObservation,
        lastFailedObservation: state.lastFailedObservation,
        currentUrl: args.currentUrl || state.currentUrl || state.lastValidObservation?.url || "",
      })
    : {});
  const command = browserResult?.watcher?.command || browserResult?.lastCommand || watcher?.command || {};
  const observation = browserResult?.whatFound || browserResult?.observation || state.lastFailedObservation || state.lastValidObservation || {};
  const result = browserResult || {
    ok: false,
    status: "failed",
    error,
    engine: observation?.engine || state.activeEngine || "",
    observation,
  };
  const diagnostics = adviseBrowserFailure({
    watcher,
    command,
    result,
    observation,
    state,
    verification: result?.verification || null,
  });

  return {
    ok: true,
    status: "success",
    sessionId,
    instruction,
    currentUrl: state.currentUrl || state.lastValidObservation?.url || "",
    currentTitle: state.currentTitle || state.lastValidObservation?.title || "",
    diagnostics: diagnostics || {
      diagnosis: error ? "No specific browser-agent diagnosis matched this error." : "No browser error was provided to diagnose.",
      evidence: [error].filter(Boolean),
      suggestedFixes: [
        "Ask `browser agent status` to inspect current state and engine health.",
        "Retry after confirming the backend and CDP browser engine are running.",
      ],
      engineFailures: state.engineFailures || {},
    },
    state: {
      currentUrl: state.currentUrl || "",
      currentTitle: state.currentTitle || "",
      activeEngine: state.activeEngine || "",
      engineFailures: state.engineFailures || {},
      lastFailedObservation: state.lastFailedObservation || null,
    },
  };
}

export async function browserAgentRun(args = {}) {
  const runStartedAt = nowMs();
  let taskPlanningMs = 0;
  let watcherMs = 0;
  let browserToolMs = 0;
  let verificationMs = 0;
  let stateMs = 0;
  const runtimeTiming = () => ({
    totalMs: roundMs(nowMs() - runStartedAt),
    taskPlanningMs: roundMs(taskPlanningMs),
    watcherMs: roundMs(watcherMs),
    browserToolMs: roundMs(browserToolMs),
    verificationMs: roundMs(verificationMs),
    stateMs: roundMs(stateMs),
    mainModelMs: 0,
  });
  const sessionId = safeSessionId(args.sessionId || DEFAULT_SESSION_ID);
  const state = loadState(sessionId);
  const instruction = String(args.instruction || "").trim();

  const baseArgs = {
    ...args,
    sessionId,
    instruction,
  };

  const taskPlanningStartedAt = nowMs();
  const taskPlan = args._skipTaskPlan ? { steps: [], atomic: true } : planBrowserTask({ instruction });
  taskPlanningMs = nowMs() - taskPlanningStartedAt;
  if (Array.isArray(taskPlan.steps) && taskPlan.steps.length > 1) {
    return browserAgentRunTaskPlan({
      ...baseArgs,
      _taskPlanningMs: taskPlanningMs,
      _runStartedAt: runStartedAt,
    }, taskPlan);
  }

  const watcherStartedAt = nowMs();
  const watcher = watchBrowserInstruction({
    sessionId,
    rawUserMessage: instruction,
    currentState: state,
    lastValidObservation: state.lastValidObservation,
    lastFailedObservation: state.lastFailedObservation,
    currentUrl: args.currentUrl || state.currentUrl || state.lastValidObservation?.url || "",
    currentTitle: args.currentTitle || state.currentTitle || state.lastValidObservation?.title || "",
    confirm: args.confirm === true || String(args.confirm || "").toLowerCase() === "true",
  });
  watcherMs = nowMs() - watcherStartedAt;

  const redactedWatcher = {
    ...watcher,
    command: redactCommand(watcher.command),
    normalizedInstruction: redactInstructionSecrets(watcher.normalizedInstruction || ""),
  };

  if (watcher.needsUser || !watcher.command) {
    const waitingState = saveState({
      ...state,
      pendingInstruction: redactInstructionSecrets(instruction),
      pendingAction: redactedWatcher,
      lastIntent: watcher.intent || "",
      lastCommand: redactCommand(watcher.command),
    });

    return responseBase({
      ok: false,
      status: "needs_user",
      instruction,
      state: waitingState,
      steps: stepsFromWatcherResult(redactedWatcher, {}, watcher.command),
      summary: watcher.reason || "I need clarification before acting in the browser.",
      requiresUser: true,
      blockedReason: watcher.reason || "needs_user",
      watcher: redactedWatcher,
      nextSafeAction: watcher.reason || "Navigate to a URL or clarify the target field/action.",
      runtimeTiming: runtimeTiming(),
      tokenUsage: browserAgentTokenUsage(),
    });
  }

  const command = watcher.command;
  const browserToolStartedAt = nowMs();
  const result = await executeWatcherCommand(command, baseArgs, state);
  browserToolMs = nowMs() - browserToolStartedAt;

  if (result?.state && ["browserLearn", "browserShowActions", "browserReset", "browserStatus"].includes(command.tool)) {
    return {
      ...result,
      watcher: redactedWatcher,
      steps: stepsFromWatcherResult(redactedWatcher, result, command),
      runtimeTiming: runtimeTiming(),
      tokenUsage: browserAgentTokenUsage(),
    };
  }

  const observation = observationFromPageResult(result || {});
  const verificationStartedAt = nowMs();
  const verification = verifyBrowserResult({
    watcher,
    command,
    result,
    observation,
    previousState: state,
  });
  verificationMs = nowMs() - verificationStartedAt;

  if (!verification.ok) {
    const diagnostics = adviseBrowserFailure({
      watcher,
      command,
      result,
      observation,
      state,
      verification,
    });
    const stateStartedAt = nowMs();
    const failedState = result?.status === "needs_user"
      ? saveState({
          ...state,
          pendingInstruction: redactInstructionSecrets(instruction),
          pendingAction: redactedWatcher,
          lastIntent: watcher.intent,
          lastCommand: redactCommand(command),
          lastToolResult: compactToolResult(result, command),
        })
      : recordFailedObservation({
          ...state,
          lastIntent: watcher.intent,
          lastCommand: redactCommand(command),
          lastToolResult: compactToolResult(result, command),
        }, observation, {
          error: result?.error || observation.error || observation.snapshotError,
          requestedUrl: observation.requestedUrl || command.args?.currentUrl || command.args?.url || "",
          engine: observation.engine || result?.engine,
        });
    stateMs = nowMs() - stateStartedAt;

    return responseBase({
      ok: false,
      status: result?.status === "needs_user" || verification.needsUser ? "needs_user" : "failed",
      instruction,
      state: failedState,
      observation: isValidObservation(observation) ? observation : null,
      steps: stepsFromWatcherResult(redactedWatcher, result, command),
      summary: result?.status === "needs_user"
        ? (result.error || watcher.reason || "The browser needs more input before acting.")
        : `${verification.reason || "Browser action failed verification."} Previous valid URL: ${state.currentUrl || state.lastValidObservation?.url || "none"}.`,
      possibleNextActions: [],
      requiresUser: true,
      blockedReason: verification.blockedReason || result?.error || observation.error || observation.snapshotError || "observation_failed",
      watcher: redactedWatcher,
      filledFields: filledFieldsFromResult(result, command),
      missingFields: missingFieldsFromResult(result),
      submitStatus: submitStatusFromResult(result),
      nextSafeAction: verification.nextSafeAction || "Retry the action, clarify the target, or navigate to a valid URL.",
      diagnostics,
      runtimeTiming: runtimeTiming(),
      tokenUsage: browserAgentTokenUsage(),
    });
  }

  const extension = boolArg(args.useExtensions, true)
    ? extensionFromContext({
        extensionId: args.extensionId,
        observation,
        state,
        instruction,
      })
    : null;
  const skill = extension ? getExtensionSkill(extension.id) : null;
  const pageKey = pageKeyForObservation(skill, observation);
  const stateStartedAt = nowMs();
  const updatedFromObservation = updateStateFromObservation(state, observation, extension, pageKey);
  const pendingForm = pendingFormFromResult(result, state.pendingForm);
  const updated = saveState({
    ...updatedFromObservation,
    pendingForm,
    pendingInstruction: "",
    pendingAction: null,
    lastIntent: watcher.intent,
    lastCommand: redactCommand(command),
    lastToolResult: compactToolResult(result, command),
    lastToolResults: [
      ...(Array.isArray(updatedFromObservation.lastToolResults) ? updatedFromObservation.lastToolResults : []),
      compactToolResult(result, command),
    ].slice(-20),
  });
  stateMs = nowMs() - stateStartedAt;
  const possibleNextActions = extension && skill ? safePossibleNextActions(extension, skill, observation) : [];
  const filledFields = filledFieldsFromResult(result, command);
  const missingFields = missingFieldsFromResult(result);
  const submitStatus = submitStatusFromResult(result);
  const accessDenied = /\baccess denied\b/i.test(`${observation.url || ""} ${observation.title || ""} ${observation.textPreview || ""}`);

  return responseBase({
    ok: true,
    status: "success",
    instruction,
    state: updated,
    observation,
    extension,
    pageKey,
    steps: stepsFromWatcherResult(redactedWatcher, result, command),
    summary: accessDenied
      ? "Submitted the form, but the site returned Access Denied for this browser/IP/location."
      : watcher.intent === "fill_form"
      ? "Filled the requested field values without submitting."
      : watcher.intent === "fill_and_submit"
        ? "Filled the requested field values and submitted the form."
        : watcher.intent === "submit_form"
          ? "Submitted the current form."
          : watcher.intent === "click_or_open"
            ? `Clicked/opened "${command.args?.text || "the requested target"}" and observed the result.`
            : watcher.intent === "navigate"
              ? `Navigated to ${observation.url}.`
              : `Observed ${observation.url}.`,
    possibleNextActions,
    requiresUser: true,
    watcher: redactedWatcher,
    filledFields,
    missingFields,
    submitStatus,
    nextSafeAction: accessDenied
      ? "Use an authorized network/IP or ask the site admin to whitelist this browser location."
      : missingFields.length
      ? `Provide a value for ${missingFields[0]}.`
      : possibleNextActions[0]?.label || "Tell me the next visible button/link to click, fields to fill, or page to read.",
    runtimeTiming: runtimeTiming(),
    tokenUsage: browserAgentTokenUsage(),
  });
}
