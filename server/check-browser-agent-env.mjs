import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const keys = [
  "BROWSER_AGENT_BASE_URL",
  "BROWSER_AGENT_ORCHESTRATOR_BASE_URL",
  "BROWSER_AGENT_MAIN_BASE_URL",
  "BROWSER_AGENT_STEP_AGENT_BASE_URL",
  "BROWSER_AGENT_CHECKER_BASE_URL",
  "BROWSER_AGENT_WATCHER_BASE_URL",
  "BROWSER_AGENT_FINAL_VERIFIER_BASE_URL",
  "BROWSER_AGENT_MODEL",
  "BROWSER_AGENT_STEP_AGENT_MODEL",
  "BROWSER_AGENT_CHECKER_MODEL",
  "BROWSER_AGENT_WATCHER_MODEL",
  "BROWSER_AGENT_PLANNER_MODEL",
  "BROWSER_AGENT_REVIEWER_MODEL",
  "BROWSER_AGENT_RESULT_REVIEWER_MODEL",
];

for (const k of keys) console.log(k + "=" + (process.env[k] || ""));

const base =
  process.env.BROWSER_AGENT_STEP_AGENT_BASE_URL ||
  process.env.BROWSER_AGENT_BASE_URL ||
  process.env.OLLAMA_BASE_URL;

const model =
  process.env.BROWSER_AGENT_STEP_AGENT_MODEL ||
  process.env.BROWSER_AGENT_MODEL;

console.log("\nTEST_BASE=", base);
console.log("TEST_MODEL=", model);

if (!base || !model) {
  console.error("Missing base or model");
  process.exit(1);
}

const cleanBase = base.replace(/\/+$/, "");

const tags = await fetch(cleanBase + "/api/tags").then(r => r.text());
console.log("\n/api/tags includes model?", tags.includes(`"name":"${model}"`) || tags.includes(`"model":"${model}"`));
console.log(tags.slice(0, 1200));

const chat = await fetch(cleanBase + "/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "say ok" }],
    stream: false
  })
}).then(r => r.text());

console.log("\n/api/chat result:");
console.log(chat.slice(0, 1200));
