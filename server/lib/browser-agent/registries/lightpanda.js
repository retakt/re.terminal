import { safeText } from "../shared.js";

const LIGHTPANDA_REGISTRY_TOOLS = new Set([
  "browserFillFields",
  "browserFillAndSubmit",
  "browserSubmitForm",
  "browserClickByText",
]);

function key(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function valuesForMatch(entry = {}) {
  return [
    entry.actionId,
    entry.label,
    entry.selector,
    entry.name,
    entry.id,
    entry.type,
    entry.role,
    entry.text,
    entry.placeholder,
  ].map((value) => String(value || ""));
}

function toFieldEntry(source = {}, index = 0, prefix = "lp_field") {
  if (!source || typeof source !== "object") return null;
  const label = safeText(
    source.label ||
      source.text ||
      source.name ||
      source.placeholder ||
      source.id ||
      source.selector ||
      "",
    220
  );
  if (!label) return null;

  const actionId = safeText(source.actionId || `${prefix}_${index + 1}`, 120);
  return {
    actionId,
    kind: "field",
    label,
    selector: safeText(source.selector || "", 400),
    name: safeText(source.name || "", 120),
    id: safeText(source.id || "", 120),
    type: safeText(source.type || "", 80),
    role: safeText(source.role || "", 80),
    text: safeText(source.text || "", 200),
    placeholder: safeText(source.placeholder || "", 200),
  };
}

function buildLightpandaRegistry(observation = {}) {
  const source = observation && typeof observation === "object" ? observation : {};
  const inputs = Array.isArray(source.inputs) ? source.inputs : [];
  const forms = Array.isArray(source.forms) ? source.forms : [];
  const interactiveElements = Array.isArray(source.interactiveElements) ? source.interactiveElements : [];

  const fieldEntries = [
    ...inputs.map((entry, index) => toFieldEntry(entry, index, "lp_input")),
    ...forms.flatMap((form, formIndex) => {
      const fields = Array.isArray(form?.fields) ? form.fields : [];
      return fields.map((field, fieldIndex) => toFieldEntry(field, formIndex * 100 + fieldIndex, "lp_form_field"));
    }),
    ...interactiveElements
      .filter((entry) => {
        const role = String(entry?.role || "").toLowerCase();
        const type = String(entry?.type || "").toLowerCase();
        const tag = String(entry?.tag || entry?.tagName || "").toLowerCase();
        return ["textbox", "combobox", "searchbox", "input"].includes(role) ||
          ["input", "textarea", "select"].includes(tag) ||
          ["text", "search", "email", "password", "tel", "number", "date"].includes(type);
      })
      .map((entry, index) => toFieldEntry(entry, index, "lp_interactive")),
  ].filter(Boolean);

  const deduped = [];
  const seen = new Set();
  for (const entry of fieldEntries) {
    const identity = key([entry.selector, entry.id, entry.name, entry.label].join("|"));
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    deduped.push(entry);
  }

  return {
    ok: deduped.length > 0,
    status: deduped.length > 0 ? "ready" : "empty",
    actions: deduped,
    stats: {
      total: deduped.length,
      fields: deduped.length,
    },
  };
}

function scoreMatch(field = {}, action = {}) {
  const targetValues = valuesForMatch(field).map(key).filter(Boolean);
  const actionValues = valuesForMatch(action).map(key).filter(Boolean);
  let score = 0;

  const fieldActionId = key(field.actionId || field.lpActionId || "");
  if (fieldActionId && fieldActionId === key(action.actionId || "")) score += 300;

  const fieldSelector = key(field.selector || "");
  if (fieldSelector && fieldSelector === key(action.selector || "")) score += 260;

  for (const left of targetValues) {
    for (const right of actionValues) {
      if (left === right) score = Math.max(score, 220);
      else if (left && right && (left.includes(right) || right.includes(left))) score = Math.max(score, 140);
    }
  }

  return score;
}

function resolveField(field = {}, registry = {}) {
  const actions = Array.isArray(registry.actions) ? registry.actions : [];
  if (!actions.length) return null;

  const exactActionId = String(field.actionId || field.lpActionId || "").trim();
  if (exactActionId) {
    const exact = actions.find((action) => String(action.actionId || "") === exactActionId);
    if (exact) return exact;
  }

  const scored = actions
    .map((action) => ({ action, score: scoreMatch(field, action) }))
    .sort((left, right) => right.score - left.score)[0];
  return scored && scored.score >= 120 ? scored.action : null;
}

function resolveFillFields(command = {}, registry = {}) {
  const args = command.args && typeof command.args === "object" ? command.args : {};
  if (!Array.isArray(args.fields)) return command;

  const nextFields = args.fields.map((field) => {
    if (!field || typeof field !== "object") return field;
    const matched = resolveField(field, registry);
    if (!matched) return field;

    return {
      ...field,
      lpActionId: matched.actionId || field.lpActionId || "",
      label: matched.label || field.label || "",
      selector: matched.selector || field.selector || "",
      name: matched.name || field.name || "",
      id: matched.id || field.id || "",
      type: matched.type || field.type || "",
      registryMatched: true,
    };
  });

  return {
    ...command,
    args: {
      ...args,
      fields: nextFields,
    },
    notes: [command.notes || "", "Resolved fields against Lightpanda route registry."]
      .filter(Boolean)
      .join(" "),
  };
}

function resolveClickTarget(command = {}, registry = {}) {
  const args = command.args && typeof command.args === "object" ? command.args : {};
  if (args.selector || !args.text) return command;

  const wanted = key(args.text);
  if (!wanted) return command;

  const matched = (Array.isArray(registry.actions) ? registry.actions : []).find((entry) => {
    const text = key(entry.label || entry.text || "");
    return text && (text === wanted || text.includes(wanted) || wanted.includes(text));
  });

  if (!matched?.selector) return command;

  return {
    ...command,
    args: {
      ...args,
      selector: matched.selector,
    },
    notes: [command.notes || "", "Resolved click target against Lightpanda route registry."]
      .filter(Boolean)
      .join(" "),
  };
}

export async function prepareLightpandaCommandWithRegistry({
  command = {},
  currentObservation = null,
} = {}) {
  const tool = String(command?.tool || "").trim();
  if (!LIGHTPANDA_REGISTRY_TOOLS.has(tool)) {
    return {
      command,
      registryEvidence: {
        route: "lightpanda",
        status: "skipped",
        reason: "tool_not_registry_driven",
      },
    };
  }

  const registry = buildLightpandaRegistry(currentObservation || {});
  if (!registry.ok) {
    return {
      command,
      registryEvidence: {
        route: "lightpanda",
        status: "empty",
        reason: "no_registry_fields_in_observation",
      },
    };
  }

  const withFields = resolveFillFields(command, registry);
  const withClick = resolveClickTarget(withFields, registry);
  const requestedFields = Array.isArray(withClick?.args?.fields) ? withClick.args.fields.length : 0;
  const matchedFields = Array.isArray(withClick?.args?.fields)
    ? withClick.args.fields.filter((field) => field?.registryMatched === true).length
    : 0;

  return {
    command: withClick,
    registryEvidence: {
      route: "lightpanda",
      status: "ready",
      stats: registry.stats,
      fieldsRequested: requestedFields,
      fieldsResolved: matchedFields,
      fields: registry.actions.slice(0, 30).map((field) => ({
        actionId: field.actionId || "",
        label: field.label || "",
        selector: field.selector || "",
        name: field.name || "",
        id: field.id || "",
        type: field.type || "",
      })),
    },
  };
}
