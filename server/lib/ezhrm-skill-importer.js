import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function siteSkillsDir() {
  return path.resolve(__dirname, "..", "config", "site-skills");
}

function ezhrmSkillPath() {
  return path.join(siteSkillsDir(), "ezhrm.generated.json");
}

function ensureDir() {
  fs.mkdirSync(siteSkillsDir(), { recursive: true });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function safeText(value, limit = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeId(value, fallback = "action") {
  const id = safeText(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return id || fallback;
}

function pageKeyFromObservation(observation) {
  const pathName = observation?.page?.path || "/";
  return safeId(pathName === "/" ? "login_page" : pathName, "page");
}

function stableSelector(item = {}) {
  const selector = String(item.selector || "");
  if (!selector) return "";

  if (selector.startsWith("#")) return selector;
  if (selector.includes("[name=")) return selector;
  if (selector.includes("[aria-label=")) return selector;

  return selector;
}

function stripField(field = {}) {
  return {
    index: field.index ?? null,
    tag: field.tag || "",
    type: field.type || "",
    name: field.name || "",
    id: field.id || "",
    placeholder: field.placeholder || "",
    ariaLabel: field.ariaLabel || "",
    required: Boolean(field.required),
    visible: Boolean(field.visible),
    secret: Boolean(field.secret),
    selector: stableSelector(field),
    valueCaptured: false,
  };
}

function stripButton(button = {}) {
  return {
    index: button.index ?? null,
    tag: button.tag || "",
    type: button.type || "",
    text: safeText(button.text),
    id: button.id || "",
    name: button.name || "",
    visible: Boolean(button.visible),
    selector: stableSelector(button),
  };
}

function stripLink(link = {}) {
  return {
    index: link.index ?? null,
    text: safeText(link.text),
    href: link.href || "",
    visible: Boolean(link.visible),
    selector: stableSelector(link),
  };
}

function stripForm(form = {}) {
  return {
    index: form.index ?? null,
    action: form.action || "",
    method: form.method || "",
    id: form.id || "",
    name: form.name || "",
    visible: Boolean(form.visible),
    selector: stableSelector(form),
    fields: Array.isArray(form.fields) ? form.fields.map(stripField) : [],
    buttons: Array.isArray(form.buttons) ? form.buttons.map(stripButton) : [],
  };
}

function stripTable(table = {}) {
  return {
    index: table.index ?? null,
    visible: Boolean(table.visible),
    selector: stableSelector(table),
    rowCount: Number(table.rowCount || 0),
    headers: Array.isArray(table.headers)
      ? table.headers.map((header) => safeText(header, 120)).filter(Boolean)
      : [],
    cellTextCaptured: false,
  };
}

function actionRequiresConfirmation(label, kind) {
  const lower = String(label || "").toLowerCase();

  if (/\bsearch\b/.test(lower) || kind === "search") {
    return false;
  }

  if (kind === "form_submit") {
    return /\b(login|log in|sign in|submit|save|delete|remove|check out|checkout|check in|emergency|apply|approve|reject|verify|logout)\b/.test(lower);
  }

  return /\b(login|log in|sign in|submit|save|delete|remove|check out|checkout|check in|emergency|apply|approve|reject|verify|logout)\b/.test(lower);
}

function inferActionKind(label, source) {
  const lower = String(label || "").toLowerCase();

  if (/\blogin|log in|sign in\b/.test(lower)) return "login";
  if (/\bemergency.*check\s*out|emergency.*checkout\b/.test(lower)) return "emergency_check_out";
  if (/\bcheck\s*out|checkout|clock\s*out|punch\s*out\b/.test(lower)) return "check_out";
  if (/\bcheck\s*in|clock\s*in|punch\s*in\b/.test(lower)) return "check_in";
  if (/\bleave application|apply leave|leave request\b/.test(lower)) return "leave_application";
  if (/\bleave status\b/.test(lower)) return "leave_status";
  if (/\bprofile|my profile|personal info\b/.test(lower)) return "profile";
  if (/\bsearch\b/.test(lower)) return "search";
  if (/\blogout\b/.test(lower)) return "logout";

  return source;
}

function makeAction({ label, kind, selector, href, formIndex, pageKey, source }) {
  const actionKind = inferActionKind(label, kind);
  const id = safeId(`${pageKey}_${actionKind}_${label}`, `${pageKey}_${kind}`);

  return {
    id,
    label: safeText(label || actionKind),
    kind: actionKind,
    source,
    pageKey,
    selector: selector || "",
    href: href || "",
    formIndex: formIndex ?? null,
    requiresConfirmation: actionRequiresConfirmation(label, kind),
    observedOnly: true,
    lastObservedAt: new Date().toISOString(),
  };
}

function isNoisyActionLabel(label) {
  const text = safeText(label).toLowerCase();

  if (!text) return true;

  // Pure UI/pagination noise
  if (/^[»«‹›….\-–—_|/\\]+$/.test(text)) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^(next|previous|prev|first|last|back|close|cancel|ok|yes|no)$/i.test(text)) return true;

  // Language / theme / notification noise
  if (/^(english|tiếng việt|language|languages|theme|dark|light|refresh|clear|mark all as read)$/i.test(text)) {
    return true;
  }

  // Generic dashboard/menu labels that are usually not actions by themselves
  if (/^(dashboard|menu|home|notifications?|settings?|help|apps?|pages?)$/i.test(text)) {
    return true;
  }

  // Icon library / template demo noise
  if (/\b(fontawesome|feather icons?|ionic icons?|material icons?|pe7 icons?|themify icons?|simpleline icons?)\b/i.test(text)) {
    return true;
  }

  // Very long menu blobs are usually collapsed sidebar text, not useful actions
  if (text.length > 90) return true;

  return false;
}

function isUsefulVisibleLink(link) {
  if (!link || !link.visible) return false;
  if (!link.text) return false;
  if (!link.href) return false;
  if (link.href.includes("#")) return false;
  if (/javascript:void/i.test(link.href)) return false;
  if (isNoisyActionLabel(link.text)) return false;

  return true;
}

function isUsefulVisibleButton(button) {
  if (!button || !button.visible) return false;

  const label = button.text || button.id || button.name;
  if (!label) return false;
  if (isNoisyActionLabel(label)) return false;

  return true;
}

function isImportantActionLabel(label) {
  const text = safeText(label).toLowerCase();

  if (isNoisyActionLabel(text)) return false;

  return /\b(login|log in|sign in|logout|sign out|check in|check-in|clock in|punch in|check out|check-out|checkout|clock out|punch out|emergency checkout|emergency check out|leave application|apply leave|leave request|leave status|other leaves application|manage bank accounts|salary deduction|passport request|passport request form|passport request status|profile|my profile|view deduction details|deduction details|search)\b/.test(text);
}

function extractActions(pageKey, forms, buttons, links) {
  const actions = [];

  for (const form of forms) {
    if (!form.visible) continue;

    for (const button of form.buttons || []) {
      if (!isUsefulVisibleButton(button)) continue;

      const label = button.text || button.id || button.name || "submit";

      // Only keep meaningful EZHRM form submits.
      if (!isImportantActionLabel(label)) continue;

      actions.push(makeAction({
        label,
        kind: "form_submit",
        selector: button.selector || form.selector,
        formIndex: form.index,
        pageKey,
        source: "visible_form_button",
      }));
    }
  }

  for (const button of buttons) {
    if (!isUsefulVisibleButton(button)) continue;

    const label = button.text || button.id || button.name;
    if (!isImportantActionLabel(label)) continue;

    actions.push(makeAction({
      label,
      kind: "button",
      selector: button.selector,
      pageKey,
      source: "visible_button",
    }));
  }

  for (const link of links) {
    if (!isUsefulVisibleLink(link)) continue;

    // Keep only useful HRM/navigation actions, not every sidebar/demo link.
    if (!isImportantActionLabel(link.text)) continue;

    actions.push(makeAction({
      label: link.text,
      kind: "link",
      selector: link.selector,
      href: link.href,
      pageKey,
      source: "visible_link",
    }));
  }

  const seen = new Set();

  return actions.filter((action) => {
    const key = [
      action.kind,
      safeText(action.label).toLowerCase(),
      action.selector || "",
      action.href || "",
    ].join(":");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function createBaseSkill() {
  return {
    id: "ezhrm",
    name: "EZHRM Skill",
    enabled: true,
    version: "0.1.0",
    source: "ezhrm-skill-recorder",
    domains: ["ezhrmsys.com", "www.ezhrmsys.com"],
    updatedAt: new Date().toISOString(),
    rules: [
      "Use only imported EZHRM observations and actions.",
      "Operate round by round.",
      "Ask before login, logout, check-in, check-out, emergency checkout, leave submission, profile updates, or any irreversible action.",
      "Never reveal password values.",
      "Do not use hidden actions unless the user explicitly asks and the current page confirms they are available."
    ],
    pages: {},
    actions: []
  };
}

function actionIsStillUseful(action = {}) {
  const label = action.label || action.id || "";
  const href = String(action.href || "").toLowerCase();
  const selector = String(action.selector || "").toLowerCase();

  if (isNoisyActionLabel(label)) return false;
  if (!isImportantActionLabel(label)) return false;

  if (selector.includes("language-toggle")) return false;
  if (href.includes("#")) return false;
  if (href.includes("javascript:void")) return false;

  // Dashboard links are usually navigation noise, not a task action.
  if (/\bdashboard\b/i.test(label) || href.includes("dashboard")) return false;

  return true;
}

function mergeActions(existing = [], incoming = []) {
  const map = new Map();

  for (const action of existing) {
    if (actionIsStillUseful(action)) {
      map.set(action.id, action);
    }
  }

  for (const action of incoming) {
    if (actionIsStillUseful(action)) {
      map.set(action.id, {
        ...(map.get(action.id) || {}),
        ...action,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
}
export function importEzhrmObservation(observation) {
  if (!observation || typeof observation !== "object") {
    throw new Error("observation JSON is required");
  }

  if (observation.recorder !== "ezhrm-skill-recorder") {
    throw new Error("not an EZHRM recorder observation");
  }

  const pageKey = pageKeyFromObservation(observation);
  const page = observation.page || {};
  const raw = observation.observations || {};

  const forms = Array.isArray(raw.forms) ? raw.forms.map(stripForm) : [];
  const fields = Array.isArray(raw.fields) ? raw.fields.map(stripField) : [];
  const buttons = Array.isArray(raw.buttons) ? raw.buttons.map(stripButton) : [];
  const links = Array.isArray(raw.links) ? raw.links.map(stripLink) : [];
  const tables = Array.isArray(raw.tables) ? raw.tables.map(stripTable) : [];
  const incomingActions = extractActions(pageKey, forms, buttons, links);
  
  const cleanForms = forms.map((form) => ({
    ...form,
    buttons: (form.buttons || []).filter((button) => {
      const label = button.text || button.id || button.name || "";
      return isUsefulVisibleButton(button) && isImportantActionLabel(label);
    }),
  }));
  
  const cleanButtons = buttons.filter((button) => {
    const label = button.text || button.id || button.name || "";
    return isUsefulVisibleButton(button) && isImportantActionLabel(label);
  });
  
  const cleanLinks = links.filter((link) => {
    if (!isUsefulVisibleLink(link)) return false;
    if (!isImportantActionLabel(link.text)) return false;
    if (/\bdashboard\b/i.test(link.text || "")) return false;
    if (String(link.href || "").toLowerCase().includes("dashboard")) return false;
    return true;
  });
  
  const current = readJson(ezhrmSkillPath()) || createBaseSkill();
  
  const next = {    
    ...current,
    updatedAt: new Date().toISOString(),
    pages: {
      ...(current.pages || {}),
      [pageKey]: {
        key: pageKey,
        url: page.url || "",
        path: page.path || "",
        title: page.title || "",
        capturedAt: observation.capturedAt || new Date().toISOString(),
        counts: observation.counts || {},
        forms: cleanForms,
        fields: fields.filter((field) => field.visible),
        buttons: cleanButtons,
        links: cleanLinks,
        tables,
      }
    },
    actions: mergeActions(current.actions || [], incomingActions),
  };

  writeJson(ezhrmSkillPath(), next);

  return {
    ok: true,
    file: path.relative(path.resolve(__dirname, ".."), ezhrmSkillPath()),
    pageKey,
    imported: {
      forms: forms.length,
      fields: fields.length,
      visibleButtons: buttons.filter((button) => button.visible).length,
      visibleLinks: links.filter((link) => link.visible).length,
      tables: tables.length,
      actions: incomingActions.length,
    },
    actions: incomingActions,
    skill: next,
  };
}