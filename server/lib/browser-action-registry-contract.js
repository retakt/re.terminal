export const BROWSER_ACTION_REGISTRY_VERSION = "browser_action_registry_v1";

function safeText(value = "", limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function normalizeBrowserAction(action = {}) {
  const kind = safeText(action.kind || "", 40);
  const tag = safeText(action.tag || "", 40);
  const type = safeText(action.type || "", 80);
  const label = safeText(action.label || action.text || "", 240);
  const actionId = safeText(action.actionId || "", 120);

  return {
    actionId,
    registryVersion: BROWSER_ACTION_REGISTRY_VERSION,
    source: safeText(action.source || "playwright_dom_probe", 80),
    kind,
    tag,
    type,
    label,
    text: safeText(action.text || label, 240),

    selector: safeText(action.selector || "", 400),
    playwrightRef: safeText(action.playwrightRef || action.ref || "", 160),

    name: safeText(action.name || "", 160),
    id: safeText(action.id || "", 160),
    role: safeText(action.role || "", 80),
    href: safeText(action.href || "", 400),

    value: safeText(action.value || "", 240),
    checked: typeof action.checked === "boolean" ? action.checked : null,

    disabled: Boolean(action.disabled),
    readonly: Boolean(action.readonly),
    required: Boolean(action.required),

    lightpandaEvidence: safeText(action.lightpandaEvidence || "", 160),
  };
}

export function normalizeBrowserActionRegistry(registry = {}) {
  const actions = Array.isArray(registry.actions)
    ? registry.actions.map(normalizeBrowserAction).filter((action) => action.actionId)
    : [];

  return {
    registryVersion: BROWSER_ACTION_REGISTRY_VERSION,
    ok: registry.ok === true,
    status: safeText(registry.status || (registry.ok === true ? "ready" : "failed"), 80),
    engine: safeText(registry.engine || "playwright_mcp", 80),
    url: safeText(registry.url || "", 800),
    title: safeText(registry.title || "", 300),
    actions,
    stats: {
      total: actions.length,
      fields: actions.filter((action) => action.kind === "field").length,
      buttons: actions.filter((action) => action.kind === "button").length,
      links: actions.filter((action) => action.kind === "link").length,
    },
    error: safeText(registry.error || "", 1200),
  };
}

export function compactActionRegistryForModel(registry = {}, limit = 80) {
  const normalized = normalizeBrowserActionRegistry(registry);

  return {
    registryVersion: normalized.registryVersion,
    ok: normalized.ok,
    status: normalized.status,
    url: normalized.url,
    title: normalized.title,
    stats: normalized.stats,
    actions: normalized.actions.slice(0, limit).map((action) => ({
      actionId: action.actionId,
      kind: action.kind,
      tag: action.tag,
      type: action.type,
      label: action.label,
      name: action.name,
      id: action.id,
      role: action.role,
      required: action.required,
      disabled: action.disabled,
      readonly: action.readonly,
      lightpandaEvidence: action.lightpandaEvidence,
    })),
    error: normalized.error,
  };
}

export function compactActionRegistryForClient(registry = {}, limit = 200) {
  const normalized = normalizeBrowserActionRegistry(registry);

  return {
    registryVersion: normalized.registryVersion,
    ok: normalized.ok,
    status: normalized.status,
    url: normalized.url,
    title: normalized.title,
    stats: normalized.stats,
    actions: normalized.actions.slice(0, limit).map((action) => ({
      actionId: action.actionId,
      kind: action.kind,
      label: action.label,
      tag: action.tag,
      type: action.type,
      name: action.name,
      id: action.id,
      role: action.role,
      required: action.required,
      disabled: action.disabled,
      readonly: action.readonly,
      value: action.value,
      checked: action.checked,
      href: action.href,
      lightpandaEvidence: action.lightpandaEvidence,
    })),
    error: normalized.error,
  };
}
