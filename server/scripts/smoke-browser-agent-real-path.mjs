import http from "node:http";
import { browserAgentReset, browserAgentRun, setBrowserAgentMcpCaller } from "../lib/browser-agent.js";

const SESSION_PREFIX = `smoke-real-browser-path-${Date.now()}`;
const LOGIN_URL = "https://ezhrmsys.com/";

function jsonResponse(res, payload) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function loginSnapshot(url = LOGIN_URL) {
  return {
    content: [{
      type: "text",
      text: [
        `Page URL: ${url}`,
        "Page Title: Login - HRM",
        "- textbox \"Please enter your employee ID\" [ref=employee]",
        "- textbox \"Please enter your password\" [ref=password]",
        "- button \"Login\" [ref=login]",
      ].join("\n"),
    }],
  };
}

function dashboardSnapshot() {
  return {
    content: [{
      type: "text",
      text: [
        "Page URL: https://ezhrmsys.com/attendance-employee",
        "Page Title: Dashboard - HRM",
        "- link \"Attendance\" [ref=attendance]",
        "- button \"Logout\" [ref=logout]",
      ].join("\n"),
    }],
  };
}

function blankErrorSnapshot() {
  return {
    isError: true,
    content: [{
      type: "text",
      text: [
        "Page URL: about:blank",
        "Page Title:",
        "Page.navigate timeout",
      ].join("\n"),
    }],
  };
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
      const context = JSON.parse(String(payload.messages?.[1]?.content || "{}"));
      const instruction = String(context.rawUserInstruction || context.userInstruction || "");
      const isReporter = /runtime browser agent.*reporter/i.test(system);
      let response;

      if (isReporter) {
        response = {
          summary: /exit browser|^exit$/i.test(String(context.instruction || ""))
            ? "Browser session reset."
            : context.verification?.ok === false
            ? "The browser action failed and the latest page snapshot was not usable."
            : "The browser action completed through the selected backend.",
          whatHappened: "Reporter observed the actual browser-agent result.",
          success: context.verification?.ok !== false,
          currentPage: context.observation?.title || context.observation?.url || "",
          nextSafeAction: "Continue with a visible browser action.",
          failureDiagnosis: context.diagnostics?.diagnosis || "",
        };
      } else if (/exit browser|^exit$/i.test(instruction)) {
        response = {
          intent: "navigate",
          risk: "low",
          backend: "lightpanda",
          command: { tool: "browserNavigate", args: { url: "exit" } },
          requiresConfirmation: false,
          reason: "Intentionally bad planner response; local reset guardrail must override it.",
          confidence: 0.7,
        };
      } else if (/fill form there text/i.test(instruction)) {
        response = {
          intent: "fill_and_submit",
          risk: "medium",
          backend: "playwright_mcp",
          command: {
            tool: "browserFillAndSubmit",
            args: {
              currentUrl: LOGIN_URL,
              explicitSubmit: true,
              fields: [
                { label: "text", value: "test123", secret: false },
                { label: "password", value: "pass123", secret: true },
              ],
            },
          },
          requiresConfirmation: false,
          reason: "Fill the login form with alias labels.",
          confidence: 0.9,
        };
      } else if (/lightpanda timeout/i.test(instruction)) {
        response = {
          intent: "fill_form",
          risk: "medium",
          backend: "lightpanda",
          command: {
            tool: "browserFillFields",
            args: {
              currentUrl: LOGIN_URL,
              fields: [
                { label: "employee id", value: "test123", secret: false },
                { label: "password", value: "pass123", secret: true },
              ],
            },
          },
          requiresConfirmation: false,
          reason: "Intentionally asks for Lightpanda on an interactive task; runtime must force Playwright.",
          confidence: 0.8,
        };
      } else if (/stale state/i.test(instruction)) {
        response = {
          intent: "observe",
          risk: "low",
          backend: "playwright_mcp",
          command: { tool: "browserObserve", args: { currentUrl: "https://tougen.example/" } },
          requiresConfirmation: false,
          reason: "Observe current page after a failed browser state.",
          confidence: 0.8,
        };
      } else {
        response = {
          intent: "navigate",
          risk: "low",
          backend: "lightpanda",
          command: { tool: "browserNavigate", args: { url: LOGIN_URL } },
          requiresConfirmation: false,
          reason: "Intentionally asks for Lightpanda; explicit user Playwright must override it.",
          confidence: 0.8,
        };
      }

      jsonResponse(res, {
        model: payload.model || "mock-browser-agent",
        message: { role: "assistant", content: JSON.stringify(response) },
        prompt_eval_count: isReporter ? 31 : 71,
        eval_count: isReporter ? 13 : 19,
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

function createFakeMcp() {
  const calls = [];
  const state = { submitted: false, blank: false };
  const tools = [
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_fill_form",
    "browser_press_key",
    "browser_wait_for",
    "browser_close",
  ].map((name) => ({ name, inputSchema: { type: "object", properties: {} } }));

  async function call(name, args = {}) {
    calls.push({ name, args });
    if (name === "mcp__ops__playwright_mcp_status") {
      return { ok: true, discovered: true, server: { enabled: true, status: "ready", toolCount: tools.length } };
    }
    if (name === "mcp__ops__external_mcp_tools" || name === "mcp__ops__external_mcp_refresh") {
      return { ok: true, tools };
    }
    if (name === "mcp__playwright__browser_close") return { ok: true, content: [{ type: "text", text: "closed" }] };
    if (name === "mcp__playwright__browser_navigate") {
      state.submitted = false;
      return { ok: true, content: [{ type: "text", text: `Navigated to ${args.url}` }] };
    }
    if (name === "mcp__playwright__browser_snapshot") {
      if (state.blank) return blankErrorSnapshot();
      return state.submitted ? dashboardSnapshot() : loginSnapshot();
    }
    if (name === "mcp__playwright__browser_fill_form") {
      return { ok: true, content: [{ type: "text", text: "filled" }] };
    }
    if (name === "mcp__playwright__browser_click" || name === "mcp__playwright__browser_press_key") {
      state.submitted = true;
      return { ok: true, content: [{ type: "text", text: "clicked" }] };
    }
    if (name === "mcp__playwright__browser_wait_for") {
      return { ok: true, content: [{ type: "text", text: "waited" }] };
    }
    throw new Error(`Unexpected fake MCP call: ${name}`);
  }

  return { call, calls, state };
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
};
const createdSessions = [];

const { server, baseUrl } = await createMockLlmServer();

try {
  process.env.BROWSER_AGENT_BASE_URL = baseUrl;
  process.env.BROWSER_AGENT_MODEL = "mock-browser-agent";

  {
    const fakeMcp = createFakeMcp();
    setBrowserAgentMcpCaller(fakeMcp.call);
    const sessionId = `${SESSION_PREFIX}-explicit-playwright`;
    createdSessions.push(sessionId);
    await browserAgentReset({ sessionId });
    const result = await browserAgentRun({
      sessionId,
      instruction: "use playwright go to https://ezhrmsys.com and observe the login form",
      useExtensions: false,
    });
    assert(result.planner?.backend === "playwright_mcp", "explicit Playwright overrides a Lightpanda planner backend", result.planner);
    assert(fakeMcp.calls.some((call) => call.name === "mcp__playwright__browser_navigate"), "explicit Playwright path calls Playwright navigate", fakeMcp.calls);
    assert(!fakeMcp.calls.some((call) => /lightpanda/i.test(call.name)), "explicit Playwright path does not call Lightpanda", fakeMcp.calls);
    assert(result.whatFound?.inputs?.some((input) => /employee/i.test(input.label || input.name || "")), "Playwright snapshot includes employee ID field", result.whatFound);
    assert(result.whatFound?.inputs?.some((input) => /password/i.test(input.label || input.name || "")), "Playwright snapshot includes password field", result.whatFound);
    assert(Number(result.tokenUsage?.totalTokens || 0) > 0, "explicit Playwright path reports non-zero token usage", result.tokenUsage);
  }

  {
    const fakeMcp = createFakeMcp();
    setBrowserAgentMcpCaller(fakeMcp.call);
    const sessionId = `${SESSION_PREFIX}-exit`;
    createdSessions.push(sessionId);
    await browserAgentReset({ sessionId });
    const result = await browserAgentRun({ sessionId, instruction: "exit browser", useExtensions: false });
    assert(result.ok && /reset/i.test(result.summary || ""), "exit browser resets the session", result);
    assert(!fakeMcp.calls.some((call) => call.name === "mcp__playwright__browser_navigate"), "exit browser does not call navigate", fakeMcp.calls);
  }

  {
    const fakeMcp = createFakeMcp();
    setBrowserAgentMcpCaller(fakeMcp.call);
    const sessionId = `${SESSION_PREFIX}-alias`;
    createdSessions.push(sessionId);
    await browserAgentReset({ sessionId });
    const result = await browserAgentRun({
      sessionId,
      currentUrl: LOGIN_URL,
      instruction: "fill form there text: test123 password: pass123 click login button",
      useExtensions: false,
    });
    const fillCall = fakeMcp.calls.find((call) => call.name === "mcp__playwright__browser_fill_form");
    assert(result.ok, "form aliasing run succeeds through browserAgentRun", result);
    assert(fillCall?.args?.fields?.some((field) => field.target === "employee"), "text alias maps to employee ID field", fillCall);
    assert(fillCall?.args?.fields?.some((field) => field.target === "password"), "password alias maps to password field", fillCall);
  }

  {
    const fakeMcp = createFakeMcp();
    setBrowserAgentMcpCaller(fakeMcp.call);
    const sessionId = `${SESSION_PREFIX}-failover`;
    createdSessions.push(sessionId);
    await browserAgentReset({ sessionId });
    const result = await browserAgentRun({
      sessionId,
      currentUrl: LOGIN_URL,
      instruction: "lightpanda timeout login form should fill employee id and password",
      useExtensions: false,
    });
    assert(result.planner?.backend === "playwright_mcp", "interactive Lightpanda plan is locally routed to Playwright", result.planner);
    assert(fakeMcp.calls.some((call) => call.name === "mcp__playwright__browser_fill_form"), "interactive failover path uses Playwright fill_form", fakeMcp.calls);
  }

  {
    const fakeMcp = createFakeMcp();
    fakeMcp.state.blank = true;
    setBrowserAgentMcpCaller(fakeMcp.call);
    const sessionId = `${SESSION_PREFIX}-stale`;
    createdSessions.push(sessionId);
    await browserAgentReset({ sessionId });
    const result = await browserAgentRun({
      sessionId,
      currentUrl: "https://tougen.example/",
      instruction: "stale state observe current page",
      useExtensions: false,
    });
    assert(!/TOUGEN ANKI/i.test(result.currentTitle || ""), "failed about:blank snapshot does not report stale title", result);
    assert(result.currentUrl === "" || result.currentUrl === "about:blank", "failed about:blank snapshot does not report stale URL as current", result);
  }

  console.log("DONE browser-agent real chat path regressions passed");
} finally {
  await Promise.all(createdSessions.map((sessionId) => browserAgentReset({ sessionId }).catch(() => null)));
  setBrowserAgentMcpCaller(null);
  server.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
