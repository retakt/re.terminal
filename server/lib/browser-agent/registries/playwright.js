import { compactActionRegistryForModel } from "../../browser-action-registry-contract.js";
import { withActionRegistryFieldTargets } from "../../browser-action-registry-resolver.js";
import { buildPlaywrightActionRegistry } from "../../browser-playwright-mcp-bridge.js";
import { safeText } from "../shared.js";

const PLAYWRIGHT_REGISTRY_TOOLS = new Set([
  "browserFillFields",
  "browserFillAndSubmit",
  "browserSubmitForm",
]);

function shouldResolveWithRegistry(command = {}) {
  const tool = String(command?.tool || "").trim();
  if (!PLAYWRIGHT_REGISTRY_TOOLS.has(tool)) return false;
  if (tool === "browserSubmitForm") {
    return Array.isArray(command?.args?.fields) && command.args.fields.length > 0;
  }
  return true;
}

function enrichResolvedFields(command = {}, registry = {}) {
  if (!command || typeof command !== "object") return command;
  const args = command.args && typeof command.args === "object" ? command.args : {};
  if (!Array.isArray(args.fields)) return command;

  const actions = Array.isArray(registry.actions) ? registry.actions : [];
  const byActionId = new Map(
    actions
      .filter((action) => action && typeof action === "object")
      .map((action) => [String(action.actionId || ""), action])
      .filter(([actionId]) => Boolean(actionId))
  );

  const nextFields = args.fields.map((field) => {
    if (!field || typeof field !== "object") return field;
    const actionId = String(field.actionId || "").trim();
    const matched = actionId ? byActionId.get(actionId) : null;
    if (!matched) return field;

    return {
      ...field,
      actionId: matched.actionId || field.actionId || "",
      label: matched.label || field.label || "",
      selector: matched.selector || field.selector || "",
      name: matched.name || field.name || "",
      id: matched.id || field.id || "",
      type: matched.type || field.type || "",
    };
  });

  return {
    ...command,
    args: {
      ...args,
      fields: nextFields,
    },
  };
}

function buildRegistryEvidence(registry = {}, resolvedCommand = {}) {
  const compact = compactActionRegistryForModel(registry, 60);
  const fieldActions = Array.isArray(compact.actions)
    ? compact.actions.filter((action) => action.kind === "field")
    : [];
  const resolvedFields = Array.isArray(resolvedCommand?.args?.fields)
    ? resolvedCommand.args.fields.filter((field) => field && typeof field === "object")
    : [];
  const matchedCount = resolvedFields.filter((field) => field.registryMatched === true || String(field.actionId || "").trim()).length;

  return {
    route: "playwright",
    status: compact.ok ? "ready" : "failed",
    stats: compact.stats || {},
    fieldsRequested: resolvedFields.length,
    fieldsResolved: matchedCount,
    fields: fieldActions.slice(0, 30).map((field) => ({
      actionId: field.actionId || "",
      label: field.label || "",
      selector: field.selector || "",
      name: field.name || "",
      id: field.id || "",
      type: field.type || "",
      required: field.required === true,
      disabled: field.disabled === true,
      readonly: field.readonly === true,
    })),
    error: safeText(compact.error || "", 500),
  };
}

export async function preparePlaywrightCommandWithRegistry({
  command = {},
  state = {},
  currentUrl = "",
} = {}) {
  if (!shouldResolveWithRegistry(command)) {
    return {
      command,
      registryEvidence: {
        route: "playwright",
        status: "skipped",
        reason: "tool_not_registry_driven",
      },
    };
  }

  let registry = null;
  try {
    registry = await buildPlaywrightActionRegistry({
      args: {
        currentUrl: currentUrl || state.currentUrl || "",
      },
      state,
      currentUrl: currentUrl || state.currentUrl || "",
    });
  } catch (error) {
    return {
      command,
      registryEvidence: {
        route: "playwright",
        status: "failed",
        reason: "registry_build_exception",
        error: safeText(error instanceof Error ? error.message : String(error || ""), 500),
      },
    };
  }

  if (!registry?.ok) {
    return {
      command,
      registryEvidence: {
        route: "playwright",
        status: "failed",
        reason: "registry_build_failed",
        error: safeText(registry?.error || "Playwright registry failed.", 500),
      },
    };
  }

  const resolved = withActionRegistryFieldTargets(command, registry);
  const enriched = enrichResolvedFields(resolved, registry);

  return {
    command: enriched,
    registryEvidence: buildRegistryEvidence(registry, enriched),
  };
}
