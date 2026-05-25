import fs from "node:fs";
import path from "node:path";
import { browserAgentJsonSchemaFor } from "./browser-agent-json-schemas.js";

const ALLOWED_TOOLS = new Set([
  "browserNavigate",
  "browserObserve",
  "browserClickByText",
  "browserFillFields",
  "browserSubmitForm",
  "browserFillAndSubmit",
  "browserPrepareFormSubmission",
  "browserSubmitPreparedForm",
  "browserScrape",
  "browserShowActions",
  "browserReset",
  "browserStatus",
]);

const ALLOWED_BACKENDS = new Set(["auto", "lightpanda", "chrome_cdp", "playwright_mcp"]);
const ALLOWED_RISKS = new Set(["low", "medium", "high"]);
const warnedMissingPromptFiles = new Set();

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
    process.env.OLLAMA_BASE_URL ||
    "https://chat-api.retakt.cc"
  ).trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

function resolvePromptPath(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (path.isAbsolute(raw)) return raw;

  const withoutLeadingDot = raw.replace(/^\\.?[\\/]/, "");
  const withoutServerPrefix = withoutLeadingDot.replace(/^server[\\/]/i, "");

  const candidates = [
    path.resolve(process.cwd(), raw),
    path.resolve(process.cwd(), withoutLeadingDot),
    path.resolve(process.cwd(), withoutServerPrefix),
    path.resolve(process.cwd(), "..", raw),
    path.resolve(process.cwd(), "..", withoutLeadingDot),
    path.resolve(process.cwd(), "..", withoutServerPrefix),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function stageKey(stage = "") {
  const raw = String(stage || "planner").trim();
  if (raw === "mainHandoff") return "MAIN";
  if (raw === "resultReviewer") return "RESULT_REVIEWER";
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase() || "PLANNER";
}

function firstEnv(names = []) {
  for (const name of names) {
    if (process.env[name] !== undefined) return process.env[name];
  }
  return undefined;
}

function stageAliasKeys(stage = "") {
  const raw = String(stage || "").trim();

  if (raw === "main") return ["ORCHESTRATOR"];
  if (raw === "planner") return ["STEP_AGENT"];
  if (raw === "reviewer") return ["CHECKER"];
  if (raw === "resultReviewer") return ["WATCHER", "REVIEWER"];
  if (raw === "finalVerifier") return ["FINAL_VERIFIER"];
  if (raw === "reporter") return ["REPORTER"];
  if (raw === "executor") return ["EXECUTOR"];

  return [];
}

function stageEnv(stage, suffix) {
  const key = stageKey(stage);
  const keys = [key, ...stageAliasKeys(stage)].filter(Boolean);
  const uniqueKeys = [...new Set(keys)];

  const names = [];
  for (const candidate of uniqueKeys) {
    names.push(
      `BROWSER_AGENT_${candidate}_${suffix}`,
      `BROWSER_${candidate}_${suffix}`,
    );
  }

  names.push(`BROWSER_AGENT_${suffix}`);

  return firstEnv(names);
}

function baseBrowserAgentModel() {
  return String(
    process.env.BROWSER_AGENT_MODEL ||
    process.env.RUNTIME_BROWSER_AGENT_MODEL ||
    process.env.BROWSER_PLANNER_MODEL ||
    process.env.BROWSER_AGENT_PLANNER_MODEL ||
    process.env.BROWSER_REVIEWER_MODEL ||
    process.env.BROWSER_AGENT_REVIEWER_MODEL ||
    process.env.OLLAMA_MODEL ||
    "llama3.1"
  ).trim();
}

function stageModel(stage, fallback = "") {
  return String(stageEnv(stage, "MODEL") || fallback || "").trim();
}

function normalizeBrowserAgentProvider(value = "", baseUrl = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (["openai", "openai-compatible", "openai_compatible"].includes(raw)) return "openai";
  if (raw === "ollama") return "ollama";

  const url = String(baseUrl || "").toLowerCase();
  if (url.includes("/v1") || url.includes("openai.com")) return "openai";
  return "ollama";
}

function normalizeBrowserAgentBaseUrl(value = "", provider = "ollama") {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (provider === "ollama") return raw.replace(/\/api$/i, "");
  if (provider === "openai") {
    const cleaned = raw.replace(/\/chat\/completions$/i, "");
    if (/^https:\/\/api\.openai\.com$/i.test(cleaned)) return cleaned + "/v1";
    return cleaned;
  }
  return raw;
}

function stageProvider(stage, fallbackBaseUrl = "") {
  const baseCandidate = String(stageEnv(stage, "BASE_URL") || fallbackBaseUrl || rawBaseUrl()).trim();
  return normalizeBrowserAgentProvider(stageEnv(stage, "PROVIDER"), baseCandidate);
}

function stageBaseUrl(stage, fallbackBaseUrl = "") {
  const raw = String(stageEnv(stage, "BASE_URL") || fallbackBaseUrl || rawBaseUrl()).trim();
  return normalizeBrowserAgentBaseUrl(raw, stageProvider(stage, raw));
}

function stageApiKey(stage, provider = "") {
  return String(
    stageEnv(stage, "API_KEY") ||
    (provider === "openai" ? process.env.OPENAI_API_KEY : "") ||
    ""
  ).trim();
}

function stageEndpointDisplay(stage, fallbackBaseUrl = "") {
  const provider = stageProvider(stage, fallbackBaseUrl);
  const baseUrl = stageBaseUrl(stage, fallbackBaseUrl);
  return {
    provider,
    redactedBaseUrl: redactBaseUrl(baseUrl),
    hasApiKey: Boolean(stageApiKey(stage, provider)),
  };
}

function modelForStage(config = {}, stage = "planner") {
  if (stage === "finalVerifier") {
    return config.models?.finalVerifier || config.models?.main || config.model;
  }
  return config.models?.[stage] || config.model;
}

function runtimeForStage(config = {}, stage = "planner") {
  const provider = stageProvider(stage, config.baseUrl);
  return {
    ...config,
    stage,
    provider,
    baseUrl: stageBaseUrl(stage, config.baseUrl),
    apiKey: stageApiKey(stage, provider),
    model: modelForStage(config, stage),
  };
}

function stagePromptConfig(stage) {
  const promptPath = resolvePromptPath(stageEnv(stage, "SYSTEM_PROMPT_PATH") || "");
  const inlinePrompt = String(stageEnv(stage, "SYSTEM_PROMPT") || "").trim();
  const promptPathExists = promptPath ? fs.existsSync(promptPath) : false;
  const strictPromptFiles = envFlag("BROWSER_AGENT_STRICT_PROMPT_FILES", false);
  return {
    promptPath,
    inlinePrompt,
    hasCustomPrompt: Boolean(promptPath || inlinePrompt),
    promptPathExists,
    strictPromptFiles,
    promptPathIgnored: Boolean(promptPath && !promptPathExists && !strictPromptFiles),
  };
}

function warnMissingPromptFile(stage, promptPath) {
  const key = `${stage}:${promptPath}`;
  if (warnedMissingPromptFiles.has(key)) return;
  warnedMissingPromptFiles.add(key);
  console.warn(`[browser-agent] ${stage} prompt file not found, using built-in prompt: ${promptPath}`);
}

function customSystemPrompt(stage) {
  const config = stagePromptConfig(stage);
  const pieces = [];
  if (config.promptPath) {
    if (!config.promptPathExists) {
      if (config.strictPromptFiles) {
        const error = new Error(`Browser agent ${stage} prompt file not found: ${config.promptPath}`);
        error.code = "BROWSER_AGENT_PROMPT_CONFIG_ERROR";
        throw error;
      }
      warnMissingPromptFile(stage, config.promptPath);
    } else {
      pieces.push(fs.readFileSync(config.promptPath, "utf8"));
    }
  }
  if (config.inlinePrompt) pieces.push(config.inlinePrompt);
  return pieces.map((piece) => String(piece || "").trim()).filter(Boolean).join("\n\n");
}

function stageDefaultTemperature(stage = "") {
  if (stage === "main") return 0.45;
  if (stage === "reviewer" || stage === "resultReviewer") return 0;
  if (stage === "executor") return 0.1;
  if (stage === "reporter") return 0.25;
  return 0.25;
}

function stageOptions(stage) {
  const key = stageKey(stage);
  const defaultTemperature = stageDefaultTemperature(stage);

  const options = {
    temperature: envNumber(
      `BROWSER_AGENT_${key}_TEMPERATURE`,
      envNumber(`BROWSER_${key}_TEMPERATURE`, envNumber("BROWSER_AGENT_TEMPERATURE", defaultTemperature, { min: 0, max: 2 }), { min: 0, max: 2 }),
      { min: 0, max: 2 },
    ),
    top_p: envNumber(
      `BROWSER_AGENT_${key}_TOP_P`,
      envNumber(`BROWSER_${key}_TOP_P`, envNumber("BROWSER_AGENT_TOP_P", 0.85, { min: 0, max: 1 }), { min: 0, max: 1 }),
      { min: 0, max: 1 },
    ),
    top_k: envNumber(
      `BROWSER_AGENT_${key}_TOP_K`,
      envNumber(`BROWSER_${key}_TOP_K`, envNumber("BROWSER_AGENT_TOP_K", 40, { min: 0, max: 1000 }), { min: 0, max: 1000 }),
      { min: 0, max: 1000 },
    ),
    repeat_penalty: envNumber(
      `BROWSER_AGENT_${key}_REPEAT_PENALTY`,
      envNumber(`BROWSER_${key}_REPEAT_PENALTY`, envNumber("BROWSER_AGENT_REPEAT_PENALTY", 1.05, { min: 0, max: 4 }), { min: 0, max: 4 }),
      { min: 0, max: 4 },
    ),
  };

  const numCtx = envNumber("BROWSER_AGENT_NUM_CTX", 8192, { min: 1024, max: 131072 });
  if (numCtx) options.num_ctx = numCtx;

  const numPredict = envNumber(
    `BROWSER_AGENT_${key}_NUM_PREDICT`,
    envNumber(`BROWSER_${key}_NUM_PREDICT`, envNumber("BROWSER_AGENT_NUM_PREDICT", 2048, { min: 128, max: 32768 }), { min: 128, max: 32768 }),
    { min: 128, max: 32768 },
  );
  if (numPredict) options.num_predict = numPredict;

  const seed = envNumber("BROWSER_AGENT_SEED", NaN);
  if (Number.isFinite(seed)) options.seed = seed;
  return options;
}

export function browserAgentRuntimeConfig({ display = false } = {}) {
  const baseUrl = rawBaseUrl();
  const model = baseBrowserAgentModel();
  const plannerModel = stageModel("planner", model);
  const reporterModel = stageModel("reporter", model);
  const timeoutMs = Math.max(1000, Number(process.env.BROWSER_AGENT_TIMEOUT_MS || 60000));
  const plannerPrompt = stagePromptConfig("planner");
  const reporterPrompt = stagePromptConfig("reporter");
  const strictPromptFiles = envFlag("BROWSER_AGENT_STRICT_PROMPT_FILES", false);
  const config = {
    configured: Boolean(baseUrl && model),
    llmRequired: true,
    baseUrl,
    redactedBaseUrl: redactBaseUrl(baseUrl),
    model,
    models: {
      default: model,
      main: stageModel("main", model),
      planner: plannerModel,
      reviewer: stageModel("reviewer", model),
      executor: stageModel("executor", model),
      resultReviewer: stageModel("resultReviewer", model),
      finalVerifier: stageModel("finalVerifier", stageModel("main", model)),
      reporter: reporterModel,
    },
    endpoints: {
      default: stageEndpointDisplay("default", baseUrl),
      main: stageEndpointDisplay("main", baseUrl),
      planner: stageEndpointDisplay("planner", baseUrl),
      reviewer: stageEndpointDisplay("reviewer", baseUrl),
      executor: stageEndpointDisplay("executor", baseUrl),
      resultReviewer: stageEndpointDisplay("resultReviewer", baseUrl),
      finalVerifier: stageEndpointDisplay("finalVerifier", baseUrl),
      reporter: stageEndpointDisplay("reporter", baseUrl),
    },
    timeoutMs,
    think: envFlag("BROWSER_AGENT_THINK", false),
    options: {
      main: stageOptions("main"),
      planner: stageOptions("planner"),
      reviewer: stageOptions("reviewer"),
      executor: stageOptions("executor"),
      resultReviewer: stageOptions("resultReviewer"),
      finalVerifier: stageOptions("finalVerifier"),
      reporter: stageOptions("reporter"),
    },
    prompts: {
      strictPromptFiles,
      planner: {
        hasCustomPrompt: plannerPrompt.hasCustomPrompt,
        path: plannerPrompt.promptPath,
        pathExists: plannerPrompt.promptPath ? plannerPrompt.promptPathExists : undefined,
        ignored: plannerPrompt.promptPathIgnored || undefined,
        inline: Boolean(plannerPrompt.inlinePrompt),
      },
      reporter: {
        hasCustomPrompt: reporterPrompt.hasCustomPrompt,
        path: reporterPrompt.promptPath,
        pathExists: reporterPrompt.promptPath ? reporterPrompt.promptPathExists : undefined,
        ignored: reporterPrompt.promptPathIgnored || undefined,
        inline: Boolean(reporterPrompt.inlinePrompt),
      },
    },
    strategy: "llm-required",
    missing: [
      ...(baseUrl ? [] : ["BROWSER_AGENT_BASE_URL"]),
      ...(model ? [] : ["BROWSER_AGENT_MODEL"]),
      ...(strictPromptFiles && plannerPrompt.promptPath && !plannerPrompt.promptPathExists ? ["BROWSER_AGENT_PLANNER_SYSTEM_PROMPT_PATH"] : []),
      ...(strictPromptFiles && reporterPrompt.promptPath && !reporterPrompt.promptPathExists ? ["BROWSER_AGENT_REPORTER_SYSTEM_PROMPT_PATH"] : []),
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

function responseThinking(data = {}) {
  return String(
    data.thinking ??
    data.message?.thinking ??
    data.choices?.[0]?.message?.thinking ??
    ""
  ).trim();
}

function thinkUnsupportedError(data = {}, model = "") {
  const text = String(data?.error || data?.message || data?.response || "").toLowerCase();
  return Boolean(
    text.includes("does not support thinking") ||
    text.includes("thinking is not supported") ||
    text.includes("think is not supported") ||
    (model && text.includes(String(model).toLowerCase()) && text.includes("thinking"))
  );
}

async function postOllamaChat({ config, model, messages, format, options, think }) {
  const body = {
    model,
    messages,
    stream: false,
    format,
    options,
  };

  // Always send explicit think=false for watcher/checker JSON calls.
  // Some thinking-capable local models otherwise spend the entire token budget
  // in message.thinking and return empty message.content.
  body.think = think === true;

  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(config.timeoutMs),
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = { response: await response.text().catch(() => "") };
  }

  return { response, data };
}

function openAiMessages(messages = []) {
  return messages.map((message) => {
    const images = Array.isArray(message.images) ? message.images : [];

    if (!images.length) {
      return {
        role: message.role,
        content: String(message.content || ""),
      };
    }

    return {
      role: message.role,
      content: [
        { type: "text", text: String(message.content || "") },
        ...images.map((image) => ({
          type: "image_url",
          image_url: {
            url: "data:image/png;base64," + String(image || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ""),
          },
        })),
      ],
    };
  });
}

async function postOpenAiChat({ config, model, messages, format, options }) {
  const body = {
    model,
    messages: openAiMessages(messages),
    stream: false,
  };

  if (format === "json") body.response_format = { type: "json_object" };
  if (Number.isFinite(Number(options?.temperature))) body.temperature = Number(options.temperature);
  if (Number.isFinite(Number(options?.top_p))) body.top_p = Number(options.top_p);
  if (Number.isFinite(Number(options?.num_predict))) body.max_tokens = Number(options.num_predict);

  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;

  const response = await fetch(config.baseUrl + "/chat/completions", {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(config.timeoutMs),
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = { response: await response.text().catch(() => "") };
  }

  return { response, data };
}

async function callOllamaChat({ stage, messages, format = "json", forceThink = null }) {
  const schemaFormatForStage = browserAgentJsonSchemaFor(stage);
  if (schemaFormatForStage && (format === "json" || !format)) {
    format = schemaFormatForStage;
  }
  const config = requireBrowserAgentRuntimeConfig();
  const stageConfig = runtimeForStage(config, stage);
  const startedAt = performance.now();
  const options = stageOptions(stage);
  const model = stageConfig.model;

  let retriedWithoutThink = false;
  let attempt = null;

  if (stageConfig.provider === "openai") {
    attempt = await postOpenAiChat({
      config: stageConfig,
      model,
      messages,
      format,
      options,
    });
  } else {
    attempt = await postOllamaChat({
      config: stageConfig,
      model,
      messages,
      format,
      options,
      think: forceThink === null ? config.think : Boolean(forceThink),
    });

    if (!attempt.response.ok && config.think && thinkUnsupportedError(attempt.data, model)) {
      retriedWithoutThink = true;
      attempt = await postOllamaChat({
        config: stageConfig,
        model,
        messages,
        format,
        options,
        think: false,
      });
    }
  }

  const { response, data } = attempt;

  if (!response.ok) {
    const error = new Error(data?.error || data?.message || `Browser agent LLM ${stage} call failed: HTTP ${response.status}`);
    error.code = "BROWSER_AGENT_LLM_HTTP_ERROR";
    error.status = response.status;
    error.usage = tokenUsageFromResponse(data || {}, { ...stageConfig, model }, stage, Math.round(performance.now() - startedAt));
    error.retriedWithoutThink = retriedWithoutThink;
    throw error;
  }

  const usage = tokenUsageFromResponse(data || {}, { ...stageConfig, model }, stage, Math.round(performance.now() - startedAt));
  usage.provider = stageConfig.provider;
  usage.redactedBaseUrl = redactBaseUrl(stageConfig.baseUrl);
  usage.thinkRequested = Boolean(stageConfig.provider === "ollama" && config.think);
  usage.retriedWithoutThink = retriedWithoutThink;
  usage.thinkUsed = Boolean(
    stageConfig.provider === "ollama" &&
    (forceThink === null ? config.think : Boolean(forceThink)) &&
    !retriedWithoutThink
  );

  return {
    content: responseContent(data),
    thinking: responseThinking(data),
    usage,
    raw: data,
  };
}

function stripJsonFence(content = "") {
  return String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function balancedJsonCandidates(content = "") {
  const raw = stripJsonFence(content);
  const candidates = [raw];

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));

  return [...new Set(candidates.map((item) => item.trim()).filter(Boolean))];
}

function lightJsonRepair(value = "") {
  return String(value || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function extractJsonObject(content = "") {
  const candidates = balancedJsonCandidates(content);
  let lastError = null;

  for (const candidate of candidates) {
    for (const attempt of [candidate, lightJsonRepair(candidate)]) {
      try {
        return JSON.parse(attempt);
      } catch (err) {
        lastError = err;
      }
    }
  }

  throw lastError || new Error("No JSON object found.");
}


function normalizeConfidence(value) {
  if (typeof value === "string") {
    const cleaned = value.replace("%", "").trim();
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n > 1 ? Math.min(n / 100, 1) : Math.max(0, n);
  }

  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return n > 1 ? Math.min(n / 100, 1) : Math.max(0, Math.min(n, 1));
}

function normalizePlannerPlan(plan = {}) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return plan;
  return {
    ...plan,
    confidence: normalizeConfidence(plan.confidence),
    risk: String(plan.risk || "medium").toLowerCase(),
    backend: String(plan.backend || "auto").toLowerCase(),
  };
}

function normalizeWatcherJsonShape(data = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;

  const hasWatcherShape =
    typeof data.status === "string" &&
    typeof data.success === "boolean" &&
    typeof data.summary === "string";

  if (hasWatcherShape) {
    return {
      status: data.status || (data.success ? "passed" : "needs_repair"),
      success: Boolean(data.success),
      summary: String(data.summary || ""),
      evidence: String(data.evidence || data.reason || data.summary || ""),
      repairInstruction: String(data.repairInstruction || data.repair_instruction || ""),
      messageToUser: String(data.messageToUser || data.message_to_user || ""),
      confidence: normalizeConfidence(data.confidence ?? 0.8),
      ...data,
    };
  }

  const passed =
    data.passed === true ||
    data.ok === true ||
    data.result === "passed" ||
    data.status === "passed";

  const failed =
    data.passed === false ||
    data.ok === false ||
    data.result === "failed" ||
    data.status === "failed";

  const success = Boolean(passed && !failed);
  const summary = String(
    data.summary ||
    data.reason ||
    data.evidence ||
    data.message ||
    (success ? "The browser action passed." : "The browser action needs repair.")
  );

  return {
    status: success ? "passed" : (failed ? "failed" : "needs_repair"),
    success,
    summary,
    evidence: String(data.evidence || data.reason || summary || ""),
    repairInstruction: String(data.repairInstruction || data.repair_instruction || data.nextSafeAction || ""),
    messageToUser: String(data.messageToUser || data.message_to_user || ""),
    confidence: normalizeConfidence(data.confidence ?? (success ? 0.9 : 0.65)),
    rawNormalizedFrom: data,
  };
}

function shouldNormalizeWatcherJson(stage = "", schemaName = "") {
  const key = `${stage} ${schemaName}`.toLowerCase();
  return /watcher|resultreviewer|result_reviewer|resultchecker|result_checker|gemma_result_checker/.test(key);
}

function parseStrictJson(content = "", stage = "planner") {
  try {
    return extractJsonObject(content);
  } catch (err) {
    const error = new Error(`Browser agent LLM ${stage} returned invalid JSON.`);
    error.code = "BROWSER_AGENT_LLM_INVALID_JSON";
    error.contentPreview = safeText(content, 1200);
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
- You are expected to be the strongest/smartest model in browser mode. The chat model may be weaker; you must reason from runtime state, errors, and available backends instead of echoing the chat answer.
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
- browserReset: args {}
- browserStatus: args {}

Backend choices:
- auto: let the runtime choose the safest backend.
- lightpanda: fast read, scrape, observe, simple extraction.
- playwright_mcp: real browser actions such as click, type, forms, login, submit, screenshots, network, console, and tabs.
- chrome_cdp: legacy/manual compatibility backend only.

Allowed backends: auto, lightpanda, playwright_mcp, chrome_cdp. Use playwright_mcp for real browser fidelity when the user asks to click/type/fill/submit/login or explicitly says Playwright.
For playwright_mcp, a command may include "url" as well as fields/text. That means: navigate there first, then execute the requested browser action after a fresh snapshot.

Return schema:
{
  "intent": "navigate|observe|click_or_open|fill_form|submit_form|fill_and_submit|scrape|show_actions|reset|status|learn",
  "risk": "low|medium|high",
  "backend": "auto|lightpanda|playwright_mcp|chrome_cdp",
  "command": { "tool": "browserNavigate|browserObserve|browserClickByText|browserFillFields|browserSubmitForm|browserFillAndSubmit|browserScrape|browserShowActions|browserReset|browserStatus", "args": {} },
  "requiresConfirmation": false,
  "reason": "short reason",
  "confidence": 0.0
}

Safety:
- Mark login, submit, password, OTP/code, delete, payment, attendance, and profile update as medium or high risk.
- Do not invent credentials.
- If a password/OTP/code value is included, set secret=true for that field.
- If the user asks to exit, close, stop, reset, or start a new browser session, return browserReset.
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

function normalizedImages(images = []) {
  return (Array.isArray(images) ? images : [])
    .map((image) => String(image || "").trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ""))
    .filter(Boolean)
    .slice(0, 4);
}

function userMessageWithImages(context = {}, images = []) {
  const safeImages = normalizedImages(images);
  return {
    role: "user",
    content: compactContext(context),
    ...(safeImages.length ? { images: safeImages } : {}),
  };
}

export async function callBrowserAgentPlanner(context = {}, options = {}) {
  const call = await callOllamaChat({
    stage: "planner",
    messages: [
      { role: "system", content: plannerSystemPrompt() },
      userMessageWithImages(context, options.images),
    ],
  });
  let plan;
  try {
    plan = normalizePlannerPlan(parseStrictJson(call.content, "planner"));
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

function parseRoleJsonOrThrow(content = "", role = "planner", schemaName = "") {
  let data = parseStrictJson(content, schemaName || role);
  if (shouldNormalizeWatcherJson(role, schemaName)) {
    data = normalizeWatcherJsonShape(data);
  }
  return data;
}

export async function callBrowserAgentRoleJson(stage = "planner", {
  system = "",
  context = {},
  schemaName = "",
  images = [],
} = {}) {
  const role = String(stage || "planner").trim() || "planner";
  const roleSchemaFormat = browserAgentJsonSchemaFor(schemaName || role) || "json";
  const messages = [
    { role: "system", content: String(system || "Return ONLY strict JSON. Do not use markdown.") },
    userMessageWithImages(context, images),
  ];

  const call = await callOllamaChat({
    stage: role,
    format: roleSchemaFormat,
    messages,
  });

  try {
    const data = parseRoleJsonOrThrow(call.content, role, schemaName);
    return {
      data,
      usage: call.usage,
      rawContent: call.content,
    };
  } catch (err) {
    const shouldRetryWithoutThink =
      call.usage?.provider === "ollama" &&
      call.usage?.thinkUsed === true &&
      (
        !String(call.content || "").trim() ||
        err.code === "BROWSER_AGENT_LLM_INVALID_JSON"
      );

    if (!shouldRetryWithoutThink) {
      err.usage = call.usage;
      throw err;
    }

    const retry = await callOllamaChat({
      stage: role,
      format: roleSchemaFormat,
      messages: [
        ...messages,
        {
          role: "user",
          content: "Your previous response was not parseable JSON. Retry now with ONLY one strict JSON object matching the schema. No markdown. No explanation.",
        },
      ],
      forceThink: false,
    });

    try {
      const data = parseRoleJsonOrThrow(retry.content, role, schemaName);
      retry.usage.retriedWithoutThinkForJson = true;
      retry.usage.firstInvalidJsonPreview = safeText(call.content || call.thinking || "", 1200);
      return {
        data,
        usage: retry.usage,
        rawContent: retry.content,
        firstRawContent: call.content,
      };
    } catch (retryErr) {
      retryErr.usage = retry.usage;
      retryErr.firstInvalidJsonPreview = safeText(call.content || call.thinking || "", 1200);
      throw retryErr;
    }
  }
}

export async function callBrowserAgentReviewer(context = {}, system = "", options = {}) {
  return callBrowserAgentRoleJson("reviewer", {
    system,
    context,
    schemaName: "reviewer",
    images: options.images || [],
  });
}

export async function callBrowserAgentExecutor(context = {}, system = "", options = {}) {
  return callBrowserAgentRoleJson("executor", {
    system,
    context,
    schemaName: "executor",
    images: options.images || [],
  });
}

export async function callBrowserAgentResultReviewer(context = {}, system = "", options = {}) {
  return callBrowserAgentRoleJson("resultReviewer", {
    system,
    context,
    schemaName: "resultReviewer",
    images: options.images || [],
  });
}

export async function callBrowserAgentMainHandoff(context = {}, system = "", options = {}) {
  return callBrowserAgentRoleJson("main", {
    system,
    context,
    schemaName: "mainHandoff",
    images: options.images || [],
  });
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
  plan.confidence = normalizeConfidence(plan?.confidence);
  const confidence = plan.confidence;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) errors.push("confidence must be a number from 0 to 1");
  return {
    ok: errors.length === 0,
    errors,
    command,
  };
}

export { ALLOWED_TOOLS };
