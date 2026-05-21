import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const configPath = path.join(repoRoot, "server", "config", "mcp-servers.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readConfig() {
  return fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
}

function writeConfig(value) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, value, "utf8");
}

function parseJsonText(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function main() {
  const originalConfig = readConfig();
  const hadConfig = fs.existsSync(configPath);

  try {
    process.env.PLAYWRIGHT_MCP_ENABLED = "false";
    const gateway = await import("../lib/mcp-gateway.js");

    writeConfig(JSON.stringify({
      servers: {
        playwright: {
          id: "playwright",
          title: "Playwright MCP",
          source: "external",
          type: "external",
          transport: "stdio",
          protocol: "mcp",
          enabled: false,
          command: "npx",
          args: ["-y", "@playwright/mcp@latest"],
          description: "Official Microsoft Playwright MCP server for browser automation.",
        },
      },
    }, null, 2));

    let servers = await gateway.listMcpServers();
    assert(Array.isArray(servers), "listMcpServers must return an array");
    const disabledPlaywright = servers.find((server) => server.id === "playwright");
    assert(disabledPlaywright, "disabled Playwright MCP config should appear in server status");
    assert(disabledPlaywright.enabled === false, "disabled Playwright MCP should be marked disabled");

    writeConfig(originalConfig || JSON.stringify({
      servers: {
        playwright: {
          id: "playwright",
          title: "Playwright MCP",
          source: "external",
          type: "external",
          transport: "stdio",
          protocol: "mcp",
          enabled: true,
          command: "npx",
          args: ["-y", "@playwright/mcp@latest"],
          description: "Official Microsoft Playwright MCP server for browser automation.",
        },
      },
    }, null, 2));

    servers = await gateway.listMcpServers();
    const playwright = servers.find((server) => server.id === "playwright");
    assert(playwright, "enabled Playwright MCP config should appear in server status");
    assert(["configured", "ready", "error"].includes(playwright.status), `unexpected Playwright MCP status: ${playwright.status}`);

    let tools = await gateway.listMcpTools();
    assert(tools.some((tool) => tool.name === "mcp__ops__playwright_mcp_status"), "mcp__ops__playwright_mcp_status must be registered");
    assert(tools.some((tool) => tool.name === "mcp__ops__mcp_architecture_status"), "mcp__ops__mcp_architecture_status must be registered");
    assert(!tools.some((tool) => tool.serverId === "playwright"), "external Playwright tools should not be listed before discovery");

    const status = parseJsonText(await gateway.callMcpTool("mcp__ops__playwright_mcp_status", {}));
    assert(status.ok === true, "Playwright MCP status ops tool should be callable");
    assert(status.server?.id === "playwright", "Playwright MCP status should describe playwright server");
    assert(["configured", "ready", "error"].includes(status.server?.status), `status must be configured/ready/error, got ${status.server?.status}`);

    const listed = parseJsonText(await gateway.callMcpTool("mcp__ops__external_mcp_tools", { serverId: "playwright", refresh: true }));
    assert(listed.ok === true, "external_mcp_tools should return ok after real discovery");
    assert(Array.isArray(listed.tools), "external_mcp_tools should return a tools array");
    assert(listed.tools.length > 0, "real Playwright MCP discovery should return tools");

    tools = await gateway.listMcpTools();
    const navigate = tools.find((tool) => tool.name === "mcp__playwright__browser_navigate");
    assert(navigate, "discovered Playwright browser_navigate tool should appear in listMcpTools");

    const navigateResult = await gateway.callMcpTool("mcp__playwright__browser_navigate", { url: "https://example.com" });
    assert(navigateResult && typeof navigateResult === "object", "external Playwright tool call should return the MCP result object");

    const route = gateway.routeMcpIntent("open google", { mode: "browser", projectId: "smoke" });
    assert(route.tool_candidates?.[0]?.name === "mcp__browser_agent__run", "generic browser route should remain browser_agent.run");

    const playwrightRoute = gateway.routeMcpIntent("playwright mcp status", { mode: "auto", projectId: "smoke" });
    assert(playwrightRoute.tool_candidates?.[0]?.name === "mcp__ops__playwright_mcp_status", "explicit Playwright MCP status should route to ops status");

    console.log(JSON.stringify({
      ok: true,
      tests: [
        "listMcpServers awaits async external status and returns an array",
        "disabled Playwright MCP config appears as disabled",
        "enabled Playwright MCP appears as configured/ready/error",
        "mcp__ops__playwright_mcp_status is registered and callable",
        "mcp__ops__mcp_architecture_status is registered",
        "external Playwright tools are hidden before discovery",
        "real Playwright MCP tools appear after refresh/list",
        "mcp__playwright__browser_navigate dispatches through external MCP client",
        "generic browser routing remains browser_agent.run",
      ],
      discoveredToolCount: listed.tools.length,
      navigateResultKeys: Object.keys(navigateResult),
    }, null, 2));
  } finally {
    try {
      const external = await import("../lib/external-mcp-client.js");
      await external.stopExternalMcpClient("playwright");
    } catch {}
    if (hadConfig) writeConfig(originalConfig);
    else fs.rmSync(configPath, { force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
