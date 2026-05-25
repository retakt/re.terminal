import { callBrowserAgentRoleJson } from "../browser-llm-runtime.js";
import { extractUrl, safeText } from "./shared.js";
import { plannerSystemPrompt } from "./prompts/roles.js";
import { tidySteps } from "./steps.js";

const ALLOWED_KINDS = new Set([
  "navigate",
  "search",
  "observe",
  "click",
  "fill",
  "fill_and_submit",
  "submit",
  "screenshot",
  "scrape",
  "extract",
  "verify",
  "report",
]);

function normalizeKind(kind = "") {
  const raw = String(kind || "").trim().toLowerCase();
  return ALLOWED_KINDS.has(raw) ? raw : "observe";
}

function normalizeField(field = {}) {
  return {
    label: safeText(field?.label || field?.name || field?.id || "", 120),
    value: safeText(field?.value || "", 500),
    secret: Boolean(field?.secret),
  };
}

function normalizeStep(step = {}) {
  return {
    kind: normalizeKind(step.kind),
    text: safeText(step.text || "", 1200),
    url: safeText(step.url || "", 600),
    query: safeText(step.query || "", 500),
    targetText: safeText(step.targetText || "", 240),
    fields: Array.isArray(step.fields) ? step.fields.map(normalizeField).filter((field) => field.label || field.value) : [],
    notes: safeText(step.notes || "", 400),
    shouldVerify: step.shouldVerify !== false,
    shouldScreenshot: Boolean(step.shouldScreenshot),
  };
}

function normalizeRouteHint(value = "") {
  const route = String(value || "").trim().toLowerCase();
  return ["playwright", "lightpanda", "auto"].includes(route) ? route : "auto";
}

function normalizePlannerData(data = {}) {
  const rawSteps = Array.isArray(data.steps)
    ? data.steps.map(normalizeStep).filter((step) => step.kind || step.text || step.url || step.query || step.targetText || step.fields.length)
    : [];
  const steps = tidySteps(rawSteps);
  const status = String(data.status || "").toLowerCase() === "needs_user" ? "needs_user" : "ready";

  return {
    status,
    userIntent: safeText(data.userIntent || "", 500),
    routeHint: normalizeRouteHint(data.routeHint || data.route_hint || "auto"),
    needsLightpandaWarmup: Boolean(data.needsLightpandaWarmup || data.needs_lightpanda_warmup),
    steps,
    reason: safeText(data.reason || "", 900),
    confidence: Math.max(0, Math.min(Number(data.confidence ?? 0.7) || 0, 1)),
  };
}

function compactInstructionForRetry(instruction = "") {
  const text = String(instruction || "");
  const url = extractUrl(text);
  const fields = [];
  const pattern = /"([^"]+)"\s+field\s+with\s+"([^"]+)"/ig;
  let match;
  while ((match = pattern.exec(text))) {
    fields.push({ label: safeText(match[1], 120), value: safeText(match[2], 500) });
  }

  return {
    instruction: safeText(text, 1200),
    url,
    fields,
    requestsSubmit: /\bsubmit\b/i.test(text),
    requestsScreenshot: /\bscreenshot\b/i.test(text),
    verificationText: text.match(/\b(?:page\s+says|verify(?:\s+the\s+page\s+says)?)\s+["']([^"']+)["']/i)?.[1] || "",
  };
}

function fallbackPlanFromCompact(compact = {}) {
  const steps = [];
  if (compact.url) {
    steps.push({
      kind: "navigate",
      text: `Open ${compact.url}`,
      url: compact.url,
      query: "",
      targetText: "",
      fields: [],
      notes: "Recovered from planner JSON failure.",
      shouldVerify: true,
      shouldScreenshot: false,
    });
  }

  if (Array.isArray(compact.fields) && compact.fields.length) {
    steps.push({
      kind: "fill",
      text: "Fill the requested fields.",
      url: compact.url || "",
      query: "",
      targetText: "",
      fields: compact.fields,
      notes: "Recovered field/value plan from the user instruction after planner JSON failure.",
      shouldVerify: true,
      shouldScreenshot: false,
    });
  }

  if (compact.requestsSubmit) {
    steps.push({
      kind: "submit",
      text: "Submit the form.",
      url: compact.url || "",
      query: "",
      targetText: "Submit",
      fields: [],
      notes: "Recovered submit step from the user instruction.",
      shouldVerify: true,
      shouldScreenshot: false,
    });
  }

  if (compact.requestsScreenshot) {
    steps.push({
      kind: "screenshot",
      text: "Take a screenshot.",
      url: compact.url || "",
      query: "",
      targetText: "",
      fields: [],
      notes: "Recovered screenshot step from the user instruction.",
      shouldVerify: true,
      shouldScreenshot: true,
    });
  }

  if (compact.verificationText) {
    steps.push({
      kind: "verify",
      text: `Verify the page says ${compact.verificationText}.`,
      url: "",
      query: "",
      targetText: compact.verificationText,
      fields: [],
      notes: "Recovered verification step from the user instruction.",
      shouldVerify: true,
      shouldScreenshot: false,
    });
  }

  if (!steps.length) {
    steps.push({
      kind: "observe",
      text: "Observe the current page.",
      url: compact.url || "",
      query: "",
      targetText: "",
      fields: [],
      notes: "Fallback observation after planner JSON failure.",
      shouldVerify: true,
      shouldScreenshot: false,
    });
  }

  return {
    status: "ready",
    userIntent: "Recovered browser plan after planner JSON formatting failure.",
    routeHint: compact.fields?.length || compact.requestsSubmit || compact.requestsScreenshot ? "playwright" : "auto",
    needsLightpandaWarmup: false,
    steps: tidySteps(steps),
    reason: "The planner model returned invalid JSON twice, so the runtime recovered a minimal plan from the explicit browser instruction.",
    confidence: 0.55,
  };
}

export async function planBrowserTask({
  instruction = "",
  currentUrl = "",
  currentTitle = "",
  currentState = {},
  images = [],
} = {}) {
  const context = {
    instruction: safeText(instruction, 5000),
    currentUrl: safeText(currentUrl || currentState?.currentUrl || "", 600),
    currentTitle: safeText(currentTitle || currentState?.currentTitle || "", 240),
    currentState,
  };

  let response;
  try {
    response = await callBrowserAgentRoleJson("planner", {
      system: plannerSystemPrompt(),
      context,
      schemaName: "browser_agent_planner",
      images,
    });
  } catch (error) {
    if (error?.code !== "BROWSER_AGENT_LLM_INVALID_JSON") throw error;
    const compactInstruction = compactInstructionForRetry(context.instruction);
    try {
      response = await callBrowserAgentRoleJson("planner", {
        system: plannerSystemPrompt(),
        context: {
          compactInstruction,
          currentUrl: context.currentUrl,
          currentTitle: context.currentTitle,
          retryInstruction: "Return only one strict JSON object matching the planner schema.",
        },
        schemaName: "browser_agent_planner",
        images: [],
      });
    } catch (retryError) {
      if (retryError?.code !== "BROWSER_AGENT_LLM_INVALID_JSON") throw retryError;
      const plan = fallbackPlanFromCompact(compactInstruction);
      return {
        ok: true,
        usage: error.usage || retryError.usage || null,
        rawContent: retryError.contentPreview || error.contentPreview || "",
        plan,
        routeHint: plan.routeHint,
        needsUser: false,
      };
    }
  }

  const plan = normalizePlannerData(response.data || {});
  const validRouteHint = plan.routeHint;
  const valid = plan.status === "needs_user" || plan.steps.length > 0 || Boolean(plan.reason);

  return {
    ok: valid,
    usage: response.usage,
    rawContent: response.rawContent,
    plan,
    routeHint: validRouteHint,
    needsUser: plan.status === "needs_user",
  };
}
