import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  callExternalMcpTool,
  listExternalMcpTools,
} from "./external-mcp-client.js";

const SERVER_ID = "playwright";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, "..");
const PLAYWRIGHT_MCP_DIR = path.resolve(process.env.PLAYWRIGHT_MCP_OUTPUT_DIR || path.join(SERVER_ROOT, "playwright-mcp"));

function safeText(value = "", limit = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}


function parseMcpWrappedJsonSafe(value = "") {
  const raw = String(value || "").trim();
  const candidates = [];

  if (raw) candidates.push(raw);

  const resultString = raw.match(/###\s*Result\s+("(?:(?:\\.)|[^"\\])*")/s)?.[1];
  if (resultString) {
    try {
      candidates.push(JSON.parse(resultString));
    } catch {}
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      if (typeof parsed === "string") {
        try {
          return JSON.parse(parsed);
        } catch {}
      }

      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {}
  }

  return null;
}

function isLikelyUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) return true;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) return false;
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#][^\s]*)?$/i.test(raw);
}

function normalizeUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (isLikelyUrl(raw)) return `https://${raw}`;
  return "";
}

function currentUrlFromInput(args = {}, state = {}) {
  return normalizeUrl(
    args.currentUrl ||
    args.url ||
    state.currentUrl ||
    state.lastValidObservation?.url ||
    ""
  );
}

function contentArray(result = {}) {
  if (Array.isArray(result?.content)) return result.content;
  if (Array.isArray(result?.result?.content)) return result.result.content;
  return [];
}

function textFromMcp(result = {}) {
  const parts = contentArray(result)
    .filter((item) => item?.type === "text")
    .map((item) => item.text || "")
    .filter(Boolean);

  if (parts.length) return parts.join("\n");
  if (typeof result === "string") return result;

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return "";
  }
}

function imagesFromMcp(result = {}) {
  return contentArray(result)
    .filter((item) => item?.type === "image" && item.data)
    .map((item) => ({
      data: String(item.data || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ""),
      mimeType: String(item.mimeType || item.mime_type || "image/png"),
    }))
    .filter((item) => item.data);
}

function readImageBase64(filePath = "") {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return null;
    return {
      imageBase64: fs.readFileSync(filePath).toString("base64"),
      imagePath: filePath,
      mimeType: ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png",
    };
  } catch {
    return null;
  }
}

function latestPlaywrightScreenshot(sinceMs = 0) {
  try {
    if (!fs.existsSync(PLAYWRIGHT_MCP_DIR)) return null;

    const files = fs.readdirSync(PLAYWRIGHT_MCP_DIR)
      .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
      .map((name) => {
        const filePath = path.join(PLAYWRIGHT_MCP_DIR, name);
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      })
      .filter((entry) => entry.mtimeMs >= sinceMs - 2500)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return files[0] ? readImageBase64(files[0].filePath) : null;
  } catch {
    return null;
  }
}

function snapshotPathFromText(text = "") {
  const raw = String(text || "");
  const match = raw.match(/(?:[A-Za-z]:)?[^"'`\n\r]*playwright-mcp[\\/][^"'`\n\r]+\.(?:png|jpe?g|webp)/i)
    || raw.match(/page-[^"'`\n\r]+\.(?:png|jpe?g|webp)/i);
  if (!match) return null;

  const candidate = match[0];
  if (path.isAbsolute(candidate)) return readImageBase64(candidate);

  return readImageBase64(path.join(PLAYWRIGHT_MCP_DIR, path.basename(candidate)));
}

function parseSnapshotMetadata(text = "", fallbackUrl = "") {
  const raw = String(text || "");
  const url =
    raw.match(/(?:Page\s+URL|URL|url)\s*[:=]\s*(https?:\/\/[^\s)]+)/i)?.[1] ||
    raw.match(/https?:\/\/[^\s)]+/i)?.[0] ||
    fallbackUrl ||
    "";

  const title =
    raw.match(/(?:Page\s+Title|Title|title)\s*[:=]\s*(.+)/i)?.[1]?.split("\n")[0]?.trim() ||
    "";

  return {
    url: safeText(url, 500),
    title: safeText(title, 300),
  };
}

async function availableToolNames() {
  const tools = await listExternalMcpTools(SERVER_ID);
  return tools.map((tool) => String(tool.name || "").trim()).filter(Boolean);
}

async function findTool(aliases = []) {
  const names = await availableToolNames();

  for (const alias of aliases) {
    if (names.includes(alias)) return alias;
  }

  const lowerNames = names.map((name) => [name.toLowerCase(), name]);
  for (const alias of aliases) {
    const lowerAlias = alias.toLowerCase();
    const fuzzy = lowerNames.find(([lower]) => lower === lowerAlias || lower.endsWith(lowerAlias) || lower.includes(lowerAlias));
    if (fuzzy) return fuzzy[1];
  }

  throw new Error(`Playwright MCP tool not found. Tried: ${aliases.join(", ")}. Available: ${names.join(", ")}`);
}

async function callPlaywrightTool(aliases = [], args = {}) {
  const tool = await findTool(aliases);
  const result = await callExternalMcpTool(SERVER_ID, tool, args);
  const text = textFromMcp(result);
  const isError = Boolean(
    result?.isError ||
    result?.error ||
    /(^|\\n)###\\s*Error\\b/i.test(text) ||
    /invalid_type|expected .* received|did not match any elements|tool call failed/i.test(text)
  );

  return {
    ok: !isError,
    tool,
    result,
    text,
    images: imagesFromMcp(result),
    error: isError ? text || String(result?.error || "Playwright MCP tool returned an error.") : "",
  };
}

function summarizeSnapshotText(value = "") {
  const text = String(value || "");
  return {
    ok: Boolean(text.trim()),
    textPreview: safeText(text, 5000),
    rawText: text.slice(0, 16000),
  };
}

export async function capturePlaywrightMcpSnapshot(args = {}, state = {}) {
  const startedAt = Date.now();
  const currentUrl = currentUrlFromInput(args, state);

  if (currentUrl && args.navigate !== false) {
    await callPlaywrightTool(["browser_navigate", "navigate"], { url: currentUrl }).catch(() => null);
  }

  const snapshotCall = await callPlaywrightTool(["browser_snapshot", "snapshot"], {});
  let screenshotCall = null;

  if (envFlag("PLAYWRIGHT_MCP_SCREENSHOT_ENABLED", true)) {
    try {
      screenshotCall = await callPlaywrightTool(["browser_take_screenshot", "take_screenshot", "screenshot"], {
        raw: true,
      });
    } catch (err) {
      screenshotCall = {
        ok: false,
        tool: "",
        result: null,
        text: "",
        images: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    screenshotCall = {
      ok: true,
      tool: "disabled",
      result: null,
      text: "",
      images: [],
      error: "",
    };
  }

  const imageFromMcp = screenshotCall.images?.[0]
    ? {
        imageBase64: screenshotCall.images[0].data,
        mimeType: screenshotCall.images[0].mimeType,
        imagePath: "",
      }
    : null;

  const imageFromText = snapshotPathFromText(screenshotCall.text) || snapshotPathFromText(snapshotCall.text);
  const imageFromDisk = latestPlaywrightScreenshot(startedAt);
  const image = imageFromMcp || imageFromText || imageFromDisk || {};

  const metadata = parseSnapshotMetadata(snapshotCall.text, currentUrl);

  const snapshot = {
    label: args.label || "snapshot",
    capturedAt: new Date().toISOString(),
    url: metadata.url || currentUrl,
    title: metadata.title,
    mcpSnapshotTool: snapshotCall.tool,
    mcpScreenshotTool: screenshotCall.tool,
    text: snapshotCall.text,
    imageBase64: image.imageBase64 || "",
    imagePath: image.imagePath || "",
    mimeType: image.mimeType || "",
    screenshotError: screenshotCall.error || "",
    dom: summarizeSnapshotText(snapshotCall.text),
  };

  return {
    ok: Boolean(snapshot.text || snapshot.imageBase64),
    status: "captured",
    engine: "playwright_mcp",
    snapshot,
    observation: {
      ok: Boolean(snapshot.text),
      url: snapshot.url,
      title: snapshot.title,
      textPreview: safeText(snapshot.text, 5000),
      engine: "playwright_mcp",
      links: [],
      buttons: [],
      inputs: [],
      forms: [],
      interactiveElements: [],
      stats: {},
    },
    error: screenshotCall.error || "",
  };
}

function scoutControlScript(targetText = "", intent = "") {
  const payload = {
    targetText: safeText(targetText, 240),
    intent: safeText(intent, 120),
  };

  return `() => {
    const payload = ${JSON.stringify(payload)};
    const targetRaw = String(payload.targetText || "").trim();
    const intent = String(payload.intent || "").toLowerCase();

    const norm = (value) => String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\\s+/g, " ")
      .trim();

    const coreTarget = (value) => norm(value)
      .replace(/\b(click|press|tap|select|choose|open|launch)\b/g, " ")
      .replace(/\b(button|link|control|element|field|item|option)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const wanted = norm(targetRaw);
    const wantedCore = coreTarget(targetRaw);

    const textScoreFor = (label) => {
      const labelNorm = norm(label);
      const labelCore = coreTarget(label);

      const pairs = [
        [labelNorm, wanted, "full"],
        [labelNorm, wantedCore, "target_core"],
        [labelCore, wantedCore, "both_core"],
        [labelCore, wanted, "label_core"],
      ].filter(([left, right]) => left && right);

      for (const [left, right, mode] of pairs) {
        if (left === right) return { score: 120, match: "exact_" + mode };
        if (left.includes(right)) return { score: 104, match: "label_contains_" + mode };
        if (right.includes(left) && left.length >= 4) return { score: 90, match: "target_contains_" + mode };
      }

      return { score: 0, match: "none" };
    };

    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom >= 0 &&
        rect.right >= 0;
    };

    const inCodeLikeContainer = (el) => Boolean(el.closest([
      "pre",
      "code",
      "kbd",
      "samp",
      "[data-highlighted]",
      ".highlight",
      ".code",
      ".codehilite",
      ".hljs"
    ].join(",")));

    const labelFor = (el) => [
      el.innerText || el.textContent || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.getAttribute("value") || "",
      el.getAttribute("name") || "",
      el.getAttribute("id") || "",
      el.getAttribute("data-bs-target") || "",
      el.getAttribute("data-target") || "",
      el.getAttribute("aria-controls") || ""
    ].filter(Boolean).join(" ");

    const attr = (el, name) => el.getAttribute(name) || "";

    const cssEscape = (value) => {
      try { return CSS.escape(String(value || "")); }
      catch { return String(value || "").replace(/["\\\\]/g, "\\\\$&"); }
    };

    const cssQuoted = (value) => String(value || "").replace(/["\\\\]/g, "\\\\$&");

    const selectorFor = (el) => {
      const tag = el.tagName.toLowerCase();
      const id = attr(el, "id");
      if (id) return "#" + cssEscape(id);

      const stableAttrs = [
        "data-testid",
        "data-test",
        "data-cy",
        "data-bs-target",
        "data-target",
        "aria-controls",
        "aria-label",
        "name",
        "type",
        "role"
      ];

      for (const name of stableAttrs) {
        const value = attr(el, name);
        if (!value) continue;
        const selector = tag + "[" + name + "=\\"" + cssQuoted(value) + "\\"]";
        try {
          if (document.querySelectorAll(selector).length === 1) return selector;
        } catch {}
      }

      const textSelectorBase = tag;
      try {
        const sameTag = Array.from(document.querySelectorAll(textSelectorBase)).filter((candidate) => candidate === el || visible(candidate));
        const index = sameTag.indexOf(el) + 1;
        if (index > 0) return textSelectorBase + ":nth-of-type(" + index + ")";
      } catch {}

      return tag;
    };

    const controlSelector = [
      "button",
      "[role='button']",
      "input[type='button']",
      "input[type='submit']",
      "input[type='reset']",
      "summary",
      "select",
      "[data-bs-toggle]",
      "[data-toggle]",
      "[data-bs-target]",
      "[data-target]",
      "[aria-controls]",
      "a[href]"
    ].join(",");

    const isPlainNavigationLink = (el) => {
      if (!el || el.tagName.toLowerCase() !== "a") return false;
      const href = attr(el, "href");
      if (!href) return false;

      const role = norm(attr(el, "role"));
      const hasControlAttr = Boolean(
        attr(el, "data-bs-toggle") ||
        attr(el, "data-toggle") ||
        attr(el, "data-bs-target") ||
        attr(el, "data-target") ||
        attr(el, "aria-controls") ||
        role === "button"
      );

      return !hasControlAttr;
    };

    const nearestHeading = (el) => {
      let node = el;
      for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
        const heading = node.querySelector?.("h1,h2,h3,h4,h5,h6");
        if (heading && visible(heading)) return (heading.innerText || heading.textContent || "").trim().slice(0, 160);
      }

      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter(visible);
      const rect = el.getBoundingClientRect();
      let best = null;
      for (const heading of headings) {
        const hRect = heading.getBoundingClientRect();
        if (hRect.top <= rect.top) best = heading;
      }
      return best ? (best.innerText || best.textContent || "").trim().slice(0, 160) : "";
    };

    const controls = Array.from(document.querySelectorAll(controlSelector))
      .filter(visible)
      .filter((el) => !inCodeLikeContainer(el))
      .filter((el) => !isPlainNavigationLink(el));

    const scored = controls.map((el) => {
      const tag = el.tagName.toLowerCase();
      const role = norm(attr(el, "role"));
      const labelRaw = labelFor(el);
      const label = norm(labelRaw);
      const dataToggle = norm(attr(el, "data-bs-toggle") || attr(el, "data-toggle"));
      const dataTarget = norm(attr(el, "data-bs-target") || attr(el, "data-target"));
      const ariaControls = norm(attr(el, "aria-controls"));
      const disabled = el.disabled === true || attr(el, "aria-disabled") === "true";

      const textMatchResult = textScoreFor(labelRaw);
      const textScore = textMatchResult.score;
      const textMatch = textMatchResult.match;

      let score = textScore;
      if (tag === "button") score += 28;
      if (role === "button") score += 22;
      if (tag === "input") score += 18;
      if (dataTarget || ariaControls) score += 20;
      if (dataToggle && dataToggle !== "tooltip") score += 18;
      if (/modal|dialog|popup/.test(intent + " " + wanted) && /modal|dialog/.test(dataToggle + " " + dataTarget + " " + ariaControls)) score += 16;
      if (/collapse|accordion/.test(intent + " " + wanted) && /collapse/.test(dataToggle + " " + dataTarget + " " + ariaControls)) score += 16;
      if (tag === "a") score -= 12;
      if (dataToggle === "tooltip") score -= 60;
      if (disabled) score -= 100;

      const rect = el.getBoundingClientRect();

      return {
        el,
        score,
        textScore,
        textMatch,
        tag,
        role: attr(el, "role"),
        text: labelRaw.trim().replace(/\\s+/g, " ").slice(0, 260),
        selector: selectorFor(el),
        href: attr(el, "href"),
        type: attr(el, "type"),
        dataToggle: attr(el, "data-bs-toggle") || attr(el, "data-toggle"),
        dataTarget: attr(el, "data-bs-target") || attr(el, "data-target"),
        ariaControls: attr(el, "aria-controls"),
        disabled,
        heading: nearestHeading(el),
        rect: {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    })
    .filter((item) => item.textScore >= 82)
    .filter((item) => item.score >= 90)
    .sort((a, b) => b.score - a.score);

    const best = scored[0] || null;

    if (!best) {
      return {
        ok: false,
        targetText: targetRaw,
        targetCore: wantedCore,
        reason: "No reliable visible actionable control matched the requested target.",
        candidates: controls.slice(0, 20).map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: labelFor(el).trim().replace(/\\s+/g, " ").slice(0, 140),
          role: attr(el, "role"),
          href: attr(el, "href"),
          dataToggle: attr(el, "data-bs-toggle") || attr(el, "data-toggle"),
          dataTarget: attr(el, "data-bs-target") || attr(el, "data-target"),
          ariaControls: attr(el, "aria-controls")
        }))
      };
    }

    best.el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    try { best.el.focus?.(); } catch {}

    return {
      ok: true,
      targetText: targetRaw,
      selected: {
        score: best.score,
        textMatch: best.textMatch,
        tag: best.tag,
        text: best.text,
        selector: best.selector,
        role: best.role,
        href: best.href,
        type: best.type,
        dataToggle: best.dataToggle,
        dataTarget: best.dataTarget,
        ariaControls: best.ariaControls,
        heading: best.heading,
        rect: best.rect
      },
      rejectedCount: Math.max(0, controls.length - 1)
    };
  }`;
}

export async function scoutPlaywrightControlTarget(args = {}, state = {}) {
  const currentUrl = currentUrlFromInput(args, state);
  const targetText = safeText(args.targetText || args.text || "", 240);
  const intent = safeText(args.intent || "", 120);

  const parseScoutJson = (value = "") => {
    const raw = String(value || "").trim();
    const candidates = [raw];

    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {}
    }

    return null;
  };

  const normalizeScoutResult = (result = {}, fallbackError = "") => {
    const parsed = parseScoutJson(result.text || "") || parseScoutJson(result.error || "") || null;
    const selected = parsed?.selected || null;

    return {
      ok: Boolean(parsed?.ok === true && selected?.selector),
      status: parsed?.ok === true && selected?.selector ? "found" : "not_found",
      engine: "playwright_mcp",
      targetText,
      targetCore: safeText(parsed?.targetCore || "", 240),
      intent,
      selector: safeText(selected?.selector || "", 500),
      text: safeText(selected?.text || "", 240),
      score: Number(selected?.score || 0),
      selected: selected || null,
      candidates: Array.isArray(parsed?.candidates) ? parsed.candidates : [],
      error: parsed?.reason || fallbackError || result.error || "",
      rawText: safeText(result.text || result.error || "", 2000),
    };
  };

  if (currentUrl && args.navigate !== false) {
    await callPlaywrightTool(["browser_navigate", "navigate"], { url: currentUrl }).catch(() => null);
  }

  const fastPathPayload = { targetText, intent };
  const fastPathScript = `() => {
    const payload = ${JSON.stringify(fastPathPayload)};
    const targetRaw = String(payload.targetText || "").trim();

    const norm = (value) => String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\\s+/g, " ")
      .trim();

    const core = (value) => norm(value)
      .replace(/\\b(click|press|tap|select|choose|open)\\b/g, " ")
      .replace(/\\b(button|link|control|element|field|item|option)\\b/g, " ")
      .replace(/\\s+/g, " ")
      .trim();

    const wanted = norm(targetRaw);
    const wantedCore = core(targetRaw);

    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const labelFor = (el) => [
      el.innerText || el.textContent || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.getAttribute("value") || "",
      el.getAttribute("name") || "",
      el.getAttribute("id") || ""
    ].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();

    const inCode = (el) => Boolean(el.closest("pre,code,kbd,samp,.highlight,.hljs,.code,.codehilite"));

    const isPlainNavigationLink = (el) => {
      if (!el || el.tagName.toLowerCase() !== "a") return false;
      if (!el.getAttribute("href")) return false;
      return !(
        el.getAttribute("role") === "button" ||
        el.getAttribute("data-bs-toggle") ||
        el.getAttribute("data-toggle") ||
        el.getAttribute("data-bs-target") ||
        el.getAttribute("data-target") ||
        el.getAttribute("aria-controls")
      );
    };

    const q = (value) => String(value || "").replace(/["\\\\]/g, "\\\\$&");
    const esc = (value) => {
      try { return CSS.escape(String(value || "")); }
      catch { return q(value); }
    };

    const selectorFor = (el) => {
      const tag = el.tagName.toLowerCase();
      if (el.id) return "#" + esc(el.id);

      for (const attr of ["data-bs-target", "data-target", "aria-controls", "aria-label", "name", "type", "role"]) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        const selector = tag + "[" + attr + "=\\"" + q(value) + "\\"]";
        try {
          if (document.querySelectorAll(selector).length === 1) return selector;
        } catch {}
      }

      const parent = el.parentElement;
      if (!parent) return tag;
      const siblings = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
      return tag + ":nth-of-type(" + Math.max(siblings.indexOf(el) + 1, 1) + ")";
    };

    const controls = Array.from(document.querySelectorAll([
      "button",
      "[role='button']",
      "input[type='button']",
      "input[type='submit']",
      "input[type='reset']",
      "[data-bs-toggle]",
      "[data-toggle]",
      "[data-bs-target]",
      "[data-target]",
      "[aria-controls]",
      "a[href]"
    ].join(",")))
      .filter(visible)
      .filter((el) => !inCode(el))
      .filter((el) => !isPlainNavigationLink(el));

    const scored = controls.map((el) => {
      const label = labelFor(el);
      const labelNorm = norm(label);
      const labelCore = core(label);

      let score = 0;
      let textMatch = "none";

      if (labelNorm === wanted || labelCore === wantedCore) {
        score = 200;
        textMatch = "exact";
      } else if (wantedCore && labelNorm.includes(wantedCore)) {
        score = 170;
        textMatch = "label_contains_target_core";
      } else if (wantedCore && labelCore.includes(wantedCore)) {
        score = 165;
        textMatch = "core_contains_core";
      } else if (wantedCore && wantedCore.includes(labelCore) && labelCore.length >= 4) {
        score = 145;
        textMatch = "target_contains_label_core";
      }

      const tag = el.tagName.toLowerCase();
      const dataToggle = el.getAttribute("data-bs-toggle") || el.getAttribute("data-toggle") || "";
      const dataTarget = el.getAttribute("data-bs-target") || el.getAttribute("data-target") || "";
      const ariaControls = el.getAttribute("aria-controls") || "";

      if (tag === "button") score += 40;
      if (el.getAttribute("role") === "button") score += 30;
      if (dataTarget || ariaControls) score += 25;
      if (dataToggle && dataToggle !== "tooltip") score += 20;
      if (dataToggle === "tooltip") score -= 80;
      if (tag === "a") score -= 15;

      return {
        el,
        score,
        textMatch,
        tag,
        text: label,
        selector: selectorFor(el),
        role: el.getAttribute("role") || "",
        href: el.getAttribute("href") || "",
        type: el.getAttribute("type") || "",
        dataToggle,
        dataTarget,
        ariaControls
      };
    }).sort((a, b) => b.score - a.score);

    const best = scored.find((item) => item.score >= 145) || null;

    if (!best) {
      return JSON.stringify({
        ok: false,
        targetText: targetRaw,
        targetCore: wantedCore,
        reason: "Exact visible-control fast path found no matching control.",
        candidates: scored.slice(0, 12).map((item) => ({
          score: item.score,
          textMatch: item.textMatch,
          tag: item.tag,
          text: item.text,
          selector: item.selector,
          role: item.role,
          href: item.href,
          dataToggle: item.dataToggle,
          dataTarget: item.dataTarget,
          ariaControls: item.ariaControls
        }))
      });
    }

    best.el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    try { best.el.focus?.(); } catch {}

    return JSON.stringify({
      ok: true,
      targetText: targetRaw,
      targetCore: wantedCore,
      selected: {
        score: best.score,
        textMatch: best.textMatch,
        tag: best.tag,
        text: best.text,
        selector: best.selector,
        role: best.role,
        href: best.href,
        type: best.type,
        dataToggle: best.dataToggle,
        dataTarget: best.dataTarget,
        ariaControls: best.ariaControls,
        fastPath: "exact_visible_control"
      }
    });
  }`;

  const fastPath = await callPlaywrightTool(["browser_evaluate", "evaluate"], {
    function: fastPathScript,
  }).catch((err) => ({
    ok: false,
    text: "",
    error: err instanceof Error ? err.message : String(err),
  }));

  const fastPathResult = normalizeScoutResult(fastPath);
  if (fastPathResult.ok === true) {
    return {
      ...fastPathResult,
      status: "found",
      fastPathUsed: true,
    };
  }

  const primary = await callPlaywrightTool(["browser_evaluate", "evaluate"], {
    function: scoutControlScript(targetText, intent),
  }).catch((err) => ({
    ok: false,
    text: "",
    error: err instanceof Error ? err.message : String(err),
  }));

  let normalized = normalizeScoutResult(primary);

  if (normalized.ok === true) {
    return normalized;
  }

  const payload = { targetText, intent };
  const fallbackScript = `() => {
    const payload = ${JSON.stringify(payload)};
    const targetRaw = String(payload.targetText || "").trim();

    const norm = (value) => String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\\s+/g, " ")
      .trim();

    const core = (value) => norm(value)
      .replace(/\\b(click|press|tap|select|choose|open)\\b/g, " ")
      .replace(/\\b(button|link|control|element|field|item|option)\\b/g, " ")
      .replace(/\\s+/g, " ")
      .trim();

    const wanted = norm(targetRaw);
    const wantedCore = core(targetRaw);

    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const labelFor = (el) => [
      el.innerText || el.textContent || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.getAttribute("value") || "",
      el.getAttribute("name") || "",
      el.getAttribute("id") || "",
      el.getAttribute("data-bs-target") || "",
      el.getAttribute("data-target") || "",
      el.getAttribute("aria-controls") || ""
    ].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();

    const inCode = (el) => Boolean(el.closest("pre,code,kbd,samp,.highlight,.hljs,.code,.codehilite"));

    const isPlainNavigationLink = (el) => {
      if (!el || el.tagName.toLowerCase() !== "a") return false;
      const href = el.getAttribute("href") || "";
      if (!href) return false;

      const role = norm(el.getAttribute("role") || "");
      const hasControl = Boolean(
        el.getAttribute("data-bs-toggle") ||
        el.getAttribute("data-toggle") ||
        el.getAttribute("data-bs-target") ||
        el.getAttribute("data-target") ||
        el.getAttribute("aria-controls") ||
        role === "button"
      );

      return !hasControl;
    };

    const cssEscape = (value) => {
      try { return CSS.escape(String(value || "")); }
      catch { return String(value || "").replace(/["\\\\]/g, "\\\\$&"); }
    };

    const q = (value) => String(value || "").replace(/["\\\\]/g, "\\\\$&");

    const selectorFor = (el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.getAttribute("id");
      if (id) return "#" + cssEscape(id);

      const attrs = [
        "data-bs-target",
        "data-target",
        "aria-controls",
        "data-bs-toggle",
        "data-toggle",
        "aria-label",
        "name",
        "type",
        "role"
      ];

      for (const attr of attrs) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        const selector = tag + "[" + attr + "=\\"" + q(value) + "\\"]";
        try {
          if (document.querySelectorAll(selector).length === 1) return selector;
        } catch {}
      }

      const parent = el.parentElement;
      if (!parent) return tag;
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
      const index = sameTag.indexOf(el) + 1;
      return tag + ":nth-of-type(" + Math.max(index, 1) + ")";
    };

    const controlSelector = [
      "button",
      "[role='button']",
      "input[type='button']",
      "input[type='submit']",
      "input[type='reset']",
      "summary",
      "[data-bs-toggle]",
      "[data-toggle]",
      "[data-bs-target]",
      "[data-target]",
      "[aria-controls]",
      "a[href]"
    ].join(",");

    const scoreText = (label) => {
      const labelNorm = norm(label);
      const labelCore = core(label);

      const pairs = [
        [labelNorm, wanted, "exact_full"],
        [labelNorm, wantedCore, "target_core"],
        [labelCore, wantedCore, "both_core"],
        [labelCore, wanted, "label_core"]
      ].filter(([left, right]) => left && right);

      for (const [left, right, mode] of pairs) {
        if (left === right) return { score: 130, match: mode };
        if (left.includes(right)) return { score: 112, match: "contains_" + mode };
        if (right.includes(left) && left.length >= 4) return { score: 96, match: "reverse_" + mode };
      }

      return { score: 0, match: "none" };
    };

    const controls = Array.from(document.querySelectorAll(controlSelector))
      .filter(visible)
      .filter((el) => !inCode(el))
      .filter((el) => !isPlainNavigationLink(el));

    const scored = controls.map((el) => {
      const label = labelFor(el);
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") || "";
      const dataToggle = el.getAttribute("data-bs-toggle") || el.getAttribute("data-toggle") || "";
      const dataTarget = el.getAttribute("data-bs-target") || el.getAttribute("data-target") || "";
      const ariaControls = el.getAttribute("aria-controls") || "";
      const text = scoreText(label);

      let score = text.score;
      if (tag === "button") score += 30;
      if (norm(role) === "button") score += 22;
      if (dataTarget || ariaControls) score += 22;
      if (dataToggle && norm(dataToggle) !== "tooltip") score += 18;
      if (norm(dataToggle) === "tooltip") score -= 60;
      if (tag === "a") score -= 10;

      const rect = el.getBoundingClientRect();

      return {
        el,
        score,
        textScore: text.score,
        textMatch: text.match,
        tag,
        text: label.slice(0, 240),
        selector: selectorFor(el),
        role,
        href: el.getAttribute("href") || "",
        type: el.getAttribute("type") || "",
        dataToggle,
        dataTarget,
        ariaControls,
        rect: {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    }).sort((a, b) => b.score - a.score);

    const best = scored.find((item) => item.textScore >= 96 && item.score >= 110) || null;

    if (!best) {
      return JSON.stringify({
        ok: false,
        targetText: targetRaw,
        targetCore: wantedCore,
        reason: "Fallback scout found no reliable visible control.",
        candidates: scored.slice(0, 12).map((item) => ({
          score: item.score,
          textScore: item.textScore,
          textMatch: item.textMatch,
          tag: item.tag,
          text: item.text,
          selector: item.selector,
          role: item.role,
          href: item.href,
          dataToggle: item.dataToggle,
          dataTarget: item.dataTarget,
          ariaControls: item.ariaControls
        }))
      });
    }

    best.el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    try { best.el.focus?.(); } catch {}

    return JSON.stringify({
      ok: true,
      targetText: targetRaw,
      targetCore: wantedCore,
      selected: {
        score: best.score,
        textScore: best.textScore,
        textMatch: best.textMatch,
        tag: best.tag,
        text: best.text,
        selector: best.selector,
        role: best.role,
        href: best.href,
        type: best.type,
        dataToggle: best.dataToggle,
        dataTarget: best.dataTarget,
        ariaControls: best.ariaControls,
        rect: best.rect
      }
    });
  }`;

  const fallback = await callPlaywrightTool(["browser_evaluate", "evaluate"], {
    function: fallbackScript,
  }).catch((err) => ({
    ok: false,
    text: "",
    error: err instanceof Error ? err.message : String(err),
  }));

  const fallbackResult = normalizeScoutResult(fallback, normalized.error);

  if (fallbackResult.ok === true) {
    return {
      ...fallbackResult,
      status: "found",
      fallbackUsed: true,
      primaryError: normalized.error || "",
      primaryCandidates: normalized.candidates || [],
    };
  }

  return {
    ...normalized,
    candidates: fallbackResult.candidates?.length ? fallbackResult.candidates : normalized.candidates,
    error: fallbackResult.error || normalized.error,
    rawText: [normalized.rawText, fallbackResult.rawText].filter(Boolean).join("\\n--- fallback ---\\n").slice(0, 2000),
  };
}

export async function dismissPlaywrightBlockingUi(args = {}, state = {}) {
  const currentUrl = currentUrlFromInput(args, state);

  const script = `async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const textOf = (el) => String(el?.innerText || el?.textContent || "")
      .replace(/\\s+/g, " ")
      .trim();

    const activeRoots = () => Array.from(document.querySelectorAll([
      ".modal.show",
      ".modal.fade.show",
      ".offcanvas.show",
      "[aria-modal='true']",
      "[role='dialog']",
      "[role='alertdialog']",
      "dialog[open]",
      ".dropdown-menu.show",
      ".popover.show",
      "[data-state='open']"
    ].join(","))).filter(visible);

    const activeBackdrops = () => Array.from(document.querySelectorAll(".modal-backdrop.show,.modal-backdrop"))
      .filter(visible);

    const state = () => {
      const roots = activeRoots();
      const backs = activeBackdrops();
      return {
        open: roots.length > 0 || backs.length > 0,
        roots: roots.map((el) => ({
          tag: el.tagName.toLowerCase(),
          id: el.getAttribute("id") || "",
          role: el.getAttribute("role") || "",
          ariaModal: el.getAttribute("aria-modal") || "",
          className: String(el.className || ""),
          text: textOf(el).slice(0, 500)
        })),
        backdrops: backs.map((el) => ({
          tag: el.tagName.toLowerCase(),
          className: String(el.className || "")
        }))
      };
    };

    const waitClosed = async (timeoutMs = 1600) => {
      const start = Date.now();
      let last = state();

      while (Date.now() - start < timeoutMs) {
        last = state();
        if (!last.open) return { closed: true, state: last };
        await delay(100);
      }

      return { closed: false, state: last };
    };

    const userLikeClick = (el) => {
      if (!el || !visible(el)) return false;

      try {
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      } catch {}

      const rect = el.getBoundingClientRect();
      const x = Math.max(1, Math.floor(rect.left + rect.width / 2));
      const y = Math.max(1, Math.floor(rect.top + rect.height / 2));

      const opts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1
      };

      try { el.focus?.(); } catch {}

      for (const type of ["pointerover", "mouseover", "pointerenter", "mouseenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        try {
          const Ctor = type.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
          el.dispatchEvent(new Ctor(type, opts));
        } catch {
          try { el.dispatchEvent(new MouseEvent(type, opts)); } catch {}
        }
      }

      try { el.click?.(); } catch {}

      return true;
    };

    const before = state();
    if (!before.open) {
      return JSON.stringify({ ok: true, dismissed: false, method: "already_clear", before, after: before });
    }

    const root = activeRoots()[0] || document.body;

    // 1. Prefer real close/dismiss controls inside the active overlay.
    const controls = Array.from(root.querySelectorAll([
      "[data-bs-dismiss]",
      "[data-dismiss]",
      ".btn-close",
      "button[aria-label='Close']",
      "button[aria-label='close']",
      "[aria-label='Close']",
      "[aria-label='close']",
      "button",
      "[role='button']"
    ].join(","))).filter(visible).map((el) => {
      const label = [
        textOf(el),
        el.getAttribute("aria-label") || "",
        el.getAttribute("title") || "",
        el.getAttribute("class") || "",
        el.getAttribute("data-bs-dismiss") || "",
        el.getAttribute("data-dismiss") || ""
      ].join(" ").toLowerCase();

      let score = 0;
      if (el.getAttribute("data-bs-dismiss") || el.getAttribute("data-dismiss")) score += 140;
      if (el.classList.contains("btn-close")) score += 130;
      if (/\\b(close|dismiss|cancel|x)\\b/.test(label)) score += 110;
      if (el.tagName.toLowerCase() === "button") score += 25;
      if (/\\bsave\\b/.test(label)) score -= 90;

      return {
        el,
        score,
        label,
        text: textOf(el),
        ariaLabel: el.getAttribute("aria-label") || "",
        className: String(el.className || ""),
        dataDismiss: el.getAttribute("data-bs-dismiss") || el.getAttribute("data-dismiss") || ""
      };
    }).sort((a, b) => b.score - a.score);

    const clicked = [];

    for (const item of controls.filter((entry) => entry.score >= 100).slice(0, 4)) {
      userLikeClick(item.el);
      clicked.push({
        score: item.score,
        text: item.text,
        ariaLabel: item.ariaLabel,
        className: item.className,
        dataDismiss: item.dataDismiss
      });

      const closed = await waitClosed(1700);
      if (closed.closed) {
        return JSON.stringify({
          ok: true,
          dismissed: true,
          method: "close_control",
          clicked,
          before,
          after: closed.state
        });
      }
    }

    // 2. Native dialog close.
    if (root instanceof HTMLDialogElement && root.open) {
      try { root.close(); } catch {}
      const closed = await waitClosed(800);
      if (closed.closed) {
        return JSON.stringify({ ok: true, dismissed: true, method: "html_dialog_close", clicked, before, after: closed.state });
      }
    }

    // 3. Bootstrap / library API hide if available.
    try {
      const bootstrapApi = window.bootstrap || window.Bootstrap || null;
      const Modal = bootstrapApi?.Modal;
      const Offcanvas = bootstrapApi?.Offcanvas;

      if (Modal && root.classList?.contains("modal")) {
        const instance =
          Modal.getInstance?.(root) ||
          Modal.getOrCreateInstance?.(root) ||
          new Modal(root);

        instance?.hide?.();

        const closed = await waitClosed(1800);
        if (closed.closed) {
          return JSON.stringify({ ok: true, dismissed: true, method: "bootstrap_modal_hide", clicked, before, after: closed.state });
        }
      }

      if (Offcanvas && root.classList?.contains("offcanvas")) {
        const instance =
          Offcanvas.getInstance?.(root) ||
          Offcanvas.getOrCreateInstance?.(root) ||
          new Offcanvas(root);

        instance?.hide?.();

        const closed = await waitClosed(1200);
        if (closed.closed) {
          return JSON.stringify({ ok: true, dismissed: true, method: "bootstrap_offcanvas_hide", clicked, before, after: closed.state });
        }
      }
    } catch {}

    // 4. Escape.
    for (const target of [document.activeElement, root, document, window]) {
      try {
        target?.dispatchEvent?.(new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
          composed: true
        }));
      } catch {}
    }

    let closed = await waitClosed(1000);
    if (closed.closed) {
      return JSON.stringify({ ok: true, dismissed: true, method: "escape", clicked, before, after: closed.state });
    }

    // 5. Backdrop / outside click.
    const backdrop = activeBackdrops()[0];
    if (backdrop) {
      userLikeClick(backdrop);
      closed = await waitClosed(1000);
      if (closed.closed) {
        return JSON.stringify({ ok: true, dismissed: true, method: "backdrop_click", clicked, before, after: closed.state });
      }
    }

    // 6. Last resort: if this is a visual blocking UI and user explicitly asked to close,
    // clear common modal state so the task can continue. This is safer than clicking random page controls.
    try {
      root.classList?.remove("show", "open", "is-open", "active");
      root.setAttribute?.("aria-hidden", "true");
      root.removeAttribute?.("aria-modal");
      if (root instanceof HTMLDialogElement && root.open) root.close();

      if (root.classList?.contains("modal")) {
        root.style.display = "none";
      }

      for (const el of activeBackdrops()) {
        try { el.remove(); } catch {}
      }

      document.body.classList.remove("modal-open");
      document.body.style.removeProperty("overflow");
      document.body.style.removeProperty("padding-right");

      closed = await waitClosed(300);
      if (closed.closed) {
        return JSON.stringify({ ok: true, dismissed: true, method: "forced_dom_clear", clicked, before, after: closed.state });
      }
    } catch {}

    const after = state();

    return JSON.stringify({
      ok: false,
      dismissed: false,
      method: "failed",
      clicked,
      before,
      after,
      reason: "Blocking UI remained open after close controls, library hide, Escape, backdrop click, and DOM clear fallback."
    });
  }`;

  const result = await callPlaywrightTool(["browser_evaluate", "evaluate"], {
    function: script,
  }).catch((err) => ({
    ok: false,
    text: "",
    error: err instanceof Error ? err.message : String(err),
  }));

  const parsed = parseMcpWrappedJsonSafe(result.text || result.error || "");

  return {
    ok: Boolean(parsed?.ok),
    dismissed: Boolean(parsed?.dismissed),
    method: safeText(parsed?.method || "", 120),
    clicked: Array.isArray(parsed?.clicked) ? parsed.clicked : [],
    before: parsed?.before || null,
    after: parsed?.after || null,
    error: parsed?.reason || result.error || "",
    rawText: safeText(result.text || result.error || "", 2600),
    url: currentUrl,
  };
}


export async function activatePlaywrightControlByText(args = {}, state = {}) {
  const currentUrl = currentUrlFromInput(args, state);
  const targetText = safeText(args.targetText || args.text || "", 240);
  const intent = safeText(args.intent || "", 180);

  const script = `async () => {
    const payload = ${JSON.stringify({ targetText, intent })};

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const norm = (value) => String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\\s+/g, " ")
      .trim();

    const core = (value) => norm(value)
      .replace(/\\b(click|press|tap|select|choose|open|launch)\\b/g, " ")
      .replace(/\\b(button|link|control|element|field|item|option)\\b/g, " ")
      .replace(/\\s+/g, " ")
      .trim();

    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const inCode = (el) => Boolean(el.closest("pre,code,kbd,samp,.highlight,.hljs,.code,.codehilite"));

    const labelFor = (el) => [
      el.innerText || el.textContent || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.getAttribute("value") || "",
      el.getAttribute("name") || "",
      el.getAttribute("id") || "",
      el.getAttribute("data-bs-target") || "",
      el.getAttribute("data-target") || "",
      el.getAttribute("aria-controls") || ""
    ].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();

    const isPlainNavLink = (el) => {
      if (!el || el.tagName.toLowerCase() !== "a") return false;
      if (!el.getAttribute("href")) return false;
      return !(
        el.getAttribute("role") === "button" ||
        el.getAttribute("data-bs-toggle") ||
        el.getAttribute("data-toggle") ||
        el.getAttribute("data-bs-target") ||
        el.getAttribute("data-target") ||
        el.getAttribute("aria-controls")
      );
    };

    const wanted = norm(payload.targetText);
    const wantedCore = core(payload.targetText);

    const controlSelector = [
      "button",
      "[role='button']",
      "input[type='button']",
      "input[type='submit']",
      "input[type='reset']",
      "summary",
      "[data-bs-toggle]",
      "[data-toggle]",
      "[data-bs-target]",
      "[data-target]",
      "[aria-controls]",
      "a[href]"
    ].join(",");

    const controls = Array.from(document.querySelectorAll(controlSelector))
      .filter(visible)
      .filter((el) => !inCode(el))
      .filter((el) => !isPlainNavLink(el));

    const scored = controls.map((el) => {
      const tag = el.tagName.toLowerCase();
      const label = labelFor(el);
      const labelNorm = norm(label);
      const labelCore = core(label);
      const dataToggle = el.getAttribute("data-bs-toggle") || el.getAttribute("data-toggle") || "";
      const dataTarget = el.getAttribute("data-bs-target") || el.getAttribute("data-target") || "";
      const ariaControls = el.getAttribute("aria-controls") || "";

      let score = 0;
      let match = "none";

      if (labelNorm === wanted) {
        score += 160;
        match = "exact";
      } else if (wantedCore && labelNorm.includes(wantedCore)) {
        score += 135;
        match = "contains_target_core";
      } else if (wantedCore && labelCore.includes(wantedCore)) {
        score += 130;
        match = "core_contains_core";
      } else if (wantedCore && wantedCore.includes(labelCore) && labelCore.length >= 4) {
        score += 112;
        match = "target_contains_label_core";
      }

      if (tag === "button") score += 45;
      if (el.getAttribute("role") === "button") score += 35;
      if (dataTarget || ariaControls) score += 30;
      if (dataToggle && dataToggle !== "tooltip") score += 25;
      if (dataToggle === "tooltip") score -= 80;
      if (tag === "a") score -= 25;

      return {
        el,
        score,
        match,
        tag,
        text: label.slice(0, 240),
        dataToggle,
        dataTarget,
        ariaControls,
        role: el.getAttribute("role") || "",
        href: el.getAttribute("href") || ""
      };
    }).sort((a, b) => b.score - a.score);

    const best = scored.find((item) => item.score >= 120) || null;

    if (!best) {
      return JSON.stringify({
        ok: false,
        targetText: payload.targetText,
        reason: "No reliable visible control found for deterministic activation.",
        candidates: scored.slice(0, 10).map((item) => ({
          score: item.score,
          match: item.match,
          tag: item.tag,
          text: item.text,
          role: item.role,
          href: item.href,
          dataToggle: item.dataToggle,
          dataTarget: item.dataTarget,
          ariaControls: item.ariaControls
        }))
      });
    }

    best.el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    best.el.focus?.();
    best.el.click();
    await delay(450);

    const modalOpen = Boolean(
      Array.from(document.querySelectorAll(".modal.show,.modal.fade.show,[aria-modal='true'],[role='dialog'],[role='alertdialog'],dialog[open]"))
        .filter(visible).length ||
      Array.from(document.querySelectorAll(".modal-backdrop.show,.modal-backdrop"))
        .filter(visible).length
    );

    return JSON.stringify({
      ok: true,
      targetText: payload.targetText,
      activated: {
        score: best.score,
        match: best.match,
        tag: best.tag,
        text: best.text,
        dataToggle: best.dataToggle,
        dataTarget: best.dataTarget,
        ariaControls: best.ariaControls
      },
      uiState: {
        modalOpen
      }
    });
  }`;

  const result = await callPlaywrightTool(["browser_evaluate", "evaluate"], {
    function: script,
  }).catch((err) => ({
    ok: false,
    text: "",
    error: err instanceof Error ? err.message : String(err),
  }));

  const parsed = parseMcpWrappedJsonSafe(result.text || result.error || "");

  return {
    ok: Boolean(parsed?.ok),
    targetText,
    activated: parsed?.activated || null,
    uiState: parsed?.uiState || null,
    candidates: Array.isArray(parsed?.candidates) ? parsed.candidates : [],
    error: parsed?.reason || result.error || "",
    rawText: safeText(result.text || result.error || "", 2000),
    url: currentUrl,
  };
}


export async function togglePlaywrightOpenCollapse(args = {}, state = {}) {
  const currentUrl = currentUrlFromInput(args, state);

  const script = `async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const textOf = (el) => String(el?.innerText || el?.textContent || "")
      .replace(/\\s+/g, " ")
      .trim();

    const openCollapses = () => Array.from(document.querySelectorAll(".collapse.show,.accordion-collapse.show"))
      .filter(visible);

    const userLikeClick = (el) => {
      if (!el || !visible(el)) return false;

      try {
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      } catch {}

      const rect = el.getBoundingClientRect();
      const x = Math.max(1, Math.floor(rect.left + rect.width / 2));
      const y = Math.max(1, Math.floor(rect.top + rect.height / 2));

      const opts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1
      };

      try { el.focus?.(); } catch {}

      for (const type of ["pointerover", "mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        try {
          const Ctor = type.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
          el.dispatchEvent(new Ctor(type, opts));
        } catch {
          try { el.dispatchEvent(new MouseEvent(type, opts)); } catch {}
        }
      }

      try { el.click?.(); } catch {}
      return true;
    };

    const state = () => {
      const opens = openCollapses();
      const expanded = Array.from(document.querySelectorAll("[aria-expanded='true']")).filter(visible);

      return {
        open: opens.length > 0,
        collapses: opens.map((el) => ({
          id: el.getAttribute("id") || "",
          className: String(el.className || ""),
          text: textOf(el).slice(0, 300)
        })),
        expandedControls: expanded.map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: textOf(el).slice(0, 180),
          ariaControls: el.getAttribute("aria-controls") || "",
          dataTarget: el.getAttribute("data-bs-target") || el.getAttribute("data-target") || "",
          href: el.getAttribute("href") || "",
          className: String(el.className || "")
        }))
      };
    };

    const before = state();
    if (!before.open) {
      return JSON.stringify({ ok: true, toggled: false, method: "already_closed", before, after: before });
    }

    const openIds = new Set(before.collapses.map((item) => item.id).filter(Boolean));

    const controls = Array.from(document.querySelectorAll([
      "[aria-expanded='true']",
      "[data-bs-toggle='collapse']",
      "[data-toggle='collapse']",
      "a[href^='#']",
      "button"
    ].join(","))).filter(visible).map((el) => {
      const ariaControls = el.getAttribute("aria-controls") || "";
      const dataTarget = el.getAttribute("data-bs-target") || el.getAttribute("data-target") || "";
      const href = el.getAttribute("href") || "";
      const targetId = ariaControls || dataTarget.replace(/^#/, "") || href.replace(/^#/, "");

      let score = 0;
      if (openIds.has(targetId)) score += 160;
      if (el.getAttribute("aria-expanded") === "true") score += 110;
      if ((el.getAttribute("data-bs-toggle") || el.getAttribute("data-toggle")) === "collapse") score += 80;
      if (el.tagName.toLowerCase() === "button" || el.getAttribute("role") === "button") score += 20;

      return {
        el,
        score,
        text: textOf(el).slice(0, 180),
        targetId,
        ariaControls,
        dataTarget,
        href,
        className: String(el.className || "")
      };
    }).sort((a, b) => b.score - a.score);

    const best = controls.find((item) => item.score >= 120);
    if (!best) {
      return JSON.stringify({
        ok: false,
        toggled: false,
        method: "no_expanded_trigger",
        before,
        candidates: controls.slice(0, 8).map((item) => ({
          score: item.score,
          text: item.text,
          targetId: item.targetId,
          ariaControls: item.ariaControls,
          dataTarget: item.dataTarget,
          href: item.href,
          className: item.className
        }))
      });
    }

    userLikeClick(best.el);

    let after = state();
    const started = Date.now();
    while (Date.now() - started < 1800) {
      after = state();
      if (!after.open) break;
      await delay(100);
    }

    return JSON.stringify({
      ok: !after.open,
      toggled: true,
      method: "collapse_expanded_trigger",
      clicked: {
        score: best.score,
        text: best.text,
        targetId: best.targetId,
        ariaControls: best.ariaControls,
        dataTarget: best.dataTarget,
        href: best.href,
        className: best.className
      },
      before,
      after,
      reason: after.open ? "Collapse remained open after clicking expanded trigger." : ""
    });
  }`;

  const result = await callPlaywrightTool(["browser_evaluate", "evaluate"], {
    function: script,
  }).catch((err) => ({
    ok: false,
    text: "",
    error: err instanceof Error ? err.message : String(err),
  }));

  const parsed = parseMcpWrappedJsonSafe(result.text || result.error || "");

  return {
    ok: Boolean(parsed?.ok),
    toggled: Boolean(parsed?.toggled),
    method: safeText(parsed?.method || "", 120),
    clicked: parsed?.clicked || null,
    before: parsed?.before || null,
    after: parsed?.after || null,
    candidates: Array.isArray(parsed?.candidates) ? parsed.candidates : [],
    error: parsed?.reason || result.error || "",
    rawText: safeText(result.text || result.error || "", 2600),
    url: currentUrl,
  };
}


function fieldsFromCommand(command = {}) {
  return Array.isArray(command.args?.fields) ? command.args.fields : Array.isArray(command.fields) ? command.fields : [];
}

function cleanDuplicatedWords(value = "") {
  const words = safeText(value, 240).split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const left = words.slice(0, half).join(" ");
    const right = words.slice(half).join(" ");
    if (left && left.toLowerCase() === right.toLowerCase()) return left;
  }
  return words.join(" ");
}

function targetTextFromCommand(command = {}) {
  return cleanDuplicatedWords(
    command.args?.text ||
    command.args?.label ||
    command.args?.buttonText ||
    command.target ||
    ""
  );
}

function isLightpandaSyntheticRef(value = "") {
  return /^lp_(?:link|button|input|form|el)_\d+$/i.test(String(value || "").trim());
}

function playwrightSelectorFromCommand(command = {}) {
  const args = command.args || {};
  const selector = safeText(args.selector || args.rawSelector || args.cssSelector || "", 500);
  if (selector && !isLightpandaSyntheticRef(selector)) return selector;
  return "";
}

function playwrightRefFromCommand(command = {}) {
  const args = command.args || {};
  const ref = safeText(args.ref || "", 180);
  if (!ref || isLightpandaSyntheticRef(ref)) return "";
  return ref;
}

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function isNonFatalScreenshotError(error = "") {
  return /taking page screenshot|waiting for fonts to load|screenshot|TimeoutError/i.test(String(error || ""));
}

function snapshotHasEvidence(snapshot = null) {
  return Boolean(snapshot?.text || snapshot?.url || snapshot?.title || snapshot?.dom?.textPreview);
}

function snapshotUrlFromLine(line = "") {
  const raw = String(line || "").trim();

  const urlMarker = "/url:";
  const urlIndex = raw.toLowerCase().indexOf(urlMarker);
  if (urlIndex >= 0) {
    const value = raw.slice(urlIndex + urlMarker.length).trim().split(/\s+/)[0] || "";
    return normalizeUrl(value.replace(/[.,;:!?]+$/g, ""));
  }

  const hrefDouble = 'href="';
  const hrefDoubleIndex = raw.toLowerCase().indexOf(hrefDouble);
  if (hrefDoubleIndex >= 0) {
    const rest = raw.slice(hrefDoubleIndex + hrefDouble.length);
    const value = rest.split('"')[0] || "";
    return normalizeUrl(value.replace(/[.,;:!?]+$/g, ""));
  }

  const hrefSingle = "href='";
  const hrefSingleIndex = raw.toLowerCase().indexOf(hrefSingle);
  if (hrefSingleIndex >= 0) {
    const rest = raw.slice(hrefSingleIndex + hrefSingle.length);
    const value = rest.split("'")[0] || "";
    return normalizeUrl(value.replace(/[.,;:!?]+$/g, ""));
  }

  return "";
}

function hrefNearSnapshotTarget(snapshot = null, { text = "", ref = "" } = {}) {
  const raw = String(snapshot?.text || snapshot?.dom?.rawText || snapshot?.dom?.textPreview || "");
  if (!raw.trim()) return "";

  const lines = raw.split(/\r?\n/);
  const lowerText = String(text || "").toLowerCase();

  function scanFrom(index) {
    for (let offset = 0; offset <= 6; offset += 1) {
      const url = snapshotUrlFromLine(lines[index + offset] || "");
      if (url) return url;
    }
    return "";
  }

  if (ref) {
    const refNeedle = "[ref=" + ref + "]";
    const refIndex = lines.findIndex((line) => String(line || "").includes(refNeedle));
    if (refIndex >= 0) {
      const url = scanFrom(refIndex);
      if (url) return url;
    }
  }

  if (lowerText) {
    const textIndex = lines.findIndex((line) => String(line || "").toLowerCase().includes(lowerText));
    if (textIndex >= 0) {
      const url = scanFrom(textIndex);
      if (url) return url;
    }
  }

  return "";
}

function clickResultFailed(result = {}) {
  const text = String(result?.text || result?.error || "");
  return result?.ok === false ||
    /###\s*Error\b/i.test(text) ||
    /invalid_type|expected .* received|did not match any elements|tool call failed/i.test(text);
}

async function tryDomClick(command = {}) {
  const selector = playwrightSelectorFromCommand(command);
  const text = targetTextFromCommand(command);

  if (!selector && !text) return { ok: false, error: "DOM click needs selector or text.", text: "" };

  const payload = { selector, text };
  const script = `() => {
    const payload = ${JSON.stringify(payload)};
    const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const labelFor = (el) => [
      el.innerText || el.textContent || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.getAttribute("value") || "",
      el.getAttribute("name") || "",
      el.getAttribute("id") || "",
      el.getAttribute("data-bs-target") || "",
      el.getAttribute("aria-controls") || ""
    ].filter(Boolean).join(" ");

    let el = null;
    if (payload.selector) {
      try {
        const selected = Array.from(document.querySelectorAll(payload.selector)).filter(visible);
        el = selected[0] || null;
      } catch {}
    }

    if (!el && payload.text) {
      const wanted = norm(payload.text);
      const candidates = Array.from(document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit'], a[href]")).filter(visible);
      el = candidates.find((candidate) => {
        const label = norm(labelFor(candidate));
        return label === wanted || label.includes(wanted) || wanted.includes(label);
      }) || null;
    }

    if (!el) return { ok: false, error: "No matching DOM element found.", selector: payload.selector, text: payload.text };

    el.scrollIntoView({ block: "center", inline: "center" });
    el.focus?.();
    el.click();

    return {
      ok: true,
      clickedText: labelFor(el),
      selector: payload.selector || "",
      tag: el.tagName.toLowerCase(),
      id: el.getAttribute("id") || "",
      ariaExpanded: el.getAttribute("aria-expanded") || "",
      dataBsTarget: el.getAttribute("data-bs-target") || "",
      ariaControls: el.getAttribute("aria-controls") || ""
    };
  }`;

  const result = await callPlaywrightTool(["browser_evaluate", "evaluate"], { function: script }).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    text: err instanceof Error ? err.message : String(err),
  }));

  if (clickResultFailed(result)) {
    return {
      ok: false,
      error: "DOM click fallback failed.",
      text: result.error || result.text || "",
    };
  }

  const parsed = parseMcpJsonResult(result.text);
  if (parsed && parsed.ok === false) {
    return {
      ok: false,
      error: parsed.error || "DOM click did not find target.",
      text: result.text || "",
    };
  }

  return {
    ...result,
    ok: true,
    text: ["DOM click fallback executed.", result.text].filter(Boolean).join("\n"),
  };
}

function browserActionUrlCoreV2(value = "") {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return String(value || "").replace(/#.*$/, "").replace(/\/$/, "");
  }
}

function sameBrowserActionUrlV2(a = "", b = "") {
  const left = browserActionUrlCoreV2(a);
  const right = browserActionUrlCoreV2(b);
  return Boolean(left && right && left === right);
}

async function getPlaywrightCurrentLocationV2() {
  const result = await callPlaywrightTool(["browser_evaluate", "evaluate"], {
    function: "() => JSON.stringify({ ok: true, url: location.href, title: document.title })",
  }).catch((err) => ({
    ok: false,
    text: "",
    error: err instanceof Error ? err.message : String(err),
  }));

  const parsed = parseMcpWrappedJsonSafe(result.text || result.error || "");
  return {
    ok: parsed?.ok === true,
    url: safeText(parsed?.url || "", 800),
    title: safeText(parsed?.title || "", 300),
    error: parsed?.ok === true ? "" : safeText(result.error || result.text || "No Playwright location.", 900),
  };
}

async function ensurePlaywrightAtLiveActionUrlV2(command = {}, args = {}, state = {}) {
  const tool = String(command?.tool || "");
  if (tool === "browserNavigate") {
    return { ok: true, skipped: true, reason: "navigation_command" };
  }

  const targetUrl = currentUrlFromInput(args, state);
  if (!targetUrl) {
    return { ok: true, skipped: true, reason: "no_target_url" };
  }

  const current = await getPlaywrightCurrentLocationV2();

  if (current.ok === true && sameBrowserActionUrlV2(current.url, targetUrl)) {
    return {
      ok: true,
      skipped: false,
      navigated: false,
      reason: "already_at_target_url",
      currentUrl: current.url,
      targetUrl,
      title: current.title,
    };
  }

  const nav = await callPlaywrightTool(["browser_navigate", "navigate"], { url: targetUrl }).catch((err) => ({
    ok: false,
    text: "",
    error: err instanceof Error ? err.message : String(err),
  }));

  return {
    ok: nav.ok !== false,
    skipped: false,
    navigated: nav.ok !== false,
    reason: nav.ok === false ? "navigate_failed" : "synced_to_target_url",
    previousUrl: current.url || "",
    targetUrl,
    error: nav.error || "",
  };
}

async function tryDomAutoFillTestForm(command = {}, args = {}, state = {}) {
  const commandArgs = command.args || {};
  const formIntent = safeText(commandArgs.formIntent || args.instruction || "", 900);

  const script = `() => {
    const formIntent = ${JSON.stringify(formIntent)};

    const norm = (value) => String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const compact = (value) => norm(value).replace(/\\s+/g, "");

    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const cssEscape = (value) => {
      try { return CSS.escape(String(value || "")); }
      catch { return String(value || "").replace(/["\\\\]/g, "\\\\$&"); }
    };

    const labelFor = (el) => {
      const parts = [];
      const id = el.getAttribute("id") || "";

      if (id) {
        document.querySelectorAll('label[for="' + cssEscape(id) + '"]').forEach((label) => {
          parts.push(label.innerText || label.textContent || "");
        });
      }

      const parentLabel = el.closest("label");
      if (parentLabel) parts.push(parentLabel.innerText || parentLabel.textContent || "");

      let prev = el.previousElementSibling;
      let guard = 0;
      while (prev && guard < 3) {
        if (/label/i.test(prev.tagName || "")) parts.push(prev.innerText || prev.textContent || "");
        prev = prev.previousElementSibling;
        guard += 1;
      }

      parts.push(
        el.getAttribute("aria-label") || "",
        el.getAttribute("placeholder") || "",
        el.getAttribute("name") || "",
        el.getAttribute("id") || "",
        el.getAttribute("type") || "",
        el.tagName || ""
      );

      return parts.join(" ").replace(/\\s+/g, " ").trim();
    };

    const inputType = (el) => String(el.getAttribute("type") || "text").toLowerCase();

    const shouldSkip = (el) => {
      const tag = el.tagName.toLowerCase();
      const type = inputType(el);
      if (!visible(el)) return true;
      if (el.disabled || el.readOnly) return true;
      if (tag === "input" && ["hidden", "submit", "button", "reset", "file", "image", "color", "range"].includes(type)) return true;
      return false;
    };

    const personName = "Test User";
    const slug = "test-user-" + String(Date.now()).slice(-6);

    const valueFor = (el) => {
      const tag = el.tagName.toLowerCase();
      const type = inputType(el);
      const rawLabel = labelFor(el);
      const label = norm(rawLabel);
      const key = compact(rawLabel);

      const attrKey = compact([
        el.getAttribute("name") || "",
        el.getAttribute("id") || "",
        el.getAttribute("aria-label") || "",
        el.getAttribute("placeholder") || "",
        el.getAttribute("autocomplete") || "",
      ].join(" "));

      // Exact field identity wins before fuzzy visible-label matching.
      if (/customerfirstname|firstname|first/.test(attrKey)) return "Test";
      if (/customerlastname|lastname|surname|last/.test(attrKey)) return "User";
      if (/customeraddressstreet|addressstreet|streetaddress|street|address/.test(attrKey)) return "123 Test Street";
      if (/customercity|city/.test(attrKey)) return "Testville";
      if (/customerstate|province|region|state/.test(attrKey)) return "CA";
      if (/customerzipcode|postalcode|postcode|zipcode|zip/.test(attrKey)) return "90210";
      if (/customerssn|ssn|socialsecurity/.test(attrKey)) return "123456789";
      if (/customerphone|phone|mobile|tel/.test(attrKey)) return "5550100";
      if (/country/.test(attrKey)) return "US";
      if (/username|userid|login/.test(attrKey)) return slug;
      if (/repeatedpassword|confirmpassword|confirm|repeat|verify/.test(attrKey)) return slug + "-Pass123";
      if (/password|passcode/.test(attrKey)) return slug + "-Pass123";
      if (/email/.test(attrKey)) return slug + "@example.test";

      if (tag === "textarea") return "Harmless automated test submission";
      if (tag === "select") return "";

      if (type === "password") return slug + "-Pass123";
      if (type === "email" || /email/.test(key)) return slug + "@example.test";
      if (type === "tel" || /phone|mobile|tel/.test(key)) return "5550100";
      if (type === "url" || /website|url/.test(key)) return "https://example.test";
      if (type === "number" || /age|count|quantity|number/.test(key)) return "42";
      if (type === "date") return "2026-01-01";

      // Realistic registration field values.
      if (/firstname|customerfirstname|first name/.test(key) || /\bfirst name\b/.test(label)) return "Test";
      if (/lastname|customerlastname|last name|surname/.test(key) || /\blast name\b/.test(label)) return "User";
      if (/country/.test(key)) return "US";
      if (/city/.test(key)) return "Testville";
      if (/state|province|region/.test(key)) return "CA";
      if (/zipcode|zip|postal/.test(key)) return "90210";
      if (/address|street/.test(key)) return "123 Test Street";
      if (/ssn|socialsecurity/.test(key)) return "123456789";
      if (/username|user name|login/.test(key)) return slug;
      if (/confirm|repeat|verify|repeatedpassword/.test(key)) return slug + "-Pass123";

      if (/name|textinput|mytext|text/.test(key)) return personName;

      return "Test value";
    };

    const setValue = (el, value) => {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      try { el.focus?.(); } catch {}

      if (el.tagName.toLowerCase() === "select") {
        const options = Array.from(el.options || []).filter((option) => !option.disabled);
        const option = options.find((item) => item.value && !/open this select menu|choose|select/i.test(item.textContent || "")) ||
          options.find((item) => item.value) ||
          options[0] ||
          null;
        if (option) el.value = option.value;
      } else if (el.isContentEditable) {
        el.textContent = value;
      } else {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
      }

      try { el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value })); }
      catch { el.dispatchEvent(new Event("input", { bubbles: true })); }

      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    };

    const readValue = (el) => {
      if (el.tagName.toLowerCase() === "select") {
        const opt = el.selectedOptions && el.selectedOptions[0];
        return opt ? (opt.textContent || opt.value || "") : (el.value || "");
      }
      if (el.isContentEditable) return el.textContent || "";
      return el.value || "";
    };

    const controls = Array.from(document.querySelectorAll("input, textarea, select, [contenteditable=true]"))
      .filter((el) => !shouldSkip(el));

    const filled = [];
    const fields = [];
    const skipped = [];

    for (const el of controls) {
      const tag = el.tagName.toLowerCase();
      const type = inputType(el);
      const label = labelFor(el) || tag;
      const value = valueFor(el);

      if (tag === "input" && ["checkbox", "radio"].includes(type)) {
        skipped.push({ label, tag, type, reason: "choice_control_left_as_is" });
        continue;
      }

      setValue(el, value);
      const actual = readValue(el);

      const ok = tag === "select" ? Boolean(actual) : actual === value;

      if (ok) {
        const field = {
          label,
          value,
          type: tag === "textarea" ? "textarea" : type || tag,
          secret: type === "password",
          name: el.getAttribute("name") || "",
          id: el.getAttribute("id") || "",
        };
        fields.push(field);
        filled.push({
          ...field,
          value: type === "password" ? "[redacted]" : actual,
        });
      } else {
        skipped.push({
          label,
          tag,
          type,
          reason: "value_not_confirmed",
          actualLength: actual.length,
        });
      }
    }

    return JSON.stringify({
      ok: fields.length > 0,
      fields,
      filled,
      skipped,
      candidateCount: controls.length,
      url: location.href,
      title: document.title,
    });
  }`;

  const result = await callPlaywrightTool(["browser_evaluate", "evaluate"], { function: script }).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    text: err instanceof Error ? err.message : String(err),
  }));

  if (clickResultFailed(result)) {
    return {
      ok: false,
      error: result.error || result.text || "DOM auto-fill failed.",
      text: result.text || result.error || "",
    };
  }

  const parsed = parseMcpWrappedJsonSafe(result.text || result.error || "");
  return {
    ...result,
    ok: parsed?.ok === true,
    autoFill: parsed || null,
    fields: Array.isArray(parsed?.fields) ? parsed.fields : [],
    error: parsed?.ok === true ? "" : "DOM auto-fill found no fillable fields.",
    text: parsed
      ? "DOM auto-fill " + (parsed.ok ? "confirmed." : "failed.") + " " + safeText(JSON.stringify(parsed), 1600)
      : result.text,
  };
}


function parsePlaywrightUiProbeRepairV1(value = "") {
  const raw = String(value || "").trim();
  const attempts = [raw];

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) attempts.push(raw.slice(first, last + 1));

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (typeof parsed === "string") {
        try { return JSON.parse(parsed); } catch {}
      }
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }

  return null;
}

export async function probePlaywrightUiState(args = {}, state = {}) {
  const currentUrl = currentUrlFromInput(args, state);

  if (currentUrl && args.navigate === true) {
    await callPlaywrightTool(["browser_navigate", "navigate"], { url: currentUrl }).catch(() => null);
  }

  const script = `() => {
    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const textOf = (el) => String(el?.innerText || el?.textContent || "")
      .replace(/\\s+/g, " ")
      .trim()
      .slice(0, 700);

    const dialogs = Array.from(document.querySelectorAll([
      ".modal.show",
      ".modal.fade.show",
      "[aria-modal='true']",
      "[role='dialog']",
      "[role='alertdialog']",
      "dialog[open]"
    ].join(","))).filter(visible);

    const modalBackdrops = Array.from(document.querySelectorAll(".modal-backdrop.show,.modal-backdrop"))
      .filter(visible);

    const dropdowns = Array.from(document.querySelectorAll(".dropdown-menu.show,[role='menu']"))
      .filter(visible);

    const offcanvas = Array.from(document.querySelectorAll(".offcanvas.show,.drawer.open,[data-state='open']"))
      .filter(visible);

    const popovers = Array.from(document.querySelectorAll(".popover.show,[role='tooltip']"))
      .filter(visible);

    const collapses = Array.from(document.querySelectorAll(".collapse.show,.accordion-collapse.show"))
      .filter(visible);

    const expandedControls = Array.from(document.querySelectorAll("[aria-expanded='true']"))
      .filter(visible);

    const mapNode = (el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.getAttribute("id") || "",
      role: el.getAttribute("role") || "",
      ariaModal: el.getAttribute("aria-modal") || "",
      className: String(el.className || ""),
      text: textOf(el)
    });

    return JSON.stringify({
      ok: true,
      url: location.href,
      title: document.title,
      modalOpen: dialogs.length > 0 || modalBackdrops.length > 0,
      dialogOpen: dialogs.length > 0,
      dropdownOpen: dropdowns.length > 0,
      offcanvasOpen: offcanvas.length > 0,
      popoverOpen: popovers.length > 0,
      collapseOpen: collapses.length > 0 || expandedControls.length > 0,
      blockingOpen: dialogs.length > 0 || modalBackdrops.length > 0 || dropdowns.length > 0 || offcanvas.length > 0 || popovers.length > 0,
      dialogs: dialogs.map(mapNode),
      modalBackdrops: modalBackdrops.map(mapNode),
      dropdowns: dropdowns.map(mapNode),
      offcanvas: offcanvas.map(mapNode),
      popovers: popovers.map(mapNode),
      collapses: collapses.map(mapNode),
      expandedControls: expandedControls.map(mapNode)
    });
  }`;

  const result = await callPlaywrightTool(["browser_evaluate", "evaluate"], {
    function: script,
  }).catch((err) => ({
    ok: false,
    text: "",
    error: err instanceof Error ? err.message : String(err),
  }));

  const parsed = parseMcpWrappedJsonSafe(result.text || result.error || "") ||
    parsePlaywrightUiProbeRepairV1(result.text || result.error || "");

  return {
    ok: Boolean(parsed?.ok),
    engine: "playwright_mcp",
    url: safeText(parsed?.url || currentUrl || "", 500),
    title: safeText(parsed?.title || "", 300),
    modalOpen: Boolean(parsed?.modalOpen),
    dialogOpen: Boolean(parsed?.dialogOpen),
    dropdownOpen: Boolean(parsed?.dropdownOpen),
    offcanvasOpen: Boolean(parsed?.offcanvasOpen),
    popoverOpen: Boolean(parsed?.popoverOpen),
    collapseOpen: Boolean(parsed?.collapseOpen),
    blockingOpen: Boolean(parsed?.blockingOpen),
    dialogs: Array.isArray(parsed?.dialogs) ? parsed.dialogs : [],
    modalBackdrops: Array.isArray(parsed?.modalBackdrops) ? parsed.modalBackdrops : [],
    dropdowns: Array.isArray(parsed?.dropdowns) ? parsed.dropdowns : [],
    offcanvas: Array.isArray(parsed?.offcanvas) ? parsed.offcanvas : [],
    popovers: Array.isArray(parsed?.popovers) ? parsed.popovers : [],
    collapses: Array.isArray(parsed?.collapses) ? parsed.collapses : [],
    expandedControls: Array.isArray(parsed?.expandedControls) ? parsed.expandedControls : [],
    error: parsed ? "" : safeText(result.error || result.text || "UI probe returned no parseable JSON.", 900),
  };
}


async function tryPlaywrightClick(command = {}, args = {}, state = {}) {
  const commandArgs = command.args || {};

  const isSyntheticRef = (value = "") =>
    /^lp_(?:link|button|input|form|el)_\d+$/i.test(String(value || "").trim());

  const rawRef = safeText(commandArgs.ref || commandArgs.targetRef || "", 180);
  const ref = rawRef && !isSyntheticRef(rawRef) ? rawRef : "";

  const rawSelector = safeText(
    commandArgs.selector || commandArgs.rawSelector || commandArgs.cssSelector || "",
    500
  );
  const selector = rawSelector && !isSyntheticRef(rawSelector) ? rawSelector : "";

  const text = safeText(
    commandArgs.text ||
    commandArgs.label ||
    commandArgs.buttonText ||
    command.target ||
    "",
    180
  );

  const refOnly = commandArgs.refOnly === true || commandArgs.requireRef === true;
  const selectorOnly = commandArgs.selectorOnly === true || commandArgs.requireSelector === true;

  if (!text && !ref && !selector) {
    return {
      ok: false,
      error: "Click needs visible text, selector, or Playwright snapshot ref.",
      text: "",
    };
  }

  if (refOnly && !ref) {
    return {
      ok: false,
      error: "Ref-only click requires a concrete Playwright snapshot ref. Loose text click blocked.",
      text: "Ref-only click blocked because no concrete Playwright ref was provided.",
    };
  }

  if (selectorOnly && !selector) {
    return {
      ok: false,
      error: "Selector-only click requires a concrete selector. Loose text click blocked.",
      text: "Selector-only click blocked because no concrete selector was provided.",
    };
  }

  const attempts = [];

  if (selector && text) attempts.push({ label: "selector_target", args: { target: selector, element: text } });
  if (selector) attempts.push({ label: "selector_only", args: { target: selector } });

  if (!selectorOnly) {
    if (text && ref) attempts.push({ label: "target_element_ref", args: { target: text, element: text, ref } });
    if (text && ref) attempts.push({ label: "element_ref", args: { element: text, ref } });
    if (text && ref) attempts.push({ label: "target_ref", args: { target: text, ref } });
    if (ref) attempts.push({ label: "ref_as_target", args: { target: ref } });
    if (text) attempts.push({ label: "target_text", args: { target: text } });
    if (text) attempts.push({ label: "element_text", args: { element: text } });
  }

  const failures = [];

  for (const attempt of attempts) {
    const result = await callPlaywrightTool(["browser_click", "click"], attempt.args).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      text: err instanceof Error ? err.message : String(err),
    }));

    if (!clickResultFailed(result)) {
      return {
        ...result,
        ok: true,
        text: ["Click succeeded using " + attempt.label + ".", result.text].filter(Boolean).join("\n"),
      };
    }

    failures.push(attempt.label + ": " + safeText(result.error || result.text || "", 500));
  }

  const domPayload = {
    selector,
    text,
  };

  const domScript = `() => {
    const payload = ${JSON.stringify(domPayload)};

    const norm = (value) => String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const labelFor = (el) => [
      el.innerText || el.textContent || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.getAttribute("value") || "",
      el.getAttribute("name") || "",
      el.getAttribute("id") || "",
      el.getAttribute("data-bs-target") || "",
      el.getAttribute("aria-controls") || ""
    ].filter(Boolean).join(" ");

    let el = null;

    if (payload.selector) {
      try {
        el = Array.from(document.querySelectorAll(payload.selector)).find(visible) || null;
      } catch {}
    }

    if (!el && payload.text) {
      const wanted = norm(payload.text);
      const candidates = Array.from(document.querySelectorAll([
        "button",
        "[role='button']",
        "input[type='button']",
        "input[type='submit']",
        "a[href]",
        "summary"
      ].join(","))).filter(visible);

      el = candidates.find((candidate) => {
        const label = norm(labelFor(candidate));
        return label === wanted || label.includes(wanted) || wanted.includes(label);
      }) || null;
    }

    if (!el) {
      return JSON.stringify({
        ok: false,
        error: "No matching DOM element found.",
        selector: payload.selector,
        text: payload.text
      });
    }

    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    try { el.focus?.(); } catch {}

    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      buttons: 1
    };

    for (const type of ["pointerover", "mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        const Ctor = type.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ctor(type, opts));
      } catch {
        try { el.dispatchEvent(new MouseEvent(type, opts)); } catch {}
      }
    }

    try { el.click?.(); } catch {}

    return JSON.stringify({
      ok: true,
      clickedText: labelFor(el).replace(/\\s+/g, " ").trim().slice(0, 300),
      tag: el.tagName.toLowerCase(),
      id: el.getAttribute("id") || "",
      name: el.getAttribute("name") || "",
      type: el.getAttribute("type") || ""
    });
  }`;

  const domResult = await callPlaywrightTool(["browser_evaluate", "evaluate"], {
    function: domScript,
  }).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    text: err instanceof Error ? err.message : String(err),
  }));

  if (!clickResultFailed(domResult)) {
    const parsed = parseMcpWrappedJsonSafe(domResult.text || domResult.error || "");
    if (parsed?.ok === true) {
      return {
        ...domResult,
        ok: true,
        text: "DOM click fallback executed. " + safeText(JSON.stringify(parsed), 900),
      };
    }

    failures.push("dom_click_fallback: " + safeText(parsed?.error || domResult.text || domResult.error || "", 500));
  } else {
    failures.push("dom_click_fallback: " + safeText(domResult.error || domResult.text || "", 500));
  }

  return {
    ok: false,
    error: "Click failed for all Playwright MCP payloads.",
    text: failures.join("\n"),
  };
}


async function probeDomFormFilledEnoughBeforeSubmitV1(command = {}, args = {}, state = {}) {
  const script = `() => {
    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const inputType = (el) => String(el.getAttribute("type") || "text").toLowerCase();

    const shouldSkip = (el) => {
      const tag = el.tagName.toLowerCase();
      const type = inputType(el);
      if (!visible(el)) return true;
      if (el.disabled || el.readOnly) return true;
      if (tag === "input" && ["hidden", "submit", "button", "reset", "file", "image", "color", "range", "checkbox", "radio"].includes(type)) return true;
      return false;
    };

    const readValue = (el) => {
      if (el.tagName.toLowerCase() === "select") return el.value || "";
      if (el.isContentEditable) return el.textContent || "";
      return el.value || "";
    };

    const controls = Array.from(document.querySelectorAll("input, textarea, select, [contenteditable=true]"))
      .filter((el) => !shouldSkip(el));

    const meaningful = controls.map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: inputType(el),
      name: el.getAttribute("name") || "",
      id: el.getAttribute("id") || "",
      valueLength: readValue(el).trim().length,
    }));

    const textLike = meaningful.filter((item) =>
      item.tag === "textarea" ||
      item.type === "password" ||
      ["text", "email", "search", "tel", "url", "number"].includes(item.type)
    );

    const requiredKinds = {
      hasText: textLike.some((item) => item.type === "text" || item.name.includes("text") || item.id.includes("text")),
      hasPassword: textLike.some((item) => item.type === "password"),
      hasTextarea: textLike.some((item) => item.tag === "textarea"),
    };

    const filledKinds = {
      hasText: textLike.some((item) => (item.type === "text" || item.name.includes("text") || item.id.includes("text")) && item.valueLength > 0),
      hasPassword: textLike.some((item) => item.type === "password" && item.valueLength > 0),
      hasTextarea: textLike.some((item) => item.tag === "textarea" && item.valueLength > 0),
    };

    const missing = [];
    if (requiredKinds.hasText && !filledKinds.hasText) missing.push("text");
    if (requiredKinds.hasPassword && !filledKinds.hasPassword) missing.push("password");
    if (requiredKinds.hasTextarea && !filledKinds.hasTextarea) missing.push("textarea");

    return JSON.stringify({
      ok: true,
      filledEnough: textLike.length > 0 && missing.length === 0,
      missing,
      controls: meaningful,
      url: location.href,
      title: document.title,
    });
  }`;

  const result = await callPlaywrightTool(["browser_evaluate", "evaluate"], {
    function: script,
  }).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    text: err instanceof Error ? err.message : String(err),
  }));

  const parsed = parseMcpWrappedJsonSafe(result.text || result.error || "");

  return {
    ok: parsed?.ok === true,
    filledEnough: parsed?.filledEnough === true,
    missing: Array.isArray(parsed?.missing) ? parsed.missing : [],
    controls: Array.isArray(parsed?.controls) ? parsed.controls : [],
    url: safeText(parsed?.url || "", 500),
    title: safeText(parsed?.title || "", 300),
    error: parsed ? "" : safeText(result.error || result.text || "Could not probe form values.", 900),
  };
}


async function submitDomRegistrationFormV7(command = {}, args = {}, state = {}) {
  const script = `() => {
    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const valueOf = (selector) => {
      const el = document.querySelector(selector);
      return el ? String(el.value || "").trim() : "";
    };

    const form =
      document.querySelector("form input[name='customer.firstName']")?.closest("form") ||
      document.querySelector("form input[name='customer.lastName']")?.closest("form") ||
      document.querySelector("form input[name='customer.address.street']")?.closest("form") ||
      document.querySelector("form input[name='customer.ssn']")?.closest("form") ||
      document.querySelector("form input[name='repeatedPassword']")?.closest("form") ||
      null;

    if (!form) {
      return JSON.stringify({
        ok: false,
        reason: "registration_form_not_found",
        title: document.title,
        url: location.href,
      });
    }

    const required = [
      ["firstName", "input[name='customer.firstName']"],
      ["lastName", "input[name='customer.lastName']"],
      ["address", "input[name='customer.address.street']"],
      ["city", "input[name='customer.address.city']"],
      ["state", "input[name='customer.address.state']"],
      ["zipCode", "input[name='customer.address.zipCode']"],
      ["phone", "input[name='customer.phoneNumber']"],
      ["ssn", "input[name='customer.ssn']"],
      ["username", "input[name='customer.username'], input[name='username']"],
      ["password", "input[name='customer.password'], input[name='password']"],
      ["confirm", "input[name='repeatedPassword'], input[name='confirm'], input[name='passwordConfirm']"]
    ];

    const values = {};
    const missing = [];

    for (const [name, selector] of required) {
      const value = valueOf(selector);
      values[name] = name === "password" || name === "confirm" ? (value ? "[redacted]" : "") : value;
      if (!value) missing.push(name);
    }

    if (missing.length) {
      return JSON.stringify({
        ok: false,
        reason: "registration_form_has_missing_values_before_submit",
        missing,
        values,
        title: document.title,
        url: location.href,
      });
    }

    const submit =
      Array.from(form.querySelectorAll("input[type='submit'], button[type='submit'], button, input[type='button']"))
        .filter(visible)
        .find((el) => /register|submit|create/i.test(String(el.value || el.innerText || el.textContent || ""))) ||
      form.querySelector("input[type='submit'], button[type='submit']");

    if (!submit) {
      return JSON.stringify({
        ok: false,
        reason: "registration_submit_button_not_found",
        values,
        title: document.title,
        url: location.href,
      });
    }

    submit.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    try { submit.focus?.(); } catch {}

    try {
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit(submit);
      } else {
        submit.click();
      }
    } catch {
      try { submit.click(); } catch {}
    }

    return JSON.stringify({
      ok: true,
      reason: "registration_form_submit_requested",
      buttonText: String(submit.value || submit.innerText || submit.textContent || "").trim(),
      values,
      title: document.title,
      url: location.href,
    });
  }`;

  const result = await callPlaywrightTool(["browser_evaluate", "evaluate"], {
    function: script,
  }).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    text: err instanceof Error ? err.message : String(err),
  }));

  if (clickResultFailed(result)) {
    return {
      ok: false,
      error: result.error || result.text || "Registration DOM submit failed.",
      text: result.text || result.error || "",
    };
  }

  const parsed = parseMcpWrappedJsonSafe(result.text || result.error || "") ||
    parseMcpJsonResult(result.text || result.error || "");

  return {
    ...result,
    ok: parsed?.ok === true,
    registrationSubmit: parsed || null,
    error: parsed?.ok === true ? "" : parsed?.reason || "Registration DOM submit failed.",
    text: parsed
      ? "Registration DOM submit " + (parsed.ok ? "requested." : "blocked.") + " " + safeText(JSON.stringify(parsed), 1600)
      : result.text,
  };
}

function isRegistrationSubmitCommandV7(command = {}, args = {}) {
  const haystack = [
    command.intent,
    command.tool,
    command.args?.currentUrl,
    command.args?.url,
    command.args?.formIntent,
    command.args?.text,
    command.args?.buttonText,
    args.currentUrl,
  ].map((value) => String(value || "")).join(" ").toLowerCase();

  return /\b(register|registration|new customer|create account|sign up|signup)\b/.test(haystack) ||
    /\/register(?:\.htm)?/i.test(haystack);
}


async function executeApprovedAction(command = {}, args = {}, state = {}) {
  const tool = command.tool || "unknown";
  const commandArgs = command.args || {};

  if (tool === "browserNavigate") {
    const url = normalizeUrl(commandArgs.url || command.url || command.target || "");
    if (!url) return { ok: false, error: "Navigation needs a valid URL." };
    return callPlaywrightTool(["browser_navigate", "navigate"], { url });
  }

  if (tool === "browserObserve" || tool === "browserScrape" || tool === "browserShowActions") {
    return callPlaywrightTool(["browser_snapshot", "snapshot"], {});
  }

  if (tool === "browserClickByText") {
    return tryPlaywrightClick(command, args, state);
  }

  if (tool === "browserFillFields") {
    if (commandArgs.autoFillTestData === true) {
      const autoFill = await tryDomAutoFillTestForm(command, args, state);
      return {
        ok: autoFill.ok === true,
        autoFill,
        fields: autoFill.fields || [],
        verify: { ok: autoFill.ok === true },
        error: autoFill.ok === true ? "" : autoFill.error || "Auto-fill failed.",
        text: autoFill.text || autoFill.error || "",
      };
    }

    const fields = fieldsFromCommand(command);
    if (!fields.length) return { ok: false, error: "Fill needs at least one field." };

    const formFill = await tryPlaywrightFillForm(fields);

    const results = [];
    for (const field of fields) {
      results.push(await tryPlaywrightTypeField(field));
    }

    const verifyAfterType = await verifyFilledFields(fields);
    if (verifyAfterType.ok === true) {
      return {
        ok: true,
        formFill,
        results,
        verify: verifyAfterType,
        text: [
          formFill.text || formFill.error || "",
          results.map((result) => result.text || result.error || "").filter(Boolean).join("\n"),
          verifyAfterType.text || "",
        ].filter(Boolean).join("\n"),
      };
    }

    const domFallback = await tryDomFillFields(fields);
    const verifyAfterDom = await verifyFilledFields(fields);

    return {
      ok: verifyAfterDom.ok === true,
      formFill,
      results,
      domFallback,
      verify: verifyAfterDom,
      error: verifyAfterDom.ok === true ? "" : verifyAfterDom.error || domFallback.error || "Fill failed verification.",
      text: [
        formFill.text || formFill.error || "",
        results.map((result) => result.text || result.error || "").filter(Boolean).join("\n"),
        domFallback.text || domFallback.error || "",
        verifyAfterDom.text || verifyAfterDom.error || "",
      ].filter(Boolean).join("\n"),
    };
  }

  if (tool === "browserSubmitForm") {
    if (isRegistrationSubmitCommandV7(command, args)) {
      return submitDomRegistrationFormV7(command, args, state);
    }

    const text = safeText(commandArgs.text || commandArgs.submitText || commandArgs.buttonText || "Submit", 180);
    return tryPlaywrightClick({
      ...command,
      tool: "browserClickByText",
      args: {
        ...commandArgs,
        text,
        ref: commandArgs.ref || commandArgs.selector || commandArgs.target || text,
      },
    }, args, state);
  }


  if (tool === "browserFillAndSubmit") {
    if (isRegistrationSubmitCommandV7(command, args)) {
      const submit = await submitDomRegistrationFormV7(command, args, state);
      return {
        ok: Boolean(submit.ok),
        fill: {
          ok: true,
          skipped: true,
          text: "Skipped re-fill before registration submit; using existing verified DOM values.",
        },
        submit,
        text: [
          "Skipped re-fill before registration submit; using existing verified DOM values.",
          submit.text || submit.error || "",
        ].filter(Boolean).join("\n"),
      };
    }

    const fill = await executeApprovedAction({ ...command, tool: "browserFillFields" }, args, state);
    if (!fill.ok) return fill;

    const submit = await executeApprovedAction({ ...command, tool: "browserSubmitForm" }, args, state);
    return {
      ok: Boolean(submit.ok),
      fill,
      submit,
      text: [fill.text, submit.text].filter(Boolean).join("\n"),
    };
  }


  return {
    ok: false,
    error: `Unsupported Playwright MCP command: ${tool}`,
  };
}

export async function executePlaywrightMcpBrowserCommand({
  command = {},
  args = {},
  state = {},
  beforeSnapshot = null,
  beforeObservation = null,
  skipBeforeSnapshot = false,
} = {}) {
  // Keep Playwright standing beside Lightpanda:
  // - navigate Playwright if it is on a different/blank page
  // - do NOT reload when already on the same page, because that clears form state
  const liveSyncV2 = await ensurePlaywrightAtLiveActionUrlV2(command, args, state);

  let before;

  if (beforeSnapshot) {
    before = {
      ok: true,
      status: "reused",
      engine: "playwright_mcp",
      snapshot: beforeSnapshot,
      observation: {
        ok: Boolean(beforeSnapshot.text || beforeSnapshot.dom?.textPreview),
        url: beforeSnapshot.url || "",
        title: beforeSnapshot.title || "",
        textPreview: safeText(beforeSnapshot.text || beforeSnapshot.dom?.textPreview || "", 5000),
        engine: "playwright_mcp",
        links: [],
        buttons: [],
        inputs: [],
        forms: [],
        interactiveElements: [],
        stats: {},
      },
      error: "",
    };
  } else if (skipBeforeSnapshot) {
    const currentUrl = currentUrlFromInput(args, state) || beforeObservation?.url || "";
    before = {
      ok: true,
      status: "skipped",
      engine: "playwright_mcp",
      snapshot: null,
      observation: {
        ok: Boolean(beforeObservation?.ok || beforeObservation?.url || currentUrl),
        url: beforeObservation?.url || currentUrl,
        title: beforeObservation?.title || "",
        textPreview: safeText(beforeObservation?.textPreview || beforeObservation?.text || "", 5000),
        engine: beforeObservation?.engine || "lightpanda_cdp",
        links: Array.isArray(beforeObservation?.links) ? beforeObservation.links : [],
        buttons: Array.isArray(beforeObservation?.buttons) ? beforeObservation.buttons : [],
        inputs: Array.isArray(beforeObservation?.inputs) ? beforeObservation.inputs : [],
        forms: Array.isArray(beforeObservation?.forms) ? beforeObservation.forms : [],
        interactiveElements: Array.isArray(beforeObservation?.interactiveElements) ? beforeObservation.interactiveElements : [],
        stats: beforeObservation?.stats || {},
      },
      error: "",
    };
  } else {
    // Important: do not navigate/reload before live actions.
    // Reloading here clears form values before click/submit/fill.
    const shouldNavigateBeforeSnapshot = command?.tool === "browserNavigate";
    before = await capturePlaywrightMcpSnapshot({
      ...args,
      label: "before",
      navigate: shouldNavigateBeforeSnapshot,
    }, state);
  }

  const action = await executeApprovedAction(command, { ...args, beforeSnapshot: before.snapshot || beforeSnapshot || null }, state);

  const after = await capturePlaywrightMcpSnapshot({
    ...args,
    label: "after",
    navigate: false,
  }, state);

  const afterHasEvidence = after.ok === true || snapshotHasEvidence(after.snapshot) || Boolean(after.observation?.url || after.observation?.title);
  const afterError = after.error && !(afterHasEvidence && isNonFatalScreenshotError(after.error))
    ? after.error
    : "";

  return {
    ok: action.ok !== false,
    status: action.ok === false ? "failed" : "executed",
    engine: "playwright_mcp",
    tool: command.tool || "unknown",
    actionResult: action,
    liveSync: liveSyncV2,
    beforeSnapshot: before.snapshot,
    afterSnapshot: after.snapshot,
    observation: after.observation,
    error: action.error || afterError || "",
    screenshotWarning: after.error && !afterError ? after.error : "",
  };
}

export function snapshotImagesForModel(...snapshots) {
  return snapshots
    .filter(Boolean)
    .map((snapshot) => snapshot.imageBase64 || snapshot.snapshot?.imageBase64 || "")
    .map((image) => String(image || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ""))
    .filter(Boolean)
    .slice(0, 4);
}

export function compactSnapshotForModel(snapshot = null) {
  if (!snapshot) return null;
  return {
    label: snapshot.label || "",
    capturedAt: snapshot.capturedAt || "",
    url: snapshot.url || "",
    title: snapshot.title || "",
    hasImage: Boolean(snapshot.imageBase64),
    imagePath: snapshot.imagePath || "",
    screenshotError: snapshot.screenshotError || "",
    textPreview: safeText(snapshot.text || snapshot.dom?.textPreview || "", 3000),
    mcpSnapshotTool: snapshot.mcpSnapshotTool || "",
    mcpScreenshotTool: snapshot.mcpScreenshotTool || "",
  };
}
