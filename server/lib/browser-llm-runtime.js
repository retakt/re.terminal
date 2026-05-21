import fs from "node:fs";
import path from "node:path";

const ALLOWED_TOOLS = new Set([
  "browserNavigate",
  "browserObserve",
  "browserClickByText",
  "browserFillFields",
  "browserSubmitForm",
  "browserFillAndSubmit",
  "browserScrape",
  "browserShowActions",
]);

const ALLOWED_BACKENDS = new Set(["auto", "lightpanda", "chrome_cdp", "playwright_mcp"]);
const ALLOWED_RISKS = new Set(["low", "medium", "high"]);

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function envNumber(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function safeText(value = "", limit = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function redactBaseUrl(value = "") {
  return String(value || "").replace(/([?&](?:token|key|api_key)=)[^&]+/ig, "$1***");
}

function rawBaseUrl() {
  return String(
    process.env.BROWSER_AGENT_BASE_URL ||
    process.env.BROWSER_AGENT_API_BASE_URL ||
    process.env.RUNTIME_BROWSER_AGENT_BASE_URL ||
    ""
  ).trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

function resolvePromptPath(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function stageEnv(stage, suffix) {
  const prefix = stage === "reporter" ? "BROWSER_AGENT_REPORTER" : "BROWSER_AGENT_PLANNER";
  return process.env[`${prefix}_${suffix}`] ?? process.env[`BROWSER_AGENT_${suffix}`];
}

function stagePromptConfig(stage) {
  const promptPath = resolvePromptPath(stageEnv(stage, "SYSTEM_PROMPT_PATH") || "");
  const inlinePrompt = String(stageEnv(stage, "SYSTEM_PROMPT") || "").trim();
  return {
    promptPath,
    inlinePrompt,
    hasCustomPrompt: Boolean(promptPath || inlinePrompt),
    promptPathExists: promptPath ? fs.existsSync(promptPath) : false,
  };
}

function customSystemPrompt(stage) {
  const config = stagePromptConfig(stage);
  const pieces = [];
  if (config.promptPath) {
    if (!config.promptPathExists) {
      const error = new Error(`Browser agent ${stage} prompt file not found: ${config.promptPath}`);
      error.code = "BROWSER_AGENT_PROMPT_CONFIG_ERROR";
      throw error;
    }
    pieces.push(fs.readFileSync(config.promptPath, "utf8"));
  }
  if (config.inlinePrompt) pieces.push(config.inlinePrompt);
  return pieces.map((piece) => String(piece || "").trim()).filter(Boolean).join("\n\n");
}

function stageOptions(stage) {
  const defaultTemperature = stage === "reporter" ? 0.25 : 0.1;
  const options = {
    temperature: envNumber(
      stage === "reporter" ? "BROWSER_AGENT_REPORTER_TEMPERATURE" : "BROWSER_AGENT_PLANNER_TEMPERATURE",
      envNumber("BROWSER_AGENT_TEMPERATURE", defaultTemperature, { min: 0, max: 2 }),
      { min: 0, max: 2 },
    ),
    top_p: envNumber("BROWSER_AGENT_TOP_P", 0.85, { min: 0, max: 1 }),
    top_k: envNumber("BROWSER_AGENT_TOP_K", 40, { min: 0, max: 1000 }),
    repeat_penalty: envNumber("BROWSER_AGENT_REPEAT_PENALTY", 1.05, { min: 0, max: 4 }),
  };
  const numCtx = envNumber("BROWSER_AGENT_NUM_CTX", 8192, { min: 1024, max: 131072 });
  if (numCtx) options.num_ctx = numCtx;
  const seed = envNumber("BROWSER_AGENT_SEED", NaN);
  if (Number.isFinite(seed)) options.seed = seed;
  return options;
}

export function browserAgentRuntimeConfig({ display = false } = {}) {
  const baseUrl = rawBaseUrl();
  const model = String(process.env.BROWSER_AGENT_MODEL || process.env.RUNTIME_BROWSER_AGENT_MODEL || "").trim();
  const timeoutMs = Math.max(1000, Number(process.env.BROWSER_AGENT_TIMEOUT_MS || 60000));
  const plannerPrompt = stagePromptConfig("planner");
  const reporterPrompt = stagePromptConfig("reporter");
  const config = {
    configured: Boolean(baseUrl && model),
    llmRequired: true,
    baseUrl,
    redactedBaseUrl: redactBaseUrl(baseUrl),
    model,
    timeoutMs,
    think: envFlag("BROWSER_AGENT_THINK", false),
    options: {
      planner: stageOptions("planner"),
      reporter: stageOptions("reporter"),
    },
    prompts: {
      planner: {
        hasCustomPrompt: plannerPrompt.hasCustomPrompt,
        path: plannerPrompt.promptPath,
        pathExists: plannerPrompt.promptPath ? plannerPrompt.promptPathExists : undefined,
        inline: Boolean(plannerPrompt.inlinePrompt),
      },
      reporter: {
        hasCustomPrompt: reporterPrompt.hasCustomPrompt,
        path: reporterPrompt.promptPath,
        pathExists: reporterPrompt.promptPath ? reporterPrompt.promptPathExists : undefined,
        inline: Boolean(reporterPrompt.inlinePrompt),
      },
    },
    strategy: "llm-required",
    missing: [
      ...(baseUrl ? [] : ["BROWSER_AGENT_BASE_URL"]),
      ...(model ? [] : ["BROWSER_AGENT_MODEL"]),
      ...(plannerPrompt.promptPath && !plannerPrompt.promptPathExists ? ["BROWSER_AGENT_PLANNER_SYSTEM_PROMPT_PATH"] : []),
      ...(reporterPrompt.promptPath && !reporterPrompt.promptPathExists ? ["BROWSER_AGENT_REPORTER_SYSTEM_PROMPT_PATH"] : []),
    ],
  };
  config.configured = config.missing.length === 0;
  if (display) {
    return {
      ...config,
      baseUrl: undefined,
    };
  }
  return config;
}

export function requireBrowserAgentRuntimeConfig() {
  const config = browserAgentRuntimeConfig();
  if (!config.configured) {
    const missing = config.missing.join(", ");
    const error = new Error(`Browser agent LLM is required but not configured. Missing: ${missing}. Set BROWSER_AGENT_BASE_URL and BROWSER_AGENT_MODEL.`);
    error.code = "BROWSER_AGENT_LLM_CONFIG_MISSING";
    error.config = browserAgentRuntimeConfig({ display: true });
    throw error;
  }
  return config;
}

function tokenUsageFromResponse(data = {}, config = {}, stage = "planner", elapsedMs = 0) {
  const usage = data.usage && typeof data.usage === "object" ? data.usage : {};
  const promptTokens = Number(data.prompt_eval_count ?? usage.prompt_tokens ?? usage.promptTokens ?? 0);
  const completionTokens = Number(data.eval_count ?? usage.completion_tokens ?? usage.completionTokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? 0) || promptTokens + completionTokens;
  return {
    stage,
    model: String(data.model || config.model || ""),
    promptTokens,
    completionTokens,
    totalTokens,
    totalDurationMs: Number(data.total_duration || 0) ? Math.round(Number(data.total_duration) / 1_000_000) : elapsedMs,
    promptEvalDurationMs: Number(data.prompt_eval_duration || 0) ? Math.round(Number(data.prompt_eval_duration) / 1_000_000) : 0,
    evalDurationMs: Number(data.eval_duration || 0) ? Math.round(Number(data.eval_duration) / 1_000_000) : 0,
  };
}

export function emptyBrowserAgentTokenUsage() {
  return {
    totalTokens: 0,
    planner: null,
    reporter: null,
  };
}

export function combineBrowserAgentTokenUsage(planner = null, reporter = null) {
  return {
    totalTokens: Number(planner?.totalTokens || 0) + Number(reporter?.totalTokens || 0),
    planner,
    reporter,
  };
}

function responseContent(data = {}) {
  return String(
    data.response ??
    data.message?.content ??
    data.choices?.[0]?.message?.content ??
    data.choices?.[0]?.text ??
    ""
  ).trim();
}

async function callOllamaChat({ stage, messages, format = "json" }) {
  const config = requireBrowserAgentRuntimeConfig();
  const startedAt = performance.now();
  const options = stageOptions(stage);
  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(config.timeoutMs),
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      format,
      think: config.think,
      options,
    }),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = { response: await response.text().catch(() => "") };
  }

  if (!response.ok) {
    const error = new Error(data?.error || `Browser agent LLM ${stage} call failed: HTTP ${response.status}`);
    error.code = "BROWSER_AGENT_LLM_HTTP_ERROR";
    error.status = response.status;
    error.usage = tokenUsageFromResponse(data || {}, config, stage, Math.round(performance.now() - startedAt));
    throw error;
  }

  return {
    content: responseContent(data),
    usage: tokenUsageFromResponse(data || {}, config, stage, Math.round(performance.now() - startedAt)),
    raw: data,
  };
}

function parseStrictJson(content = "", stage = "planner") {
  try {
    return JSON.parse(content);
  } catch (err) {
    const error = new Error(`Browser agent LLM ${stage} returned invalid JSON. The runtime will not guess or use deterministic fallback.`);
    error.code = "BROWSER_AGENT_LLM_INVALID_JSON";
    error.contentPreview = safeText(content, 800);
    error.cause = err;
    throw error;
  }
}

function plannerSystemPrompt() {
  const base = `You are the required LLM brain for a runtime browser agent.
Return ONLY strict JSON. Do not use markdown.

Your job:
- Understand the user's browser instruction against current page state.
- Choose exactly one validated browser command for this turn.
- The deterministic parser is only a local guardrail after you; it is not the planner.
- Prefer safe observation if the instruction is unclear.

Allowed tools:
- browserNavigate: args { "url": "https://..." }
- browserObserve: args { "currentUrl": "...", "focus": "page|links|forms|actions" }
- browserClickByText: args { "currentUrl": "...", "text": "visible text" }
- browserFillFields: args { "currentUrl": "...", "fields": [{ "label": "...", "value": "...", "secret": boolean }] }
- browserSubmitForm: args { "currentUrl": "...", "explicitSubmit": true }
- browserFillAndSubmit: args { "currentUrl": "...", "explicitSubmit": true, "fields": [...] }
- browserScrape: args { "currentUrl": "...", "focus": "..." }
- browserShowActions: args { "currentUrl": "...", "instruction": "..." }

Backend choices:
- auto: let the runtime choose the safest backend.
- lightpanda: fast read, scrape, observe, simple extraction.
- playwright_mcp: real browser actions such as click, type, forms, login, submit, screenshots, network, console, and tabs.
- chrome_cdp: legacy/manual compatibility backend only.

Allowed backends: auto, lightpanda, playwright_mcp, chrome_cdp. Use playwright_mcp for real browser fidelity when the user asks to click/type/fill/submit/login or explicitly says Playwright.
For playwright_mcp, a command may include "url" as well as fields/text. That means: navigate there first, then execute the requested browser action after a fresh snapshot.

Return schema:
{
  "intent": "navigate|observe|click_or_open|fill_form|submit_form|fill_and_submit|scrape|show_actions|learn",
  "risk": "low|medium|high",
  "backend": "auto|lightpanda|playwright_mcp|chrome_cdp",
  "command": { "tool": "browserNavigate|browserObserve|browserClickByText|browserFillFields|browserSubmitForm|browserFillAndSubmit|browserScrape|browserShowActions", "args": {} },
  "requiresConfirmation": false,
  "reason": "short reason",
  "confidence": 0.0
}

Safety:
- Mark login, submit, password, OTP/code, delete, payment, attendance, and profile update as medium or high risk.
- Do not invent credentials.
- If a password/OTP/code value is included, set secret=true for that field.
- If no valid current URL is available for a non-navigation command, return browserNavigate only if the user gave a URL, otherwise browserObserve with reason asking for a URL.`;
  const custom = customSystemPrompt("planner");
  return custom ? `${base}\n\nCustom browser-agent planner instructions:\n${custom}` : base;
}

function reporterSystemPrompt() {
  const base = `You are the required LLM reporter for a runtime browser agent.
Return ONLY strict JSON. Do not use markdown.

Summarize browser execution for the user in compact, non-scary language.
Redact passwords, OTPs, codes, and secrets.
Ground your diagnosis only in the provided result, verification, diagnostics, observation, and engine attempts.
Do not invent frontend/backend/server causes unless that exact evidence appears in the context.
If the evidence says Page.navigate timeout, fetch timeout, loading screen, redirect, validation text, access denied, or login form still visible, say that exact browser/runtime cause.
If evidence is incomplete, say what is unknown instead of guessing.

Return schema:
{
  "summary": "one sentence",
  "whatHappened": "short explanation",
  "success": true,
  "currentPage": "title or url",
  "nextSafeAction": "one safe next action",
  "failureDiagnosis": ""
}`;
  const custom = customSystemPrompt("reporter");
  return custom ? `${base}\n\nCustom browser-agent reporter instructions:\n${custom}` : base;
}

function compactContext(context = {}) {
  return JSON.stringify(context, null, 2).slice(0, 12000);
}

export async function callBrowserAgentPlanner(context = {}) {
  const call = await callOllamaChat({
    stage: "planner",
    messages: [
      { role: "system", content: plannerSystemPrompt() },
      { role: "user", content: compactContext(context) },
    ],
  });
  let plan;
  try {
    plan = parseStrictJson(call.content, "planner");
  } catch (err) {
    err.usage = call.usage;
    throw err;
  }
  return {
    plan,
    usage: call.usage,
    rawContent: call.content,
  };
}

export async function callBrowserAgentReporter(context = {}) {
  const call = await callOllamaChat({
    stage: "reporter",
    messages: [
      { role: "system", content: reporterSystemPrompt() },
      { role: "user", content: compactContext(context) },
    ],
  });
  let report;
  try {
    report = parseStrictJson(call.content, "reporter");
  } catch (err) {
    err.usage = call.usage;
    throw err;
  }
  return {
    report,
    usage: call.usage,
    rawContent: call.content,
  };
}

export function validatePlannerShape(plan = {}) {
  const errors = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) errors.push("plan must be an object");
  const command = plan?.command;
  const tool = command?.tool;
  if (!ALLOWED_RISKS.has(String(plan?.risk || ""))) errors.push("risk must be low, medium, or high");
  if (!ALLOWED_BACKENDS.has(String(plan?.backend || "auto"))) errors.push("backend must be auto, lightpanda, playwright_mcp, or chrome_cdp");
  if (!ALLOWED_TOOLS.has(String(tool || ""))) errors.push(`tool is not allowed: ${tool || "<missing>"}`);
  if (!command || typeof command !== "object" || Array.isArray(command)) errors.push("command must be an object");
  if (!command?.args || typeof command.args !== "object" || Array.isArray(command.args)) errors.push("command.args must be an object");
  const confidence = Number(plan?.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) errors.push("confidence must be a number from 0 to 1");
  return {
    ok: errors.length === 0,
    errors,
    command,
  };
}

export { ALLOWED_TOOLS };
