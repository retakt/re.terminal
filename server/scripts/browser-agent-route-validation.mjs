import fs from "node:fs";
import http from "node:http";
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

const validationModel = "llama3.2:latest";
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

function setBaseUrlEnv(name, fallback = validationBaseUrl) {
  const current = String(process.env[name] || "").trim();
  if (!current || /chat-api\.retakt\.cc/i.test(current)) {
    process.env[name] = fallback;
  }
}

setBaseUrlEnv("BROWSER_AGENT_BASE_URL");
setBaseUrlEnv("BROWSER_AGENT_API_BASE_URL");
setBaseUrlEnv("RUNTIME_BROWSER_AGENT_BASE_URL");
setBaseUrlEnv("OLLAMA_BASE_URL");

const {
  browserAgentReset,
  browserAgentRun,
  browserAgentStatus,
} = await import("../lib/browser-agent.js");
const { chooseBrowserRoute } = await import("../lib/browser-agent/route-selector.js");

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

  const number = String(Math.floor(10000 + Math.random() * 90000));
  const country = pickOne(countries);
  const name = `${pickOne(firstNames)} ${pickOne(lastNames)}`;

  return {
    id: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    number,
    country,
  };
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function renderPage({ title, heading, record, description, form = "", extra = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --bg: #f7f2eb;
      --card: #fffaf2;
      --ink: #1f2328;
      --muted: #5f6b7a;
      --accent: #2458ff;
      --accent-soft: rgba(36, 88, 255, 0.08);
      --border: rgba(31, 35, 40, 0.12);
    }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, rgba(36, 88, 255, 0.10), transparent 38%),
        linear-gradient(180deg, #fffdf8, var(--bg));
      color: var(--ink);
      display: grid;
      place-items: center;
      padding: 32px;
    }
    main {
      width: min(920px, 100%);
      background: rgba(255, 250, 242, 0.92);
      border: 1px solid var(--border);
      border-radius: 24px;
      box-shadow: 0 24px 60px rgba(31, 35, 40, 0.10);
      padding: 28px;
      backdrop-filter: blur(6px);
    }
    .eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--accent);
      font-weight: 700;
      font-size: 12px;
    }
    h1 {
      margin: 8px 0 12px;
      font-size: clamp(28px, 3vw, 42px);
      line-height: 1.05;
    }
    p {
      line-height: 1.6;
      color: var(--muted);
      margin: 0 0 16px;
    }
    .card {
      background: white;
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
      margin-top: 18px;
    }
    .fresh-data {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      margin-top: 18px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 700;
      margin: 4px 8px 4px 0;
    }
    label {
      display: grid;
      gap: 6px;
      margin-bottom: 14px;
      font-weight: 600;
    }
    input {
      font: inherit;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid rgba(31, 35, 40, 0.18);
      background: white;
    }
    button, a.button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 0;
      border-radius: 12px;
      padding: 12px 18px;
      font: inherit;
      font-weight: 700;
      color: white;
      background: linear-gradient(135deg, #2458ff, #163cc7);
      text-decoration: none;
      cursor: pointer;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    th, td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(31, 35, 40, 0.1);
    }
    .status {
      display: inline-block;
      padding: 10px 12px;
      border-radius: 999px;
      background: rgba(47, 166, 74, 0.12);
      color: #177245;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">${escapeHtml(title)}</div>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(description)}</p>
    ${record ? `
      <div class="fresh-data" aria-label="fresh data">
        <div class="pill">Name: <span>${escapeHtml(record.name)}</span></div>
        <div class="pill">Number: <span>${escapeHtml(record.number)}</span></div>
        <div class="pill">Country: <span>${escapeHtml(record.country)}</span></div>
      </div>
    ` : ""}
    ${form ? `<div class="card">${form}</div>` : ""}
    ${extra ? `<div class="card">${extra}</div>` : ""}
  </main>
</body>
</html>`;
}

function startFixtureServer(playRecord, readRecord) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const { pathname } = url;

      if (req.method === "GET" && pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPage({
          title: "Browser Agent Fixture",
          heading: "Route Isolation Fixture",
          description: "Use the Playwright page for visual interaction and the Lightpanda page for fast read/extract work.",
          extra: `<p>Open <a class="button" href="/playwright">Playwright page</a> or <a class="button" href="/lightpanda">Lightpanda page</a>.</p>`,
        }));
        return;
      }

      if (req.method === "GET" && pathname === "/playwright") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPage({
          title: "Playwright Fixture",
          heading: "Playwright route test",
          description: "Read the fresh values shown below, fill the form with the exact same values, submit it, and capture a screenshot of the confirmation page.",
          record: playRecord,
          form: `
            <form method="post" action="/playwright-confirm">
              <label>Full name
                <input name="name" autocomplete="off" />
              </label>
              <label>Number
                <input name="number" autocomplete="off" inputmode="numeric" />
              </label>
              <label>Country
                <input name="country" autocomplete="off" />
              </label>
              <button type="submit">Confirm record</button>
            </form>
          `,
          extra: `<p>This page is intentionally visual, so it should prefer the Playwright route.</p>`,
        }));
        return;
      }

      if (req.method === "POST" && pathname === "/playwright-confirm") {
        const body = await parseBody(req);
        const form = new URLSearchParams(body);
        const submitted = {
          name: form.get("name") || "",
          number: form.get("number") || "",
          country: form.get("country") || "",
        };
        const matched =
          submitted.name === playRecord.name &&
          submitted.number === playRecord.number &&
          submitted.country === playRecord.country;

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPage({
          title: "Playwright Confirmation",
          heading: matched ? "Submission confirmed" : "Submission mismatch",
          description: matched
            ? "The browser filled and submitted the exact fresh values from the page."
            : "The submitted values did not match the fresh data shown on the page.",
          record: playRecord,
          extra: `
            <div class="status">${matched ? "Confirmed" : "Mismatch"}</div>
            <table>
              <tr><th>Field</th><th>Submitted</th><th>Expected</th></tr>
              <tr><td>Name</td><td>${escapeHtml(submitted.name)}</td><td>${escapeHtml(playRecord.name)}</td></tr>
              <tr><td>Number</td><td>${escapeHtml(submitted.number)}</td><td>${escapeHtml(playRecord.number)}</td></tr>
              <tr><td>Country</td><td>${escapeHtml(submitted.country)}</td><td>${escapeHtml(playRecord.country)}</td></tr>
            </table>
            <p><a class="button" href="/playwright">Back to the form</a></p>
          `,
        }));
        return;
      }

      if (req.method === "GET" && pathname === "/lightpanda") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPage({
          title: "Lightpanda Fixture",
          heading: "Lightpanda route test",
          description: "Read the page and extract the fresh name, number, and country quickly. No clicks or screenshots are needed here.",
          record: readRecord,
          extra: `
            <div class="card">
              <table>
                <tr><th>Field</th><th>Value</th></tr>
                <tr><td>Name</td><td>${escapeHtml(readRecord.name)}</td></tr>
                <tr><td>Number</td><td>${escapeHtml(readRecord.number)}</td></tr>
                <tr><td>Country</td><td>${escapeHtml(readRecord.country)}</td></tr>
              </table>
              <p>This page is optimized for fast read, scrape, and extract tasks, so it should prefer the Lightpanda route.</p>
            </div>
          `,
        }));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(err?.stack || err?.message || String(err));
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function cleanupSessionFiles(sessionIds = []) {
  const stateDir = path.resolve(__dirname, "..", "config", "browser-agent");
  for (const id of sessionIds) {
    try {
      fs.unlinkSync(path.join(stateDir, `${id}.json`));
    } catch {}
  }
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
    assert(haystack.includes(String(value)), `${label} should include ${value}`, { label, value, text: haystack });
  }
}

async function main() {
  const playRecord = freshRecord("play");
  const readRecord = freshRecord("read");
  const sessionId = `browser-route-validation-${Date.now()}`;
  const fixture = await startFixtureServer(playRecord, readRecord);

  try {
    await browserAgentReset({ sessionId });

    const playInstruction = `Open ${fixture.baseUrl}/playwright, read the fresh name, number, and country shown on the page, fill the form with those exact values, submit it, take a screenshot of the confirmation page, and verify the values match.`;
    const readInstruction = `Open ${fixture.baseUrl}/lightpanda, read the fresh name, number, and country shown on the page, extract them quickly, and report the verified values. No screenshot or form interaction is needed.`;

    const playRouteChoice = await chooseBrowserRoute({
      instruction: playInstruction,
      plan: {
        status: "ready",
        userIntent: "interact with a visible form and capture a screenshot",
        routeHint: "auto",
        needsLightpandaWarmup: false,
        steps: [
          { kind: "navigate", text: "open the page" },
          { kind: "observe", text: "read the visible fresh values" },
          { kind: "fill_and_submit", text: "fill the form and submit it" },
          { kind: "screenshot", text: "take a screenshot of the confirmation page" },
        ],
        reason: "The task is visual and interactive.",
        confidence: 0.9,
      },
      currentState: {},
      images: [],
    });
    assertRouteChoice(playRouteChoice, "playwright", "Playwright route selector");

    const readRouteChoice = await chooseBrowserRoute({
      instruction: readInstruction,
      plan: {
        status: "ready",
        userIntent: "read and extract visible values quickly",
        routeHint: "auto",
        needsLightpandaWarmup: true,
        steps: [
          { kind: "navigate", text: "open the page" },
          { kind: "scrape", text: "read the fresh values" },
          { kind: "extract", text: "extract the values" },
        ],
        reason: "The task is read-only and extraction-focused.",
        confidence: 0.9,
      },
      currentState: {},
      images: [],
    });
    assertRouteChoice(readRouteChoice, "lightpanda", "Lightpanda route selector");

    const playRun = await browserAgentRun({
      sessionId,
      instruction: playInstruction,
      route: "playwright",
      currentUrl: "",
      currentTitle: "",
    });
    assert(playRun.ok, "Playwright route should succeed", playRun);
    assert(playRun.route === "playwright", "Playwright run should stay on the Playwright route", playRun);
    assert(playRun.stepResults.some((step) => step?.command?.tool === "browserScreenshot"), "Playwright run should include a screenshot step", playRun.stepResults);
    assert(playRun.currentUrl.includes("/playwright-confirm"), "Playwright run should end on the confirmation page", playRun.currentUrl);
    assertContainsAll(JSON.stringify(playRun.stepResults || []), [playRecord.name, playRecord.number, playRecord.country], "Playwright step results");
    assertNoForeignBackend(playRun, "lightpanda_cdp", "Playwright result");

    const playStatus = await browserAgentStatus({ sessionId });
    assert(playStatus.state.route === "playwright", "Playwright status should record the selected route", playStatus.state);
    assert(playStatus.state.routeEngine === "playwright_mcp", "Playwright status should record the Playwright backend", playStatus.state);
    assert(playStatus.state.history.every((entry) => entry.route === "playwright"), "Playwright history should not mix in another route", playStatus.state.history);

    const lightRun = await browserAgentRun({
      sessionId,
      instruction: readInstruction,
      route: "lightpanda",
      currentUrl: "",
      currentTitle: "",
    });
    assert(lightRun.ok, "Lightpanda route should succeed", lightRun);
    assert(lightRun.route === "lightpanda", "Lightpanda run should stay on the Lightpanda route", lightRun);
    assert(lightRun.stepResults.some((step) => ["browserScrape", "browserExtract", "browserObserve"].includes(step?.command?.tool)), "Lightpanda run should include a read/extract step", lightRun.stepResults);
    assertContainsAll(JSON.stringify(lightRun.stepResults || []), [readRecord.name, readRecord.number, readRecord.country], "Lightpanda step results");
    assertNoForeignBackend(lightRun, "playwright_mcp", "Lightpanda result");

    const lightStatus = await browserAgentStatus({ sessionId });
    assert(lightStatus.state.route === "lightpanda", "Lightpanda status should record the selected route", lightStatus.state);
    assert(lightStatus.state.routeEngine === "lightpanda_cdp", "Lightpanda status should record the Lightpanda backend", lightStatus.state);
    assert(lightStatus.state.history.every((entry) => entry.route === "lightpanda"), "Route switch should reset state before the Lightpanda run", lightStatus.state.history);
    assert(lightStatus.state.currentUrl.includes("/lightpanda"), "Lightpanda status should point at the read page", lightStatus.state.currentUrl);

    console.log(JSON.stringify({
      ok: true,
      sessionId,
      playRecord,
      readRecord,
      playRoute: playRouteChoice.route,
      readRoute: readRouteChoice.route,
      playSummary: playRun.summary,
      readSummary: lightRun.summary,
    }, null, 2));
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
    cleanupSessionFiles([sessionId]);
    await browserAgentReset({ sessionId }).catch(() => {});
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
