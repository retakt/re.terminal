import {
  getSiteSkill,
  listPublicSiteSkills,
  matchSiteSkillForUrl,
} from "./site-skills.js";

function nowIso() {
  return new Date().toISOString();
}

function safeText(value, limit = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function publicAction(action = {}) {
  return {
    id: action.id,
    label: action.label,
    kind: action.kind,
    pageKey: action.pageKey,
    requiresConfirmation: Boolean(action.requiresConfirmation),
    observedOnly: Boolean(action.observedOnly),
  };
}

function fullAction(action = {}) {
  return {
    id: action.id,
    label: action.label,
    kind: action.kind,
    source: action.source || "",
    pageKey: action.pageKey,
    selector: action.selector || "",
    href: action.href || "",
    formIndex: action.formIndex ?? null,
    requiresConfirmation: Boolean(action.requiresConfirmation),
    observedOnly: Boolean(action.observedOnly),
    lastObservedAt: action.lastObservedAt || "",
  };
}

function skillPageKeys(skill = {}) {
  if (Array.isArray(skill.pages)) {
    return skill.pages;
  }

  if (skill.pages && typeof skill.pages === "object") {
    return Object.keys(skill.pages);
  }

  return [];
}

function dangerousActionKinds(skill = {}) {
  return (skill.actions || [])
    .filter((action) => action.requiresConfirmation)
    .map((action) => action.kind || action.label || action.id)
    .filter(Boolean);
}

function permissionsForSiteSkill(skill = {}) {
  const actions = skill.actions || [];

  const hasLinks = actions.some((action) => Boolean(action.href));
  const hasClicks = actions.some((action) => Boolean(action.selector));

  return [
    "site_skill.read",
    "site_skill.actions",
    "browser.read_page",
    ...(hasLinks ? ["browser.navigate"] : []),
    ...(hasClicks ? ["browser.click"] : []),
  ];
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function extensionFromSiteSkill(skill) {
  if (!skill) return null;

  const rules = uniqueStrings([
    ...(skill.rules || []),
    "Use this extension only on matching domains.",
    "Use one browser action at a time.",
    "Ask for confirmation before any action marked requiresConfirmation.",
    "Never reveal password values.",
  ]);

  return {
    id: skill.id,
    skillId: skill.id,
    type: "site_skill_extension",
    name: skill.name || `${skill.id} Extension`,
    enabled: skill.enabled !== false,
    version: skill.version || "0.1.0",
    domains: skill.domains || [],
    description: skill.description || "",
    source: skill.source || "site-skill",
    updatedAt: skill.updatedAt || nowIso(),

    permissions: permissionsForSiteSkill(skill),
    dangerousActions: uniqueStrings(dangerousActionKinds(skill)),

    rules,

    actions: (skill.actions || []).map(publicAction),
    pages: skillPageKeys(skill),
  };
}

export function listExtensions() {
  return listPublicSiteSkills()
    .map((publicSkill) => getSiteSkill(publicSkill.id) || publicSkill)
    .map((skill) => extensionFromSiteSkill(skill))
    .filter(Boolean);
}

export function getExtension(id) {
  const raw = String(id || "").trim();
  if (!raw) return null;

  const skillId = raw.startsWith("site:") ? raw.slice("site:".length) : raw;
  return extensionFromSiteSkill(getSiteSkill(skillId));
}

export function getExtensionSkill(id) {
  const raw = String(id || "").trim();
  if (!raw) return null;

  const skillId = raw.startsWith("site:") ? raw.slice("site:".length) : raw;
  return getSiteSkill(skillId);
}

export function matchExtensionForUrl(url) {
  const skill = matchSiteSkillForUrl(url);
  return extensionFromSiteSkill(skill);
}

export function findExtensionAction({ extensionId = "ezhrm", actionId = "", label = "" } = {}) {
  const skill = getExtensionSkill(extensionId);
  if (!skill) return { skill: null, action: null };

  const wantedId = String(actionId || "").trim();
  const wantedLabel = safeText(label).toLowerCase();

  const actions = skill.actions || [];

  const action = wantedId
    ? actions.find((entry) => entry.id === wantedId)
    : actions.find((entry) => safeText(entry.label).toLowerCase() === wantedLabel)
      || actions.find((entry) => wantedLabel && safeText(entry.label).toLowerCase().includes(wantedLabel))
      || actions.find((entry) => wantedLabel && wantedLabel.includes(safeText(entry.label).toLowerCase()));

  return { skill, action };
}

export function planExtensionAction(args = {}) {
  const extensionId = String(args.extensionId || args.id || args.skillId || "ezhrm").trim();

  const { skill, action } = findExtensionAction({
    extensionId,
    actionId: args.actionId,
    label: args.label,
  });

  if (!skill) {
    return {
      ok: false,
      error: `extension not found: ${extensionId}`,
    };
  }

  if (!action) {
    return {
      ok: false,
      error: "action not found",
      extension: extensionFromSiteSkill(skill),
      availableActions: (skill.actions || []).map(publicAction),
    };
  }

  return {
    ok: true,
    extension: extensionFromSiteSkill(skill),
    action: fullAction(action),
    requiresConfirmation: Boolean(action.requiresConfirmation),
    nextStep: action.requiresConfirmation
      ? `Ask the user to confirm before executing "${action.label}".`
      : `You may execute "${action.label}" if the user requested it.`,
  };
}