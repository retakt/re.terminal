import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(__dirname, "..", ".env"));

function setModelEnv(name, fallback = "llama3.2:latest") {
  const current = String(process.env[name] || "").trim();
  if (!current || /qwen3\.5:2b/i.test(current)) {
    process.env[name] = fallback;
  }
}

function setBaseUrlEnv(name, fallback) {
  const current = String(process.env[name] || "").trim();
  if (!current || /chat-api\.retakt\.cc/i.test(current)) {
    process.env[name] = fallback;
  }
}

const validationModel = "qwen3.5:2b";
const validationBaseUrl =
  String(process.env.BROWSER_AGENT_MAIN_BASE_URL || "").trim() ||
  String(process.env.BROWSER_AGENT_ORCHESTRATOR_BASE_URL || "").trim() ||
  "http://takt-pc.reverse-cliff.ts.net:11434";

setModelEnv("BROWSER_AGENT_MODEL", validationModel);
setModelEnv("BROWSER_AGENT_ORCHESTRATOR_MODEL", validationModel);
setModelEnv("BROWSER_AGENT_MAIN_MODEL", validationModel);
setModelEnv("BROWSER_AGENT_PLANNER_MODEL", validationModel);
setModelEnv("BROWSER_AGENT_STEP_AGENT_MODEL", validationModel);
setModelEnv("BROWSER_AGENT_CHECKER_MODEL", validationModel);
setModelEnv("BROWSER_AGENT_WATCHER_MODEL", validationModel);
setModelEnv("BROWSER_AGENT_REVIEWER_MODEL", validationModel);
setModelEnv("BROWSER_AGENT_RESULT_REVIEWER_MODEL", validationModel);
setModelEnv("BROWSER_AGENT_EXECUTOR_MODEL", validationModel);
setModelEnv("BROWSER_AGENT_REPORTER_MODEL", validationModel);
setModelEnv("BROWSER_AGENT_FINAL_VERIFIER_MODEL", validationModel);

setBaseUrlEnv("BROWSER_AGENT_BASE_URL", validationBaseUrl);
setBaseUrlEnv("BROWSER_AGENT_API_BASE_URL", validationBaseUrl);
setBaseUrlEnv("RUNTIME_BROWSER_AGENT_BASE_URL", validationBaseUrl);
setBaseUrlEnv("OLLAMA_BASE_URL", validationBaseUrl);

process.env.BROWSER_AGENT_TIMEOUT_MS = "20000";
process.env.EXTERNAL_MCP_CALL_TIMEOUT_MS = "10000";
process.env.BROWSER_AGENT_NUM_PREDICT = "1024";
process.env.BROWSER_AGENT_DEBUG_TRACE = "1";
process.env.BROWSER_AGENT_TEMPERATURE = "0.2";
process.env.BROWSER_AGENT_MAIN_TEMPERATURE = "0.1";
process.env.BROWSER_AGENT_PLANNER_TEMPERATURE = "0.2";
process.env.BROWSER_AGENT_STEP_AGENT_TEMPERATURE = "0.2";
process.env.BROWSER_AGENT_CHECKER_TEMPERATURE = "0";
process.env.BROWSER_AGENT_REVIEWER_TEMPERATURE = "0";
process.env.BROWSER_AGENT_WATCHER_TEMPERATURE = "0";
process.env.BROWSER_AGENT_RESULT_REVIEWER_TEMPERATURE = "0";
process.env.BROWSER_AGENT_REPORTER_TEMPERATURE = "0";
process.env.BROWSER_AGENT_EXECUTOR_TEMPERATURE = "0.1";
process.env.BROWSER_AGENT_CHECKER_MODEL = "qwen2.5-coder:7b";
process.env.BROWSER_AGENT_REVIEWER_MODEL = "qwen2.5-coder:7b";
process.env.BROWSER_AGENT_WATCHER_MODEL = "qwen2.5-coder:7b";
process.env.BROWSER_AGENT_RESULT_REVIEWER_MODEL = "qwen2.5-coder:7b";
process.env.BROWSER_AGENT_REPORTER_MODEL = "qwen2.5-coder:7b";
process.env.BROWSER_AGENT_FINAL_VERIFIER_MODEL = "qwen2.5-coder:7b";

const {
  browserAgentReset,
  browserAgentRun,
  browserAgentStatus,
} = await import("../lib/browser-agent.js");
const { chooseBrowserRoute } = await import("../lib/browser-agent/route-selector.js");
const { stopExternalMcpClient } = await import("../lib/external-mcp-client.js");

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function pickOne(values = []) {
  return values[Math.floor(Math.random() * values.length)] || "";
}

function freshRecord(prefix = "record") {
  const countries = [
    "Canada",
    "Japan",
    "Kenya",
    "Portugal",
    "Chile",
    "Vietnam",
    "Morocco",
    "Finland",
  ];
  const cities = [
    "Seattle",
    "Lisbon",
    "Nairobi",
    "Hanoi",
    "Osaka",
    "Santiago",
    "Casablanca",
    "Toronto",
  ];
  const selectOptions = ["One", "Two", "Three"];
  const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
  const firstNames = [
    "Avery",
    "Noah",
    "Mina",
    "Sofia",
    "Ethan",
    "Layla",
    "Aria",
    "Kai",
  ];
  const lastNames = [
    "Tan",
    "Nguyen",
    "Rivera",
    "Patel",
    "Carter",
    "Kim",
    "Gomez",
    "Hassan",
  ];
  const firstName = pickOne(firstNames);
  const lastName = pickOne(lastNames);
  const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    email: `${firstName}.${lastName}.${id.replace(/[^a-z0-9]/gi, "").slice(-8)}@example.com`.toLowerCase(),
    number: String(Math.floor(10000 + Math.random() * 90000)),
    country: pickOne(countries),
    city: pickOne(cities),
    selectOption: pickOne(selectOptions),
    color: `#${hex}`,
    date: `2026-06-${day}`,
    range: String(1 + Math.floor(Math.random() * 9)),
  };
}

function assertRouteChoice(actual, expected, label) {
  assert(actual?.route === expected, `${label} should choose ${expected}`, actual);
  assert(actual?.decision?.route === expected, `${label} decision should choose ${expected}`, actual);
}

function assertNoForeignBackend(payload, forbiddenToken, label) {
  const text = JSON.stringify(payload || {});
  assert(!text.includes(forbiddenToken), `${label} must not include ${forbiddenToken}`, {
    forbiddenToken,
    preview: text.slice(0, 2000),
  });
}

function assertContainsAll(text, values = [], label) {
  const haystack = String(text || "");
  for (const value of values) {
    assert(haystack.includes(String(value)), `${label} should include ${value}`, { label, value, text: haystack.slice(0, 3000) });
  }
}

async function chooseRouteCheck({ instruction, plan, expected, label }) {
  console.log(`[validation] ${label}: route selection starting`);
  const result = await chooseBrowserRoute({
    instruction,
    plan,
    currentState: {},
    images: [],
  });
  assertRouteChoice(result, expected, label);
  console.log(`[validation] ${label}: route selection ok`);
  return result;
}

function routeStepTools(stepResults = []) {
  return stepResults.map((step) => step?.command?.tool || "").filter(Boolean);
}

function shouldRunCase(name) {
  const selected = String(process.env.VALIDATION_CASE || "").trim().toLowerCase();
  return !selected || selected === "all" || selected === name;
}

async function runBrowserCase({
  sessionId,
  instruction,
  expectedRoute,
  expectedBackendForbidden = "",
  expectScreenshot = false,
  expectFreshValues = [],
  expectCurrentUrlIncludes = "",
  label,
}) {
  console.log(`[validation] ${label}: starting`);
  const result = await browserAgentRun({
    sessionId,
    instruction,
    route: expectedRoute,
    currentUrl: "",
    currentTitle: "",
  });

  assert(result.ok, `${label} should succeed`, result);
  assert(result.route === expectedRoute, `${label} should stay on the ${expectedRoute} route`, result);
  assertNoForeignBackend(result, expectedBackendForbidden, label);

  const tools = routeStepTools(result.stepResults || []);
  if (expectScreenshot) {
    assert(tools.includes("browserScreenshot"), `${label} should include a screenshot step`, tools);
  }
  if (expectedRoute === "playwright") {
    assert(tools.some((tool) => ["browserObserve", "browserScrape", "browserExtract", "browserFillFields", "browserFillAndSubmit", "browserSubmitForm", "browserClickByText"].includes(tool)), `${label} should include a browser interaction step`, tools);
  } else {
    assert(tools.some((tool) => ["browserObserve", "browserScrape", "browserExtract"].includes(tool)), `${label} should include a read/extract step`, tools);
  }

  if (expectFreshValues.length) {
    assertContainsAll(JSON.stringify(result.stepResults || []), expectFreshValues, `${label} step results`);
  }
  if (expectCurrentUrlIncludes) {
    assert(String(result.currentUrl || "").includes(expectCurrentUrlIncludes), `${label} should end on ${expectCurrentUrlIncludes}`, {
      currentUrl: result.currentUrl,
    });
  }

  console.log(`[validation] ${label}: ok`);
  return result;
}

async function main() {
  const sessionId = `browser-public-form-validation-${Date.now()}`;
  const seleniumWebForm = freshRecord("selenium-web");
  const testPagesForm = freshRecord("testpages-form");
  const testPagesReadOnly = freshRecord("testpages-readonly");

  const seleniumWebFormInstruction = `Open https://www.selenium.dev/selenium/web/web-form.html. Fill the "Text input" field with "${seleniumWebForm.name}", the "Password" field with "${seleniumWebForm.number}", the "Textarea" field with "${seleniumWebForm.country}", the "Dropdown (select)" field with "${seleniumWebForm.selectOption}", the "Dropdown (datalist)" field with "${seleniumWebForm.city}", the "Color picker" field with "${seleniumWebForm.color}", the "Date picker" field with "${seleniumWebForm.date}", and the "Example range" field with "${seleniumWebForm.range}". Submit the form, take a screenshot of the confirmation page, and verify the page says Received!.`;
  const testPagesInstruction = `Open https://webdriveruniversity.com/Contact-Us/contactus.html. Fill the "First Name" field with "${testPagesForm.firstName}", the "Last Name" field with "${testPagesForm.lastName}", the "Email Address" field with "${testPagesForm.email}", and the "Comments" field with "${testPagesForm.country} ${testPagesForm.city}". Submit the form, take a screenshot of the thank-you page, and verify the page says Thank You for your Message!.`;
  const testPagesReadOnlyInstruction = `Open https://webdriveruniversity.com/Contact-Us/contactus.html. Read the visible contact form controls, extract the readable labels, and report which parts of the page would be useful for entering a fresh record like "${testPagesReadOnly.name}", "${testPagesReadOnly.email}", and "${testPagesReadOnly.country}". Do not click, fill, or screenshot.`;

  try {
    console.log("[validation] reset starting");
    await browserAgentReset({ sessionId });
    console.log("[validation] reset ok");

    let seleniumWebRun = null;
    let testPagesRun = null;
    let testPagesReadOnlyRun = null;

    if (shouldRunCase("selenium")) {
      const seleniumWebRoute = await chooseRouteCheck({
        instruction: seleniumWebFormInstruction,
        plan: {
          status: "ready",
          userIntent: "interact with a visible form and capture a screenshot",
          routeHint: "auto",
          needsLightpandaWarmup: false,
          steps: [
            { kind: "navigate", text: "open the page" },
            { kind: "fill_and_submit", text: "fill the form and submit it" },
            { kind: "screenshot", text: "take a screenshot of the confirmation page" },
          ],
          reason: "The task is visual and interactive.",
          confidence: 0.9,
        },
        expected: "playwright",
        label: "Selenium web form route selector",
      });
      assertRouteChoice(seleniumWebRoute, "playwright", "Selenium web form route selector");

      seleniumWebRun = await runBrowserCase({
        sessionId,
        instruction: seleniumWebFormInstruction,
        expectedRoute: "playwright",
        expectedBackendForbidden: "lightpanda_cdp",
        expectScreenshot: true,
        expectFreshValues: [
          seleniumWebForm.name,
          seleniumWebForm.number,
          seleniumWebForm.country,
          seleniumWebForm.city,
          seleniumWebForm.color,
          seleniumWebForm.date,
          seleniumWebForm.range,
          "Received!",
        ],
        expectCurrentUrlIncludes: "/submitted-form.html",
        label: "Selenium web form",
      });
      const seleniumWebStatus = await browserAgentStatus({ sessionId });
      assert(seleniumWebStatus.state.route === "playwright", "Selenium web form status should record Playwright", seleniumWebStatus.state);
      assert(seleniumWebStatus.state.routeEngine === "playwright_mcp", "Selenium web form status should record the Playwright backend", seleniumWebStatus.state);
      assert(seleniumWebStatus.state.history.every((entry) => entry.route === "playwright"), "Selenium web form history should stay on Playwright", seleniumWebStatus.state.history);
    }

    if (shouldRunCase("testpages")) {
      const testPagesRoute = await chooseRouteCheck({
        instruction: testPagesInstruction,
        plan: {
          status: "ready",
          userIntent: "fill a multi-field practice form and verify the results page",
          routeHint: "auto",
          needsLightpandaWarmup: false,
          steps: [
            { kind: "navigate", text: "open the page" },
            { kind: "observe", text: "read the visible fields" },
            { kind: "fill_and_submit", text: "fill the form and submit it" },
            { kind: "screenshot", text: "take a screenshot of the results page" },
          ],
          reason: "This is a multi-field practice form that benefits from visual interaction.",
          confidence: 0.9,
        },
        expected: "playwright",
        label: "Test Pages form route selector",
      });
      assertRouteChoice(testPagesRoute, "playwright", "Test Pages form route selector");

      testPagesRun = await runBrowserCase({
        sessionId,
        instruction: testPagesInstruction,
        expectedRoute: "playwright",
        expectedBackendForbidden: "lightpanda_cdp",
        expectScreenshot: true,
        expectFreshValues: [
          testPagesForm.firstName,
          testPagesForm.lastName,
          testPagesForm.email,
          testPagesForm.country,
          "Thank You for your Message!",
        ],
        label: "WebDriver University contact form",
      });
      const testPagesStatus = await browserAgentStatus({ sessionId });
      assert(testPagesStatus.state.route === "playwright", "Test Pages status should still show Playwright", testPagesStatus.state);
      assert(testPagesStatus.state.routeEngine === "playwright_mcp", "Test Pages status should still show the Playwright backend", testPagesStatus.state);
      assert(testPagesStatus.state.history.every((entry) => entry.route === "playwright"), "Test Pages history should stay on Playwright before the route switch", testPagesStatus.state.history);
      assertContainsAll(JSON.stringify(testPagesRun.stepResults || []), [testPagesForm.firstName, testPagesForm.lastName, testPagesForm.email, testPagesForm.country], "Test Pages step results");
    }

    if (shouldRunCase("lightpanda")) {
      const testPagesReadOnlyRoute = await chooseRouteCheck({
        instruction: testPagesReadOnlyInstruction,
        plan: {
          status: "ready",
          userIntent: "read a practice form quickly",
          routeHint: "auto",
          needsLightpandaWarmup: true,
          steps: [
            { kind: "navigate", text: "open the page" },
            { kind: "scrape", text: "read the visible control labels" },
            { kind: "extract", text: "extract the readable form structure" },
          ],
          reason: "This is a read-only inspection task and should prefer the faster read route.",
          confidence: 0.9,
        },
        expected: "lightpanda",
        label: "Test Pages read-only route selector",
      });
      assertRouteChoice(testPagesReadOnlyRoute, "lightpanda", "Test Pages read-only route selector");

      testPagesReadOnlyRun = await runBrowserCase({
        sessionId,
        instruction: testPagesReadOnlyInstruction,
        expectedRoute: "lightpanda",
        expectedBackendForbidden: "playwright_mcp",
        expectScreenshot: false,
        expectFreshValues: [],
        label: "WebDriver University read/extract",
      });
      const testPagesReadOnlyStatus = await browserAgentStatus({ sessionId });
      assert(testPagesReadOnlyStatus.state.route === "lightpanda", "Route switch should move the session to Lightpanda", testPagesReadOnlyStatus.state);
      assert(testPagesReadOnlyStatus.state.routeEngine === "lightpanda_cdp", "Lightpanda state should record the Lightpanda backend", testPagesReadOnlyStatus.state);
      assert(testPagesReadOnlyStatus.state.history.every((entry) => entry.route === "lightpanda"), "Route switch should reset the state before the Lightpanda run", testPagesReadOnlyStatus.state.history);
      assert(String(testPagesReadOnlyStatus.state.currentUrl || "").includes("contactus.html"), "Lightpanda status should point to the WebDriver University contact form", testPagesReadOnlyStatus.state.currentUrl);
      assert(routeStepTools(testPagesReadOnlyRun.stepResults || []).some((tool) => ["browserObserve", "browserScrape", "browserExtract"].includes(tool)), "Lightpanda run should use a read/extract tool", testPagesReadOnlyRun.stepResults);
      assertContainsAll(JSON.stringify(testPagesReadOnlyRun.stepResults || []), ["First Name", "Last Name", "Email Address", "Comments"], "Lightpanda extracted labels");
    }

    console.log(JSON.stringify({
      ok: true,
      sessionId,
      cases: [
        ...(seleniumWebRun ? [{
          label: "Selenium web form",
          route: seleniumWebRun.route,
          summary: seleniumWebRun.summary,
        }] : []),
        ...(testPagesRun ? [{
          label: "WebDriver University contact form",
          route: testPagesRun.route,
          summary: testPagesRun.summary,
        }] : []),
        ...(testPagesReadOnlyRun ? [{
          label: "WebDriver University read/extract",
          route: testPagesReadOnlyRun.route,
          summary: testPagesReadOnlyRun.summary,
        }] : []),
      ],
    }, null, 2));
  } finally {
    await browserAgentReset({ sessionId }).catch(() => {});
    await stopExternalMcpClient("playwright").catch(() => {});
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: err.message,
    details: err.details || null,
    stack: err.stack,
  }, null, 2));
  process.exitCode = 1;
});
