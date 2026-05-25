import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.join(__dirname, "..");
const libRoot = path.join(serverRoot, "lib");
const configPath = path.join(serverRoot, "config", "mcp-servers.json");
const examplePath = path.join(serverRoot, "config", "mcp-servers.example.json");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
    return;
  }
  passed += 1;
  console.log(`PASS ${message}`);
}

function playwrightConfig(enabled) {
  return {
    servers: {
      playwright: {
        id: "playwright",
        title: "Playwright MCP",
        source: "external",
        type: "external",
        transport: "stdio",
        protocol: "mcp",
        enabled,
        command: "npx",
        args: ["-y", "@playwright/mcp@latest", "--isolated", "--headless"],
        description: "Official Microsoft Playwright MCP server for browser automation.",
      },
    },
  };
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function main() {
  console.log("=== MCP Architecture Smoke Tests ===");

  const originalConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : null;
  const gateway = await import(`file://${path.join(libRoot, "mcp-gateway.js")}`);
  const externalClient = await import(`file://${path.join(libRoot, "external-mcp-client.js")}`);

  try {
    assert(typeof gateway.listMcpServers === "function", "listMcpServers is exported");
    assert(typeof gateway.listMcpTools === "function", "listMcpTools is exported");
    assert(typeof gateway.listMcpToolDefinitions === "function", "listMcpToolDefinitions is exported");
    assert(typeof gateway.callMcpTool === "function", "callMcpTool is exported");
    assert(typeof gateway.routeMcpIntent === "function", "routeMcpIntent is exported");

    assert(fs.existsSync(examplePath), "mcp-servers.example.json exists");
    const example = JSON.parse(fs.readFileSync(examplePath, "utf8"));
    const examplePlaywright = example.servers?.playwright;
    assert(examplePlaywright?.id === "playwright", "example config includes playwright server");
    assert(examplePlaywright?.protocol === "mcp", "example Playwright config uses MCP protocol");
    assert(examplePlaywright?.enabled === false, "example Playwright config is disabled by default");
    assert(examplePlaywright?.command === "npx", "example Playwright config uses npx");
    assert(examplePlaywright?.args?.includes("@playwright/mcp@latest"), "example Playwright config uses official package");

    writeConfig(playwrightConfig(false));
    let servers = await gateway.listMcpServers();
    assert(Array.isArray(servers), "listMcpServers returns an array");
    const disabledPlaywright = servers.find((server) => server.id === "playwright");
    assert(disabledPlaywright?.source === "external", "disabled Playwright MCP appears as an external server");
    assert(disabledPlaywright?.enabled === false, "disabled Playwright MCP remains visible as disabled");
    assert(disabledPlaywright?.status === "disabled", "disabled Playwright MCP reports disabled status");

    writeConfig(playwrightConfig(true));
    servers = await gateway.listMcpServers();
    const enabledPlaywright = servers.find((server) => server.id === "playwright");
    assert(enabledPlaywright?.source === "external", "enabled Playwright MCP appears as external");
    assert(["configured", "ready", "error"].includes(enabledPlaywright?.status), "enabled Playwright MCP reports configured/ready/error");

    const toolsBefore = await gateway.listMcpTools();
    assert(Array.isArray(toolsBefore), "listMcpTools returns an array");
    assert(toolsBefore.some((tool) => tool.name === "mcp__ops__playwright_mcp_status"), "playwright_mcp_status ops tool is registered");
    assert(toolsBefore.some((tool) => tool.name === "mcp__ops__mcp_architecture_status"), "mcp_architecture_status ops tool is registered");
    assert(!toolsBefore.some((tool) => tool.name.startsWith("mcp__playwright__")), "external Playwright tools are hidden before discovery");

    const statusResult = parseMaybeJson(await gateway.callMcpTool("mcp__ops__playwright_mcp_status", {}));
    assert(statusResult?.ok === true, "playwright_mcp_status is callable");
    assert(statusResult?.server?.id === "playwright", "playwright_mcp_status returns Playwright server status");

    const discovered = parseMaybeJson(await gateway.callMcpTool("mcp__ops__external_mcp_tools", { serverId: "playwright" }));
    assert(discovered?.ok === true, "external_mcp_tools discovers real Playwright MCP tools");
    assert(Array.isArray(discovered?.tools), "external_mcp_tools returns a tools array");
    assert(discovered.tools.some((tool) => tool.name === "browser_navigate"), "real Playwright browser_navigate tool is discovered");

    const toolsAfter = await gateway.listMcpTools();
    assert(toolsAfter.some((tool) => tool.name === "mcp__playwright__browser_navigate"), "discovered Playwright tool appears in listMcpTools");

    const definitions = await gateway.listMcpToolDefinitions();
    assert(definitions.some((tool) => tool.function?.name === "mcp__playwright__browser_navigate"), "discovered Playwright tool appears in tool definitions");

    const navigateResult = await gateway.callMcpTool("mcp__playwright__browser_navigate", { url: "https://example.com" });
    assert(Array.isArray(navigateResult?.content), "mcp__playwright__browser_navigate dispatches to real external MCP client");

    const route = await gateway.routeMcpIntent("open google", { mode: "browser" });
    assert(route.tool_candidates?.[0]?.name === "mcp__browser_agent__run", "generic browser route remains browser_agent.run");

    const playwrightRoute = await gateway.routeMcpIntent("playwright mcp status", {});
    assert(playwrightRoute.tool_candidates?.[0]?.name === "mcp__ops__playwright_mcp_status", "explicit Playwright MCP status routes to ops status");
  } finally {
    await externalClient.stopExternalMcpClient("playwright").catch(() => {});
    if (originalConfig == null) {
      fs.rmSync(configPath, { force: true });
    } else {
      fs.writeFileSync(configPath, originalConfig, "utf8");
    }
  }

  console.log("\n=== Test Summary ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
