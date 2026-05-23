import fs from "node:fs";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile("server/.env");

function setDefaultEnv(key, value) {
  if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
}

setDefaultEnv("BROWSER_AGENT_ORCHESTRATOR_ENABLED", "true");
setDefaultEnv("BROWSER_AGENT_LEGACY_RUNTIME", "false");
setDefaultEnv("BROWSER_AGENT_MAIN_HANDOFF_ENABLED", "false");
setDefaultEnv("BROWSER_AGENT_REPAIR_ATTEMPTS", "0");
setDefaultEnv("BROWSER_AGENT_TIMEOUT_MS", "45000");
setDefaultEnv("EXTERNAL_MCP_CALL_TIMEOUT_MS", "15000");

const {
  browserAgentRun,
  browserAgentReset,
} = await import("../lib/browser-agent.js");

const sessionId = `debug-browser-${Date.now()}`;
const instruction = process.argv.slice(2).join(" ") || "Open https://example.com and click More information.";
const started = Date.now();

console.log("=== DEBUG INPUT ===");
console.log(JSON.stringify({
  sessionId,
  instruction,
  baseUrl: process.env.BROWSER_AGENT_BASE_URL,
  model: process.env.BROWSER_AGENT_MODEL,
  orchestrator: process.env.BROWSER_AGENT_ORCHESTRATOR_ENABLED,
}, null, 2));

const timeout = setTimeout(() => {
  console.error("\n=== TIMEOUT ===");
  console.error(`browserAgentRun did not return after ${Date.now() - started}ms`);
  process.exit(124);
}, 120000);

try {
  await browserAgentReset({ sessionId });

  const result = await browserAgentRun({
    sessionId,
    instruction,
    useExtensions: true,
    currentUrl: "",
  });

  clearTimeout(timeout);

  console.log("\n=== RESULT SUMMARY ===");
  console.log(JSON.stringify({
    ok: result.ok,
    status: result.status,
    summary: result.summary,
    currentUrl: result.currentUrl,
    currentTitle: result.currentTitle,
    blockedReason: result.blockedReason,
    runtimeTiming: result.runtimeTiming,
    tokenUsage: result.tokenUsage,
    sequence: result.sequence,
    architecture: result.pipeline?.architecture,
  }, null, 2));

  console.log("\n=== AGENT TRACE ===");
  for (const [index, entry] of (result.agentTrace || []).entries()) {
    const label = entry.roleLabel || entry.agentName || entry.title || entry.role || "Agent";
    const kind = entry.agentKind || entry.role || "agent";
    const model = entry.modelLabel || entry.model || "";
    const modelPart = model ? ` [${model}]` : "";
    console.log(`${index + 1}. ${label}${modelPart} | kind=${kind} | step=${entry.step ?? "-"} | status=${entry.status} | ok=${entry.ok} | tool=${entry.tool || "-"}`);
    if (entry.summary) console.log(`   ${entry.summary}`);
    if (entry.tokens) console.log(`   tokens=${entry.tokens} duration=${entry.durationMs}ms`);
  }

  console.log("\n=== RAW RESULT SAVED ===");
  const out = `server/debug-browser-agent-${Date.now()}.json`;
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(out);

  process.exit(result.ok ? 0 : 1);
} catch (err) {
  clearTimeout(timeout);
  console.error("\n=== ERROR ===");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}
