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
    /invalid_type|expected .* received|tool call failed/i.test(text)
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
    const text = targetTextFromCommand(command);
    if (!text) return { ok: false, error: "Click needs visible text." };

    return callPlaywrightTool(["browser_click", "click"], {
      target: text,
      element: text,
      ref: commandArgs.ref || commandArgs.selector || text,
    });
  }

  if (tool === "browserFillFields") {
    const fields = fieldsFromCommand(command);
    if (!fields.length) return { ok: false, error: "Fill needs at least one field." };

    const results = [];
    for (const field of fields) {
      const label = safeText(field.label || field.name || field.id || field.placeholder || field.selector || "", 180);
      const value = String(field.value ?? "");

      results.push(await callPlaywrightTool(["browser_type", "type"], {
        element: label,
        ref: field.ref || field.selector || label,
        text: value,
      }));
    }

    return {
      ok: results.every((result) => !/error/i.test(result.text || "")),
      results,
      text: results.map((result) => result.text).join("\n"),
    };
  }

  if (tool === "browserSubmitForm") {
    const text = safeText(commandArgs.text || commandArgs.submitText || commandArgs.buttonText || "Submit", 180);
    return callPlaywrightTool(["browser_click", "click"], {
      element: text,
      ref: commandArgs.ref || commandArgs.selector || text,
    });
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

export async function executePlaywrightMcpBrowserCommand({ command = {}, args = {}, state = {}, beforeSnapshot = null } = {}) {
  const before = beforeSnapshot
    ? {
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
      }
    : await capturePlaywrightMcpSnapshot({ ...args, label: "before" }, state);

  const action = await executeApprovedAction(command, args, state);

  const after = await capturePlaywrightMcpSnapshot({
    ...args,
    label: "after",
    navigate: false,
  }, state);

  return {
    ok: action.ok !== false,
    status: action.ok === false ? "failed" : "executed",
    engine: "playwright_mcp",
    tool: command.tool || "unknown",
    actionResult: action,
    beforeSnapshot: before.snapshot,
    afterSnapshot: after.snapshot,
    observation: after.observation,
    error: action.error || after.error || "",
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
