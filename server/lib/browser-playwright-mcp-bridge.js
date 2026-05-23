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

function fieldsFromCommand(command = {}) {
  return Array.isArray(command.args?.fields) ? command.args.fields : Array.isArray(command.fields) ? command.fields : [];
}

function targetTextFromCommand(command = {}) {
  return safeText(
    command.args?.text ||
    command.args?.label ||
    command.args?.buttonText ||
    command.target ||
    "",
    240,
  );
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

async function tryPlaywrightClick(command = {}, args = {}, state = {}) {
  const commandArgs = command.args || {};
  const text = targetTextFromCommand(command);
  const ref = safeText(commandArgs.ref || commandArgs.selector || "", 180);

  if (!text && !ref) return { ok: false, error: "Click needs visible text or snapshot ref." };

  const attempts = [];
  if (text && ref) attempts.push({ label: "target_element_ref", args: { target: text, element: text, ref } });
  if (text && ref) attempts.push({ label: "element_ref", args: { element: text, ref } });
  if (text && ref) attempts.push({ label: "target_ref", args: { target: text, ref } });
  if (ref) attempts.push({ label: "ref_as_target", args: { target: ref } });
  if (text) attempts.push({ label: "target_text", args: { target: text } });
  if (text) attempts.push({ label: "element_text", args: { element: text } });

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

  const href = hrefNearSnapshotTarget(args.beforeSnapshot, { text, ref });
  if (href) {
    const nav = await callPlaywrightTool(["browser_navigate", "navigate"], { url: href }).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      text: err instanceof Error ? err.message : String(err),
    }));

    if (!clickResultFailed(nav)) {
      return {
        ...nav,
        ok: true,
        text: [
          "Direct click failed, but snapshot showed link URL. Navigated to " + href + " as click fallback.",
          nav.text,
        ].filter(Boolean).join("\n"),
      };
    }

    failures.push("href_fallback: " + safeText(nav.error || nav.text || "", 500));
  }

  return {
    ok: false,
    error: "Click failed for all Playwright MCP payloads.",
    text: failures.join("\n"),
  };
}

function fieldDisplayName(field = {}) {
  return safeText(
    field.label ||
    field.name ||
    field.id ||
    field.placeholder ||
    field.selector ||
    field.ref ||
    "field",
    180
  );
}

function fieldIsSecret(field = {}) {
  const haystack = [
    field.label,
    field.name,
    field.id,
    field.placeholder,
    field.selector,
    field.type,
  ].map((item) => String(item || "")).join(" ").toLowerCase();

  return Boolean(field.secret) || /password|passcode|pin|otp|token|secret/.test(haystack);
}

function redactedFieldValue(field = {}, value = "") {
  if (fieldIsSecret(field)) return "[redacted]";
  return safeText(value, 120);
}

function uniqueAttemptList(attempts = []) {
  const seen = new Set();
  return attempts.filter((attempt) => {
    const key = JSON.stringify(attempt.args || {});
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function playwrightFieldType(field = {}) {
  const haystack = [
    field.type,
    field.role,
    field.label,
    field.name,
    field.placeholder,
  ].map((item) => String(item || "")).join(" ").toLowerCase();

  if (/checkbox/.test(haystack)) return "checkbox";
  if (/radio/.test(haystack)) return "radio";
  if (/combo|select|dropdown/.test(haystack)) return "combobox";
  return "textbox";
}

function fillFormFieldsFromCommand(fields = []) {
  return fields
    .map((field) => {
      const target = safeText(field.ref || field.selector || field.target || "", 180);
      const name = fieldDisplayName(field);
      const value = String(field.value ?? "");

      if (!target || !name) return null;

      return {
        target,
        name,
        type: playwrightFieldType(field),
        value,
      };
    })
    .filter(Boolean);
}

async function tryPlaywrightFillForm(fields = []) {
  const mcpFields = fillFormFieldsFromCommand(fields);

  if (!mcpFields.length) {
    return {
      ok: false,
      error: "browser_fill_form needs snapshot targets.",
      text: "",
    };
  }

  const result = await callPlaywrightTool(["browser_fill_form", "fill_form"], {
    fields: mcpFields,
  }).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    text: err instanceof Error ? err.message : String(err),
  }));

  if (clickResultFailed(result)) {
    return {
      ...result,
      ok: false,
      error: result.error || result.text || "browser_fill_form failed.",
      text: result.text || result.error || "",
    };
  }

  return {
    ...result,
    ok: true,
    text: ["browser_fill_form succeeded.", result.text].filter(Boolean).join("\n"),
  };
}

function typeAttemptsForField(field = {}) {
  const label = fieldDisplayName(field);
  const target = safeText(field.ref || field.selector || field.target || "", 180);
  const placeholder = safeText(field.placeholder || "", 180);
  const name = safeText(field.name || field.id || "", 180);
  const value = String(field.value ?? "");

  return uniqueAttemptList([
    target ? { label: "target_ref", args: { element: label || target, target, text: value, slowly: true } } : null,
    placeholder ? { label: "placeholder", args: { element: placeholder, target: placeholder, text: value, slowly: true } } : null,
    name ? { label: "name_or_id", args: { element: name, target: name, text: value, slowly: true } } : null,
    label ? { label: "label", args: { element: label, target: label, text: value, slowly: true } } : null,
  ].filter(Boolean));
}

async function tryPlaywrightTypeField(field = {}) {
  const label = fieldDisplayName(field);
  const value = String(field.value ?? "");
  if (!value && value !== "") return { ok: false, error: "Field value is missing.", text: "" };

  const attempts = typeAttemptsForField(field);
  const failures = [];

  for (const attempt of attempts) {
    // Focus first when possible. If focus/click fails, still try browser_type.
    await callPlaywrightTool(["browser_click", "click"], {
      element: attempt.args.element,
      target: attempt.args.target,
    }).catch(() => null);

    const result = await callPlaywrightTool(["browser_type", "type"], attempt.args).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      text: err instanceof Error ? err.message : String(err),
    }));

    if (!clickResultFailed(result)) {
      return {
        ...result,
        ok: true,
        text: `Filled ${label} using ${attempt.label} with ${redactedFieldValue(field, value)}.`,
      };
    }

    failures.push(`${attempt.label}: ${safeText(result.error || result.text || "", 500)}`);
  }

  return {
    ok: false,
    error: `Could not type into ${label}.`,
    text: failures.join("\n"),
  };
}

async function tryDomFillFields(fields = []) {
  const payload = fields.map((field) => ({
    label: fieldDisplayName(field),
    name: safeText(field.name || field.id || "", 180),
    placeholder: safeText(field.placeholder || "", 180),
    type: safeText(field.type || "", 80),
    value: String(field.value ?? ""),
    secret: fieldIsSecret(field),
  }));

  const script = `() => {
    const fields = ${JSON.stringify(payload)};

    const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };

    const textFor = (el) => {
      const parts = [];
      const id = el.getAttribute("id");
      if (id) {
        document.querySelectorAll('label[for="' + CSS.escape(id) + '"]').forEach((label) => parts.push(label.textContent || ""));
      }
      const parentLabel = el.closest("label");
      if (parentLabel) parts.push(parentLabel.textContent || "");
      parts.push(
        el.getAttribute("aria-label") || "",
        el.getAttribute("placeholder") || "",
        el.getAttribute("name") || "",
        el.getAttribute("id") || "",
        el.getAttribute("type") || ""
      );
      return parts.join(" ");
    };

    const candidates = Array.from(document.querySelectorAll("input, textarea, [contenteditable=true]")).filter(visible);
    const filled = [];
    const missing = [];

    function setNativeValue(el, value) {
      if (el.isContentEditable) {
        el.focus();
        el.textContent = value;
      } else {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        el.focus();
        if (setter) setter.call(el, value);
        else el.value = value;
      }

      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    for (const field of fields) {
      const wanted = [field.label, field.name, field.placeholder].map(norm).filter(Boolean);
      const isSecret = field.secret || /password|pass|pin|otp|secret/.test(norm(field.label + " " + field.name + " " + field.type));

      let target = candidates.find((el) => {
        const hay = norm(textFor(el));
        return wanted.some((needle) => needle && hay.includes(needle));
      });

      if (!target && isSecret) {
        target = candidates.find((el) => String(el.getAttribute("type") || "").toLowerCase() === "password");
      }

      if (!target) {
        missing.push(field.label);
        continue;
      }

      setNativeValue(target, field.value);
      filled.push({
        label: field.label,
        secret: field.secret,
        value: field.secret ? "[redacted]" : field.value,
      });
    }

    return { ok: missing.length === 0, filled, missing };
  }`;

  const result = await callPlaywrightTool(["browser_evaluate", "evaluate"], { function: script }).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    text: err instanceof Error ? err.message : String(err),
  }));

  if (clickResultFailed(result)) {
    return {
      ok: false,
      error: "DOM fill fallback failed.",
      text: result.error || result.text || "",
    };
  }

  return {
    ...result,
    ok: true,
    text: ["DOM fill fallback executed.", result.text].filter(Boolean).join("\n"),
  };
}

function parseMcpJsonResult(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  return null;
}

async function verifyFilledFields(fields = []) {
  const payload = fields.map((field) => ({
    label: fieldDisplayName(field),
    name: safeText(field.name || field.id || "", 180),
    placeholder: safeText(field.placeholder || "", 180),
    type: safeText(field.type || "", 80),
    value: String(field.value ?? ""),
    secret: fieldIsSecret(field),
  }));

  const script = `() => {
    const fields = ${JSON.stringify(payload)};
    const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const textFor = (el) => {
      const parts = [];
      const id = el.getAttribute("id");
      if (id) document.querySelectorAll('label[for="' + CSS.escape(id) + '"]').forEach((label) => parts.push(label.textContent || ""));
      const parentLabel = el.closest("label");
      if (parentLabel) parts.push(parentLabel.textContent || "");
      parts.push(el.getAttribute("aria-label") || "", el.getAttribute("placeholder") || "", el.getAttribute("name") || "", el.getAttribute("id") || "", el.getAttribute("type") || "");
      return parts.join(" ");
    };
    const candidates = Array.from(document.querySelectorAll("input, textarea, [contenteditable=true]")).filter(visible);
    const filled = [];
    const missing = [];
    for (const field of fields) {
      const wanted = [field.label, field.name, field.placeholder].map(norm).filter(Boolean);
      const isSecret = field.secret || /password|pass|pin|otp|secret/.test(norm(field.label + " " + field.name + " " + field.type));
      let target = candidates.find((el) => {
        const hay = norm(textFor(el));
        return wanted.some((needle) => needle && hay.includes(needle));
      });
      if (!target && isSecret) target = candidates.find((el) => String(el.getAttribute("type") || "").toLowerCase() === "password");
      const actual = target ? (target.isContentEditable ? target.textContent || "" : target.value || "") : "";
      if (target && actual === field.value) filled.push({ label: field.label, secret: field.secret });
      else missing.push({ label: field.label, actualLength: actual.length });
    }
    return { ok: missing.length === 0, filled, missing };
  }`;

  const result = await callPlaywrightTool(["browser_evaluate", "evaluate"], { function: script }).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    text: err instanceof Error ? err.message : String(err),
  }));

  if (clickResultFailed(result)) {
    return { ok: false, error: result.error || result.text || "Field verification failed.", text: result.text || "" };
  }

  const parsed = parseMcpJsonResult(result.text);
  return {
    ...result,
    ok: parsed?.ok === true,
    verification: parsed || null,
    text: parsed ? "Field verification " + (parsed.ok ? "passed" : "failed") + "." : result.text,
  };
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
    before = await capturePlaywrightMcpSnapshot({ ...args, label: "before" }, state);
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
