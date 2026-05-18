import WebSocket from "ws";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const DEFAULT_CDP_URL = "ws://127.0.0.1:9222";
const DEFAULT_TIMEOUT_MS = 12000;

function cdpUrl() {
  return (process.env.BROWSER_CDP_URL || process.env.CHROME_CDP_URL || process.env.LIGHTPANDA_CDP_URL || DEFAULT_CDP_URL).trim();
}

function browserEngine() {
  return (process.env.BROWSER_ENGINE || "lightpanda").trim();
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.BROWSER_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((entry) => fs.existsSync(entry));
}

function normalizeUrl(input = "") {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("browser url is required");
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) return raw;
  return `https://${raw}`;
}

function safeText(value, limit = 16000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpSession {
  constructor(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Lightpanda CDP connect timeout: ${this.url}`));
      }, this.timeoutMs);

      ws.once("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      });
      ws.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      ws.on("message", (data) => {
        const msg = JSON.parse(String(data));
        if (msg.id && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else pending.resolve(msg.result);
          return;
        }
        if (msg.method) this.events.push(msg);
      });
      ws.on("close", () => {
        for (const pending of this.pending.values()) {
          pending.reject(new Error("Lightpanda CDP connection closed"));
        }
        this.pending.clear();
      });
    });
  }

  call(method, params = {}, timeoutMs = this.timeoutMs, sessionId = "") {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Lightpanda CDP is not connected"));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Lightpanda CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.ws.send(payload);
    });
  }

  waitForEvent(method, timeoutMs = 5000) {
    const existingIndex = this.events.findIndex((event) => event.method === method);
    if (existingIndex !== -1) {
      const [event] = this.events.splice(existingIndex, 1);
      return Promise.resolve(event.params || {});
    }
    return new Promise((resolve) => {
      const started = Date.now();
      const interval = setInterval(() => {
        const index = this.events.findIndex((event) => event.method === method);
        if (index !== -1) {
          clearInterval(interval);
          const [event] = this.events.splice(index, 1);
          resolve(event.params || {});
          return;
        }
        if (Date.now() - started > timeoutMs) {
          clearInterval(interval);
          resolve(null);
        }
      }, 40);
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

async function withSession(fn, options = {}) {
  const startedAt = Date.now();
  const session = new CdpSession(cdpUrl(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  await session.connect();
  try {
    const result = await fn(session, startedAt);
    return {
      ...result,
      engine: browserEngine(),
      cdpUrl: cdpUrl().replace(/token=[^&]+/i, "token=***"),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    session.close();
  }
}

export async function lightpandaStatus() {
  const startedAt = Date.now();
  try {
    return await withSession(async (session) => {
      const version = await session.call("Browser.getVersion", {});
      return {
        ok: true,
        status: "ready",
        version,
      };
    }, { timeoutMs: 2000 });
  } catch (err) {
    return {
      ok: false,
      status: "down",
      engine: browserEngine(),
      cdpUrl: cdpUrl().replace(/token=[^&]+/i, "token=***"),
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
      hint: "Start Lightpanda with: lightpanda serve --host 127.0.0.1 --port 9222, or run Chrome with --remote-debugging-port=9222 and set BROWSER_CDP_URL/CHROME_CDP_URL.",
    };
  }
}

export async function lightpandaNavigate(args = {}) {
  const url = normalizeUrl(args.url || args.query || "");
  const waitMs = Math.max(250, Math.min(Number(args.waitMs || 1200), 8000));
  return withSession(async (session) => {
    const target = await session.call("Target.createTarget", { url: "about:blank" });
    const targetId = target?.targetId;
    const attached = await session.call("Target.attachToTarget", { targetId, flatten: true });
    const sid = attached?.sessionId || "";
    await session.call("Page.enable", {}, DEFAULT_TIMEOUT_MS, sid);
    await session.call("Runtime.enable", {}, DEFAULT_TIMEOUT_MS, sid);
    await session.call("Page.navigate", { url }, DEFAULT_TIMEOUT_MS, sid);
    await Promise.race([session.waitForEvent("Page.loadEventFired", 8000), wait(waitMs)]);
    await wait(waitMs);
    const expression = `(() => {
      const pick = (value, limit = 160) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit);
      const firstPicked = (values, limit = 160) => {
        for (const value of values) {
          const text = pick(value, limit);
          if (text) return text;
        }
        return "";
      };
      const absoluteUrl = (value) => {
        const raw = String(value || "").trim();
        if (!raw) return "";
        try { return new URL(raw, location.href).href; } catch { return raw; }
      };
      const nodeText = (node, limit = 12000) => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const parts = [];
        let current;
        while ((current = walker.nextNode()) && parts.length < 1600) {
          const parent = current.parentElement;
          if (parent && parent.closest("script, style, noscript, svg, template")) continue;
          if (parent && parent.getAttribute("aria-hidden") === "true") continue;
          const text = pick(current.nodeValue, 220);
          if (text) parts.push(text);
        }
        return pick(parts.join(" "), limit);
      };
      const seenLinks = new Set();
      const links = Array.from(document.querySelectorAll("a[href]")).map((a) => {
        const href = absoluteUrl(a.href || a.getAttribute("href"));
        const text = firstPicked([
          a.innerText,
          a.textContent,
          a.getAttribute("aria-label"),
          a.getAttribute("title"),
          href
        ], 140) || href;
        return { text, href };
      }).filter((link) => {
        const key = link.href || link.text;
        if (!key || seenLinks.has(key)) return false;
        seenLinks.add(key);
        return true;
      }).slice(0, 120);
      const forms = Array.from(document.querySelectorAll("form")).slice(0, 20).map((form, index) => ({
        index,
        action: form.action || "",
        method: form.method || "get",
        fields: Array.from(form.querySelectorAll("input, textarea, select")).slice(0, 40).map((field) => ({
          name: field.getAttribute("name") || "",
          type: field.getAttribute("type") || field.tagName.toLowerCase(),
          placeholder: field.getAttribute("placeholder") || "",
          required: field.hasAttribute("required")
        }))
      }));
      return {
        url: location.href,
        title: document.title || "",
        text: document.body ? nodeText(document.body, 12000) : "",
        links,
        forms,
        stats: {
          links: links.length,
          forms: forms.length,
          scripts: document.scripts.length,
          images: document.images.length
        }
      };
    })()`;
    const evaluated = await session.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, DEFAULT_TIMEOUT_MS, sid);
    const value = evaluated?.result?.value || {};
    if (targetId) {
      await session.call("Target.closeTarget", { targetId }).catch(() => null);
    }
    return {
      ok: true,
      requestedUrl: url,
      page: value,
    };
  });
}

export async function lightpandaFetch(args = {}) {
  const result = await lightpandaNavigate(args);
  return safeText(result);
}

export async function openHeadfulBrowser(args = {}) {
  const url = normalizeUrl(args.url || "about:blank");
  const executable = chromeExecutable();
  if (!executable) {
    throw new Error("Chrome executable was not found. Set CHROME_PATH or BROWSER_CHROME_PATH.");
  }

  const port = Number(process.env.BROWSER_CDP_PORT || 9222);
  const userDataDir = process.env.CHROME_USER_DATA_DIR || path.join(os.tmpdir(), "reterm-headful-chrome");
  fs.mkdirSync(userDataDir, { recursive: true });

  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();

  return {
    ok: true,
    engine: "chrome-headful",
    url,
    pid: child.pid,
    cdpUrl: `ws://127.0.0.1:${port}`,
    note: "Opened a real Chrome window with remote debugging so the AI browser tools can share the same CDP port.",
  };
}

export function getLightpandaConfig() {
  return {
    engine: "lightpanda",
    cdpUrl: cdpUrl().replace(/token=[^&]+/i, "token=***"),
    configured: Boolean(process.env.BROWSER_CDP_URL || process.env.CHROME_CDP_URL || process.env.LIGHTPANDA_CDP_URL),
    defaultCdpUrl: DEFAULT_CDP_URL,
    docs: "https://lightpanda.io/docs/open-source/usage",
    headful: {
      supported: Boolean(chromeExecutable()),
      cdpUrl: `ws://127.0.0.1:${Number(process.env.BROWSER_CDP_PORT || 9222)}`,
    },
  };
}
