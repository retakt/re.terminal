import { callBrowserAgentRoleJson } from "../browser-llm-runtime.js";
import { safeText } from "./shared.js";
import { commandBuilderSystemPrompt } from "./prompts/roles.js";
import { buildClickCommand } from "./tools/click.js";
import { buildExtractCommand } from "./tools/extract.js";
import { buildFillCommand } from "./tools/fill.js";
import { buildNavigateCommand } from "./tools/navigate.js";
import { buildObserveCommand } from "./tools/observe.js";
import { buildScrapeCommand } from "./tools/scrape.js";
import { buildSearchCommand } from "./tools/search.js";
import { buildScreenshotCommand } from "./tools/screenshot.js";
import { buildVerifyCommand } from "./tools/verify.js";

const ALLOWED_TOOLS = new Set([
  "browserNavigate",
  "browserObserve",
  "browserShowActions",
  "browserClickByText",
  "browserFillFields",
  "browserSubmitForm",
  "browserFillAndSubmit",
  "browserScrape",
  "browserExtract",
  "browserScreenshot",
  "browserVerify",
]);

function normalizeTool(value = "") {
  const tool = String(value || "").trim();
  return ALLOWED_TOOLS.has(tool) ? tool : "";
}

function observationLabelSet(observation = {}) {
  const labels = new Set();
  const source = observation && typeof observation === "object" ? observation : {};
  const arrays = [source.inputs, source.forms, source.buttons, source.links];

  for (const list of arrays) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const candidate = safeText(item.label || item.text || item.name || item.value || item.href || "", 180);
      if (candidate) labels.add(candidate.toLowerCase());
    }
  }

  const textPreview = safeText(source.textPreview || source.text || "", 2000).toLowerCase();
  return { labels, textPreview };
}

function normalizeFieldLabel(label = "", observation = {}) {
  const raw = safeText(label, 180);
  if (!raw) return raw;

  const { labels, textPreview } = observationLabelSet(observation);
  const lower = raw.toLowerCase();
  if (labels.has(lower)) return raw;

  const suffixMatch = raw.match(/^(.*?)(?:\s+field)$/i);
  if (suffixMatch) {
    const candidate = safeText(suffixMatch[1], 180);
    if (candidate && (labels.has(candidate.toLowerCase()) || textPreview.includes(candidate.toLowerCase()))) {
      return candidate;
    }
  }

  return raw;
}

function normalizeCommandFieldLabels(result = {}, observation = {}) {
  if (!result || typeof result !== "object") return result;
  if (!result.command || typeof result.command !== "object") return result;

  const command = result.command;
  const args = command.args && typeof command.args === "object" && !Array.isArray(command.args)
    ? command.args
    : {};

  if (!Array.isArray(args.fields)) return result;

  return {
    ...result,
    command: {
      ...command,
      args: {
        ...args,
        fields: args.fields.map((field) => {
          if (!field || typeof field !== "object") return field;
          return {
            ...field,
            label: normalizeFieldLabel(field.label || "", observation),
          };
        }),
      },
    },
  };
}

function normalizeCommand(data = {}) {
  const command = data.command && typeof data.command === "object" ? data.command : data;
  const tool = normalizeTool(command.tool || "");
  return {
    status: String(data.status || "").toLowerCase() === "needs_user" ? "needs_user" : "ready",
    command: tool ? {
      kind: safeText(command.kind || "", 60),
      tool,
      args: command.args && typeof command.args === "object" && !Array.isArray(command.args) ? command.args : {},
      notes: safeText(command.notes || "", 700),
    } : null,
    reason: safeText(data.reason || "", 900),
    confidence: Math.max(0, Math.min(Number(data.confidence ?? 0.7) || 0, 1)),
  };
}

function buildSubmitCommand(step = {}, route = "") {
  return {
    ok: true,
    command: {
      route,
      kind: "submit",
      tool: "browserSubmitForm",
      args: {
        text: safeText(step.targetText || step.submitText || "Submit", 180),
      },
      notes: safeText(step.notes || step.text || "", 300),
    },
  };
}

function buildCommandFromStep(step = {}, route = "") {
  const kind = String(step.kind || "").trim().toLowerCase();
  if (kind === "navigate") return buildNavigateCommand(step, route);
  if (kind === "search") return buildSearchCommand(step, route);
  if (kind === "click") return buildClickCommand(step, route);
  if (kind === "fill" || kind === "fill_and_submit") return buildFillCommand(step, route);
  if (kind === "submit") return buildSubmitCommand(step, route);
  if (kind === "screenshot") return buildScreenshotCommand(step, route);
  if (kind === "scrape") return buildScrapeCommand(step, route);
  if (kind === "extract") return buildExtractCommand(step, route);
  if (kind === "verify") return buildVerifyCommand(step, route);
  if (kind === "observe" || kind === "report" || kind === "show_actions") return buildObserveCommand(step, route);
  return { ok: false, needsUser: true, reason: "Command Builder needs a clearer browser step.", command: null };
}

function completeStepCommand(step = {}, route = "") {
  const kind = String(step.kind || "").trim().toLowerCase();
  if (kind === "navigate" && step.url) return buildCommandFromStep(step, route);
  if (kind === "search" && (step.query || step.text)) return buildCommandFromStep(step, route);
  if ((kind === "fill" || kind === "fill_and_submit") && Array.isArray(step.fields) && step.fields.length) return buildCommandFromStep(step, route);
  if (kind === "click" && (step.targetText || step.text || step.selector || step.href)) return buildCommandFromStep(step, route);
  if (kind === "submit") return buildCommandFromStep(step, route);
  if (["observe", "scrape", "extract", "screenshot", "verify", "report"].includes(kind)) return buildCommandFromStep(step, route);
  return null;
}

function commandMatchesStep(command = {}, step = {}) {
  const kind = String(step.kind || "").trim().toLowerCase();
  const tool = String(command?.tool || "").trim();

  if (kind === "navigate" || kind === "search") return tool === "browserNavigate";
  if (kind === "observe" || kind === "report") return ["browserObserve", "browserShowActions"].includes(tool);
  if (kind === "click") return tool === "browserClickByText";
  if (kind === "fill") return tool === "browserFillFields";
  if (kind === "fill_and_submit") return tool === "browserFillAndSubmit";
  if (kind === "submit") return tool === "browserSubmitForm";
  if (kind === "screenshot") return tool === "browserScreenshot";
  if (kind === "scrape") return tool === "browserScrape";
  if (kind === "extract") return tool === "browserExtract";
  if (kind === "verify") return tool === "browserVerify";
  return Boolean(tool);
}

function fillCommandMatchesStep(command = {}, step = {}) {
  const stepFields = Array.isArray(step.fields) ? step.fields : [];
  if (!stepFields.length) return true;

  const commandFields = Array.isArray(command?.args?.fields) ? command.args.fields : [];
  if (commandFields.length !== stepFields.length) return false;

  const key = (value = "") => safeText(value, 500).toLowerCase().replace(/\bfield\b/g, "").replace(/[^a-z0-9]+/g, "");
  const used = new Set();

  return stepFields.every((stepField) => {
    const stepLabel = key(stepField.label || stepField.name || "");
    const stepValue = safeText(stepField.value || "", 500);

    const index = commandFields.findIndex((commandField, commandIndex) => {
      if (used.has(commandIndex)) return false;
      const commandLabel = key(commandField.label || commandField.name || commandField.id || "");
      const commandValue = safeText(commandField.value || "", 500);
      const valueMatches = commandValue === stepValue;
      const labelMatches = !stepLabel || !commandLabel || commandLabel.includes(stepLabel) || stepLabel.includes(commandLabel);
      return valueMatches && labelMatches;
    });

    if (index < 0) return false;
    used.add(index);
    return true;
  });
}

export async function buildExecutableCommand({
  step = {},
  route = "",
  context = {},
  images = [],
} = {}) {
  const direct = completeStepCommand(step, route);
  if (direct?.command) {
    return {
      ok: true,
      command: direct.command,
      needsUser: false,
      reason: safeText(direct.reason || "Built command from a complete abstract step.", 900),
      usage: null,
      rawContent: "",
    };
  }

  const response = await callBrowserAgentRoleJson("executor", {
    system: commandBuilderSystemPrompt(),
    context: {
      route,
      step,
      context,
    },
    schemaName: "browser_agent_command_builder",
    images,
    route,
  });

  const result = normalizeCommand(response.data || {});
  const normalized = normalizeCommandFieldLabels(result, context.currentObservation || {});
  const shapeCompatible = normalized.command && commandMatchesStep(normalized.command, step);
  const valueCompatible = shapeCompatible && ["fill", "fill_and_submit"].includes(String(step.kind || "").trim().toLowerCase())
    ? fillCommandMatchesStep(normalized.command, step)
    : shapeCompatible;
  const compatibleCommand = valueCompatible
    ? normalized.command
    : null;
  const fallback = !compatibleCommand ? buildCommandFromStep(step, route) : null;
  const command = compatibleCommand || fallback?.command || null;
  const needsUser = !command && (normalized.status === "needs_user" || fallback?.needsUser !== false);

  return {
    ok: Boolean(command || needsUser),
    command,
    needsUser,
    reason: command && command !== normalized.command ? safeText(fallback?.reason || "Built command from the abstract step.", 900) : normalized.reason,
    usage: response.usage,
    rawContent: response.rawContent,
  };
}
