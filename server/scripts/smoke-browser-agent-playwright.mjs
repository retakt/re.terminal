import http from "node:http";
import { performance } from "node:perf_hooks";
import { browserAgentReset, browserAgentRun } from "../lib/browser-agent.js";
import { stopExternalMcpClient } from "../lib/external-mcp-client.js";

const TARGET_URL = process.env.BROWSER_AGENT_PLAYWRIGHT_SMOKE_URL || "https://www.selenium.dev/selenium/web/web-form.html";
const SESSION_ID = `smoke-playwright-agent-${Date.now()}`;

function jsonResponse(res, payload) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function createMockLlmServer() {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/api/chat") {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const system = String(payload.messages?.[0]?.content || "");
      const isReporter = /runtime browser agent.*reporter/i.test(system);
      const response = isReporter
        ? {
            summary: "Submitted the public Selenium web form with Playwright MCP.",
            whatHappened: "The agent navigated, filled the requested fields, submitted the form, and observed the submitted page.",
            success: true,
            currentPage: "Web form - target page",
            nextSafeAction: "Ask for another browser task or inspect the final snapshot.",
            failureDiagnosis: "",
          }
        : {
            intent: "fill_and_submit",
            risk: "low",
            backend: "playwright_mcp",
            command: {
              tool: "browserFillAndSubmit",
              args: {
                url: TARGET_URL,
                explicitSubmit: true,
                fields: [
                  { label: "Text input", value: "Retakt Agent", secret: false },
                  { label: "Textarea", value: "Hello from Playwright MCP", secret: false },
                  { label: "Dropdown (select)", value: "Two", secret: false },
                  { label: "Default checkbox", value: "true", secret: false },
                  { label: "Default radio", value: "true", secret: false },
                ],
              },
            },
            requiresConfirmation: false,
            reason: "The user explicitly requested a low-risk public automation-practice form submission using Playwright.",
            confidence: 0.92,
          };

      jsonResponse(res, {
        model: payload.model || "mock-browser-agent",
        message: { role: "assistant", content: JSON.stringify(response) },
        prompt_eval_count: isReporter ? 111 : 222,
        eval_count: isReporter ? 33 : 44,
        total_duration: 150_000_000,
        prompt_eval_duration: 50_000_000,
        eval_duration: 80_000_000,
      });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function assert(condition, message, detail = undefined) {
  if (!condition) {
    const error = new Error(message);
    error.detail = detail;
    throw error;
  }
  console.log(`PASS ${message}`);
}

const savedEnv = {
  BROWSER_AGENT_BASE_URL: process.env.BROWSER_AGENT_BASE_URL,
  BROWSER_AGENT_MODEL: process.env.BROWSER_AGENT_MODEL,
  PLAYWRIGHT_MCP_ENABLED: process.env.PLAYWRIGHT_MCP_ENABLED,
};

const startedAt = performance.now();
const { server, baseUrl } = await createMockLlmServer();

try {
  process.env.BROWSER_AGENT_BASE_URL = baseUrl;
  process.env.BROWSER_AGENT_MODEL = "mock-browser-agent";
  process.env.PLAYWRIGHT_MCP_ENABLED = "true";

  await browserAgentReset({ sessionId: SESSION_ID });
  const result = await browserAgentRun({
    sessionId: SESSION_ID,
    instruction: `Use Playwright to open ${TARGET_URL}, fill the public test form, submit it, wait for the success page, and report the result.`,
    useExtensions: false,
    waitMs: "1200",
  });

  console.log(JSON.stringify({
    ok: result.ok,
    status: result.status,
    summary: result.summary,
    currentUrl: result.currentUrl,
    currentTitle: result.currentTitle,
    engine: result.engine,
    tokenUsage: result.tokenUsage,
    runtimeTiming: result.runtimeTiming,
  }, null, 2));

  assert(result.planner?.backend === "playwright_mcp", "LLM planner selected playwright_mcp", result.planner);
  assert(result.steps?.some((step) => step.tool === "browser_navigate"), "Playwright navigate step ran", result.steps);
  assert(result.steps?.some((step) => step.tool === "browser_fill_form"), "Playwright fill_form step ran", result.steps);
  assert(result.steps?.some((step) => step.tool === "browser_click" || step.tool === "browser_press_key"), "Playwright submit step ran", result.steps);
  assert(Number(result.tokenUsage?.totalTokens || 0) > 0, "token usage is non-zero", result.tokenUsage);
  assert(result.watcher?.intent !== result.planner?.intent || result.planner?.backend === "playwright_mcp", "watcher did not replace the LLM planner", { watcher: result.watcher, planner: result.planner });

  console.log(`DONE browser-agent Playwright smoke in ${Math.round(performance.now() - startedAt)}ms`);
} finally {
  await browserAgentReset({ sessionId: SESSION_ID }).catch(() => {});
  await stopExternalMcpClient("playwright").catch(() => {});
  server.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
