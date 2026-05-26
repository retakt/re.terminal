import {
  lightpandaClickBySelector,
  lightpandaClickByText,
  lightpandaFillAndSubmit,
  lightpandaFillFields,
  lightpandaInstantScrape,
  lightpandaFindInteractiveElements,
  lightpandaNavigate,
  lightpandaSnapshotCurrent,
  lightpandaStatus,
  lightpandaSubmitForm,
} from "../../lightpanda-client.js";
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
    text,
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

  return { ok: true, reason: "Lightpanda verification passed.", nextSafeAction: "" };
}

function lightpandaObservation(result = {}) {
  return result?.page || result?.observation || result?.snapshot || result?.scrape || {};
}

function routeResult(tool = "", result = {}, command = {}) {
  const observation = lightpandaObservation(result);
  return {
    ...result,
    ok: Boolean(result?.ok),
    route: "lightpanda",
    backend: "lightpanda_cdp",
    tool: command.tool || tool,
    observation,
    snapshot: observation,
    error: result?.error || result?.snapshotError || "",
  };
}

export function createLightpandaEngine() {
  return {
    route: "lightpanda",
    backend: "lightpanda_cdp",

    async status(args = {}) {
      const status = await lightpandaStatus(args);
      return {
        ...status,
        route: "lightpanda",
        backend: "lightpanda_cdp",
      };
    },

    async warm(args = {}) {
      return this.status(args);
    },

    async navigate(command = {}, context = {}) {
      const result = await lightpandaNavigate({
        ...context,
        ...command.args,
        url: command.args?.url || context.currentUrl || "",
        currentUrl: context.currentUrl || "",
        cdpUrl: context.cdpUrl || command.args?.cdpUrl || "",
        engineName: "lightpanda_cdp",
      });
      return routeResult("browserNavigate", result, command);
    },

    async observe(command = {}, context = {}) {
      const result = await lightpandaSnapshotCurrent({
        ...context,
        url: command.args?.url || context.currentUrl || "",
        currentUrl: context.currentUrl || "",
        cdpUrl: context.cdpUrl || command.args?.cdpUrl || "",
        engineName: "lightpanda_cdp",
      });

      const observation = lightpandaObservation(result);
      return {
        ok: Boolean(result.ok),
        route: "lightpanda",
        backend: "lightpanda_cdp",
        tool: command.tool || "browserObserve",
        observation,
        snapshot: observation,
        extracted: extractFacts(observation, command.args?.query || command.args?.focus || ""),
        error: result.error || "",
      };
    },

    async click(command = {}, context = {}) {
      const args = {
        ...context,
        currentUrl: context.currentUrl || command.args?.currentUrl || "",
        cdpUrl: context.cdpUrl || command.args?.cdpUrl || "",
        engineName: "lightpanda_cdp",
        selector: command.args?.selector || "",
        text: command.args?.text || "",
        href: command.args?.href || "",
      };

      if (args.selector) {
        return routeResult("browserClickByText", await lightpandaClickBySelector(args), command);
      }
      return routeResult("browserClickByText", await lightpandaClickByText(args), command);
    },

    async fill(command = {}, context = {}) {
      const result = await lightpandaFillFields({
        ...context,
        currentUrl: context.currentUrl || command.args?.currentUrl || "",
        cdpUrl: context.cdpUrl || command.args?.cdpUrl || "",
        engineName: "lightpanda_cdp",
        fields: command.args?.fields || [],
      });
      return routeResult("browserFillFields", result, command);
    },

    async submit(command = {}, context = {}) {
      const args = {
        ...context,
        currentUrl: context.currentUrl || command.args?.currentUrl || "",
        cdpUrl: context.cdpUrl || command.args?.cdpUrl || "",
        engineName: "lightpanda_cdp",
        fields: command.args?.fields || [],
      };

      if (command.kind === "fill_and_submit") {
        return routeResult("browserFillAndSubmit", await lightpandaFillAndSubmit(args), command);
      }

      return routeResult("browserSubmitForm", await lightpandaSubmitForm(args), command);
    },

    async scroll(command = {}, context = {}) {
      return {
        ok: false,
        route: "lightpanda",
        backend: "lightpanda_cdp",
        tool: "browserScroll",
        observation: context.currentObservation || null,
        error: "Lightpanda scroll execution is not enabled for this route yet. Use Playwright for scroll-and-screenshot tasks.",
      };
    },

    async screenshot(command = {}, context = {}) {
      return {
        ok: false,
        route: "lightpanda",
        backend: "lightpanda_cdp",
        tool: "browserScreenshot",
        error: "Lightpanda route does not own screenshot capture in this architecture.",
      };
    },

    async scrape(command = {}, context = {}) {
      const result = await lightpandaInstantScrape({
        ...context,
        currentUrl: context.currentUrl || command.args?.currentUrl || "",
        cdpUrl: context.cdpUrl || command.args?.cdpUrl || "",
        engineName: "lightpanda_cdp",
      });

      const observation = lightpandaObservation(result);
      return {
        ok: Boolean(result.ok),
        route: "lightpanda",
        backend: "lightpanda_cdp",
        tool: "browserScrape",
        observation,
        snapshot: observation,
        extracted: extractFacts(observation, command.args?.query || ""),
        error: result.error || "",
      };
    },

    async extract(command = {}, context = {}) {
      const observed = await this.observe({ ...command, tool: "browserExtract" }, context);
      return {
        ...observed,
        tool: "browserExtract",
      };
    },

    async verify(command = {}, context = {}) {
      const observation = context.observation || context.beforeObservation || null;
      const verification = compareVerification(command.args || {}, observation || {}, context.result || {});
      return {
        ok: verification.ok,
        route: "lightpanda",
        backend: "lightpanda_cdp",
        tool: "browserVerify",
        verification,
        observation,
        error: verification.ok ? "" : verification.reason,
      };
    },

    async showActions(command = {}, context = {}) {
      const observed = await lightpandaFindInteractiveElements({
        ...context,
        currentUrl: context.currentUrl || command.args?.currentUrl || "",
        cdpUrl: context.cdpUrl || command.args?.cdpUrl || "",
        engineName: "lightpanda_cdp",
      });

      return {
        ok: Boolean(observed.ok),
        route: "lightpanda",
        backend: "lightpanda_cdp",
        tool: "browserShowActions",
        observation: lightpandaObservation(observed),
        snapshot: lightpandaObservation(observed),
        extracted: extractFacts(lightpandaObservation(observed), command.args?.query || "actions"),
        error: observed.error || "",
      };
    },
  };
}
