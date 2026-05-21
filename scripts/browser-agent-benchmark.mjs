import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { browserAgentRun } from "../server/lib/browser-agent.js";
import {
  inferFieldsFromShortMessage,
  watchBrowserInstruction,
} from "../server/lib/browser-runtime-watcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const stateDir = path.join(repoRoot, "server", "config", "browser-agent");
const artifactsDir = path.join(repoRoot, "artifacts");

const DUMMY_EMAIL = "browser.benchmark@example.com";

function loadServerEnv() {
  const envPath = path.join(repoRoot, "server", ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function round(value = 0) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function safeStatus(result = {}) {
  return `${result.ok ? "ok" : "fail"}:${result.status || "unknown"}`;
}

function statePath(sessionId = "") {
  return path.join(stateDir, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

function cleanupBenchmarkState() {
  if (!fs.existsSync(stateDir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(stateDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^bench-browser-agent-/.test(entry.name)) continue;
    const target = path.resolve(stateDir, entry.name);
    if (!target.startsWith(path.resolve(stateDir))) {
      throw new Error(`Refusing to remove outside state dir: ${target}`);
    }
    fs.rmSync(target, { force: true });
    removed += 1;
  }
  return removed;
}

function observedCounts(result = {}) {
  const found = result.whatFound || {};
  return {
    forms: Array.isArray(found.forms) ? found.forms.length : 0,
    inputs: Array.isArray(found.inputs) ? found.inputs.length : 0,
    buttons: Array.isArray(found.buttons) ? found.buttons.length : 0,
    links: Array.isArray(found.links) ? found.links.length : 0,
  };
}

function summarizeResult(result = {}, measuredMs = 0) {
  const timing = result.runtimeTiming || {};
  const tokens = result.tokenUsage || {};
  const counts = observedCounts(result);
  return {
    status: safeStatus(result),
    currentUrl: result.currentUrl || "",
    currentTitle: result.currentTitle || "",
    engine: result.engine || "",
    intent: result.watcher?.intent || "",
    tool: result.watcher?.command?.tool || "",
    measuredMs: round(measuredMs),
    totalMs: round(timing.totalMs || measuredMs),
    watcherMs: round(timing.watcherMs),
    browserToolMs: round(timing.browserToolMs),
    verificationMs: round(timing.verificationMs),
    stateMs: round(timing.stateMs),
    mainModelMs: round(timing.mainModelMs),
    totalTokens: Number(tokens.totalTokens || 0),
    watcherTokens: Number(tokens.watcher?.totalTokens || 0),
    mainModelTokens: Number(tokens.mainModel?.totalTokens || 0),
    sequence: result.sequence ? `${result.sequence.completed}/${result.sequence.total}` : "",
    controls: counts,
    summary: result.summary || result.blockedReason || "",
  };
}

async function runBrowserScenario(scenario, index) {
  const sessionId = `bench-browser-agent-${String(index + 1).padStart(2, "0")}-${Date.now()}`;
  const steps = Array.isArray(scenario.steps) ? scenario.steps : [scenario.instruction];
  let currentUrl = "";
  let last = null;
  const stepResults = [];
  const startedAt = performance.now();

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const stepStartedAt = performance.now();
    const result = await browserAgentRun({
      sessionId,
      instruction: steps[stepIndex],
      currentUrl,
      useExtensions: false,
      waitMs: scenario.waitMs || "10000",
      afterWaitMs: scenario.afterWaitMs || "2500",
    });
    const measuredMs = performance.now() - stepStartedAt;
    currentUrl = result.currentUrl || currentUrl;
    last = result;
    stepResults.push({
      instruction: steps[stepIndex],
      ...summarizeResult(result, measuredMs),
    });
    if (!result.ok && scenario.stopOnFailure !== false) break;
  }

  const totalMeasuredMs = performance.now() - startedAt;
  if (!scenario.keepState) fs.rmSync(statePath(sessionId), { force: true });

  return {
    name: scenario.name,
    type: "browser",
    description: scenario.description,
    expected: scenario.expected,
    sessionId,
    totalMeasuredMs: round(totalMeasuredMs),
    final: summarizeResult(last || {}, totalMeasuredMs),
    steps: stepResults,
  };
}

function fakeObservation(fields = []) {
  return {
    url: "https://example.test/form",
    title: "Test form",
    forms: [{ index: 0, fields }],
    inputs: fields,
    buttons: [{ text: "Submit", type: "submit" }],
    links: [],
    textPreview: fields.map((field) => field.placeholder || field.name || field.type).join(" "),
    engine: "unit",
  };
}

function runWatcherScenario(scenario) {
  const startedAt = performance.now();
  const result = scenario.run();
  const measuredMs = performance.now() - startedAt;
  return {
    name: scenario.name,
    type: "watcher_unit",
    description: scenario.description,
    expected: scenario.expected,
    totalMeasuredMs: round(measuredMs),
    final: {
      status: result.needsUser ? "needs_user" : result.intent || (result.ok ? "ok" : "failed"),
      intent: result.intent || "",
      tool: result.command?.tool || "",
      measuredMs: round(measuredMs),
      totalMs: round(measuredMs),
      watcherMs: round(measuredMs),
      browserToolMs: 0,
      verificationMs: 0,
      stateMs: 0,
      mainModelMs: 0,
      totalTokens: 0,
      watcherTokens: 0,
      mainModelTokens: 0,
      summary: result.reason || "",
    },
    raw: result,
  };
}

const browserScenarios = [
  {
    name: "navigate_static_example",
    description: "Simple navigation on a static public site.",
    instruction: "navigate https://example.com",
    expected: "navigate success",
  },
  {
    name: "observe_news_links",
    description: "Navigate then answer visible links/menu question from current page state.",
    instruction: "navigate https://news.ycombinator.com\nthen what links are visible",
    expected: "2-step navigate + observe",
  },
  {
    name: "click_example_more_information",
    description: "Navigate then click a visible link by text.",
    instruction: "navigate https://example.com\nthen try clicking more information and read",
    expected: "click_or_open by visible link text",
  },
  {
    name: "google_redirect_fill_email",
    description: "Accept same-origin Google redirect and fill an email field without submitting.",
    instruction: `navigate https://accounts.google.com\nthen fill email: ${DUMMY_EMAIL}`,
    expected: "redirect accepted, fill_form",
    waitMs: "12000",
    afterWaitMs: "4000",
  },
  {
    name: "short_email_followup",
    description: "Use current page context to infer a bare email value.",
    steps: ["navigate https://accounts.google.com", DUMMY_EMAIL],
    expected: "bare email inferred as email field",
    waitMs: "12000",
    afterWaitMs: "4000",
  },
  {
    name: "httpbin_form_fill_only",
    description: "Fill multiple public form fields without submitting.",
    instruction: `navigate https://httpbin.org/forms/post\nthen fill name: Browser Test phone: 0123456789 email: ${DUMMY_EMAIL}`,
    expected: "fill_form with name/phone/email",
  },
  {
    name: "httpbin_form_fill_submit",
    description: "Fill and submit a public demo form.",
    instruction: `navigate https://httpbin.org/forms/post\nthen fill name: Browser Test phone: 0123456789 email: ${DUMMY_EMAIL} and submit`,
    expected: "fill_and_submit public form",
    afterWaitMs: "4000",
  },
  {
    name: "slow_spa_tcg_login_panel",
    description: "Wait/fallback on a slow JS app until the login panel is visible.",
    instruction: "navigate https://328474848.com/",
    expected: "login panel observed via runtime browser fallback",
    waitMs: "12000",
    afterWaitMs: "12000",
  },
];

const watcherScenarios = [
  {
    name: "watcher_parse_fill_submit",
    description: "Deterministic multiline fill-and-submit parsing.",
    expected: "fill_and_submit",
    run: () => watchBrowserInstruction({
      sessionId: "bench-unit",
      rawUserMessage: "fill employee id: A password: B and submit",
      currentState: { currentUrl: "https://example.test/login" },
      currentUrl: "https://example.test/login",
    }),
  },
  {
    name: "watcher_short_phone",
    description: "Bare number inferred as phone when only one phone field exists.",
    expected: "fill_form phone",
    run: () => inferFieldsFromShortMessage({
      rawUserMessage: "0123456789",
      observation: fakeObservation([{ name: "phone", type: "tel", placeholder: "Phone" }]),
      state: {},
      pendingForm: null,
    }),
  },
  {
    name: "watcher_ambiguous_number",
    description: "Bare number asks clarification when employee id and phone are both present.",
    expected: "needs_user clarification",
    run: () => inferFieldsFromShortMessage({
      rawUserMessage: "0123456789",
      observation: fakeObservation([
        { name: "employee_id", type: "text", placeholder: "Employee ID" },
        { name: "phone", type: "tel", placeholder: "Phone" },
      ]),
      state: {},
      pendingForm: null,
    }),
  },
  {
    name: "watcher_password_safety",
    description: "Bare password-like text is not inferred as password without pending password field.",
    expected: "needs_user",
    run: () => inferFieldsFromShortMessage({
      rawUserMessage: "hunter2sample",
      observation: fakeObservation([{ name: "password", type: "password", placeholder: "Password", secret: true }]),
      state: {},
      pendingForm: null,
    }),
  },
];

function markdownTable(rows) {
  const headers = [
    "scenario",
    "status",
    "total",
    "watcher",
    "browser",
    "verify",
    "main model",
    "tokens",
    "url",
  ];
  const line = `| ${headers.join(" |")} |`;
  const sep = `| ${headers.map(() => "---").join(" |")} |`;
  const body = rows.map((row) => {
    const final = row.final || {};
    return [
      row.name,
      final.status || "",
      `${final.totalMs ?? row.totalMeasuredMs}ms`,
      `${final.watcherMs || 0}ms`,
      `${final.browserToolMs || 0}ms`,
      `${final.verificationMs || 0}ms`,
      `${final.mainModelMs || 0}ms`,
      `${final.totalTokens || 0}`,
      String(final.currentUrl || "").slice(0, 80),
    ].map((value) => String(value).replace(/\|/g, "\\|")).join(" | ");
  }).map((lineBody) => `| ${lineBody} |`);
  return [line, sep, ...body].join("\n");
}

async function main() {
  loadServerEnv();
  fs.mkdirSync(artifactsDir, { recursive: true });
  const removedBefore = cleanupBenchmarkState();
  const results = [];

  for (let index = 0; index < browserScenarios.length; index += 1) {
    const scenario = browserScenarios[index];
    process.stdout.write(`running ${scenario.name}...\n`);
    results.push(await runBrowserScenario(scenario, index));
  }

  for (const scenario of watcherScenarios) {
    process.stdout.write(`running ${scenario.name}...\n`);
    results.push(runWatcherScenario(scenario));
  }

  const removedAfter = cleanupBenchmarkState();
  const output = {
    generatedAt: new Date().toISOString(),
    note: "Browser mode now uses the mandatory browser-agent LLM planner and reporter. Token usage is reported from Ollama-compatible prompt_eval_count/eval_count when the provider returns them.",
    cleanup: {
      removedBefore,
      removedAfter,
    },
    results,
  };
  const outputPath = path.join(artifactsDir, `browser-agent-benchmark-${nowStamp()}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  process.stdout.write("\nBrowser Agent Benchmark\n");
  process.stdout.write(`${markdownTable(results)}\n\n`);
  process.stdout.write(`wrote ${outputPath}\n`);
  process.stdout.write("token note: planner/reporter token counts come from the browser-agent LLM response when available.\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
