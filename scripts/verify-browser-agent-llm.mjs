import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const stateDir = path.join(repoRoot, "server", "config", "browser-agent");

function cleanupState() {
  if (!fs.existsSync(stateDir)) return;
  for (const entry of fs.readdirSync(stateDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^verify-browser-agent-llm-/.test(entry.name)) continue;
    const target = path.resolve(stateDir, entry.name);
    if (!target.startsWith(path.resolve(stateDir))) {
      throw new Error(`Refusing to remove outside state dir: ${target}`);
    }
    fs.rmSync(target, { force: true });
  }
}

function startMockOllama() {
  const calls = [];
  let mode = "success";
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/api/chat") {
      res.writeHead(404).end();
      return;
    }

    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const system = String(body.messages?.[0]?.content || "");
      const stage = /reporter/i.test(system) ? "reporter" : "planner";
      calls.push({ stage, body });

      if (mode === "invalid-json" && stage === "planner") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          model: body.model,
          response: "this is not json",
          prompt_eval_count: 11,
          eval_count: 3,
        }));
        return;
      }

      const response = stage === "planner"
        ? {
            intent: "navigate",
            risk: "low",
            backend: "auto",
            command: {
              tool: "browserNavigate",
              args: { url: "https://example.com" },
            },
            requiresConfirmation: false,
            reason: "User asked to navigate to Example Domain.",
            confidence: 0.99,
          }
        : {
            summary: "Navigated to Example Domain.",
            whatHappened: "The browser loaded the requested page and verified the resulting observation.",
            success: true,
            currentPage: "Example Domain",
            nextSafeAction: "Ask me to read the page or click a visible link.",
            failureDiagnosis: "",
          };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        model: body.model,
        response: JSON.stringify(response),
        prompt_eval_count: stage === "planner" ? 17 : 13,
        eval_count: stage === "planner" ? 19 : 11,
        total_duration: stage === "planner" ? 25_000_000 : 18_000_000,
      }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        calls,
        setMode(nextMode) {
          mode = nextMode;
        },
      });
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  cleanupState();
  const originalEnv = { ...process.env };
  const mock = await startMockOllama();

  try {
    const { browserAgentRun } = await import("../server/lib/browser-agent.js");

    delete process.env.BROWSER_AGENT_BASE_URL;
    delete process.env.BROWSER_AGENT_MODEL;
    let result = await browserAgentRun({
      sessionId: "verify-browser-agent-llm-missing",
      instruction: "navigate https://example.com",
      currentUrl: "",
      useExtensions: false,
    });
    assert(result.ok === false, "missing config should fail");
    assert(result.status === "config_error", "missing config should return config_error");
    assert(mock.calls.length === 0, "missing config must not call LLM");

    process.env.BROWSER_AGENT_BASE_URL = mock.baseUrl;
    process.env.BROWSER_AGENT_MODEL = "mock-browser-agent";
    process.env.BROWSER_AGENT_TIMEOUT_MS = "15000";
    process.env.BROWSER_AGENT_PLANNER_TEMPERATURE = "0.12";
    process.env.BROWSER_AGENT_REPORTER_TEMPERATURE = "0.28";
    process.env.BROWSER_AGENT_TOP_P = "0.82";
    process.env.BROWSER_AGENT_TOP_K = "32";
    process.env.BROWSER_AGENT_NUM_CTX = "4096";
    process.env.BROWSER_AGENT_ENGINE_PRIORITY = "static_fetch";
    process.env.BROWSER_PAGE_SETTLE_MS = "3000";
    process.env.BROWSER_AFTER_ACTION_SETTLE_MS = "500";

    mock.setMode("invalid-json");
    result = await browserAgentRun({
      sessionId: "verify-browser-agent-llm-invalid-json",
      instruction: "navigate https://example.com",
      currentUrl: "",
      useExtensions: false,
    });
    assert(result.ok === false, "invalid JSON should fail");
    assert(result.status === "planner_error", "invalid JSON should return planner_error");
    assert(result.blockedReason.includes("invalid JSON"), "invalid JSON reason should be clear");
    assert(result.tokenUsage?.planner?.totalTokens === 14, "invalid JSON should still expose planner tokens");

    mock.setMode("success");
    result = await browserAgentRun({
      sessionId: "verify-browser-agent-llm-success",
      instruction: "navigate https://example.com",
      currentUrl: "",
      useExtensions: false,
    });
    assert(result.ok === true, "successful planner output should execute");
    assert(result.status === "success", "success status expected");
    assert(String(result.currentUrl || "").startsWith("https://example.com"), `expected example.com current URL, got ${result.currentUrl}`);
    assert(result.tokenUsage?.planner?.totalTokens === 36, "planner token count should be real");
    assert(result.tokenUsage?.reporter?.totalTokens === 24, "reporter token count should be real");
    assert(result.tokenUsage?.totalTokens === 60, "total token count should combine planner and reporter");
    assert(mock.calls.filter((call) => call.stage === "planner").length >= 2, "planner should be called");
    assert(mock.calls.some((call) => call.stage === "reporter"), "reporter should be called");
    const plannerRequest = [...mock.calls].reverse().find((call) => call.stage === "planner");
    const reporterRequest = [...mock.calls].reverse().find((call) => call.stage === "reporter");
    assert(plannerRequest?.body?.options?.temperature === 0.12, "planner temperature should be sent to LLM API");
    assert(reporterRequest?.body?.options?.temperature === 0.28, "reporter temperature should be sent to LLM API");
    assert(plannerRequest?.body?.options?.top_p === 0.82, "top_p should be sent to LLM API");
    assert(plannerRequest?.body?.options?.num_ctx === 4096, "num_ctx should be sent to LLM API");
    assert(result.runtime?.options?.planner?.temperature === 0.12, "runtime output should expose planner settings");

    console.log(JSON.stringify({
      ok: true,
      tests: [
        "browserAgentRun calls mandatory LLM planner",
        "missing LLM config fails loudly",
        "invalid planner JSON fails clearly",
        "validated planner output executes browser command",
        "planner/reporter token usage is non-zero",
        "watcher LLM API options are sent and exposed",
      ],
      calls: mock.calls.map((call) => call.stage),
      tokenUsage: result.tokenUsage,
    }, null, 2));
  } finally {
    mock.server.close();
    process.env = originalEnv;
    cleanupState();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
