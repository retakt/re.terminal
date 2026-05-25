import { callBrowserAgentRoleJson } from "../browser-llm-runtime.js";
import { safeText } from "./shared.js";
import { checkerSystemPrompt } from "./prompts/roles.js";

function normalizeCheck(data = {}) {
  const approved = data.approved === true || String(data.status || "").toLowerCase() === "approved";
  return {
    approved,
    status: approved ? "approved" : "blocked",
    reason: safeText(data.reason || "", 900),
    messageToPlanner: safeText(data.messageToPlanner || "", 900),
    messageToUser: safeText(data.messageToUser || "", 900),
    confidence: Math.max(0, Math.min(Number(data.confidence ?? (approved ? 0.8 : 0.6)) || 0, 1)),
  };
}

function registryApprovesMappedFill(command = {}, registryEvidence = null) {
  const tool = String(command?.tool || "").trim();
  if (!["browserFillFields", "browserFillAndSubmit"].includes(tool)) return null;
  if (!registryEvidence || typeof registryEvidence !== "object") return null;
  if (String(registryEvidence.status || "") !== "ready") return null;

  const requested = Number(registryEvidence.fieldsRequested || 0);
  const resolved = Number(registryEvidence.fieldsResolved || 0);
  if (!requested || resolved < requested) return null;

  return {
    approved: true,
    status: "approved",
    reason: "Approved because the selected route registry resolved every requested field to route-owned targets.",
    messageToPlanner: "",
    messageToUser: "",
    confidence: 0.92,
  };
}

export async function checkBrowserCommand({
  route = "",
  step = {},
  command = {},
  currentState = {},
  currentObservation = null,
  registryEvidence = null,
  plan = null,
  images = [],
} = {}) {
  const response = await callBrowserAgentRoleJson("reviewer", {
    system: checkerSystemPrompt(),
    context: {
      route,
      step,
      command,
      currentState,
      currentObservation,
      registryEvidence,
      plan,
    },
    schemaName: "browser_agent_checker",
    images,
    route,
  });

  const check = normalizeCheck(response.data || {});
  const registryApproval = !check.approved
    ? registryApprovesMappedFill(command, registryEvidence)
    : null;

  return {
    ok: true,
    check: registryApproval || check,
    usage: response.usage,
    rawContent: response.rawContent,
  };
}
