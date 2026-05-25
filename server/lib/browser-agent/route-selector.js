import { callBrowserAgentRoleJson } from "../browser-llm-runtime.js";
import { safeText } from "./shared.js";
import { routeSelectorSystemPrompt } from "./prompts/roles.js";

const ALLOWED_ROUTES = new Set(["playwright", "lightpanda"]);

function normalizeRoute(value = "") {
  const route = String(value || "").trim().toLowerCase();
  return ALLOWED_ROUTES.has(route) ? route : "";
}

function normalizeDecision(data = {}) {
  const route = normalizeRoute(data.route || data.selectedRoute || "");
  return {
    route,
    reason: safeText(data.reason || "", 900),
    confidence: Math.max(0, Math.min(Number(data.confidence ?? 0.7) || 0, 1)),
    warmLightpanda: Boolean(data.warmLightpanda || data.warm_lightpanda),
  };
}

export async function chooseBrowserRoute({
  instruction = "",
  plan = null,
  currentState = {},
  explicitRoute = "",
  images = [],
} = {}) {
  if (normalizeRoute(explicitRoute)) {
    return {
      ok: true,
      route: normalizeRoute(explicitRoute),
      decision: {
        route: normalizeRoute(explicitRoute),
        reason: "Explicit route override provided.",
        confidence: 1,
        warmLightpanda: normalizeRoute(explicitRoute) === "lightpanda",
      },
      usage: null,
    };
  }

  const response = await callBrowserAgentRoleJson("main", {
    system: routeSelectorSystemPrompt(),
    context: {
      instruction: safeText(instruction, 5000),
      plan,
      currentState,
    },
    schemaName: "browser_agent_route_selector",
    images,
  });

  const decision = normalizeDecision(response.data || {});
  const route = decision.route || "playwright";

  return {
    ok: Boolean(route),
    route,
    decision: {
      ...decision,
      route,
    },
    usage: response.usage,
    rawContent: response.rawContent,
  };
}
