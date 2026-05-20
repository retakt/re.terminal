import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function siteSkillsDir() {
  return path.resolve(__dirname, "..", "config", "site-skills");
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function safeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function publicSkillSummary(skill) {
  return {
    id: skill.id,
    name: skill.name,
    enabled: skill.enabled !== false,
    version: skill.version || "",
    domains: Array.isArray(skill.domains) ? skill.domains : [],
    description: skill.description || "",
    source: skill.source || "",
    updatedAt: skill.updatedAt || "",
    actions: Array.isArray(skill.actions)
      ? skill.actions.map((action) => ({
          id: action.id,
          label: action.label,
          kind: action.kind || "",
          pageKey: action.pageKey || "",
          requiresConfirmation: Boolean(action.requiresConfirmation),
          observedOnly: Boolean(action.observedOnly),
        }))
      : [],
    pages: skill.pages && typeof skill.pages === "object"
      ? Object.keys(skill.pages)
      : [],
  };
}

export function listSiteSkills() {
  const dir = siteSkillsDir();

  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const skill = readJsonFile(path.join(dir, file));
      if (!skill || typeof skill !== "object") return null;

      return {
        ...skill,
        sourceFile: file,
      };
    })
    .filter(Boolean);
}

export function listPublicSiteSkills() {
  return listSiteSkills().map(publicSkillSummary);
}

export function getSiteSkill(id) {
  const wanted = safeId(id);
  if (!wanted) return null;

  return listSiteSkills().find((skill) =>
    safeId(skill.id) === wanted || safeId(skill.sourceFile?.replace(/\.json$/, "")) === wanted
  ) || null;
}

export function matchSiteSkillForUrl(url) {
  const lowerUrl = String(url || "").toLowerCase();
  if (!lowerUrl) return null;

  return listSiteSkills().find((skill) => {
    if (skill.enabled === false) return false;

    const domains = Array.isArray(skill.domains) ? skill.domains : [];
    return domains.some((domain) =>
      lowerUrl.includes(String(domain || "").toLowerCase())
    );
  }) || null;
}

export function buildSiteSkillPrompt(skill) {
  if (!skill) return "";

  const actions = Array.isArray(skill.actions)
    ? skill.actions.map((action) => ({
        id: action.id,
        label: action.label,
        kind: action.kind,
        pageKey: action.pageKey,
        requiresConfirmation: Boolean(action.requiresConfirmation),
      }))
    : [];

  const pages = skill.pages && typeof skill.pages === "object"
    ? Object.values(skill.pages).map((page) => ({
        key: page.key,
        url: page.url,
        title: page.title,
        path: page.path,
        counts: page.counts,
      }))
    : [];

  return [
    `Active website skill: ${skill.name || skill.id}`,
    skill.description || "",
    "",
    "Rules:",
    ...(Array.isArray(skill.rules) ? skill.rules.map((rule) => `- ${rule}`) : []),
    "",
    "Observed pages:",
    JSON.stringify(pages, null, 2),
    "",
    "Available actions:",
    JSON.stringify(actions, null, 2),
  ].filter(Boolean).join("\n");
}