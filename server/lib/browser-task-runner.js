const FIELD_LABEL_RE = /\b(employee\s*id|employee_id|emp\s*id|staff\s*id|user\s*id|username|login\s*id|email|phone|mobile|contact|tel|telephone|whatsapp|password|pass|pwd|otp|code|pin|search|query|name|date|amount)\b/i;
const FILL_START_RE = /\b(fill|enter|type)\b[\s\S]*\b(form|forms|field|fields|details|login)\b/i;
const SUBMIT_RE = /\b(submit|login|log\s*in|sign\s*in|continue)\b/i;
const NAVIGATE_RE = /\b(navigate|visit|open|go|goto|load|browse)\b/i;
const ACTION_RE = /\b(navigate|visit|open|go|goto|load|browse|click|press|tap|select|choose|fill|enter|type|submit|login|sign\s*in|observe|inspect|read|scrape|extract|what|which|show|list)\b/i;

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

function normalizeUrlInput(value = "") {
  const raw = String(value || "").trim().replace(/[.,;]+$/, "");
  if (!isLikelyUrl(raw)) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function extractUrl(text = "") {
  const raw = String(text || "");
  const url = raw.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (url) return normalizeUrlInput(url);
  const domain = raw.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>]*)?/i)?.[0];
  return domain ? normalizeUrlInput(domain) : "";
}

function stripNavigationClause(text = "", url = "") {
  return String(text || "")
    .replace(url, " ")
    .replace(/\b(?:navigate|visit|open|go|goto|load|browse)\s+(?:to\s+)?/ig, " ")
    .replace(/^\s*(?:and\s+then|then|and)\s+/i, "")
    .trim();
}

function splitInstructionParts(instruction = "") {
  return String(instruction || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/\s+(?:and\s+then|then)\s+/i))
    .flatMap((line) => line.split(/\s*;\s*/))
    .map((part) => part.replace(/^\s*(?:\d+[\).:-]\s*|[-*]\s*)/, "").trim())
    .filter(Boolean);
}

function looksLikeFieldLine(value = "") {
  return FIELD_LABEL_RE.test(value) && /(?::|=|\bis\b|\s+)/i.test(value);
}

function looksLikeFormBlockStart(value = "") {
  return FILL_START_RE.test(value) || looksLikeFieldLine(value);
}

function looksLikeFormSubmitInstruction(value = "") {
  const raw = String(value || "");
  return (FILL_START_RE.test(raw) || FIELD_LABEL_RE.test(raw)) && FIELD_LABEL_RE.test(raw) && SUBMIT_RE.test(raw);
}

function classifyAtomicInstruction(instruction = "") {
  const raw = String(instruction || "");
  if (extractUrl(raw) && NAVIGATE_RE.test(raw)) return "navigate";
  if (looksLikeFormSubmitInstruction(raw)) return "fill_and_submit";
  if ((FILL_START_RE.test(raw) || FIELD_LABEL_RE.test(raw)) && FIELD_LABEL_RE.test(raw)) return "fill_form";
  if (SUBMIT_RE.test(raw)) return "submit_form";
  if (/\b(click|press|tap|select|choose|open|view|read)\b/i.test(raw)) return "click";
  if (/\b(scrape|extract)\b/i.test(raw)) return "scrape";
  return "observe";
}

function taskStep(instruction = "", index = 0) {
  return {
    index: index + 1,
    kind: classifyAtomicInstruction(instruction),
    instruction: String(instruction || "").trim(),
  };
}

export function planBrowserTask({ instruction = "" } = {}) {
  const raw = String(instruction || "").trim();
  if (!raw) {
    return { steps: [], atomic: true, reason: "empty instruction" };
  }

  const inlineUrl = extractUrl(raw);
  if (inlineUrl && NAVIGATE_RE.test(raw) && looksLikeFormSubmitInstruction(raw)) {
    const formInstruction = stripNavigationClause(raw, inlineUrl);
    return {
      steps: [
        taskStep(`navigate ${inlineUrl}`, 0),
        taskStep(formInstruction, 1),
      ].filter((step) => step.instruction),
      atomic: false,
      reason: "split combined navigation and form submit into atomic browser actions",
    };
  }

  const parts = splitInstructionParts(raw);
  if (parts.length < 2) {
    return { steps: [taskStep(raw, 0)], atomic: true, reason: "single instruction" };
  }

  const firstFormIndex = parts.findIndex((part, index) => {
    const tail = parts.slice(index).join("\n");
    return looksLikeFormBlockStart(part) && looksLikeFormSubmitInstruction(tail);
  });

  if (firstFormIndex >= 0) {
    const beforeForm = parts.slice(0, firstFormIndex).filter((part) => ACTION_RE.test(part) || extractUrl(part));
    const formBlock = parts.slice(firstFormIndex).join("\n");
    const planned = [
      ...beforeForm,
      formBlock,
    ].filter(Boolean);

    return {
      steps: planned.map(taskStep),
      atomic: planned.length <= 1,
      reason: "grouped multiline form submit into one atomic browser action",
    };
  }

  const actionable = parts.filter((part) => ACTION_RE.test(part) || extractUrl(part));
  if (actionable.length >= 2) {
    return {
      steps: actionable.map(taskStep),
      atomic: false,
      reason: "split sequential browser instructions",
    };
  }

  return { steps: [taskStep(raw, 0)], atomic: true, reason: "single actionable instruction" };
}

export function summarizeTaskSequence(items = [], lastSummary = "") {
  const total = items.length;
  const completed = items.filter((item) => item.ok).length;
  if (!total) return safeText(lastSummary || "No browser task steps were planned.", 260);
  if (completed === total) return `Completed ${total} of ${total} browser steps. ${safeText(lastSummary, 260)}`.trim();
  const stopped = items.find((item) => !item.ok);
  return `Completed ${completed} of ${total} browser steps. Stopped at step ${stopped?.index || completed + 1}: ${safeText(stopped?.summary || stopped?.blockedReason || "step did not complete", 260)}.`;
}
