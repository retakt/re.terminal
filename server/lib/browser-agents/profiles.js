export const BROWSER_AGENT_ARCHITECTURE = "main_orchestrator_step_agent_checker_watcher_final_verifier_v2";

export const BROWSER_AGENT_PROFILES = {
  orchestrator: {
    id: "orchestrator",
    role: "main_orchestrator",
    title: "Orchestrator",
    stage: "main",
    envKey: "ORCHESTRATOR",
    legacyStage: "main",
    defaultPersonality: "strategic, careful, concise, intent-focused",
    defaultSkills: ["intent_decomposition", "step_planning", "risk_awareness"],
    defaultSettings: {
      requiresVision: false,
      canExecuteBrowser: false,
      canAskUser: true,
      output: "strict_json",
    },
  },

  stepAgent: {
    id: "stepAgent",
    role: "gemma_step_agent",
    title: "Step Agent",
    stage: "planner",
    envKey: "STEP_AGENT",
    legacyStage: "planner",
    defaultPersonality: "practical, browser-aware, action-focused",
    defaultSkills: ["snapshot_reading", "tool_selection", "browser_action_planning"],
    defaultSettings: {
      requiresVision: true,
      canExecuteBrowser: false,
      canAskUser: true,
      output: "strict_json",
    },
  },

  checker: {
    id: "checker",
    role: "gemma_checker",
    title: "Checker",
    stage: "reviewer",
    envKey: "CHECKER",
    legacyStage: "reviewer",
    defaultPersonality: "skeptical, precise, safety-conscious",
    defaultSkills: ["command_validation", "target_repair", "risk_checking"],
    defaultSettings: {
      requiresVision: true,
      canExecuteBrowser: false,
      canRepairCommand: true,
      output: "strict_json",
    },
  },

  watcher: {
    id: "watcher",
    role: "gemma_result_checker",
    title: "Watcher",
    stage: "resultReviewer",
    envKey: "WATCHER",
    legacyStage: "resultReviewer",
    defaultPersonality: "visual, skeptical, evidence-first",
    defaultSkills: ["snapshot_verification", "result_validation", "repair_suggestion"],
    defaultSettings: {
      requiresVision: true,
      canAutoPassLowRisk: true,
      canSuggestRepair: true,
      output: "strict_json",
    },
  },

  reporter: {
    id: "reporter",
    role: "report_step_observe",
    title: "Reporter",
    stage: "reporter",
    envKey: "REPORTER",
    legacyStage: "reporter",
    defaultPersonality: "clear, brief, user-facing",
    defaultSkills: ["result_summarization", "noise_filtering"],
    defaultSettings: {
      requiresVision: false,
      userFacing: true,
      output: "plain_summary_or_json",
    },
  },

  finalVerifier: {
    id: "finalVerifier",
    role: "final_verifier",
    title: "Final Verifier",
    stage: "finalVerifier",
    envKey: "FINAL_VERIFIER",
    legacyStage: "main",
    defaultPersonality: "strict, objective, concise final judge",
    defaultSkills: ["goal_verification", "missing_step_detection", "final_answer"],
    defaultSettings: {
      requiresVision: false,
      canAskUser: true,
      userFacing: true,
      output: "strict_json",
    },
  },
};

function envValue(profile, suffix = "") {
  const key = profile.envKey;
  const legacy = String(profile.legacyStage || "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();

  return String(
    process.env[`BROWSER_AGENT_${key}_${suffix}`] ||
    process.env[`BROWSER_${key}_${suffix}`] ||
    process.env[`BROWSER_AGENT_${legacy}_${suffix}`] ||
    process.env[`BROWSER_${legacy}_${suffix}`] ||
    ""
  ).trim();
}

function listFromEnv(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getBrowserAgentProfile(id = "") {
  return BROWSER_AGENT_PROFILES[id] || BROWSER_AGENT_PROFILES.stepAgent;
}

export function browserAgentStage(id = "") {
  return getBrowserAgentProfile(id).stage;
}

export function browserAgentTraceTitle(id = "") {
  return getBrowserAgentProfile(id).title;
}

function parseJsonObject(value = "") {
  if (!String(value || "").trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function resolveBrowserAgentProfile(id = "") {
  const profile = getBrowserAgentProfile(id);
  const customPersonality = envValue(profile, "PERSONALITY");
  const customSkills = listFromEnv(envValue(profile, "SKILLS"));
  const customSettingsRaw = envValue(profile, "SETTINGS");
  const customSettingsObject = parseJsonObject(customSettingsRaw);
  const customMemory = envValue(profile, "MEMORY");
  const customPrompt = envValue(profile, "SYSTEM_PROMPT");

  return {
    id: profile.id,
    role: profile.role,
    title: profile.title,
    stage: profile.stage,
    envKey: profile.envKey,
    legacyStage: profile.legacyStage,
    personality: customPersonality || profile.defaultPersonality,
    skills: customSkills.length ? customSkills : profile.defaultSkills,
    settings: {
      ...(profile.defaultSettings || {}),
      ...(customSettingsObject || {}),
    },
    customSettings: customSettingsObject ? "" : customSettingsRaw,
    memory: customMemory,
    hasCustomPrompt: Boolean(customPrompt),
  };
}


export function browserAgentIdentityBlock(id = "") {
  const profile = getBrowserAgentProfile(id);
  const customPersonality = envValue(profile, "PERSONALITY");
  const customSkills = listFromEnv(envValue(profile, "SKILLS"));
  const customSettings = envValue(profile, "SETTINGS");
  const customMemory = envValue(profile, "MEMORY");
  const customPrompt = envValue(profile, "SYSTEM_PROMPT");

  const personality = customPersonality || profile.defaultPersonality;
  const skills = customSkills.length ? customSkills : profile.defaultSkills;

  return [
    `Agent Name: ${profile.title}`,
    `Agent ID: ${profile.id}`,
    `Runtime Stage: ${profile.stage}`,
    `Default Role: ${profile.role}`,
    `Personality: ${personality}`,
    `Skills: ${skills.join(", ")}`,
    `Settings: ${JSON.stringify(profile.defaultSettings)}`,
    customSettings ? `Custom Settings: ${customSettings}` : "",
    customMemory ? `Agent Memory / Notes: ${customMemory}` : "",
    customPrompt ? `Custom Agent Instructions: ${customPrompt}` : "",
  ].filter(Boolean).join("\n");
}

export function browserAgentSystemPrompt(id = "", basePrompt = "") {
  return [
    "You are one member of a pluggable browser-agent team.",
    "Your identity/personality/skills/settings may evolve over time; obey them while still following the strict task schema.",
    browserAgentIdentityBlock(id),
    "",
    String(basePrompt || "").trim(),
  ].filter(Boolean).join("\n");
}
