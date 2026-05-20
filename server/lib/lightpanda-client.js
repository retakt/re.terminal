import WebSocket from "ws";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const DEFAULT_CDP_URL = "ws://127.0.0.1:9222";
const DEFAULT_TIMEOUT_MS = 12000;

function cdpUrl(options = {}) {
  return String(options.cdpUrl || process.env.BROWSER_CDP_URL || process.env.CHROME_CDP_URL || process.env.LIGHTPANDA_CDP_URL || DEFAULT_CDP_URL).trim();
}

function browserEngine(options = {}) {
  return String(options.engineName || options.engine || process.env.BROWSER_ENGINE || "lightpanda").trim();
}

function redactUrl(value = "") {
  return String(value || "").replace(/token=[^&]+/i, "token=***");
}

function httpVersionUrlFromCdp(rawUrl = "") {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "ws:" && url.protocol !== "wss:" && url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }

    const isRootWs = (url.protocol === "ws:" || url.protocol === "wss:") && (!url.pathname || url.pathname === "/");
    const isHttpBase = (url.protocol === "http:" || url.protocol === "https:") && !/\/json\/version\/?$/i.test(url.pathname);

    if (!isRootWs && !isHttpBase) return "";

    url.protocol = url.protocol === "wss:" || url.protocol === "https:" ? "https:" : "http:";
    url.pathname = "/json/version";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

async function resolveCdpWebSocketUrl(rawUrl = DEFAULT_CDP_URL, timeoutMs = 900) {
  const versionUrl = httpVersionUrlFromCdp(rawUrl);
  if (!versionUrl) return rawUrl;

  try {
    const response = await fetch(versionUrl, {
      signal: AbortSignal.timeout(Math.max(250, Math.min(Number(timeoutMs || 900), 2500))),
    });
    if (!response.ok) return rawUrl;
    const data = await response.json().catch(() => ({}));
    return String(data.webSocketDebuggerUrl || data.webSocketUrl || rawUrl).trim() || rawUrl;
  } catch {
    return rawUrl;
  }
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

function isLikelyBrowserUrl(input = "") {
  const raw = String(input || "").trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) return true;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) return false;
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#][^\s]*)?$/i.test(raw);
}

function normalizeOptionalUrl(input = "") {
  const raw = String(input || "").trim();
  return isLikelyBrowserUrl(raw) ? normalizeUrl(raw) : "";
}

function safeText(value, limit = 16000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function pageCompatibilityScript() {
  return [
    '(function(){',
    '  function patchContext(ctx){',
    '    if (!ctx || typeof ctx !== "object") ctx = {};',
    '    if (typeof ctx.measureText !== "function") {',
    '      ctx.measureText = function(text){',
    '        var value = String(text == null ? "" : text);',
    '        var width = Math.max(0, value.length * 7);',
    '        return { width: width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 3 };',
    '      };',
    '    }',
    '    var noopNames = ["save","restore","scale","rotate","translate","transform","setTransform","resetTransform","clearRect","fillRect","strokeRect","beginPath","closePath","moveTo","lineTo","bezierCurveTo","quadraticCurveTo","arc","arcTo","ellipse","rect","fill","stroke","clip","fillText","strokeText","drawImage","putImageData","createImageData","getImageData"];',
    '    for (var i=0;i<noopNames.length;i++){ if (typeof ctx[noopNames[i]] !== "function") ctx[noopNames[i]] = function(){}; }',
    '    if (typeof ctx.createLinearGradient !== "function") ctx.createLinearGradient = function(){ return { addColorStop:function(){} }; };',
    '    if (typeof ctx.createRadialGradient !== "function") ctx.createRadialGradient = function(){ return { addColorStop:function(){} }; };',
    '    if (typeof ctx.createPattern !== "function") ctx.createPattern = function(){ return {}; };',
    '    return ctx;',
    '  }',
    '  if (typeof HTMLCanvasElement !== "undefined") {',
    '    var proto = HTMLCanvasElement.prototype;',
    '    var originalGetContext = proto.getContext;',
    '    proto.getContext = function(type){',
    '      var ctx = null;',
    '      if (typeof originalGetContext === "function") {',
    '        try { ctx = originalGetContext.apply(this, arguments); } catch(e) { ctx = null; }',
    '      }',
    '      if (!ctx && String(type || "").toLowerCase().indexOf("2d") !== -1) ctx = {};',
    '      return patchContext(ctx);',
    '    };',
    '  }',
    '})();'
  ].join('\n');
}

async function installPageCompatibility(session, sid = '') {
  const source = pageCompatibilityScript();
  await session.call('Page.addScriptToEvaluateOnNewDocument', { source }, DEFAULT_TIMEOUT_MS, sid).catch(() => null);
  await session.call('Runtime.evaluate', { expression: source, returnByValue: true, awaitPromise: true }, DEFAULT_TIMEOUT_MS, sid).catch(() => null);
}
class CdpSession {
  constructor(url, timeoutMs = DEFAULT_TIMEOUT_MS, label = "Browser") {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.label = label;
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
        reject(new Error(`${this.label} CDP connect timeout: ${this.url}`));
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
          pending.reject(new Error(`${this.label} CDP connection closed`));
        }
        this.pending.clear();
      });
    });
  }

  call(method, params = {}, timeoutMs = this.timeoutMs, sessionId = "") {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`${this.label} CDP is not connected`));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label} CDP timeout: ${method}`));
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
  const configuredUrl = cdpUrl(options);
  const engineName = browserEngine(options);
  const resolvedUrl = await resolveCdpWebSocketUrl(configuredUrl, Math.min(Number(options.timeoutMs || DEFAULT_TIMEOUT_MS), 1800));
  const session = new CdpSession(resolvedUrl, options.timeoutMs || DEFAULT_TIMEOUT_MS, engineName);
  await session.connect();
  try {
    const result = await fn(session, startedAt);
    return {
      ...result,
      engine: engineName,
      cdpUrl: redactUrl(configuredUrl),
      resolvedCdpUrl: redactUrl(resolvedUrl),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    session.close();
  }
}

export async function lightpandaStatus(args = {}) {
  const startedAt = Date.now();
  try {
    return await withSession(async (session) => {
      const version = await session.call("Browser.getVersion", {});
      return {
        ok: true,
        status: "ready",
        version,
      };
    }, { timeoutMs: Number(args.timeoutMs || 2000), cdpUrl: args.cdpUrl, engineName: args.engineName });
  } catch (err) {
    return {
      ok: false,
      status: "down",
      engine: browserEngine(args),
      cdpUrl: redactUrl(cdpUrl(args)),
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
    await installPageCompatibility(session, sid);
    await session.call("Page.navigate", { url }, DEFAULT_TIMEOUT_MS, sid);
    await Promise.race([session.waitForEvent("Page.loadEventFired", 8000), wait(waitMs)]);
    await wait(waitMs);
    const value = await evaluateBasicSnapshot(session, sid);
    if (targetId) {
      await session.call("Target.closeTarget", { targetId }).catch(() => null);
    }
    return {
      ok: true,
      requestedUrl: url,
      page: value,
    };
  }, { timeoutMs: args.timeoutMs || DEFAULT_TIMEOUT_MS, cdpUrl: args.cdpUrl, engineName: args.engineName });
}

export async function lightpandaFetch(args = {}) {
  const result = await lightpandaNavigate(args);
  return safeText(result);
}

function browserSnapshotExpression() {
  return `(() => {
    const pick = (value, limit = 160) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit);
    const absoluteUrl = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      try { return new URL(raw, location.href).href; } catch { return raw; }
    };
    const nodeText = (node, limit = 16000) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const parts = [];
      let current;
      while ((current = walker.nextNode()) && parts.length < 2200) {
        const parent = current.parentElement;
        if (parent && parent.closest("script, style, noscript, svg, template")) continue;
        if (parent && parent.getAttribute("aria-hidden") === "true") continue;
        const text = pick(current.nodeValue, 260);
        if (text) parts.push(text);
      }
      return pick(parts.join(" "), limit);
    };

    const links = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      text: pick(a.innerText || a.textContent || a.getAttribute("aria-label") || a.getAttribute("title") || a.href, 180),
      href: absoluteUrl(a.href || a.getAttribute("href")),
    })).filter((link) => link.href).slice(0, 160);

    const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']")).map((el, index) => ({
      index,
      text: pick(el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || el.value || el.name, 160),
      selector: el.id ? "#" + el.id : "",
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || "",
    })).filter((button) => button.text || button.selector).slice(0, 80);

    const forms = Array.from(document.querySelectorAll("form")).slice(0, 30).map((form, index) => ({
      index,
      action: form.action || "",
      method: form.method || "get",
      selector: form.id ? "#" + form.id : "",
      fields: Array.from(form.querySelectorAll("input, textarea, select")).slice(0, 80).map((field, fieldIndex) => ({
        index: fieldIndex,
        name: field.getAttribute("name") || "",
        id: field.getAttribute("id") || "",
        type: field.getAttribute("type") || field.tagName.toLowerCase(),
        placeholder: field.getAttribute("placeholder") || "",
        ariaLabel: field.getAttribute("aria-label") || "",
        required: field.hasAttribute("required"),
        selector: field.id ? "#" + field.id : field.name ? "[name='" + field.name.replace(/'/g, "\\\\'") + "']" : "",
      })),
      buttons: Array.from(form.querySelectorAll("button, input[type='submit'], input[type='button']")).slice(0, 20).map((button) => ({
        text: pick(button.innerText || button.textContent || button.getAttribute("aria-label") || button.value || button.name, 160),
        type: button.getAttribute("type") || "",
      })),
    }));

    return {
      url: location.href,
      title: document.title || "",
      text: document.body ? nodeText(document.body, 16000) : "",
      links,
      forms,
      buttons,
      stats: {
        links: links.length,
        forms: forms.length,
        buttons: buttons.length,
        scripts: document.scripts.length,
        images: document.images.length,
        inputs: document.querySelectorAll("input, textarea, select").length,
      },
    };
  })()`;
}

async function evaluateBrowserSnapshot(session, sid) {
  const evaluated = await session.call("Runtime.evaluate", {
    expression: browserSnapshotExpression(),
    returnByValue: true,
    awaitPromise: true,
  }, DEFAULT_TIMEOUT_MS, sid);

  return evaluated?.result?.value || {};
}

function semanticSnapshotExpression() {
  return `(() => {
    const pick = (value, limit = 180) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit);
    const quote = (value) => String(value || "").replace(/\\\\/g, "\\\\\\\\").replace(/'/g, "\\\\'");
    const cssEscape = (value) => globalThis.CSS && typeof CSS.escape === "function"
      ? CSS.escape(String(value || ""))
      : String(value || "").replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
    const absoluteUrl = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      try { return new URL(raw, location.href).href; } catch { return raw; }
    };
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const stableSelector = (el) => {
      if (!el || !el.tagName) return "";
      const tag = el.tagName.toLowerCase();
      const id = el.getAttribute("id");
      if (id) return "#" + cssEscape(id);
      for (const attr of ["data-testid", "data-test", "data-cy", "aria-label", "name", "title"]) {
        const value = el.getAttribute(attr);
        if (value) return tag + "[" + attr + "='" + quote(value) + "']";
      }
      if (tag === "a") {
        const href = el.getAttribute("href");
        if (href && !/^javascript:/i.test(href)) return "a[href='" + quote(href) + "']";
      }
      return "";
    };
    const roleFor = (el) => {
      const explicit = el.getAttribute("role");
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === "a") return "link";
      if (tag === "button") return "button";
      if (tag === "input") return el.getAttribute("type") || "input";
      if (tag === "select") return "select";
      if (tag === "textarea") return "textbox";
      return tag;
    };
    const labelFor = (el) => {
      if (!el) return "";
      const id = el.getAttribute("id");
      const labels = [];
      if (id) {
        const explicit = document.querySelector("label[for='" + quote(id) + "']");
        if (explicit) labels.push(explicit.innerText || explicit.textContent || "");
      }
      const wrapped = el.closest("label");
      if (wrapped) labels.push(wrapped.innerText || wrapped.textContent || "");
      labels.push(
        el.innerText,
        el.textContent,
        el.getAttribute("aria-label"),
        el.getAttribute("placeholder"),
        el.getAttribute("title"),
        el.getAttribute("name"),
        el.value && /^(button|submit)$/i.test(el.getAttribute("type") || "") ? el.value : ""
      );
      return pick(labels.filter(Boolean).join(" "), 180);
    };
    const nodeText = (node, limit = 16000) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const parts = [];
      let current;
      while ((current = walker.nextNode()) && parts.length < 2200) {
        const parent = current.parentElement;
        if (parent && parent.closest("script, style, noscript, svg, template")) continue;
        if (parent && parent.getAttribute("aria-hidden") === "true") continue;
        const text = pick(current.nodeValue, 260);
        if (text) parts.push(text);
      }
      return pick(parts.join(" "), limit);
    };

    const interactiveElements = Array.from(document.querySelectorAll("a[href], button, input, textarea, select, [role='button'], [role='link']"))
      .filter(visible)
      .map((el, index) => {
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute("type") || "";
        const label = labelFor(el);
        const selector = stableSelector(el);
        const href = tag === "a" ? absoluteUrl(el.href || el.getAttribute("href")) : "";
        return {
          index,
          tag,
          role: roleFor(el),
          type,
          text: label,
          selector,
          href,
          id: el.getAttribute("id") || "",
          name: el.getAttribute("name") || "",
          ariaLabel: el.getAttribute("aria-label") || "",
          placeholder: el.getAttribute("placeholder") || "",
          required: el.hasAttribute("required"),
          secret: /password/i.test(type),
        };
      })
      .slice(0, 220);

    const links = interactiveElements
      .filter((entry) => entry.tag === "a" && entry.href)
      .map((entry) => ({ text: entry.text || entry.href, href: entry.href, selector: entry.selector, index: entry.index }))
      .slice(0, 160);

    const buttons = interactiveElements
      .filter((entry) => entry.role === "button" || /^(button|submit)$/i.test(entry.type))
      .map((entry) => ({ index: entry.index, text: entry.text, selector: entry.selector, tag: entry.tag, type: entry.type, id: entry.id, name: entry.name }))
      .slice(0, 100);

    const inputs = interactiveElements
      .filter((entry) => ["input", "textarea", "select"].includes(entry.tag))
      .map((entry) => ({
        index: entry.index,
        tag: entry.tag,
        type: entry.type || entry.tag,
        name: entry.name,
        id: entry.id,
        placeholder: entry.placeholder,
        ariaLabel: entry.ariaLabel,
        required: entry.required,
        secret: entry.secret,
        selector: entry.selector,
      }))
      .slice(0, 120);

    const forms = Array.from(document.querySelectorAll("form")).slice(0, 30).map((form, index) => ({
      index,
      action: form.action || "",
      method: form.method || "get",
      selector: stableSelector(form),
      fields: Array.from(form.querySelectorAll("input, textarea, select")).slice(0, 80).map((field, fieldIndex) => ({
        index: fieldIndex,
        name: field.getAttribute("name") || "",
        id: field.getAttribute("id") || "",
        type: field.getAttribute("type") || field.tagName.toLowerCase(),
        placeholder: field.getAttribute("placeholder") || "",
        ariaLabel: field.getAttribute("aria-label") || "",
        required: field.hasAttribute("required"),
        secret: /password/i.test(field.getAttribute("type") || ""),
        selector: stableSelector(field),
      })),
      buttons: Array.from(form.querySelectorAll("button, input[type='submit'], input[type='button']")).slice(0, 30).map((button) => ({
        text: labelFor(button),
        type: button.getAttribute("type") || "",
        selector: stableSelector(button),
      })),
    }));

    return {
      url: location.href,
      title: document.title || "",
      text: document.body ? nodeText(document.body, 16000) : "",
      links,
      buttons,
      inputs,
      forms,
      interactiveElements,
      stats: {
        links: links.length,
        buttons: buttons.length,
        inputs: inputs.length,
        forms: forms.length,
        scripts: document.scripts.length,
        images: document.images.length,
      },
    };
  })()`;
}


async function evaluateSmall(session, sid, name, expression, fallback, timeoutMs = 2200) {
  try {
    const evaluated = await session.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: false,
    }, timeoutMs, sid);
    return {
      ok: true,
      value: evaluated?.result?.value ?? fallback,
    };
  } catch (err) {
    return {
      ok: false,
      value: fallback,
      error: {
        name,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function evaluateBasicSnapshot(session, sid) {
  const failures = [];
  const pickPrelude = "const pick = (value, limit = 240) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);";

  const urlTitle = await evaluateSmall(
    session,
    sid,
    "url_title",
    `(() => { ${pickPrelude} return { url: location.href || '', title: document.title || '' }; })()`,
    { url: "", title: "" },
    1400
  );
  if (urlTitle.error) failures.push(urlTitle.error);

  const links = await evaluateSmall(
    session,
    sid,
    "links",
    `(() => { ${pickPrelude}
      const absoluteUrl = (value) => { const raw = String(value || '').trim(); if (!raw) return ''; try { return new URL(raw, location.href).href; } catch { return raw; } };
      return Array.from(document.querySelectorAll('a[href]')).slice(0, 120).map((a, index) => ({
        index,
        text: pick(a.innerText || a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || a.href, 180),
        href: absoluteUrl(a.href || a.getAttribute('href')),
        selector: a.id ? '#' + a.id : ''
      })).filter((link) => link.href || link.text);
    })()`,
    [],
    2200
  );
  if (links.error) failures.push(links.error);

  const buttons = await evaluateSmall(
    session,
    sid,
    "buttons",
    `(() => { ${pickPrelude}
      return Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], [role='button']")).slice(0, 100).map((button, index) => ({
        index,
        text: pick(button.innerText || button.textContent || button.getAttribute('aria-label') || button.getAttribute('title') || button.value || button.name, 180),
        selector: button.id ? '#' + button.id : '',
        tag: button.tagName ? button.tagName.toLowerCase() : '',
        type: button.getAttribute ? (button.getAttribute('type') || '') : ''
      })).filter((button) => button.text || button.selector);
    })()`,
    [],
    2200
  );
  if (buttons.error) failures.push(buttons.error);

  const forms = await evaluateSmall(
    session,
    sid,
    "forms",
    `(() => { ${pickPrelude}
      return Array.from(document.querySelectorAll('form')).slice(0, 25).map((form, index) => ({
        index,
        action: form.action || '',
        method: form.method || 'get',
        selector: form.id ? '#' + form.id : '',
        fields: Array.from(form.querySelectorAll('input, textarea, select')).slice(0, 60).map((field, fieldIndex) => ({
          index: fieldIndex,
          name: field.getAttribute('name') || '',
          id: field.getAttribute('id') || '',
          type: field.getAttribute('type') || field.tagName.toLowerCase(),
          placeholder: field.getAttribute('placeholder') || '',
          ariaLabel: field.getAttribute('aria-label') || '',
          selector: field.id ? '#' + field.id : '',
          secret: /password/i.test(field.getAttribute('type') || '')
        }))
      }));
    })()`,
    [],
    2200
  );
  if (forms.error) failures.push(forms.error);

  const text = await evaluateSmall(
    session,
    sid,
    "text",
    `(() => { ${pickPrelude}
      return pick(document.body ? (document.body.innerText || document.body.textContent || '') : '', 4000);
    })()`,
    "",
    2200
  );
  if (text.error) failures.push(text.error);

  const safeLinks = Array.isArray(links.value) ? links.value : [];
  const safeButtons = Array.isArray(buttons.value) ? buttons.value : [];
  const safeForms = Array.isArray(forms.value) ? forms.value : [];
  const inputs = safeForms.flatMap((form) => Array.isArray(form.fields) ? form.fields : []);

  return {
    url: urlTitle.value?.url || "",
    title: urlTitle.value?.title || "",
    text: typeof text.value === "string" ? text.value : "",
    textPreview: typeof text.value === "string" ? text.value : "",
    links: safeLinks,
    buttons: safeButtons,
    inputs,
    forms: safeForms,
    interactiveElements: [
      ...safeButtons.map((button) => ({ ...button, role: "button" })),
      ...safeLinks.map((link) => ({ ...link, role: "link", tag: "a" })),
      ...inputs.map((input) => ({ ...input, role: input.type || "input", tag: input.tag || "input" })),
    ],
    stats: {
      links: safeLinks.length,
      buttons: safeButtons.length,
      forms: safeForms.length,
      inputs: inputs.length,
      extractionFailures: failures.length,
    },
    fallback: failures.length ? "basic-partial" : "basic",
    extractionErrors: failures,
  };
}

async function evaluateSemanticSnapshot(session, sid) {
  const evaluated = await session.call("Runtime.evaluate", {
    expression: semanticSnapshotExpression(),
    returnByValue: true,
    awaitPromise: true,
  }, DEFAULT_TIMEOUT_MS, sid);

  return evaluated?.result?.value || {};
}

async function openPageTarget(session, url, waitMs) {
  const target = await session.call("Target.createTarget", { url: "about:blank" });
  const targetId = target?.targetId;
  const attached = await session.call("Target.attachToTarget", { targetId, flatten: true });
  const sid = attached?.sessionId || "";

  await session.call("Page.enable", {}, DEFAULT_TIMEOUT_MS, sid);
  await session.call("Runtime.enable", {}, DEFAULT_TIMEOUT_MS, sid);
  await installPageCompatibility(session, sid);
  await session.call("Page.navigate", { url }, DEFAULT_TIMEOUT_MS, sid);
  await Promise.race([session.waitForEvent("Page.loadEventFired", 8000), wait(waitMs)]);
  await wait(waitMs);

  return { targetId, sid };
}

async function attachToCurrentPageTarget(session, args = {}) {
  const waitMs = Math.max(150, Math.min(Number(args.waitMs || 900), 8000));
  const requestedUrl = normalizeOptionalUrl(args.url || args.currentUrl || "");
  const shouldNavigate = Boolean(args.navigate && requestedUrl);
  const targets = await session.call("Target.getTargets", {}).catch(() => ({ targetInfos: [] }));
  const pages = Array.isArray(targets?.targetInfos)
    ? targets.targetInfos.filter((target) => target.type === "page")
    : [];

  const normalizedRequested = requestedUrl.toLowerCase().replace(/\/+$/, "");
  let selected = null;

  if (normalizedRequested) {
    selected = pages.find((target) =>
      String(target.url || "").toLowerCase().replace(/\/+$/, "") === normalizedRequested
    ) || null;
  }

  if (!selected) {
    selected = pages.find((target) =>
      /^https?:\/\//i.test(String(target.url || "")) && !/devtools/i.test(String(target.url || ""))
    ) || pages.find((target) =>
      target.url && target.url !== "about:blank" && !/devtools/i.test(String(target.url || ""))
    ) || pages[0] || null;
  }

  let targetId = selected?.targetId || "";
  let created = false;

  if (!targetId) {
    const target = await session.call("Target.createTarget", { url: requestedUrl || "about:blank" });
    targetId = target?.targetId || "";
    created = true;
  }

  const attached = await session.call("Target.attachToTarget", { targetId, flatten: true });
  const sid = attached?.sessionId || "";

  await session.call("Page.enable", {}, DEFAULT_TIMEOUT_MS, sid);
  await session.call("Runtime.enable", {}, DEFAULT_TIMEOUT_MS, sid);
  await installPageCompatibility(session, sid);

  if ((created && requestedUrl) || shouldNavigate) {
    await session.call("Page.navigate", { url: requestedUrl }, DEFAULT_TIMEOUT_MS, sid);
    await Promise.race([session.waitForEvent("Page.loadEventFired", 8000), wait(waitMs)]);
    await wait(waitMs);
  }

  return { targetId, sid, created, requestedUrl, selectedUrl: selected?.url || "" };
}

async function withCurrentPage(fn, args = {}) {
  return withSession(async (session) => {
    const target = await attachToCurrentPageTarget(session, args);
    return fn(session, target.sid, target);
  }, { timeoutMs: args.timeoutMs || DEFAULT_TIMEOUT_MS, cdpUrl: args.cdpUrl, engineName: args.engineName });
}

function normalizeActionFields(fields) {
  if (Array.isArray(fields)) {
    return fields.map((field) => ({
      selector: String(field?.selector || ""),
      name: String(field?.name || ""),
      id: String(field?.id || ""),
      label: String(field?.label || ""),
      placeholder: String(field?.placeholder || ""),
      type: String(field?.type || ""),
      value: String(field?.value ?? ""),
    }));
  }

  if (fields && typeof fields === "object") {
    return Object.entries(fields).map(([name, value]) => ({
      name,
      value: String(value ?? ""),
    }));
  }

  return [];
}

function hasPasswordField(fields) {
  return normalizeActionFields(fields).some((field) =>
    /password/i.test(`${field.type} ${field.name} ${field.id} ${field.selector} ${field.label} ${field.placeholder}`)
  );
}

async function fillPageFields(session, sid, fields) {
  const safeFields = normalizeActionFields(fields);
  const expression = `(() => {
    const fields = ${JSON.stringify(safeFields)};
    const pick = (value) => String(value || "").replace(/\\s+/g, " ").trim().toLowerCase();

    const labelTextFor = (el) => {
      const id = el.getAttribute("id");
      const labels = [];
      if (id) {
        const explicit = document.querySelector("label[for='" + id.replace(/'/g, "\\\\'") + "']");
        if (explicit) labels.push(explicit.innerText || explicit.textContent || "");
      }
      const wrapped = el.closest("label");
      if (wrapped) labels.push(wrapped.innerText || wrapped.textContent || "");
      return pick(labels.join(" "));
    };

    const matches = (el, field) => {
      const haystack = pick([
        el.getAttribute("name"),
        el.getAttribute("id"),
        el.getAttribute("placeholder"),
        el.getAttribute("aria-label"),
        el.getAttribute("autocomplete"),
        labelTextFor(el)
      ].join(" "));

      const needles = [
        field.name,
        field.id,
        field.label,
        field.placeholder
      ].map(pick).filter(Boolean);

      if (!needles.length) return false;
      return needles.some((needle) => haystack.includes(needle));
    };

    const elements = Array.from(document.querySelectorAll("input, textarea, select"));
    const filled = [];
    const missing = [];

    for (const field of fields) {
      let el = null;

      if (field.selector) {
        try { el = document.querySelector(field.selector); } catch {}
      }

      if (!el) {
        el = elements.find((candidate) => matches(candidate, field));
      }

      if (!el) {
        missing.push({
          key: field.selector || field.name || field.id || field.label || field.placeholder || "unknown",
        });
        continue;
      }

      const value = String(field.value ?? "");
      el.focus();

      if (el.tagName.toLowerCase() === "select") {
        const option = Array.from(el.options || []).find((entry) =>
          pick(entry.value) === pick(value) || pick(entry.textContent) === pick(value)
        );
        if (option) el.value = option.value;
        else el.value = value;
      } else {
        el.value = value;
      }

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));

      const type = String(el.getAttribute("type") || el.tagName.toLowerCase()).toLowerCase();
      filled.push({
        key: field.selector || field.name || field.id || field.label || field.placeholder || "field",
        type,
        redacted: type === "password",
        valuePreview: type === "password" ? "[redacted]" : String(value).slice(0, 80),
      });
    }

    return { ok: true, filled, missing };
  })()`;

  const evaluated = await session.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, DEFAULT_TIMEOUT_MS, sid);

  return evaluated?.result?.value || { ok: false, filled: [], missing: [] };
}

async function clickPageElement(session, sid, args = {}) {
  const payload = {
    selector: String(args.selector || ""),
    text: String(args.text || args.buttonText || args.linkText || ""),
    index: args.index === undefined ? null : Number(args.index),
  };

  const expression = `(() => {
    const payload = ${JSON.stringify(payload)};
    const pick = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const wanted = pick(payload.text).toLowerCase();

    let el = null;

    if (payload.selector) {
      try { el = document.querySelector(payload.selector); } catch {}
    }

    const candidates = Array.from(document.querySelectorAll("button, a, input[type='submit'], input[type='button'], [role='button']"));

    if (!el && Number.isInteger(payload.index) && candidates[payload.index]) {
      el = candidates[payload.index];
    }

    if (!el && wanted) {
      el = candidates.find((candidate) => {
        const text = pick(candidate.innerText || candidate.textContent || candidate.getAttribute("aria-label") || candidate.getAttribute("title") || candidate.value || candidate.href).toLowerCase();
        return text.includes(wanted);
      });
    }

    if (!el) {
      return { ok: false, error: "click target not found", target: payload };
    }

    const label = pick(el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || el.value || el.href);
    el.scrollIntoView({ block: "center", inline: "center" });
    el.click();

    return {
      ok: true,
      clicked: {
        text: label.slice(0, 160),
        tag: el.tagName.toLowerCase(),
        href: el.href || "",
      },
    };
  })()`;

  const evaluated = await session.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, DEFAULT_TIMEOUT_MS, sid);

  await Promise.race([session.waitForEvent("Page.loadEventFired", 6000), wait(Number(args.afterWaitMs || 900))]);
  await wait(Number(args.afterWaitMs || 900));

  return evaluated?.result?.value || { ok: false, error: "click failed" };
}

async function submitPageForm(session, sid, args = {}) {
  const payload = {
    formSelector: String(args.formSelector || ""),
    formIndex: args.formIndex === undefined ? 0 : Number(args.formIndex),
    buttonText: String(args.buttonText || args.text || ""),
  };

  const expression = `(() => {
    const payload = ${JSON.stringify(payload)};
    const pick = (value) => String(value || "").replace(/\\s+/g, " ").trim();

    let form = null;

    if (payload.formSelector) {
      try { form = document.querySelector(payload.formSelector); } catch {}
    }

    const forms = Array.from(document.querySelectorAll("form"));
    if (!form) form = forms[payload.formIndex] || forms[0] || null;

    if (!form) {
      const submitButton = Array.from(document.querySelectorAll("button, input[type='submit']")).find((button) => {
        if (!payload.buttonText) return true;
        const text = pick(button.innerText || button.textContent || button.value || button.getAttribute("aria-label")).toLowerCase();
        return text.includes(payload.buttonText.toLowerCase());
      });

      if (!submitButton) return { ok: false, error: "no form or submit button found" };

      submitButton.click();
      return { ok: true, submitted: "button", text: pick(submitButton.innerText || submitButton.textContent || submitButton.value) };
    }

    if (payload.buttonText) {
      const button = Array.from(form.querySelectorAll("button, input[type='submit'], input[type='button']")).find((entry) => {
        const text = pick(entry.innerText || entry.textContent || entry.value || entry.getAttribute("aria-label")).toLowerCase();
        return text.includes(payload.buttonText.toLowerCase());
      });
      if (button) {
        button.click();
        return { ok: true, submitted: "form-button", text: pick(button.innerText || button.textContent || button.value) };
      }
    }

    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();

    return { ok: true, submitted: "form", action: form.action || "", method: form.method || "get" };
  })()`;

  const evaluated = await session.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, DEFAULT_TIMEOUT_MS, sid);

  await Promise.race([session.waitForEvent("Page.loadEventFired", 8000), wait(Number(args.afterWaitMs || 1400))]);
  await wait(Number(args.afterWaitMs || 1400));

  return evaluated?.result?.value || { ok: false, error: "submit failed" };
}

export async function lightpandaAction(args = {}) {
  const url = normalizeUrl(args.url || args.currentUrl || "");
  const action = String(args.action || "snapshot").toLowerCase();
  const waitMs = Math.max(250, Math.min(Number(args.waitMs || 1200), 8000));

  if (action === "submit" && hasPasswordField(args.fields) && args.confirm !== true) {
    return {
      ok: false,
      engine: browserEngine(args),
      action,
      requestedUrl: url,
      error: "Refusing to submit a form containing a password field without confirm=true.",
      nextRequired: "Ask the user to confirm form submission.",
    };
  }

  return withSession(async (session) => {
    const { targetId, sid } = await openPageTarget(session, url, waitMs);

    let actionResult = { ok: true, action: "snapshot", skipped: true };

    if (action === "fill") {
      actionResult = await fillPageFields(session, sid, args.fields || args.field || []);
    } else if (action === "click") {
      actionResult = await clickPageElement(session, sid, args);
    } else if (action === "submit") {
      const fillResult = args.fields ? await fillPageFields(session, sid, args.fields) : null;
      const submitResult = await submitPageForm(session, sid, args);
      actionResult = { ok: Boolean(submitResult?.ok), action: "submit", fillResult, submitResult };
    } else if (action !== "snapshot") {
      actionResult = { ok: false, action, error: `Unknown browser action: ${action}` };
    }

    const page = await evaluateBrowserSnapshot(session, sid);

    if (targetId) {
      await session.call("Target.closeTarget", { targetId }).catch(() => null);
    }

    return {
      ok: Boolean(actionResult?.ok),
      action,
      requestedUrl: url,
      actionResult,
      page,
    };
  }, { timeoutMs: args.timeoutMs || DEFAULT_TIMEOUT_MS, cdpUrl: args.cdpUrl, engineName: args.engineName });
}

export async function lightpandaSnapshotCurrent(args = {}) {
  const page = await withCurrentPage(async (session, sid, target) => {
    let snapshot;
    let snapshotError = "";

    try {
      snapshot = await evaluateSemanticSnapshot(session, sid);
    } catch (err) {
      snapshotError = err instanceof Error ? err.message : String(err);
      snapshot = await evaluateBasicSnapshot(session, sid);
    }

    if (!snapshot?.url && !snapshot?.title && !snapshot?.text && !snapshot?.links?.length && !snapshot?.buttons?.length) {
      const basic = await evaluateBasicSnapshot(session, sid);
      if (basic?.url || basic?.title || basic?.text || basic?.links?.length || basic?.buttons?.length) {
        snapshot = basic;
        snapshotError = snapshotError || "semantic snapshot returned no observable page data";
      }
    }

    return {
      ok: true,
      action: "snapshot",
      target: {
        targetId: target.targetId,
        created: target.created,
        selectedUrl: target.selectedUrl,
        requestedUrl: target.requestedUrl,
      },
      snapshotError,
      page: snapshot,
    };
  }, args);

  return page;
}

export async function lightpandaWaitForSelector(args = {}) {
  const selector = String(args.selector || "").trim();
  if (!selector) throw new Error("selector is required");
  const timeoutMs = Math.max(250, Math.min(Number(args.timeoutMs || args.waitMs || 2500), 12000));

  return withCurrentPage(async (session, sid) => {
    const expression = `(() => new Promise((resolve) => {
      const selector = ${JSON.stringify(selector)};
      const started = Date.now();
      const timeoutMs = ${JSON.stringify(timeoutMs)};
      const tick = () => {
        let el = null;
        try { el = document.querySelector(selector); } catch (err) {
          resolve({ ok: false, error: "invalid selector", selector });
          return;
        }
        if (el) {
          const rect = el.getBoundingClientRect();
          resolve({ ok: true, selector, visible: rect.width > 0 && rect.height > 0 });
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          resolve({ ok: false, error: "selector not found", selector });
          return;
        }
        setTimeout(tick, 80);
      };
      tick();
    }))()`;

    const evaluated = await session.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, timeoutMs + 1000, sid);

    return evaluated?.result?.value || { ok: false, error: "selector wait failed", selector };
  }, args);
}

export async function lightpandaFindInteractiveElements(args = {}) {
  const result = await lightpandaSnapshotCurrent(args);
  return {
    ok: Boolean(result?.ok),
    page: {
      url: result?.page?.url || "",
      title: result?.page?.title || "",
    },
    interactiveElements: result?.page?.interactiveElements || [],
    buttons: result?.page?.buttons || [],
    links: result?.page?.links || [],
    inputs: result?.page?.inputs || [],
  };
}

async function clickCurrentPageElement(args = {}) {
  const payload = {
    selector: String(args.selector || ""),
    text: String(args.text || args.buttonText || args.linkText || ""),
    exact: args.exact === true,
    afterWaitMs: Math.max(150, Math.min(Number(args.afterWaitMs || 900), 8000)),
  };

  return withCurrentPage(async (session, sid) => {
    const expression = `(() => {
      const payload = ${JSON.stringify(payload)};
      const pick = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const quote = (value) => String(value || "").replace(/\\\\/g, "\\\\\\\\").replace(/'/g, "\\\\'");
      const cssEscape = (value) => globalThis.CSS && typeof CSS.escape === "function"
        ? CSS.escape(String(value || ""))
        : String(value || "").replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const stableSelector = (el) => {
        if (!el || !el.tagName) return "";
        const tag = el.tagName.toLowerCase();
        const id = el.getAttribute("id");
        if (id) return "#" + cssEscape(id);
        for (const attr of ["data-testid", "data-test", "data-cy", "aria-label", "name", "title"]) {
          const value = el.getAttribute(attr);
          if (value) return tag + "[" + attr + "='" + quote(value) + "']";
        }
        if (tag === "a") {
          const href = el.getAttribute("href");
          if (href && !/^javascript:/i.test(href)) return "a[href='" + quote(href) + "']";
        }
        return "";
      };
      const labelFor = (el) => pick(
        el.innerText ||
        el.textContent ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.getAttribute("placeholder") ||
        el.value ||
        el.href ||
        ""
      );

      let el = null;
      if (payload.selector) {
        try { el = document.querySelector(payload.selector); } catch {}
      }

      const wanted = pick(payload.text).toLowerCase();
      const candidates = Array.from(document.querySelectorAll("button, a[href], input[type='submit'], input[type='button'], [role='button'], [role='link']"))
        .filter(visible);

      if (!el && wanted) {
        el = candidates.find((candidate) => {
          const text = labelFor(candidate).toLowerCase();
          return payload.exact ? text === wanted : text.includes(wanted) || wanted.includes(text);
        }) || null;
      }

      if (!el) {
        return { ok: false, error: "click target not found", target: { selector: payload.selector, text: payload.text } };
      }

      const label = labelFor(el);
      const selector = stableSelector(el);
      const tag = el.tagName.toLowerCase();
      const href = el.href || "";

      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();

      return {
        ok: true,
        clicked: {
          text: label.slice(0, 180),
          selector,
          tag,
          href,
          role: el.getAttribute("role") || (tag === "a" ? "link" : tag === "button" ? "button" : ""),
        },
      };
    })()`;

    const evaluated = await session.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, DEFAULT_TIMEOUT_MS, sid);

    const actionResult = evaluated?.result?.value || { ok: false, error: "click failed" };
    await Promise.race([session.waitForEvent("Page.loadEventFired", 6000), wait(payload.afterWaitMs)]);
    await wait(payload.afterWaitMs);

    let page;
    let snapshotError = "";
    try {
      page = await evaluateSemanticSnapshot(session, sid);
    } catch (err) {
      snapshotError = err instanceof Error ? err.message : String(err);
      page = await evaluateBasicSnapshot(session, sid);
    }
    return {
      ok: Boolean(actionResult?.ok),
      action: "click",
      actionResult,
      snapshotError,
      page,
    };
  }, args);
}

export async function lightpandaClickBySelector(args = {}) {
  if (!String(args.selector || "").trim()) throw new Error("selector is required");
  return clickCurrentPageElement(args);
}

export async function lightpandaClickByText(args = {}) {
  if (!String(args.text || args.buttonText || args.linkText || "").trim()) throw new Error("text is required");
  return clickCurrentPageElement(args);
}

export async function lightpandaInstantScrape(args = {}) {
  const url = normalizeUrl(args.url || args.currentUrl || "");
  const waitMs = Math.max(250, Math.min(Number(args.waitMs || 1400), 8000));

  return withSession(async (session) => {
    const { targetId, sid } = await openPageTarget(session, url, waitMs);

    const expression = `(() => {
      const pick = (value, limit = 220) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit);
      const absoluteUrl = (value) => {
        const raw = String(value || "").trim();
        if (!raw) return "";
        try { return new URL(raw, location.href).href; } catch { return raw; }
      };

      const tables = Array.from(document.querySelectorAll("table")).slice(0, 12).map((table, tableIndex) => {
        const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th, tr:first-child td")).map((cell) => pick(cell.innerText || cell.textContent, 120));
        const rows = Array.from(table.querySelectorAll("tr")).slice(headers.length ? 1 : 0, 80).map((row) =>
          Array.from(row.querySelectorAll("td, th")).map((cell) => pick(cell.innerText || cell.textContent, 240))
        ).filter((row) => row.some(Boolean));

        return { tableIndex, headers, rows };
      }).filter((table) => table.rows.length);

      const signature = (el) => {
        const tag = el.tagName.toLowerCase();
        const cls = String(el.className || "").split(/\\s+/).filter(Boolean).slice(0, 3).join(".");
        return tag + "." + cls;
      };

      const candidates = Array.from(document.querySelectorAll("article, li, section, div")).filter((el) => {
        const text = pick(el.innerText || el.textContent, 1200);
        if (text.length < 30 || text.length > 1800) return false;
        if (el.querySelectorAll("article, li, section").length > 8) return false;
        return true;
      });

      const buckets = new Map();
      for (const el of candidates) {
        const key = signature(el);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(el);
      }

      const repeatedGroups = Array.from(buckets.entries())
        .filter(([, items]) => items.length >= 3)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 4)
        .map(([key, items]) => ({
          signature: key,
          count: items.length,
          sample: items.slice(0, 20).map((el, index) => {
            const link = el.querySelector("a[href]");
            const image = el.querySelector("img");
            return {
              index,
              text: pick(el.innerText || el.textContent, 900),
              href: link ? absoluteUrl(link.href || link.getAttribute("href")) : "",
              image: image ? absoluteUrl(image.currentSrc || image.src || image.getAttribute("src")) : "",
            };
          }),
        }));

      const links = Array.from(document.querySelectorAll("a[href]")).slice(0, 120).map((a) => ({
        text: pick(a.innerText || a.textContent || a.getAttribute("aria-label") || a.href, 160),
        href: absoluteUrl(a.href || a.getAttribute("href")),
      }));

      return {
        url: location.href,
        title: document.title || "",
        textPreview: pick(document.body ? document.body.innerText : "", 3000),
        tables,
        repeatedGroups,
        links,
        stats: {
          tables: tables.length,
          repeatedGroups: repeatedGroups.length,
          links: links.length,
        },
      };
    })()`;

    const evaluated = await session.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, DEFAULT_TIMEOUT_MS, sid);

    if (targetId) {
      await session.call("Target.closeTarget", { targetId }).catch(() => null);
    }

    return {
      ok: true,
      requestedUrl: url,
      scrape: evaluated?.result?.value || {},
    };
  }, { timeoutMs: args.timeoutMs || DEFAULT_TIMEOUT_MS, cdpUrl: args.cdpUrl, engineName: args.engineName });
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
    cdpUrl: redactUrl(cdpUrl()),
    configured: Boolean(process.env.BROWSER_CDP_URL || process.env.CHROME_CDP_URL || process.env.LIGHTPANDA_CDP_URL),
    defaultCdpUrl: DEFAULT_CDP_URL,
    docs: "https://lightpanda.io/docs/open-source/usage",
    headful: {
      supported: Boolean(chromeExecutable()),
      cdpUrl: `ws://127.0.0.1:${Number(process.env.BROWSER_CDP_PORT || 9222)}`,
    },
  };
}
