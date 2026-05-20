import {
  browserAgentReset,
  browserAgentRun,
  browserAgentStatus,
} from "../lib/browser-agent.js";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const savedEnv = {
  BROWSER_AGENT_ENGINE_PRIORITY: process.env.BROWSER_AGENT_ENGINE_PRIORITY,
  LIGHTPANDA_CDP_URL: process.env.LIGHTPANDA_CDP_URL,
};

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function labels(values = []) {
  return values
    .map((entry) => String(entry?.text || entry?.label || entry?.href || "").toLowerCase())
    .filter(Boolean);
}

function hasAbout(payload = {}) {
  const found = payload.whatFound || {};
  const linkLabels = labels(found.links);
  return linkLabels.some((label) => label.includes("about")) ||
    String(found.textPreview || "").toLowerCase().includes("about");
}

function printResult(name, payload) {
  console.log(JSON.stringify({
    test: name,
    status: payload.status,
    ok: payload.ok,
    engine: payload.engine,
    currentUrl: payload.currentUrl,
    currentTitle: payload.currentTitle,
    blockedReason: payload.blockedReason,
  }, null, 2));
}

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/about") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>About Fixture</title><main><h1>About</h1><p>This is the generic browser-agent fixture about page.</p><a href=\"/\">Home</a></main>");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Fixture Home</title><nav><a href=\"/about\">About</a><a href=\"/docs\">Docs</a></nav><main><p>Generic browser agent fixture with visible links.</p></main>");
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

async function run() {
  const sessionId = `retakt-acceptance-${Date.now()}`;
  const genericSessionId = `${sessionId}-generic`;
  const fixture = await startFixtureServer();

  try {
    process.env.BROWSER_AGENT_ENGINE_PRIORITY = savedEnv.BROWSER_AGENT_ENGINE_PRIORITY || "lightpanda_cdp,static_fetch";
    await browserAgentReset({ sessionId });

    const retaktObserve = await browserAgentRun({
      sessionId,
      instruction: "navigate this page https://retakt.cc",
      maxSteps: 4,
    });
    printResult("observe retakt", retaktObserve);
    assert(retaktObserve.status === "success", "navigate retakt should succeed with at least one engine", retaktObserve);
    assert(/^https:\/\/retakt\.cc/i.test(retaktObserve.currentUrl || ""), "currentUrl should stay on retakt.cc", retaktObserve);
    assert(!/^about:blank$/i.test(retaktObserve.currentUrl || ""), "currentUrl must not be about:blank", retaktObserve);
    assert(retaktObserve.state?.currentUrl, "state currentUrl must not be empty", retaktObserve.state);

    if (hasAbout(retaktObserve)) {
      const retaktClickAbout = await browserAgentRun({
        sessionId,
        instruction: "try clicking about and read",
        maxSteps: 4,
      });
      printResult("click retakt about", retaktClickAbout);
      assert(retaktClickAbout.status === "success", "click retakt about should succeed when About is observed", retaktClickAbout);
      assert(/\/about\/?$/i.test(new URL(retaktClickAbout.currentUrl).pathname), "final retakt URL should be /about", retaktClickAbout);
      assert(JSON.stringify(retaktClickAbout.steps || []).includes("browserClickByHref"), "retakt click should navigate by discovered href", retaktClickAbout.steps);
      assert(!JSON.stringify(retaktClickAbout.steps || []).includes("about:blank"), "retakt steps must not target about:blank", retaktClickAbout.steps);
    } else {
      console.log(JSON.stringify({
        test: "click retakt about",
        skipped: true,
        reason: "The active engine did not observe the JS-rendered About link. Static fetch is read-only and will not fabricate dynamic links.",
        engine: retaktObserve.engine,
      }, null, 2));
    }

    process.env.BROWSER_AGENT_ENGINE_PRIORITY = "static_fetch";
    await browserAgentReset({ sessionId: genericSessionId });
    const observe = await browserAgentRun({
      sessionId: genericSessionId,
      instruction: `navigate this page ${fixture.baseUrl}`,
      maxSteps: 4,
      useExtensions: false,
    });
    printResult("observe generic fixture", observe);
    assert(observe.status === "success", "generic fixture observe should succeed", observe);
    assert(hasAbout(observe), "generic fixture should include About link", observe.whatFound);

    const clickAbout = await browserAgentRun({
      sessionId: genericSessionId,
      instruction: "try clicking about and read",
      maxSteps: 4,
      useExtensions: false,
    });
    printResult("click generic about", clickAbout);
    assert(clickAbout.status === "success", "generic click about should succeed", clickAbout);
    assert(/\/about\/?$/i.test(new URL(clickAbout.currentUrl).pathname), "generic final URL should be /about", clickAbout);
    assert(JSON.stringify(clickAbout.steps || []).includes("browserClickByHref"), "generic click should navigate by discovered href", clickAbout.steps);
    assert(!JSON.stringify(clickAbout.steps || []).includes("about:blank"), "generic steps must not target about:blank", clickAbout.steps);
    assert(clickAbout.extensionId === "", "extensions disabled should not set extensionId", clickAbout);

    const previousUrl = clickAbout.state?.currentUrl || clickAbout.currentUrl;
    process.env.BROWSER_AGENT_ENGINE_PRIORITY = "lightpanda_cdp";
    process.env.LIGHTPANDA_CDP_URL = "ws://127.0.0.1:9";
    const failedObserve = await browserAgentRun({
      sessionId: genericSessionId,
      instruction: `navigate this page ${fixture.baseUrl}`,
      maxSteps: 4,
    });
    printResult("failed lightpanda does not poison", failedObserve);
    assert(failedObserve.status !== "success", "forced Lightpanda failure should fail", failedObserve);
    const afterFailed = await browserAgentStatus({ sessionId: genericSessionId });
    assert(afterFailed.state.currentUrl === previousUrl, "failed observe must preserve previous valid currentUrl", afterFailed.state);
    assert(afterFailed.state.currentUrl !== "", "failed observe must not blank currentUrl", afterFailed.state);
    assert(!/^about:blank$/i.test(afterFailed.state.currentUrl || ""), "failed observe must not set about:blank", afterFailed.state);
    assert(afterFailed.state.lastFailedObservation, "failed observe should record lastFailedObservation", afterFailed.state);
    assert(!/ezhrm|attendance|checkout/i.test(JSON.stringify(clickAbout.possibleNextActions || [])), "unrelated extension actions must not leak", clickAbout);

    console.log(JSON.stringify({ ok: true, sessionId }, null, 2));
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
    cleanupSessionFiles([sessionId, genericSessionId]);

    if (savedEnv.BROWSER_AGENT_ENGINE_PRIORITY === undefined) delete process.env.BROWSER_AGENT_ENGINE_PRIORITY;
    else process.env.BROWSER_AGENT_ENGINE_PRIORITY = savedEnv.BROWSER_AGENT_ENGINE_PRIORITY;

    if (savedEnv.LIGHTPANDA_CDP_URL === undefined) delete process.env.LIGHTPANDA_CDP_URL;
    else process.env.LIGHTPANDA_CDP_URL = savedEnv.LIGHTPANDA_CDP_URL;
  }
}

run().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: err.message,
    details: err.details || null,
  }, null, 2));
  process.exitCode = 1;
});
