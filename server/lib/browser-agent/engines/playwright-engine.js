import {
  capturePlaywrightMcpSnapshot,
  executePlaywrightMcpBrowserCommand,
  snapshotImagesForModel,
} from "../../browser-playwright-mcp-bridge.js";
import { normalizeUrl, safeText } from "../shared.js";

function extractFacts(observation = {}, query = "") {
  const text = safeText(observation.textPreview || observation.text || "", 4000);
  const q = safeText(query || "", 200).toLowerCase();
  const match = (value = "") => !q || String(value || "").toLowerCase().includes(q);

  const links = Array.isArray(observation.links) ? observation.links : [];
  const buttons = Array.isArray(observation.buttons) ? observation.buttons : [];
  const inputs = Array.isArray(observation.inputs) ? observation.inputs : [];
  const forms = Array.isArray(observation.forms) ? observation.forms : [];

  return {
    url: observation.url || "",
    title: observation.title || "",
    textPreview: text,
    links: links.filter((entry) => match(entry.text || entry.label || entry.href || "")).slice(0, 40),
    buttons: buttons.filter((entry) => match(entry.text || entry.label || "")).slice(0, 40),
    inputs,
    forms,
    images: snapshotImagesForModel(observation.snapshot || null),
  };
}

function compareVerification(expected = {}, observation = {}, result = {}) {
  const expectedUrl = normalizeUrl(expected.expectedUrl || "");
  const expectedTitle = safeText(expected.expectedTitle || "", 240).toLowerCase();
  const expectedText = safeText(expected.expectedText || "", 240).toLowerCase();
  const observedText = safeText(observation.textPreview || observation.text || "", 4000).toLowerCase();
  const observedTitle = safeText(observation.title || "", 240).toLowerCase();

  if (expectedUrl && normalizeUrl(observation.url || "") !== expectedUrl) {
    return {
      ok: false,
      reason: `Expected URL ${expectedUrl} but observed ${observation.url || "unknown"}.`,
      nextSafeAction: "Open the requested page again and verify the address bar.",
    };
  }

  if (expectedTitle && !observedTitle.includes(expectedTitle)) {
    return {
      ok: false,
      reason: `Expected title to include ${expectedTitle}.`,
      nextSafeAction: "Reopen the page and verify the visible title.",
    };
  }

  if (expectedText && !observedText.includes(expectedText)) {
    return {
      ok: false,
      reason: `Expected visible text to include ${expectedText}.`,
      nextSafeAction: "Inspect the current page and confirm the visible content.",
    };
  }

  if (expected.expectedImage === true && !result?.snapshot?.imageBase64) {
    return {
      ok: false,
      reason: "A screenshot was requested, but no image evidence was returned.",
      nextSafeAction: "Capture the page screenshot again.",
    };
  }

  return { ok: true, reason: "Playwright verification passed.", nextSafeAction: "" };
}

export function createPlaywrightEngine() {
  return {
    route: "playwright",
    backend: "playwright_mcp",

    async status(args = {}) {
      const snapshot = await capturePlaywrightMcpSnapshot({ ...args, navigate: false, label: "status" });
      return {
        ok: Boolean(snapshot.ok),
        route: "playwright",
        backend: "playwright_mcp",
        observation: snapshot.observation,
        snapshot: snapshot.snapshot,
        images: snapshotImagesForModel(snapshot.snapshot),
        error: snapshot.error || "",
      };
    },

    async warm(args = {}) {
      return this.status(args);
    },

    async navigate(command = {}, context = {}) {
      return executePlaywrightMcpBrowserCommand({
        command: { ...command, tool: "browserNavigate" },
        args: {
          ...context,
          currentUrl: command.args?.url || context.currentUrl || "",
        },
        state: context.state || {},
        skipBeforeSnapshot: true,
        beforeObservation: context.currentObservation || null,
      });
    },

    async observe(command = {}, context = {}) {
      const snapshot = await capturePlaywrightMcpSnapshot({
        ...context,
        navigate: command.args?.url ? true : false,
        currentUrl: command.args?.url || context.currentUrl || "",
        label: command.tool || "observe",
      }, context.state || {});

      return {
        ok: Boolean(snapshot.ok),
        route: "playwright",
        backend: "playwright_mcp",
        tool: command.tool || "browserObserve",
        observation: snapshot.observation,
        snapshot: snapshot.snapshot,
        extracted: extractFacts(snapshot.observation, command.args?.query || command.args?.focus || ""),
        error: snapshot.error || "",
        images: snapshotImagesForModel(snapshot.snapshot),
      };
    },

    async click(command = {}, context = {}) {
      return executePlaywrightMcpBrowserCommand({
        command: { ...command, tool: "browserClickByText" },
        args: context,
        state: context.state || {},
        skipBeforeSnapshot: true,
        beforeObservation: context.currentObservation || null,
      });
    },

    async fill(command = {}, context = {}) {
      return executePlaywrightMcpBrowserCommand({
        command: { ...command, tool: command.kind === "fill_and_submit" ? "browserFillAndSubmit" : "browserFillFields" },
        args: context,
        state: context.state || {},
        skipBeforeSnapshot: true,
        beforeObservation: context.currentObservation || null,
      });
    },

    async submit(command = {}, context = {}) {
      const tool = command.kind === "fill_and_submit" ? "browserFillAndSubmit" : "browserSubmitForm";
      return executePlaywrightMcpBrowserCommand({
        command: { ...command, tool },
        args: context,
        state: context.state || {},
        skipBeforeSnapshot: true,
        beforeObservation: context.currentObservation || null,
      });
    },

    async screenshot(command = {}, context = {}) {
      const snapshot = await capturePlaywrightMcpSnapshot({
        ...context,
        navigate: false,
        currentUrl: context.currentUrl || "",
        label: "screenshot",
        includeScreenshot: true,
      }, context.state || {});

      return {
        ok: Boolean(snapshot.ok && snapshot.snapshot?.imageBase64),
        route: "playwright",
        backend: "playwright_mcp",
        tool: "browserScreenshot",
        observation: snapshot.observation,
        snapshot: snapshot.snapshot,
        error: snapshot.error || "",
        images: snapshotImagesForModel(snapshot.snapshot),
      };
    },

    async scrape(command = {}, context = {}) {
      const result = await this.observe({ ...command, tool: "browserScrape" }, context);
      return {
        ...result,
        tool: "browserScrape",
        extracted: result.extracted || extractFacts(result.observation || {}, command.args?.query || ""),
      };
    },

    async extract(command = {}, context = {}) {
      const result = await this.observe({ ...command, tool: "browserExtract" }, context);
      return {
        ...result,
        tool: "browserExtract",
        extracted: result.extracted || extractFacts(result.observation || {}, command.args?.query || ""),
      };
    },

    async verify(command = {}, context = {}) {
      const observation =
        context.observation ||
        context.currentObservation ||
        context.beforeObservation ||
        context.state?.lastValidObservation ||
        context.state?.lastObservation ||
        null;
      const verification = compareVerification(command.args || {}, observation || {}, context.result || {});
      return {
        ok: verification.ok,
        route: "playwright",
        backend: "playwright_mcp",
        tool: "browserVerify",
        verification,
        observation,
        error: verification.ok ? "" : verification.reason,
      };
    },

    async showActions(command = {}, context = {}) {
      return this.observe({ ...command, tool: "browserShowActions" }, context);
    },
  };
}
