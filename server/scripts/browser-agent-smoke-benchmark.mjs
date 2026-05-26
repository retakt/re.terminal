import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, "..");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(SERVER_ROOT, ".env"));

function firstEnv(names = [], fallback = "") {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return fallback;
}

const BASE_URL = firstEnv([
  "BROWSER_AGENT_MAIN_BASE_URL",
  "BROWSER_AGENT_ORCHESTRATOR_BASE_URL",
  "BROWSER_AGENT_BASE_URL",
  "OLLAMA_BASE_URL",
], "http://takt-pc.reverse-cliff.ts.net:11434").replace(/\/+$/, "");

for (const key of ["BROWSER_AGENT_BASE_URL", "BROWSER_AGENT_API_BASE_URL", "RUNTIME_BROWSER_AGENT_BASE_URL", "OLLAMA_BASE_URL"]) {
  process.env[key] = BASE_URL;
}

process.env.BROWSER_AGENT_TIMEOUT_MS = process.env.BROWSER_AGENT_TIMEOUT_MS || "20000";
process.env.EXTERNAL_MCP_CALL_TIMEOUT_MS = process.env.EXTERNAL_MCP_CALL_TIMEOUT_MS || "10000";
process.env.BROWSER_AGENT_NUM_PREDICT = process.env.BROWSER_AGENT_NUM_PREDICT || "1024";
process.env.BROWSER_AGENT_DEBUG_TRACE = process.env.BROWSER_AGENT_DEBUG_TRACE || "0";
process.env.LIGHTPANDA_CDP_URL = process.env.LIGHTPANDA_CDP_URL || "ws://127.0.0.1:9222";

const {
  browserAgentReset,
  browserAgentRun,
  browserAgentStatus,
} = await import("../lib/browser-agent.js");
const { stopExternalMcpClient } = await import("../lib/external-mcp-client.js");

function now() {
  return performance.now();
}

function round(value = 0) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value || "");
  }
}

async function ollamaTags() {
  try {
    const response = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.models) ? data.models.map((model) => model.name).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function probeModel(model) {
  const startedAt = now();
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: "Return only strict JSON." },
          { role: "user", content: "Return {\"ok\":true,\"summary\":\"ready\"}." },
        ],
        options: {
          temperature: 0,
          num_predict: 80,
        },
        think: false,
      }),
    });
    const data = await response.json().catch(() => ({}));
    const promptTokens = Number(data.prompt_eval_count || data.usage?.prompt_tokens || 0);
    const completionTokens = Number(data.eval_count || data.usage?.completion_tokens || 0);
    return {
      model,
      ok: response.ok,
      durationMs: round(now() - startedAt),
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      error: response.ok ? "" : String(data.error || data.message || response.status),
    };
  } catch (error) {
    return {
      model,
      ok: false,
      durationMs: round(now() - startedAt),
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function tokenSummary(result = {}) {
  const usage = result.tokenUsage || {};
  return {
    totalTokens: Number(usage.totalTokens || 0),
    promptTokens: Number(usage.promptTokens || 0),
    completionTokens: Number(usage.completionTokens || 0),
    models: Array.isArray(usage.models) ? usage.models : [],
    roles: usage.roles || {},
    routes: usage.routes || {},
  };
}

function stepTools(result = {}) {
  return (Array.isArray(result.stepResults) ? result.stepResults : [])
    .map((step) => step?.command?.tool || "")
    .filter(Boolean);
}

function scrollReachedBottom(result = {}) {
  return (Array.isArray(result.stepResults) ? result.stepResults : []).some((step) => {
    const scroll = step?.result?.actionResult?.scroll || step?.afterSnapshot?.scroll || step?.result?.observation?.scroll || null;
    return scroll?.reachedBottom === true || scroll?.atBottom === true || scroll?.after?.atBottom === true;
  });
}

async function runCase({ label, route, instruction, validate }) {
  const sessionId = `browser-smoke-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  await browserAgentReset({ sessionId });
  const startedAt = now();
  const result = await browserAgentRun({
    sessionId,
    route,
    instruction,
    currentUrl: "",
    currentTitle: "",
  });
  const status = await browserAgentStatus({ sessionId });
  const durationMs = round(now() - startedAt);
  const tools = stepTools(result);
  const validation = validate ? validate(result, status) : { ok: result.ok === true, reason: "" };
  await browserAgentReset({ sessionId }).catch(() => {});
  return {
    label,
    route,
    ok: Boolean(result.ok && validation.ok),
    resultOk: Boolean(result.ok),
    validation,
    durationMs,
    runtimeMs: result.runtimeTiming?.totalMs || durationMs,
    currentUrl: result.currentUrl || "",
    currentTitle: result.currentTitle || "",
    statusRoute: status.state?.route || "",
    statusEngine: status.state?.routeEngine || "",
    tools,
    stepCount: Array.isArray(result.stepResults) ? result.stepResults.length : 0,
    screenshotCount: tools.filter((tool) => tool === "browserScreenshot").length,
    scrollCount: tools.filter((tool) => tool === "browserScroll").length,
    reachedBottom: scrollReachedBottom(result),
    summary: result.summary || "",
    tokenUsage: tokenSummary(result),
  };
}

function includesAll(result, values = []) {
  const text = safeJson(result.stepResults || []);
  return values.every((value) => text.includes(String(value)));
}

async function main() {
  const availableModels = await ollamaTags();
  const modelCandidates = [
    "llama3.2:latest",
    "qwen3.5:2b",
    "qwen2.5-coder:7b",
    process.env.BROWSER_AGENT_MAIN_MODEL,
    process.env.BROWSER_AGENT_PLANNER_MODEL,
    process.env.BROWSER_AGENT_CHECKER_MODEL,
    process.env.BROWSER_AGENT_REPORTER_MODEL,
  ].filter(Boolean);
  const modelsToProbe = [...new Set(modelCandidates)]
    .filter((model) => !availableModels.length || availableModels.includes(model));
  const modelProbes = [];
  for (const model of modelsToProbe) {
    modelProbes.push(await probeModel(model));
  }

  const stamp = Date.now().toString(36);
  const readInstruction = "Open https://webdriveruniversity.com/Contact-Us/contactus.html. Read and extract the visible contact form labels and report them. Do not fill, submit, or screenshot.";
  const first = `Smoke${stamp.slice(-4)}`;
  const last = `Route${stamp.slice(-4)}`;
  const email = `${first}.${last}@example.com`.toLowerCase();
  const comment = `headless route smoke ${stamp}`;
  const fillInstruction = `Open https://webdriveruniversity.com/Contact-Us/contactus.html. Fill the "First Name" field with "${first}", the "Last Name" field with "${last}", the "Email Address" field with "${email}", and the "Comments" field with "${comment}". Do not submit and do not take a screenshot. Report the filled values from the page.`;
  const scrollInstruction = "Open https://www.selenium.dev/documentation/webdriver/. Observe the page scroll information first. Then use separate one-action steps to take a viewport screenshot at the top, scroll down one viewport, take another viewport screenshot, scroll again, and continue screenshot plus scroll until the bottom is reached or five screenshots have been taken. Do not use a full-page screenshot. The run must include at least two screenshot steps and at least one scroll step. Report whether the bottom was reached.";

  const cases = [];
  const selectedCases = new Set(
    String(process.env.SMOKE_CASES || "all")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
  const shouldRun = (label) => selectedCases.has("all") || selectedCases.has(label.toLowerCase());

  if (shouldRun("playwright-read")) cases.push(await runCase({
    label: "playwright-read",
    route: "playwright",
    instruction: readInstruction,
    validate: (result, status) => {
      const text = safeJson(result.stepResults || []);
      return {
        ok: result.route === "playwright" &&
          status.state?.routeEngine === "playwright_mcp" &&
          text.includes("First Name") &&
          text.includes("Last Name") &&
          text.includes("Email Address") &&
          text.includes("Comments") &&
          !safeJson(result).includes("lightpanda_cdp"),
        reason: "Playwright read should stay route-isolated and extract contact labels.",
      };
    },
  }));

  if (shouldRun("lightpanda-read")) cases.push(await runCase({
    label: "lightpanda-read",
    route: "lightpanda",
    instruction: readInstruction,
    validate: (result, status) => {
      const text = safeJson(result.stepResults || []);
      return {
        ok: result.route === "lightpanda" &&
          status.state?.routeEngine === "lightpanda_cdp" &&
          text.includes("First Name") &&
          text.includes("Last Name") &&
          text.includes("Email Address") &&
          text.includes("Comments") &&
          !safeJson(result).includes("playwright_mcp"),
        reason: "Lightpanda read should stay route-isolated and extract contact labels.",
      };
    },
  }));

  if (shouldRun("lightpanda-fill")) cases.push(await runCase({
    label: "lightpanda-fill",
    route: "lightpanda",
    instruction: fillInstruction,
    validate: (result, status) => ({
      ok: result.route === "lightpanda" &&
        status.state?.routeEngine === "lightpanda_cdp" &&
        stepTools(result).includes("browserFillFields") &&
        includesAll(result, [first, last, email, comment]) &&
        !safeJson(result).includes("playwright_mcp"),
      reason: "Lightpanda fill should use Lightpanda registry and preserve fresh values.",
    }),
  }));

  if (shouldRun("playwright-scroll-screenshots")) cases.push(await runCase({
    label: "playwright-scroll-screenshots",
    route: "playwright",
    instruction: scrollInstruction,
    validate: (result, status) => {
      const tools = stepTools(result);
      return {
        ok: result.route === "playwright" &&
          status.state?.routeEngine === "playwright_mcp" &&
          tools.includes("browserObserve") &&
          tools.includes("browserScroll") &&
          tools.filter((tool) => tool === "browserScreenshot").length >= 2 &&
          scrollReachedBottom(result),
        reason: "Hard scroll screenshot test should observe, screenshot, scroll, and reach bottom.",
      };
    },
  }));

  const readCases = cases.filter((entry) => entry.label.endsWith("-read") && entry.ok);
  const fastestRead = readCases.sort((a, b) => a.durationMs - b.durationMs)[0] || null;

  const report = {
    ok: cases.every((entry) => entry.ok),
    baseUrl: BASE_URL.replace(/([?&](?:token|key|api_key)=)[^&]+/ig, "$1***"),
    availableModels,
    modelProbes,
    cases,
    fastestCorrectReadRoute: fastestRead
      ? {
          route: fastestRead.route,
          label: fastestRead.label,
          durationMs: fastestRead.durationMs,
          totalTokens: fastestRead.tokenUsage.totalTokens,
        }
      : null,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

try {
  await main();
} finally {
  await stopExternalMcpClient("playwright").catch(() => {});
}
