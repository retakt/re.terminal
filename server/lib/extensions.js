import {
  getSiteSkill,
  listPublicSiteSkills,
  matchSiteSkillForUrl,
  updateSiteSkillEnabled,
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

function skillActions(skill = {}) {
  const learned = Array.isArray(skill.learnedActions) ? skill.learnedActions : [];
  const imported = Array.isArray(skill.actions) ? skill.actions : [];
  const seen = new Set();

  return [...learned, ...imported].filter((action) => {
    const key = action.id || `${action.label || ""}:${action.pageKey || ""}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dangerousActionKinds(skill = {}) {
  return skillActions(skill)
    .filter((action) => action.requiresConfirmation)
    .map((action) => action.kind || action.label || action.id)
    .filter(Boolean);
}

function permissionsForSiteSkill(skill = {}) {
  const actions = skillActions(skill);

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

    actions: skillActions(skill).map(publicAction),
    pages: skillPageKeys(skill),
  };
}

export function listExtensions(options = {}) {
  const includeDisabled = options?.includeDisabled === true;
  return listPublicSiteSkills()
    .map((publicSkill) => getSiteSkill(publicSkill.id) || publicSkill)
    .filter((skill) => includeDisabled || skill.enabled !== false)
    .map((skill) => extensionFromSiteSkill(skill))
    .filter(Boolean);
}

export function getExtension(id, options = {}) {
  const raw = String(id || "").trim();
  if (!raw) return null;

  const skillId = raw.startsWith("site:") ? raw.slice("site:".length) : raw;
  const skill = getSiteSkill(skillId);
  if (!skill || (skill.enabled === false && options?.includeDisabled !== true)) return null;
  return extensionFromSiteSkill(skill);
}

export function getExtensionSkill(id, options = {}) {
  const raw = String(id || "").trim();
  if (!raw) return null;

  const skillId = raw.startsWith("site:") ? raw.slice("site:".length) : raw;
  const skill = getSiteSkill(skillId);
  if (!skill || (skill.enabled === false && options?.includeDisabled !== true)) return null;
  return skill;
}

export function matchExtensionForUrl(url) {
  const skill = matchSiteSkillForUrl(url);
  return extensionFromSiteSkill(skill);
}

export function setExtensionEnabled(id, enabled) {
  const skill = updateSiteSkillEnabled(id, enabled !== false);
  return skill ? extensionFromSiteSkill(skill) : null;
}

function actionMatches(action = {}, wantedId = "", wantedLabel = "") {
  if (wantedId) return action.id === wantedId;
  const actionLabel = safeText(action.label).toLowerCase();
  return Boolean(
    wantedLabel &&
    (actionLabel === wantedLabel ||
      actionLabel.includes(wantedLabel) ||
      wantedLabel.includes(actionLabel))
  );
}

export function findExtensionAction({ extensionId = "", actionId = "", label = "" } = {}) {
  const wantedId = String(actionId || "").trim();
  const wantedLabel = safeText(label).toLowerCase();
  const skills = extensionId
    ? [getExtensionSkill(extensionId)].filter(Boolean)
    : listPublicSiteSkills()
      .map((publicSkill) => getSiteSkill(publicSkill.id))
      .filter((skill) => skill?.enabled !== false)
      .filter(Boolean);

  for (const skill of skills) {
    const action = skillActions(skill).find((entry) => actionMatches(entry, wantedId, wantedLabel));
    if (action) return { skill, action };
  }

  return { skill: extensionId ? null : skills[0] || null, action: null };
}

export function planExtensionAction(args = {}) {
  const extensionId = String(args.extensionId || args.id || args.skillId || "").trim();
  const { skill, action } = findExtensionAction({
    extensionId,
    actionId: args.actionId,
    label: args.label,
  });

  if (!skill) {
    return {
      ok: false,
      error: extensionId ? `extension not found: ${extensionId}` : "extensionId is required unless the action label is unique across loaded extensions",
      availableExtensions: listExtensions().map((extension) => ({
        id: extension.id,
        name: extension.name,
        domains: extension.domains,
      })),
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
