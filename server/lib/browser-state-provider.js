import {
  browserObserve,
  isValidObservation,
} from "./browser-engine-manager.js";
import { lightpandaInstantScrape } from "./lightpanda-client.js";
import {
  browserAgentEnginePolicy,
  browserEngineCapabilities,
} from "./browser-engine-capabilities.js";

function safeText(value = "", limit = 4000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeUrlInput(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) return "";
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#][^\s]*)?$/i.test(raw)) return `https://${raw}`;
  return "";
}

function requestedUrlFromArgs(args = {}) {
  return normalizeUrlInput(
    args.url ||
    args.currentUrl ||
    args.state?.currentUrl ||
    args.state?.lastValidObservation?.url ||
    args.lastValidObservation?.url ||
    ""
  );
}

function sliceArray(value, limit = 40) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function compactLink(link = {}, index = 0) {
  return {
    ref: link.ref || `lp_link_${index}`,
    index: link.index ?? index,
    role: link.role || "link",
    tag: link.tag || "a",
    text: safeText(link.text || link.label || link.name || link.href || "", 220),
    href: link.href || "",
    selector: safeText(link.selector || "", 320),
  };
}

function compactButton(button = {}, index = 0) {
  return {
    ref: button.ref || `lp_button_${index}`,
    index: button.index ?? index,
    role: button.role || "button",
    tag: button.tag || "button",
    type: button.type || "",
    text: safeText(button.text || button.label || button.name || "", 220),
    selector: safeText(button.selector || "", 500),
    id: button.id || "",
    name: button.name || "",
    ariaLabel: button.ariaLabel || button.aria || "",
    title: button.title || "",
    value: button.value || "",
    attrs: button.attrs && typeof button.attrs === "object" ? button.attrs : {},
    raw: button.raw && typeof button.raw === "object" ? button.raw : null,
  };
}

function compactInput(input = {}, index = 0) {
  const label = safeText(
    input.label ||
    input.text ||
    input.ariaLabel ||
    input.placeholder ||
    input.name ||
    input.id ||
    "",
    220
  );

  return {
    ref: input.ref || `lp_input_${index}`,
    index: input.index ?? index,
    role: input.role || input.type || "input",
    tag: input.tag || "input",
    type: input.secret ? "password" : input.type || "",
    label,
    name: input.name || "",
    id: input.id || "",
    placeholder: input.placeholder || "",
    ariaLabel: input.ariaLabel || "",
    required: Boolean(input.required),
    secret: Boolean(input.secret),
    selector: safeText(input.selector || "", 320),
  };
}

function compactForm(form = {}, index = 0) {
  const fields = sliceArray(form.fields, 80).map(compactInput);
  const buttons = sliceArray(form.buttons, 30).map(compactButton);

  return {
    ref: form.ref || `lp_form_${index}`,
    index: form.index ?? index,
    action: form.action || "",
    method: form.method || "",
    selector: safeText(form.selector || "", 320),
    fields,
    buttons,
  };
}

function compactInteractiveElement(element = {}, index = 0) {
  return {
    ref: element.ref || `lp_el_${index}`,
    index: element.index ?? index,
    role: element.role || "",
    tag: element.tag || "",
    type: element.type || "",
    text: safeText(element.text || element.label || element.name || element.href || "", 220),
    href: element.href || "",
    selector: safeText(element.selector || "", 500),
    name: element.name || "",
    id: element.id || "",
    ariaLabel: element.ariaLabel || element.aria || "",
    title: element.title || "",
    placeholder: element.placeholder || "",
    secret: Boolean(element.secret),
    attrs: element.attrs && typeof element.attrs === "object" ? element.attrs : {},
    raw: element.raw && typeof element.raw === "object" ? element.raw : null,
  };
}

function candidatesFromState(state = {}) {
  const candidates = [];

  for (const link of state.links || []) {
    candidates.push({
      ref: link.ref,
      source: "lightpanda_read_only",
      kind: "link",
      role: "link",
      text: link.text,
      href: link.href,
      selector: link.selector,
      confidence: link.selector || link.href ? 0.88 : 0.62,
    });
  }

  for (const button of state.buttons || []) {
    candidates.push({
      ref: button.ref,
      source: "lightpanda_read_only",
      kind: "button",
      role: button.role || "button",
      text: button.text,
      selector: button.selector,
      confidence: button.selector ? 0.86 : 0.58,
    });
  }

  for (const input of state.inputs || []) {
    candidates.push({
      ref: input.ref,
      source: "lightpanda_read_only",
      kind: "input",
      role: input.role || input.type || "input",
      text: input.label || input.placeholder || input.name || input.id,
      selector: input.selector,
      name: input.name,
      id: input.id,
      placeholder: input.placeholder,
      secret: Boolean(input.secret),
      confidence: input.selector ? 0.86 : input.name || input.id ? 0.72 : 0.52,
    });
  }

  return candidates
    .filter((candidate) => candidate.text || candidate.href || candidate.selector || candidate.name || candidate.id)
    .slice(0, 260);
}

function stateFromObservation(observation = {}, result = {}, args = {}) {
  const links = sliceArray(observation.links, 160).map(compactLink);
  const buttons = sliceArray(observation.buttons, 120).map(compactButton);
  const inputs = sliceArray(observation.inputs, 120).map(compactInput);
  const forms = sliceArray(observation.forms, 30).map(compactForm);
  const interactiveElements = sliceArray(observation.interactiveElements, 220).map(compactInteractiveElement);

  const state = {
    ok: Boolean(result?.ok && isValidObservation(observation)),
    status: result?.status || (result?.ok ? "observed" : "failed"),
    source: "lightpanda_read_only",
    role: "read_only_page_state",
    engine: observation.engine || result?.engine || "",
    capabilities: browserEngineCapabilities(observation.engine || "lightpanda_cdp"),
    policy: browserAgentEnginePolicy(),
    requestedUrl: observation.requestedUrl || requestedUrlFromArgs(args),
    url: observation.url || "",
    title: observation.title || "",
    text: safeText(observation.text || observation.textPreview || "", 16000),
    textPreview: safeText(observation.textPreview || observation.text || "", 5000),
    markdown: safeText(observation.markdown || "", 20000),
    accessibility: observation.accessibility || null,
    links,
    buttons,
    inputs,
    forms,
    interactiveElements,
    stats: {
      ...(observation.stats || {}),
      links: links.length,
      buttons: buttons.length,
      inputs: inputs.length,
      forms: forms.length,
      interactiveElements: interactiveElements.length,
    },
    extractionPath: observation.extractionPath || "",
    extractionSources: Array.isArray(observation.extractionSources) ? observation.extractionSources : [],
    extractionCapabilities: observation.extractionCapabilities || {},
    extractionErrors: observation.extractionErrors || [],
    error: result?.error || observation.error || observation.snapshotError || "",
    attempts: Array.isArray(result?.attempts) ? result.attempts : [],
    rawObservation: args.includeRaw === true ? observation : null,
  };

  return {
    ...state,
    candidates: candidatesFromState(state),
  };
}

function mergeScrapeData(state = {}, scrapeResult = {}) {
  const scrape = scrapeResult?.scrape || {};
  if (!scrapeResult?.ok || !scrape || typeof scrape !== "object") return state;

  return {
    ...state,
    scrape: {
      ok: true,
      url: scrape.url || state.url,
      title: scrape.title || state.title,
      textPreview: safeText(scrape.textPreview || "", 3000),
      tables: sliceArray(scrape.tables, 12),
      repeatedGroups: sliceArray(scrape.repeatedGroups, 4),
      links: sliceArray(scrape.links, 120),
      stats: scrape.stats || {},
    },
    tables: sliceArray(scrape.tables, 12),
    repeatedGroups: sliceArray(scrape.repeatedGroups, 4),
    stats: {
      ...(state.stats || {}),
      scrapeTables: Array.isArray(scrape.tables) ? scrape.tables.length : 0,
      scrapeRepeatedGroups: Array.isArray(scrape.repeatedGroups) ? scrape.repeatedGroups.length : 0,
    },
  };
}

export async function getBrowserState(args = {}) {
  const requestedUrl = requestedUrlFromArgs(args);
  const mode = String(args.mode || args.stateMode || "browser").toLowerCase();

  if (!requestedUrl) {
    return {
      ok: false,
      status: "needs_url",
      source: "lightpanda_read_only",
      role: "read_only_page_state",
      engine: "",
      capabilities: browserEngineCapabilities("lightpanda_cdp"),
      policy: browserAgentEnginePolicy(),
      requestedUrl: "",
      url: "",
      title: "",
      text: "",
      textPreview: "",
      markdown: "",
      links: [],
      buttons: [],
      inputs: [],
      forms: [],
      interactiveElements: [],
      candidates: [],
      stats: {},
      error: "A valid current URL is required for browser state.",
    };
  }

  const observed = await browserObserve({
    ...args,
    url: args.url ? requestedUrl : undefined,
    currentUrl: args.url ? undefined : requestedUrl,
    navigate: args.url ? args.navigate !== false : args.navigate === true,
    mode: "scraper",
    enginePriority: ["lightpanda_cdp", "static_fetch"],
    waitMs: args.waitMs || "900",
    focus: args.focus || "page",
  });

  let state = stateFromObservation(observed.observation || {}, observed, {
    ...args,
    currentUrl: requestedUrl,
  });

  if (mode === "scrape" || args.includeScrape === true) {
    try {
      const scrape = await lightpandaInstantScrape({
        url: requestedUrl,
        waitMs: args.scrapeWaitMs || args.waitMs || "1200",
        cdpUrl: args.cdpUrl,
        engineName: "lightpanda_cdp",
      });
      state = mergeScrapeData(state, scrape);
    } catch (err) {
      state = {
        ...state,
        scrape: {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
        extractionErrors: [
          ...(Array.isArray(state.extractionErrors) ? state.extractionErrors : []),
          {
            name: "lightpandaInstantScrape",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  }

  return state;
}

export function compactBrowserStateForModel(state = null, options = {}) {
  if (!state) return null;
  const textLimit = Number(options.textLimit || 3000);
  const markdownLimit = Number(options.markdownLimit || 4000);

  return {
    ok: Boolean(state.ok),
    source: state.source || "lightpanda_read_only",
    engine: state.engine || "",
    url: state.url || "",
    title: state.title || "",
    textPreview: safeText(state.textPreview || state.text || "", textLimit),
    markdown: safeText(state.markdown || "", markdownLimit),
    links: sliceArray(state.links, Number(options.linkLimit || 40)),
    buttons: sliceArray(state.buttons, Number(options.buttonLimit || 40)),
    inputs: sliceArray(state.inputs, Number(options.inputLimit || 40)),
    forms: sliceArray(state.forms, Number(options.formLimit || 12)),
    candidates: sliceArray(state.candidates, Number(options.candidateLimit || 80)),
    tables: sliceArray(state.tables, Number(options.tableLimit || 8)),
    repeatedGroups: sliceArray(state.repeatedGroups, Number(options.groupLimit || 4)),
    stats: state.stats || {},
    policy: {
      lightpandaReadOnly: true,
      actionEngine: "playwright_mcp",
    },
    error: state.error || "",
  };
}
