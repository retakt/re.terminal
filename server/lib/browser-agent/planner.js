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
  "scroll",
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

function combinePlanUsage(...items) {
  const usageItems = items.filter((item) => item && typeof item === "object");
  if (!usageItems.length) return null;
  const last = usageItems[usageItems.length - 1] || {};
  return {
    ...last,
    promptTokens: usageItems.reduce((sum, item) => sum + Number(item.promptTokens || 0), 0),
    completionTokens: usageItems.reduce((sum, item) => sum + Number(item.completionTokens || 0), 0),
    totalTokens: usageItems.reduce((sum, item) => sum + Number(item.totalTokens || 0), 0),
    totalDurationMs: usageItems.reduce((sum, item) => sum + Number(item.totalDurationMs || 0), 0),
  };
}

function normalizePlannerData(data = {}) {
  const rawSteps = Array.isArray(data.steps)
    ? data.steps.map(normalizeStep).filter((step) => step.kind || step.text || step.url || step.query || step.targetText || step.fields.length)
    : [];
  const steps = tidySteps(rawSteps);
  const requestedNeedsUser = String(data.status || "").toLowerCase() === "needs_user";
  const status = requestedNeedsUser && steps.length === 0 ? "needs_user" : "ready";

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

function planRequirementGaps(plan = {}, instruction = "") {
  const text = String(instruction || "").toLowerCase();
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const kinds = steps.map((step) => String(step.kind || "").toLowerCase());
  const countKind = (kind) => kinds.filter((entry) => entry === kind).length;
  const hasAny = (candidates = []) => kinds.some((kind) => candidates.includes(kind));
  const gaps = [];

  if (/\b(?:screenshot|screen shot|snapshot)\b/.test(text) && countKind("screenshot") === 0) {
    gaps.push("The user explicitly requested screenshot evidence, but the plan has no screenshot step.");
  }

  if (/\b(?:at least two|at least 2|two or more)\s+(?:viewport\s+)?(?:screenshots|screen shots|snapshots)\b/.test(text) && countKind("screenshot") < 2) {
    gaps.push("The user requested at least two screenshot steps, but the plan has fewer than two.");
  }

  if (/\b(?:scroll|bottom|viewport)\b/.test(text) && !hasAny(["scroll"])) {
    gaps.push("The user explicitly requested scroll/bottom/viewport behavior, but the plan has no scroll step.");
  }

  if (/\b(?:bottom|continue\s+(?:screenshot|screen shot|snapshot).*\bscroll|five\s+(?:screenshots|screen shots|snapshots))\b/.test(text) && countKind("scroll") < 3) {
    gaps.push("The user requested screenshot/scroll until the bottom, but the plan has too few separate scroll steps to cover a long page.");
  }

  if (/\b(?:bottom|continue\s+(?:screenshot|screen shot|snapshot).*\bscroll|five\s+(?:screenshots|screen shots|snapshots))\b/.test(text) && countKind("screenshot") < 4) {
    gaps.push("The user requested repeated viewport screenshots toward the bottom, but the plan has too few separate screenshot steps.");
  }

  if (/\bobserve\b/.test(text) && !hasAny(["observe", "scrape", "extract"])) {
    gaps.push("The user explicitly requested an observe/read step, but the plan has no observe/scrape/extract step.");
  }

  return gaps;
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

function plannerTimedOut(error = {}) {
  return /timeout|aborted/i.test(String(error?.message || "")) || String(error?.name || "") === "TimeoutError";
}

function compactCanRecover(compact = {}) {
  return Boolean(
    compact.url &&
    (
      (Array.isArray(compact.fields) && compact.fields.length) ||
      compact.requestsSubmit ||
      compact.requestsScreenshot ||
      compact.verificationText
    )
  );
}

function fieldKey(field = {}) {
  return `${safeText(field.label || "", 160).toLowerCase()}::${safeText(field.value || "", 500)}`;
}

function restoreExplicitInstructionDetails(plan = {}, compact = {}) {
  const fields = Array.isArray(compact.fields) ? compact.fields.filter((field) => field.label || field.value) : [];
  const verificationText = safeText(compact.verificationText || "", 240);
  if (!fields.length && !verificationText) return plan;

  let steps = Array.isArray(plan.steps) ? plan.steps.map((step) => ({ ...step })) : [];

  if (fields.length) {
    const fillIndex = steps.findIndex((step) => ["fill", "fill_and_submit"].includes(String(step.kind || "").toLowerCase()));
    const mergedFields = (existingFields = []) => {
      const out = Array.isArray(existingFields) ? [...existingFields] : [];
      const seen = new Set(out.map(fieldKey));
      for (const field of fields) {
        const key = fieldKey(field);
        if (!seen.has(key)) {
          out.push(field);
          seen.add(key);
        }
      }
      return out;
    };

    if (fillIndex >= 0) {
      steps[fillIndex] = {
        ...steps[fillIndex],
        fields: mergedFields(steps[fillIndex].fields),
      };
    } else {
      const insertAt = Math.max(0, steps.findIndex((step) => String(step.kind || "").toLowerCase() === "navigate") + 1);
      steps = [
        ...steps.slice(0, insertAt),
        {
          kind: compact.requestsSubmit ? "fill_and_submit" : "fill",
          text: compact.requestsSubmit ? "Fill the requested fields and submit the form." : "Fill the requested fields.",
          url: compact.url || "",
          query: "",
          targetText: compact.requestsSubmit ? "Submit" : "",
          fields,
          notes: "Preserved explicit field/value pairs from the user instruction.",
          shouldVerify: true,
          shouldScreenshot: false,
        },
        ...steps.slice(insertAt),
      ];
    }
  }

  if (verificationText) {
    steps = steps.map((step) => {
      if (String(step.kind || "").toLowerCase() !== "verify" || step.targetText) return step;
      return {
        ...step,
        targetText: verificationText,
        query: step.query || verificationText,
      };
    });
  }

  return {
    ...plan,
    steps: tidySteps(steps),
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
  const compactInstruction = compactInstructionForRetry(context.instruction);

  let response;
  try {
    response = await callBrowserAgentRoleJson("planner", {
      system: plannerSystemPrompt(),
      context,
      schemaName: "browser_agent_planner",
      images,
    });
  } catch (error) {
    if (error?.code !== "BROWSER_AGENT_LLM_INVALID_JSON") {
      if (plannerTimedOut(error) && compactCanRecover(compactInstruction)) {
        const plan = fallbackPlanFromCompact(compactInstruction);
        return {
          ok: true,
          usage: error.usage || null,
          rawContent: error.contentPreview || "",
          plan: {
            ...plan,
            reason: "The planner model timed out, so the runtime recovered a minimal abstract plan from the explicit URL, fields, submit, screenshot, and verify instructions.",
          },
          routeHint: plan.routeHint,
          needsUser: false,
        };
      }
      throw error;
    }
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

  let plan = restoreExplicitInstructionDetails(normalizePlannerData(response.data || {}), compactInstruction);
  let usage = response.usage;
  let rawContent = response.rawContent;
  const gaps = plan.status === "ready" ? planRequirementGaps(plan, context.instruction) : [];
  if (gaps.length) {
    try {
      const repaired = await callBrowserAgentRoleJson("planner", {
        system: plannerSystemPrompt(),
        context: {
          instruction: context.instruction,
          currentUrl: context.currentUrl,
          currentTitle: context.currentTitle,
          previousPlan: plan,
          requiredFixes: gaps,
          retryInstruction: "Your previous plan omitted explicit user requirements. Return a complete corrected planner JSON object with separate abstract steps. Do not emit executable commands.",
        },
        schemaName: "browser_agent_planner",
        images: [],
      });
      const repairedPlan = restoreExplicitInstructionDetails(normalizePlannerData(repaired.data || {}), compactInstruction);
      const repairedGaps = repairedPlan.status === "ready" ? planRequirementGaps(repairedPlan, context.instruction) : gaps;
      if (repairedPlan.steps.length > plan.steps.length || repairedGaps.length < gaps.length) {
        plan = repairedPlan;
        usage = combinePlanUsage(usage, repaired.usage);
        rawContent = repaired.rawContent;
      }
    } catch {}
  }

  const validRouteHint = plan.routeHint;
  const valid = plan.status === "needs_user" || plan.steps.length > 0 || Boolean(plan.reason);

  return {
    ok: valid,
    usage,
    rawContent,
    plan,
    routeHint: validRouteHint,
    needsUser: plan.status === "needs_user",
  };
}
