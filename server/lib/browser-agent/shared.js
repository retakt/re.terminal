export function safeText(value = "", limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeUrl(value = "") {
  const raw = safeText(value, 2000).replace(/[.,;!?]+$/g, "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw)) return "";
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#][^\s]*)?$/i.test(raw)) return `https://${raw}`;
  return "";
}

export function extractUrl(text = "") {
  const raw = String(text || "");
  const explicit = raw.match(/https?:\/\/[^\s)"'<>]+/i)?.[0];
  if (explicit) return normalizeUrl(explicit);
  const domain = raw.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)"'<>]*)?/i)?.[0];
  return normalizeUrl(domain || "");
}

export function splitInstructionClauses(instruction = "") {
  return String(instruction || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/\s+(?:and\s+then|then|after\s+that|next)\s+/i))
    .flatMap((line) => line.split(/\s*;\s*/))
    .flatMap((line) => line.split(/\s*,\s*(?=(?:open|visit|go to|navigate|click|fill|enter|type|take|screenshot|observe|inspect|read|scrape|extract|verify|report|search)\b)/i))
    .map((part) => part.replace(/^\s*(?:\d+[\).:-]\s*|[-*]\s*)/, "").trim())
    .filter(Boolean);
}

export function extractQuotedText(value = "") {
  return String(value || "").match(/["'`](.+?)["'`]/)?.[1] || "";
}

export function extractKeyValuePairs(text = "") {
  const raw = String(text || "");
  const pairs = [];
  const regex = /(?:^|[\s,;])([a-z][a-z0-9 _-]{1,40})\s*(?:=|:|\bis\b)\s*([^,;]+?)(?=(?:\s+[a-z][a-z0-9 _-]{1,40}\s*(?:=|:|\bis\b))|$)/ig;
  let match;
  while ((match = regex.exec(raw))) {
    const label = safeText(match[1], 80);
    const value = safeText(match[2], 240);
    if (label && value) pairs.push({ label, value });
  }
  return pairs;
}

export function buildSearchUrl(query = "") {
  const raw = safeText(query, 2000);
  if (!raw) return "";
  return `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`;
}

function compactSnapshotEntry(entry = {}) {
  if (!entry || typeof entry !== "object") return null;

  const compacted = {
    label: safeText(entry.label || entry.text || entry.name || entry.value || entry.href || entry.selector || "", 180),
    href: safeText(entry.href || "", 240),
    selector: safeText(entry.selector || "", 220),
    role: safeText(entry.role || "", 80),
    value: safeText(entry.value || "", 160),
    type: safeText(entry.type || "", 80),
  };

  return Object.fromEntries(Object.entries(compacted).filter(([, value]) => Boolean(value)));
}

function compactSnapshotList(list = [], limit = 5) {
  return (Array.isArray(list) ? list : [])
    .slice(0, limit)
    .map((entry) => compactSnapshotEntry(entry))
    .filter(Boolean);
}

export function compactBrowserSnapshot(snapshot = null) {
  if (!snapshot || typeof snapshot !== "object") return null;

  const source = snapshot.observation && typeof snapshot.observation === "object"
    ? snapshot.observation
    : snapshot;
  const stats = source.stats && typeof source.stats === "object" ? source.stats : {};
  const links = compactSnapshotList(source.links, 5);
  const buttons = compactSnapshotList(source.buttons, 5);
  const inputs = compactSnapshotList(source.inputs, 8);
  const forms = compactSnapshotList(source.forms, 4);

  return {
    url: safeText(source.url || snapshot.url || "", 600),
    title: safeText(source.title || snapshot.title || "", 240),
    textPreview: safeText(source.textPreview || source.text || snapshot.textPreview || snapshot.text || "", 1500),
    stats: {
      links: Number.isFinite(Number(stats.links)) ? Number(stats.links) : links.length,
      buttons: Number.isFinite(Number(stats.buttons)) ? Number(stats.buttons) : buttons.length,
      forms: Number.isFinite(Number(stats.forms)) ? Number(stats.forms) : forms.length,
      inputs: Number.isFinite(Number(stats.inputs)) ? Number(stats.inputs) : inputs.length,
    },
    links,
    buttons,
    inputs,
    forms,
    hasImage: Boolean(snapshot.imageBase64 || source.imageBase64),
  };
}

export function compareBrowserSnapshots(before = null, after = null) {
  const prior = compactBrowserSnapshot(before) || {};
  const next = compactBrowserSnapshot(after) || {};
  const changes = [];

  const compareText = (label, left = "", right = "") => {
    const beforeText = safeText(left, 500);
    const afterText = safeText(right, 500);
    if (beforeText === afterText) return;
    changes.push(`${label}: ${beforeText || "none"} -> ${afterText || "none"}`);
  };

  const compareCount = (label, left = 0, right = 0) => {
    const beforeCount = Number(left || 0);
    const afterCount = Number(right || 0);
    if (beforeCount === afterCount) return;
    changes.push(`${label} count: ${beforeCount} -> ${afterCount}`);
  };

  compareText("URL", prior.url || "", next.url || "");
  compareText("Title", prior.title || "", next.title || "");
  compareText("Text", prior.textPreview || "", next.textPreview || "");
  compareCount("Links", prior.stats?.links || 0, next.stats?.links || 0);
  compareCount("Buttons", prior.stats?.buttons || 0, next.stats?.buttons || 0);
  compareCount("Forms", prior.stats?.forms || 0, next.stats?.forms || 0);
  compareCount("Inputs", prior.stats?.inputs || 0, next.stats?.inputs || 0);

  if (Boolean(prior.hasImage) !== Boolean(next.hasImage)) {
    changes.push(`Image evidence: ${prior.hasImage ? "present" : "absent"} -> ${next.hasImage ? "present" : "absent"}`);
  }

  return {
    changed: changes.length > 0,
    summary: safeText(changes.length ? changes.join("; ") : "Snapshot appears unchanged.", 1200),
    changes,
    before: prior,
    after: next,
  };
}
