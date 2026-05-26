import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");
const ARTIFACTS_ROOT = path.join(REPO_ROOT, "artifacts", "browser-agent-smoke");
const DEFAULT_SMOKE_CASES = "lightpanda-fill,playwright-scroll-screenshots";

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

loadEnvFile(path.join(SERVER_ROOT, "config", "browser-agent", "benchmark.env"));
loadEnvFile(path.join(SERVER_ROOT, ".env"));

function firstEnv(names = [], fallback = "") {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return fallback;
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function pickBenchmarkModel(availableModels = []) {
  const benchmarkModel = String(process.env.BROWSER_AGENT_BENCHMARK_MODEL || "").trim();
  if (benchmarkModel) return benchmarkModel;

  const preferred = unique([
    "llama3.2:latest",
    "rnj-1:latest",
    ...availableModels,
    process.env.BROWSER_AGENT_MAIN_MODEL,
    process.env.BROWSER_AGENT_PLANNER_MODEL,
    process.env.BROWSER_AGENT_MODEL,
    process.env.OLLAMA_MODEL,
  ]);

  for (const model of preferred) {
    if (availableModels.includes(model)) return model;
  }

  return availableModels[0] || preferred[0] || "llama3.2:latest";
}

function applyBenchmarkModel(model = "") {
  const chosen = String(model || "").trim();
  if (!chosen) return;

  const keys = [
    "BROWSER_AGENT_BENCHMARK_MODEL",
    "BROWSER_AGENT_MODEL",
    "OLLAMA_MODEL",
    "BROWSER_AGENT_MAIN_MODEL",
    "BROWSER_AGENT_ORCHESTRATOR_MODEL",
    "BROWSER_AGENT_PLANNER_MODEL",
    "BROWSER_AGENT_STEP_AGENT_MODEL",
    "BROWSER_AGENT_CHECKER_MODEL",
    "BROWSER_AGENT_REVIEWER_MODEL",
    "BROWSER_AGENT_WATCHER_MODEL",
    "BROWSER_AGENT_RESULT_REVIEWER_MODEL",
    "BROWSER_AGENT_FINAL_VERIFIER_MODEL",
    "BROWSER_AGENT_REPORTER_MODEL",
  ];

  for (const key of keys) {
    process.env[key] = chosen;
  }
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

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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

function safeFileName(value = "") {
  return String(value || "artifact")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "artifact";
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativeArtifact(file, root) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function imageExtension(mimeType = "") {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  return ".png";
}

function parseDataUrl(value = "") {
  const match = String(value || "").match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  return match ? { mimeType: match[1], base64: match[2] } : null;
}

function collectScreenshots(value, output = [], seenObjects = new Set(), seenImages = new Set(), sourcePath = "result") {
  if (!value || typeof value !== "object") return output;
  if (seenObjects.has(value)) return output;
  seenObjects.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectScreenshots(item, output, seenObjects, seenImages, `${sourcePath}[${index}]`));
    return output;
  }

  const imagePath = String(value.imagePath || "").trim();
  if (imagePath) {
    const key = `path:${imagePath}`;
    if (!seenImages.has(key)) {
      seenImages.add(key);
      output.push({ kind: "path", imagePath, sourcePath });
    }
  }

  const imageBase64 = String(value.imageBase64 || value.base64 || "").trim();
  if (imageBase64) {
    const mimeType = String(value.mimeType || value.contentType || "image/png").trim() || "image/png";
    const base64 = imageBase64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
    const key = `base64:${base64.length}:${base64.slice(0, 96)}`;
    if (!seenImages.has(key)) {
      seenImages.add(key);
      output.push({ kind: "base64", base64, mimeType, sourcePath });
    }
  }

  const dataUrl = String(value.dataUrl || value.url || "").trim();
  const parsed = parseDataUrl(dataUrl);
  if (parsed) {
    const key = `base64:${parsed.base64.length}:${parsed.base64.slice(0, 96)}`;
    if (!seenImages.has(key)) {
      seenImages.add(key);
      output.push({ kind: "base64", base64: parsed.base64, mimeType: parsed.mimeType, sourcePath });
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (!child || typeof child !== "object") continue;
    collectScreenshots(child, output, seenObjects, seenImages, `${sourcePath}.${key}`);
  }

  return output;
}

function resolveImagePath(imagePath = "") {
  const raw = String(imagePath || "").trim();
  if (!raw) return "";
  const candidates = path.isAbsolute(raw)
    ? [raw]
    : [
        path.resolve(process.cwd(), raw),
        path.resolve(REPO_ROOT, raw),
        path.resolve(SERVER_ROOT, raw),
      ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function writeScreenshotFiles({ caseDir, runDir, label, result }) {
  const entries = collectScreenshots({
    stepResults: result?.stepResults || [],
    uiReport: result?.uiReport || null,
  });

  if (!entries.length) return [];

  const screenshotDir = path.join(caseDir, "screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });

  const written = [];
  entries.forEach((entry, index) => {
    const prefix = `${safeFileName(label)}-${String(index + 1).padStart(2, "0")}`;
    try {
      if (entry.kind === "path") {
        const source = resolveImagePath(entry.imagePath);
        if (!source) {
          written.push({
            ok: false,
            sourcePath: entry.sourcePath,
            originalPath: entry.imagePath,
            error: "image path was not found",
          });
          return;
        }
        const ext = path.extname(source) || ".png";
        const output = path.join(screenshotDir, `${prefix}${ext}`);
        fs.copyFileSync(source, output);
        written.push({
          ok: true,
          file: relativeArtifact(output, runDir),
          sourcePath: entry.sourcePath,
          originalPath: entry.imagePath,
        });
        return;
      }

      const ext = imageExtension(entry.mimeType);
      const output = path.join(screenshotDir, `${prefix}${ext}`);
      fs.writeFileSync(output, Buffer.from(entry.base64, "base64"));
      written.push({
        ok: true,
        file: relativeArtifact(output, runDir),
        sourcePath: entry.sourcePath,
        mimeType: entry.mimeType,
      });
    } catch (error) {
      written.push({
        ok: false,
        sourcePath: entry.sourcePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return written;
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
  const lowLevelReached = (Array.isArray(result.stepResults) ? result.stepResults : []).some((step) => {
    const scroll =
      step?.result?.actionResult?.scroll ||
      step?.result?.scroll ||
      step?.afterSnapshot?.scroll ||
      step?.result?.observation?.scroll ||
      null;
    return scroll?.reachedBottom === true || scroll?.atBottom === true || scroll?.after?.atBottom === true;
  });

  if (lowLevelReached) return true;

  const evidenceParts = [
    result.summary,
    ...(Array.isArray(result.stepResults) ? result.stepResults : []).flatMap((step) => [
      step?.summary,
      step?.result?.summary,
      step?.result?.verification?.reason,
      step?.watch?.summary,
      step?.watch?.evidence,
      step?.report?.summary,
      step?.report?.evidence,
    ]),
  ].map((entry) => String(entry || "").trim()).filter(Boolean);

  const evidence = evidenceParts.join("\n");
  if (/\b(?:did\s+not|does\s+not|not|was\s+not|wasn't)\s+(?:reach|reached|at)\s+(?:the\s+)?bottom\b/i.test(evidence)) {
    return false;
  }

  return /\b(?:reached\s+(?:the\s+)?bottom|bottom(?:\s+of\s+(?:the\s+)?page)?\s+(?:has\s+been\s+|was\s+|is\s+)?reached|at\s+(?:the\s+)?bottom|no\s+more\s+(?:content\s+)?below)\b/i.test(evidence);
}

async function runCase({ label, route, instruction, validate, runDir }) {
  const sessionId = `browser-smoke-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  const caseDir = path.join(runDir, safeFileName(label));
  await browserAgentReset({ sessionId });
  const startedAt = now();
  let result = {};
  let status = {};
  let runError = "";
  try {
    result = await browserAgentRun({
      sessionId,
      route,
      instruction,
      currentUrl: "",
      currentTitle: "",
      includeImages: true,
    });
    status = await browserAgentStatus({ sessionId });
  } catch (error) {
    runError = error instanceof Error ? error.stack || error.message : String(error);
    result = {
      ok: false,
      status: "error",
      route,
      summary: "Browser smoke case threw before returning a normal result.",
      error: runError,
      stepResults: [],
    };
    status = await browserAgentStatus({ sessionId }).catch((statusError) => ({
      ok: false,
      error: statusError instanceof Error ? statusError.message : String(statusError),
    }));
  }
  const durationMs = round(now() - startedAt);
  const tools = stepTools(result);
  const validation = validate ? validate(result, status) : { ok: result.ok === true, reason: "" };
  fs.mkdirSync(caseDir, { recursive: true });
  writeJsonFile(path.join(caseDir, "result.json"), result);
  writeJsonFile(path.join(caseDir, "status.json"), status);
  const screenshots = writeScreenshotFiles({ caseDir, runDir, label, result });

  const summary = {
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
    artifacts: {
      directory: relativeArtifact(caseDir, runDir),
      result: relativeArtifact(path.join(caseDir, "result.json"), runDir),
      status: relativeArtifact(path.join(caseDir, "status.json"), runDir),
      screenshots,
    },
  };

  if (runError) summary.error = runError;
  writeJsonFile(path.join(caseDir, "summary.json"), summary);
  await browserAgentReset({ sessionId }).catch(() => {});
  return summary;
}

function includesAll(result, values = []) {
  const text = safeJson(result.stepResults || []);
  return values.every((value) => text.includes(String(value)));
}

async function main() {
  const runDir = path.join(ARTIFACTS_ROOT, nowStamp());
  fs.mkdirSync(runDir, { recursive: true });

  const availableModels = await ollamaTags();
  const selectedModel = pickBenchmarkModel(availableModels);
  applyBenchmarkModel(selectedModel);
  const modelsToProbe = [selectedModel];
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
    String(process.env.SMOKE_CASES || DEFAULT_SMOKE_CASES)
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
  const shouldRun = (label) => selectedCases.has("all") || selectedCases.has(label.toLowerCase());

  if (shouldRun("playwright-read")) cases.push(await runCase({
    label: "playwright-read",
    route: "playwright",
    instruction: readInstruction,
    runDir,
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
    runDir,
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
    runDir,
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
    runDir,
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
    artifactDir: runDir,
    selectedCases: [...selectedCases],
    defaultCases: DEFAULT_SMOKE_CASES.split(","),
    availableModels,
    selectedModel,
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

  writeJsonFile(path.join(runDir, "report.json"), report);
  fs.writeFileSync(path.join(runDir, "report.md"), [
    "# Browser Agent Smoke Benchmark",
    "",
    `- Overall: ${report.ok ? "pass" : "fail"}`,
    `- Model: ${selectedModel || "(none)"}`,
    `- Cases: ${[...selectedCases].join(", ") || "(none)"}`,
    `- Artifact directory: ${runDir}`,
    "",
    "| Case | Route | Result | Duration ms | Steps | Screenshots | Summary |",
    "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ...cases.map((entry) => [
      entry.label,
      entry.route,
      entry.ok ? "pass" : "fail",
      entry.durationMs,
      entry.stepCount,
      entry.screenshotCount,
      String(entry.summary || entry.validation?.reason || "").replace(/\|/g, "\\|"),
    ].join(" | ")).map((row) => `| ${row} |`),
    "",
  ].join("\n"), "utf8");

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

try {
  await main();
} finally {
  await stopExternalMcpClient("playwright").catch(() => {});
}
