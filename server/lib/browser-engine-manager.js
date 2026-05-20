import {
  lightpandaClickBySelector,
  lightpandaClickByText,
  lightpandaSnapshotCurrent,
  lightpandaStatus,
} from "./lightpanda-client.js";

const DEFAULT_CDP_URL = "ws://127.0.0.1:9222";
const VALID_ENGINES = new Set([
  "chrome_cdp",
  "lightpanda_cdp",
  "lightpanda_native_mcp",
  "static_fetch",
]);

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function safeText(value, limit = 4000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

function isHttpUrl(value = "") {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isLikelyUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) return true;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) return false;
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#][^\s]*)?$/i.test(raw);
}

function normalizeUrlInput(value = "") {
  const raw = String(value || "").trim();
  if (!isLikelyUrl(raw)) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function absoluteUrl(value = "", base = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, base || undefined).href;
  } catch {
    return raw;
  }
}

function normalizeQuery(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueEntries(entries = [], keyFn = (entry) => entry.href || entry.text || entry.selector || "") {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = safeText(keyFn(entry), 600).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function engineNameFromEnv() {
  return String(process.env.BROWSER_ENGINE || "auto").trim().toLowerCase();
}

function chromeCdpConfigured() {
  const requested = engineNameFromEnv();
  return requested === "chrome" || Boolean(process.env.CHROME_CDP_URL || process.env.BROWSER_CDP_URL);
}

function configuredEnginePriority(mode = "browser") {
  const explicitPriority = String(process.env.BROWSER_AGENT_ENGINE_PRIORITY || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => VALID_ENGINES.has(entry));

  const requested = engineNameFromEnv();
  const nativeEnabled = envFlag("LIGHTPANDA_NATIVE_MCP_ENABLED", false);

  let defaults;
  if (requested === "chrome") {
    defaults = ["chrome_cdp", "static_fetch"];
  } else if (requested === "lightpanda") {
    defaults = [
      ...(nativeEnabled ? ["lightpanda_native_mcp"] : []),
      "lightpanda_cdp",
      "static_fetch",
    ];
  } else if (String(mode || "").toLowerCase() === "scraper") {
    defaults = [
      ...(nativeEnabled ? ["lightpanda_native_mcp"] : []),
      "lightpanda_cdp",
      ...(chromeCdpConfigured() ? ["chrome_cdp"] : []),
      "static_fetch",
    ];
  } else {
    defaults = [
      ...(chromeCdpConfigured() ? ["chrome_cdp"] : []),
      "lightpanda_cdp",
      "static_fetch",
    ];
  }

  const priority = explicitPriority.length ? explicitPriority : defaults;
  return Array.from(new Set(priority.filter((entry) =>
    entry !== "lightpanda_native_mcp" || nativeEnabled
  )));
}

function cdpUrlForEngine(engine) {
  if (engine === "chrome_cdp") {
    return String(process.env.CHROME_CDP_URL || process.env.BROWSER_CDP_URL || DEFAULT_CDP_URL).trim();
  }
  if (engine === "lightpanda_cdp") {
    return String(process.env.LIGHTPANDA_CDP_URL || process.env.BROWSER_CDP_URL || DEFAULT_CDP_URL).trim();
  }
  return "";
}

function productText(status = {}) {
  return safeText([
    status.version?.product,
    status.version?.userAgent,
    status.version?.jsVersion,
  ].filter(Boolean).join(" "), 1000);
}

function engineMatchesProduct(engine, status = {}) {
  const product = productText(status);
  if (!status?.ok) return false;
  if (engine === "chrome_cdp") return /\b(chrome|chromium|headlesschrome)\b/i.test(product);
  if (engine === "lightpanda_cdp") return !/\b(chrome|chromium|headlesschrome)\b/i.test(product) || /\blightpanda\b/i.test(product);
  return true;
}

async function cdpEngineHealth(engine) {
  const cdpUrl = cdpUrlForEngine(engine);
  if (!cdpUrl) {
    return { ok: false, engine, status: "down", error: "No CDP URL configured." };
  }

  const status = await lightpandaStatus({
    cdpUrl,
    engineName: engine,
    timeoutMs: Number(process.env.BROWSER_ENGINE_HEALTH_TIMEOUT_MS || 1800),
  });
  const matches = engineMatchesProduct(engine, status);

  return {
    ...status,
    ok: Boolean(status.ok && matches),
    engine,
    cdpUrl: status.cdpUrl || cdpUrl,
    product: productText(status),
    mismatch: status.ok && !matches
      ? `CDP endpoint did not identify as ${engine}.`
      : "",
  };
}

function emptyObservation(overrides = {}) {
  return {
    ok: false,
    url: "",
    title: "",
    textPreview: "",
    links: [],
    buttons: [],
    inputs: [],
    forms: [],
    interactiveElements: [],
    stats: {},
    ...overrides,
  };
}

function normalizeObservation(result = {}, context = {}) {
  const page = result?.observation || result?.page || result?.scrape || {};
  const requestedUrl = normalizeUrlInput(
    result?.requestedUrl ||
    result?.target?.requestedUrl ||
    context.requestedUrl ||
    context.url ||
    context.currentUrl ||
    ""
  );
  const verifiedUrl = result?.navigationVerified && requestedUrl ? requestedUrl : "";
  const url = normalizeUrlInput(page.url || verifiedUrl || "");
  const textPreview = safeText(page.textPreview || page.text || page.markdown || "", 5000);
  const links = uniqueEntries(Array.isArray(page.links) ? page.links : [])
    .map((link, index) => ({
      index: link.index ?? index,
      text: safeText(link.text || link.label || link.name || link.href || "", 220),
      href: absoluteUrl(link.href || "", url || requestedUrl),
      selector: safeText(link.selector || "", 300),
      role: link.role || "link",
      tag: link.tag || "a",
    }))
    .filter((link) => link.href || link.text)
    .slice(0, 160);
  const buttons = uniqueEntries(Array.isArray(page.buttons) ? page.buttons : [], (button) => button.selector || button.text || button.label || "")
    .map((button, index) => ({
      index: button.index ?? index,
      text: safeText(button.text || button.label || button.name || "", 220),
      selector: safeText(button.selector || "", 300),
      tag: button.tag || "",
      type: button.type || "",
      role: button.role || "button",
    }))
    .filter((button) => button.text || button.selector)
    .slice(0, 120);
  const forms = Array.isArray(page.forms) ? page.forms.slice(0, 30) : [];
  const inputs = Array.isArray(page.inputs)
    ? page.inputs.slice(0, 120)
    : forms.flatMap((form) => Array.isArray(form.fields) ? form.fields : []).slice(0, 120);
  const interactiveElements = uniqueEntries([
    ...(Array.isArray(page.interactiveElements) ? page.interactiveElements : []),
    ...links,
    ...buttons,
  ], (entry) => entry.href || entry.selector || entry.text || entry.label || entry.name || "")
    .map((entry, index) => ({
      index: entry.index ?? index,
      role: entry.role || "",
      tag: entry.tag || "",
      type: entry.type || "",
      text: safeText(entry.text || entry.label || entry.name || entry.href || "", 220),
      selector: safeText(entry.selector || "", 300),
      href: absoluteUrl(entry.href || "", url || requestedUrl),
      name: entry.name || "",
      id: entry.id || "",
      secret: Boolean(entry.secret),
    }))
    .slice(0, 220);

  return emptyObservation({
    ok: Boolean(result?.ok),
    url,
    title: safeText(page.title || "", 500),
    textPreview,
    links,
    buttons,
    inputs,
    forms,
    interactiveElements,
    stats: {
      ...(page.stats || {}),
      links: links.length,
      buttons: buttons.length,
      inputs: inputs.length,
      forms: forms.length,
      interactiveElements: interactiveElements.length,
    },
    requestedUrl,
    navigationVerified: Boolean(result?.navigationVerified),
    engine: context.engine || result?.engine || "",
    snapshotError: result?.snapshotError || page.snapshotError || "",
    extractionErrors: page.extractionErrors || result?.extractionErrors || [],
    error: result?.error || page.error || "",
  });
}

export function isValidObservation(observation = {}) {
  const url = String(observation.url || "").trim();
  const requestedUrl = String(observation.requestedUrl || "").trim();
  const hasUrl = isHttpUrl(url) || (observation.navigationVerified && isHttpUrl(requestedUrl));
  const aboutBlank = !url || /^about:blank$/i.test(url) || /^about:blank$/i.test(requestedUrl);
  const dataCount =
    safeText(observation.title || "", 1000).length +
    safeText(observation.textPreview || observation.text || "", 6000).length +
    (Array.isArray(observation.links) ? observation.links.length : 0) +
    (Array.isArray(observation.buttons) ? observation.buttons.length : 0) +
    (Array.isArray(observation.forms) ? observation.forms.length : 0) +
    (Array.isArray(observation.interactiveElements) ? observation.interactiveElements.length : 0);
  const hasReadableData =
    safeText(observation.title || "", 1000).length > 0 ||
    safeText(observation.textPreview || observation.text || "", 6000).length > 20 ||
    (Array.isArray(observation.links) && observation.links.length > 0) ||
    (Array.isArray(observation.buttons) && observation.buttons.length > 0) ||
    (Array.isArray(observation.forms) && observation.forms.length > 0) ||
    (Array.isArray(observation.interactiveElements) && observation.interactiveElements.length > 0);
  const fatalTextOnly = dataCount <= safeText(observation.textPreview || "", 6000).length + safeText(observation.title || "", 1000).length &&
    /\b(Runtime\.evaluate|CDP timeout|could not evaluate page DOM|connection closed|connect timeout)\b/i.test(
      `${observation.textPreview || ""} ${observation.error || ""} ${observation.snapshotError || ""}`
    ) &&
    !observation.links?.length &&
    !observation.buttons?.length &&
    !observation.forms?.length &&
    !observation.interactiveElements?.length;

  return Boolean(hasUrl && !aboutBlank && hasReadableData && !fatalTextOnly);
}

function resultPreview(observation = {}) {
  return {
    url: observation.url || "",
    title: observation.title || "",
    textPreview: safeText(observation.textPreview || "", 600),
    links: (observation.links || []).slice(0, 8).map((link) => ({ text: link.text, href: link.href })),
    buttons: (observation.buttons || []).slice(0, 8).map((button) => ({ text: button.text, selector: button.selector })),
    engine: observation.engine || "",
  };
}

function attemptFromResult(engine, result = {}, valid = false) {
  return {
    engine,
    ok: Boolean(result.ok),
    valid: Boolean(valid),
    status: result.status || (valid ? "success" : "invalid_observation"),
    error: result.error || result.observation?.error || result.observation?.snapshotError || result.mismatch || "",
    requestedUrl: result.requestedUrl || result.observation?.requestedUrl || "",
    currentUrl: result.observation?.url || "",
  };
}

function successResponse(action, result, attempts, extra = {}) {
  const observation = result.observation;
  return {
    ok: true,
    status: "success",
    action,
    engine: observation.engine || result.engine || "",
    requestedUrl: result.requestedUrl || observation.requestedUrl || "",
    currentUrl: observation.url || "",
    currentTitle: observation.title || "",
    observation,
    attempts,
    steps: [
      {
        type: action === "observe" || action === "navigate" ? "observe" : "action",
        tool: action,
        engine: observation.engine || result.engine || "",
        ok: true,
        valid: true,
        resultPreview: resultPreview(observation),
      },
    ],
    ...extra,
  };
}

function failedResponse(action, attempts, extra = {}) {
  const last = [...attempts].reverse().find((attempt) => attempt.currentUrl || attempt.error) || attempts[attempts.length - 1] || {};
  return {
    ok: false,
    status: "failed",
    action,
    engine: last.engine || "",
    requestedUrl: extra.requestedUrl || last.requestedUrl || "",
    currentUrl: "",
    currentTitle: "",
    observation: extra.observation || null,
    attempts,
    steps: attempts.map((attempt) => ({
      type: action === "observe" || action === "navigate" ? "observe" : "action",
      tool: action,
      engine: attempt.engine,
      ok: Boolean(attempt.ok),
      valid: Boolean(attempt.valid),
      error: attempt.error || "",
      requestedUrl: attempt.requestedUrl || "",
      currentUrl: attempt.currentUrl || "",
    })),
    error: extra.error || last.error || "Browser observation failed.",
    ...extra,
  };
}

async function observeWithCdpEngine(engine, args = {}) {
  const requestedUrl = normalizeUrlInput(args.url || args.currentUrl || "");
  const health = await cdpEngineHealth(engine);
  if (!health.ok) {
    return {
      ok: false,
      status: "engine_unavailable",
      engine,
      requestedUrl,
      error: health.mismatch || health.error || "CDP engine is unavailable.",
      health,
      observation: emptyObservation({ engine, requestedUrl, error: health.error || health.mismatch || "" }),
    };
  }

  const raw = await lightpandaSnapshotCurrent({
    ...(args.url
      ? { url: requestedUrl, navigate: args.navigate !== false }
      : { currentUrl: requestedUrl }),
    waitMs: args.waitMs || "900",
    cdpUrl: cdpUrlForEngine(engine),
    engineName: engine,
  });
  const observation = normalizeObservation(raw, { engine, requestedUrl });
  return {
    ok: Boolean(raw?.ok),
    status: raw?.ok ? "observed" : "failed",
    engine,
    requestedUrl,
    raw,
    observation,
    error: raw?.error || observation.error || observation.snapshotError || "",
  };
}

function decodeHtml(value = "") {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(value = "") {
  return decodeHtml(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function extractStaticLinks(html = "", baseUrl = "") {
  const links = [];
  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRe.exec(html)) && links.length < 160) {
    const attrs = match[1] || "";
    const href = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawHref = href?.[1] || href?.[2] || href?.[3] || "";
    if (!rawHref || /^javascript:/i.test(rawHref)) continue;
    const text = stripHtml(match[2] || "") || absoluteUrl(rawHref, baseUrl);
    links.push({
      index: links.length,
      text: safeText(text, 220),
      href: absoluteUrl(rawHref, baseUrl),
      selector: "",
      role: "link",
      tag: "a",
    });
  }

  return uniqueEntries(links).slice(0, 160);
}

async function observeWithStaticFetch(args = {}) {
  const requestedUrl = normalizeUrlInput(args.url || args.currentUrl || "");
  if (!requestedUrl) {
    return {
      ok: false,
      status: "needs_url",
      engine: "static_fetch",
      requestedUrl,
      error: "static_fetch requires an http(s) URL.",
      observation: emptyObservation({ engine: "static_fetch", requestedUrl }),
    };
  }

  const response = await fetch(requestedUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "re.Term browser_agent static_fetch/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
    },
    signal: AbortSignal.timeout(Math.max(1000, Math.min(Number(args.timeoutMs || 9000), 15000))),
  });
  const html = await response.text();
  const finalUrl = response.url || requestedUrl;
  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const links = extractStaticLinks(html, finalUrl);
  const textPreview = stripHtml(html).slice(0, 5000);
  const observation = normalizeObservation({
    ok: response.ok,
    requestedUrl,
    navigationVerified: response.ok,
    page: {
      url: finalUrl,
      title,
      textPreview,
      links,
      buttons: [],
      forms: [],
      interactiveElements: links,
      stats: { status: response.status, contentType: response.headers.get("content-type") || "" },
    },
  }, { engine: "static_fetch", requestedUrl });

  return {
    ok: response.ok,
    status: response.ok ? "observed" : "http_error",
    engine: "static_fetch",
    requestedUrl,
    observation,
    error: response.ok ? "" : `HTTP ${response.status}`,
  };
}

async function observeWithNativeMcp(args = {}) {
  const requestedUrl = normalizeUrlInput(args.url || args.currentUrl || "");
  return {
    ok: false,
    status: "engine_unavailable",
    engine: "lightpanda_native_mcp",
    requestedUrl,
    error: "Lightpanda native MCP is configured as an optional future engine, but stdio tool bridging is not wired in this process yet.",
    observation: emptyObservation({ engine: "lightpanda_native_mcp", requestedUrl }),
  };
}

async function runObserveAttempt(engine, args = {}) {
  if (engine === "static_fetch") return observeWithStaticFetch(args);
  if (engine === "lightpanda_native_mcp") return observeWithNativeMcp(args);
  return observeWithCdpEngine(engine, args);
}

async function observeAcrossEngines(action, args = {}) {
  const requestedUrl = normalizeUrlInput(args.url || args.currentUrl || "");
  const attempts = [];
  const priority = args.enginePriority || configuredEnginePriority(args.mode || "browser");

  for (const engine of priority) {
    let result;
    try {
      result = await runObserveAttempt(engine, args);
    } catch (err) {
      result = {
        ok: false,
        status: "engine_error",
        engine,
        requestedUrl,
        error: err instanceof Error ? err.message : String(err),
        observation: emptyObservation({
          engine,
          requestedUrl,
          error: err instanceof Error ? err.message : String(err),
        }),
      };
    }

    const valid = isValidObservation(result.observation);
    attempts.push(attemptFromResult(engine, result, valid));
    if (result.ok && valid) return successResponse(action, result, attempts);
  }

  return failedResponse(action, attempts, {
    requestedUrl,
    status: "failed",
    error: "All configured browser engines failed to produce a valid observation.",
  });
}

export async function browserObserve(args = {}) {
  const currentUrl = normalizeUrlInput(args.url || args.currentUrl || "");
  if (!currentUrl) {
    return failedResponse("observe", [], {
      status: "needs_user",
      error: "No valid current page is loaded.",
    });
  }
  return observeAcrossEngines("observe", {
    ...args,
    ...(args.url ? { url: currentUrl } : { currentUrl }),
    navigate: Boolean(args.url && args.navigate !== false),
  });
}

export async function browserNavigate(args = {}) {
  const url = normalizeUrlInput(args.url || args.currentUrl || args.query || "");
  if (!url) {
    return failedResponse("navigate", [], {
      status: "needs_user",
      error: "A valid http(s) URL is required.",
    });
  }
  return observeAcrossEngines("navigate", {
    ...args,
    url,
    navigate: true,
  });
}

function scoreCandidate(candidate = {}, query = "", baseUrl = "") {
  const wanted = normalizeQuery(query);
  if (!wanted) return 0;
  const text = normalizeQuery(candidate.text || candidate.label || candidate.name || "");
  const href = normalizeQuery(candidate.href || "");
  let hrefPath = "";
  try {
    hrefPath = candidate.href
      ? normalizeQuery(new URL(candidate.href, baseUrl || undefined).pathname).replace(/\bhtml?\b/g, " ")
      : "";
  } catch {
    hrefPath = "";
  }

  if (text === wanted) return 1;
  if (text && (text.includes(wanted) || wanted.includes(text))) return 0.9;
  if (hrefPath && hrefPath.split(" ").includes(wanted)) return 0.78;
  if (href.includes(wanted)) return 0.65;
  return 0;
}

function findTextTarget(observation = {}, text = "") {
  const baseUrl = observation.url || observation.requestedUrl || "";
  const candidates = [
    ...(observation.links || []).map((entry) => ({ ...entry, kind: "link", preferred: 2 })),
    ...(observation.buttons || []).map((entry) => ({ ...entry, kind: "button", preferred: 1 })),
    ...(observation.interactiveElements || []).map((entry) => ({
      ...entry,
      kind: entry.href || /link/i.test(String(entry.role || entry.tag || "")) ? "link" : "interactive",
      preferred: entry.href ? 2 : 0,
    })),
  ];

  return candidates
    .map((entry) => ({
      entry,
      score: scoreCandidate(entry, text, baseUrl) + Number(entry.preferred || 0) / 100,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.entry || null;
}

function validCurrentUrl(args = {}) {
  return normalizeUrlInput(
    args.currentUrl ||
    args.url ||
    args.observation?.url ||
    args.lastValidObservation?.url ||
    args.state?.currentUrl ||
    args.state?.lastValidObservation?.url ||
    ""
  );
}

export async function browserClickByHref(args = {}) {
  const currentUrl = validCurrentUrl(args);
  const href = absoluteUrl(args.href || args.url || "", currentUrl);
  if (!isHttpUrl(href)) {
    return failedResponse("browserClickByHref", [], {
      status: "needs_user",
      requestedUrl: href,
      error: "A valid http(s) href is required.",
    });
  }
  const result = await browserNavigate({ ...args, url: href });
  return {
    ...result,
    action: "browserClickByHref",
    targetHref: href,
    steps: [
      ...(result.steps || []),
    ].map((step) => ({ ...step, tool: "browserClickByHref" })),
  };
}

async function clickWithCdpEngines(action, args = {}) {
  const currentUrl = validCurrentUrl(args);
  const requestedUrl = currentUrl;
  const attempts = [];
  const priority = (args.enginePriority || configuredEnginePriority(args.mode || "browser"))
    .filter((engine) => engine === "chrome_cdp" || engine === "lightpanda_cdp");

  if (!currentUrl) {
    return failedResponse(action, attempts, {
      status: "needs_user",
      error: "No valid current page is loaded.",
    });
  }

  for (const engine of priority) {
    let result;
    try {
      const health = await cdpEngineHealth(engine);
      if (!health.ok) {
        result = {
          ok: false,
          status: "engine_unavailable",
          engine,
          requestedUrl,
          error: health.mismatch || health.error || "CDP engine is unavailable.",
          observation: emptyObservation({ engine, requestedUrl, error: health.error || health.mismatch || "" }),
        };
      } else {
        const raw = action === "browserClickBySelector"
          ? await lightpandaClickBySelector({
              currentUrl,
              selector: args.selector,
              waitMs: args.waitMs || "1200",
              cdpUrl: cdpUrlForEngine(engine),
              engineName: engine,
            })
          : await lightpandaClickByText({
              currentUrl,
              text: args.text,
              waitMs: args.waitMs || "1200",
              cdpUrl: cdpUrlForEngine(engine),
              engineName: engine,
            });
        const observation = normalizeObservation(raw, { engine, requestedUrl });
        result = {
          ok: Boolean(raw?.ok),
          status: raw?.ok ? "clicked" : "failed",
          engine,
          requestedUrl,
          raw,
          observation,
          error: raw?.error || raw?.actionResult?.error || observation.error || observation.snapshotError || "",
        };
      }
    } catch (err) {
      result = {
        ok: false,
        status: "engine_error",
        engine,
        requestedUrl,
        error: err instanceof Error ? err.message : String(err),
        observation: emptyObservation({ engine, requestedUrl, error: err instanceof Error ? err.message : String(err) }),
      };
    }

    const valid = isValidObservation(result.observation);
    attempts.push(attemptFromResult(engine, result, valid));
    if (result.ok && valid) return successResponse(action, result, attempts);
  }

  return failedResponse(action, attempts, {
    requestedUrl,
    error: "No CDP browser engine clicked the target and produced a valid observation.",
  });
}

export async function browserClickBySelector(args = {}) {
  if (!String(args.selector || "").trim()) {
    return failedResponse("browserClickBySelector", [], {
      status: "needs_user",
      error: "A selector is required.",
    });
  }
  return clickWithCdpEngines("browserClickBySelector", args);
}

export async function browserClickByText(args = {}) {
  const targetText = safeText(args.text || args.label || args.buttonText || args.linkText || "", 180);
  const currentUrl = validCurrentUrl(args);

  if (!currentUrl) {
    return failedResponse("browserClickByText", [], {
      status: "needs_user",
      error: "No valid current page is loaded.",
    });
  }
  if (!targetText) {
    return failedResponse("browserClickByText", [], {
      status: "needs_user",
      requestedUrl: currentUrl,
      error: "Visible button or link text is required.",
    });
  }

  const observed = isValidObservation(args.observation)
    ? {
        ok: true,
        status: "success",
        observation: args.observation,
        attempts: [],
        steps: [],
      }
    : await browserObserve({
        ...args,
        url: currentUrl,
        navigate: true,
      });

  if (!observed.ok || !isValidObservation(observed.observation)) {
    return {
      ...observed,
      action: "browserClickByText",
      targetText,
      status: observed.status === "needs_user" ? "needs_user" : "failed",
    };
  }

  const target = findTextTarget(observed.observation, targetText);
  if (!target) {
    return failedResponse("browserClickByText", observed.attempts || [], {
      status: "needs_user",
      requestedUrl: currentUrl,
      observation: observed.observation,
      error: `Could not find visible text matching "${targetText}".`,
      targetText,
    });
  }

  const href = absoluteUrl(target.href || "", observed.observation.url || currentUrl);
  if (href && isHttpUrl(href)) {
    const navigated = await browserClickByHref({
      ...args,
      currentUrl: observed.observation.url || currentUrl,
      href,
    });
    return {
      ...navigated,
      action: "browserClickByText",
      targetText,
      matchedElement: target,
      steps: [
        ...(observed.steps || []),
        {
          type: "action",
          tool: "browserClickByHref",
          engine: navigated.engine || "",
          ok: Boolean(navigated.ok),
          valid: Boolean(isValidObservation(navigated.observation)),
          targetText,
          href,
        },
        ...(navigated.steps || []),
      ],
      attempts: [
        ...(observed.attempts || []),
        ...(navigated.attempts || []),
      ],
    };
  }

  const clicked = target.selector
    ? await browserClickBySelector({ ...args, currentUrl: observed.observation.url || currentUrl, selector: target.selector })
    : await clickWithCdpEngines("browserClickByText", { ...args, currentUrl: observed.observation.url || currentUrl, text: targetText });

  return {
    ...clicked,
    targetText,
    matchedElement: target,
    attempts: [
      ...(observed.attempts || []),
      ...(clicked.attempts || []),
    ],
    steps: [
      ...(observed.steps || []),
      ...(clicked.steps || []),
    ],
  };
}

export async function browserInteractiveElements(args = {}) {
  const observed = await browserObserve(args);
  return {
    ...observed,
    action: "browserInteractiveElements",
    interactiveElements: observed.observation?.interactiveElements || [],
    links: observed.observation?.links || [],
    buttons: observed.observation?.buttons || [],
    forms: observed.observation?.forms || [],
  };
}

export async function browserHealth(args = {}) {
  const priority = configuredEnginePriority(args.mode || "browser");
  const engines = [];

  for (const engine of priority) {
    if (engine === "static_fetch") {
      engines.push({ ok: true, engine, status: "ready", capability: "read-only text and links" });
    } else if (engine === "lightpanda_native_mcp") {
      engines.push({
        ok: envFlag("LIGHTPANDA_NATIVE_MCP_ENABLED", false),
        engine,
        status: envFlag("LIGHTPANDA_NATIVE_MCP_ENABLED", false) ? "configured_stub" : "disabled",
        command: process.env.LIGHTPANDA_NATIVE_MCP_COMMAND || "lightpanda",
        args: process.env.LIGHTPANDA_NATIVE_MCP_ARGS || "mcp",
        note: "Native MCP interface is stubbed here until stdio tool bridging is added.",
      });
    } else {
      engines.push(await cdpEngineHealth(engine));
    }
  }

  return {
    ok: engines.some((engine) => engine.ok),
    status: engines.some((engine) => engine.ok) ? "ready" : "down",
    browserEngine: engineNameFromEnv(),
    priority,
    engines,
  };
}
