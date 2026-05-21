#!/usr/bin/env node
/**
 * Smoke test for MCP architecture refactoring
 * 
 * Run with: node server/scripts/smoke-mcp-architecture.js
 * 
 * Verifies:
 * - Internal tool groups still list correctly
 * - Every internal group has source: "builtin" and mcpNative: false
 * - External config loader returns empty list if config missing
 * - Example config shape validates
 * - External configured servers are not listed as callable tools yet
 */

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverLib = path.join(__dirname, "..", "lib");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
    passed++;
  } else {
    console.error(`✗ ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log("=== MCP Architecture Smoke Tests ===\n");

  // Test 1: Import mcp-gateway and verify exports exist
  console.log("Test 1: Verify mcp-gateway exports");
  try {
    const gateway = await import(`file://${path.join(serverLib, "mcp-gateway.js")}`);
    
    assert(typeof gateway.listMcpServers === "function", "listMcpServers is exported");
    assert(typeof gateway.listMcpTools === "function", "listMcpTools is exported");
    assert(typeof gateway.listMcpToolDefinitions === "function", "listMcpToolDefinitions is exported");
    assert(typeof gateway.callMcpTool === "function", "callMcpTool is exported");
    assert(typeof gateway.getMcpLogs === "function", "getMcpLogs is exported");
  } catch (err) {
    console.error(`Failed to import mcp-gateway: ${err.message}`);
    failed += 5;
  }

  // Test 2: listMcpServers returns built-in groups with honest fields
  console.log("\nTest 2: listMcpServers returns honest builtin fields");
  try {
    const gateway = await import(`file://${path.join(serverLib, "mcp-gateway.js")}`);
    const servers = await gateway.listMcpServers();
    
    assert(Array.isArray(servers), "listMcpServers returns an array");
    assert(servers.length > 0, "At least one builtin server exists");
    
    for (const server of servers) {
      assert(server.source === "builtin", `Server ${server.id} has source: "builtin"`);
      assert(server.type === "builtin", `Server ${server.id} has type: "builtin"`);
      assert(server.transport === "internal", `Server ${server.id} has transport: "internal"`);
      assert(server.protocol === "internal-function", `Server ${server.id} has protocol: "internal-function"`);
      assert(server.external === false, `Server ${server.id} has external: false`);
      assert(server.mcpNative === false, `Server ${server.id} has mcpNative: false`);
      assert(typeof server.status === "string", `Server ${server.id} has status field`);
    }
  } catch (err) {
    console.error(`Failed listMcpServers test: ${err.message}`);
    failed += 10;
  }

  // Test 3: listMcpTools only returns internal tools
  console.log("\nTest 3: listMcpTools only returns internal/builtin tools");
  try {
    const gateway = await import(`file://${path.join(serverLib, "mcp-gateway.js")}`);
    const tools = gateway.listMcpTools();
    
    assert(Array.isArray(tools), "listMcpTools returns an array");
    assert(tools.length > 0, "At least one builtin tool exists");
    
    for (const tool of tools) {
      assert(tool.name.startsWith("mcp__"), `Tool name starts with mcp__: ${tool.name}`);
      assert(typeof tool.serverId === "string", `Tool ${tool.name} has serverId`);
      // Verify no external tools are listed (since no external client exists yet)
      assert(!tool.name.includes("playwright") || tool.serverId !== "playwright", 
        "External tools like playwright should not appear yet");
    }
  } catch (err) {
    console.error(`Failed listMcpTools test: ${err.message}`);
    failed += 5;
  }

  // Test 4: External config loader returns empty if config missing
  console.log("\nTest 4: External config loader handles missing config");
  try {
    const configLoader = await import(`file://${path.join(serverLib, "external-mcp-config.js")}`);
    
    // Ensure config file doesn't exist for this test
    const configPath = path.join(__dirname, "..", "config", "mcp-servers.json");
    const configExists = fs.existsSync(configPath);
    
    const configs = await configLoader.loadExternalMcpConfigs();
    assert(Array.isArray(configs), "loadExternalMcpConfigs returns an array");
    
    if (!configExists) {
      assert(configs.length === 0, "Returns empty array when config file is missing");
    } else {
      console.log("  (Note: mcp-servers.json exists, so configs may be non-empty)");
    }
  } catch (err) {
    console.error(`Failed external config test: ${err.message}`);
    failed += 3;
  }

  // Test 5: Example config shape validates
  console.log("\nTest 5: Example config shape is valid");
  try {
    const configLoader = await import(`file://${path.join(serverLib, "external-mcp-config.js")}`);
    const examplePath = path.join(__dirname, "..", "config", "mcp-servers.example.json");
    
    assert(fs.existsSync(examplePath), "mcp-servers.example.json exists");
    
    const exampleContent = fs.readFileSync(examplePath, "utf8");
    const exampleConfig = JSON.parse(exampleContent);
    
    assert(exampleConfig.servers, "Example config has servers object");
    
    // Validate one example server
    const exampleServer = Object.values(exampleConfig.servers)[0];
    assert(exampleServer.id, "Example server has id");
    assert(exampleServer.title, "Example server has title");
    assert(exampleServer.source === "external", "Example server has source: external");
    assert(exampleServer.type === "external", "Example server has type: external");
    assert(["stdio", "sse", "http"].includes(exampleServer.transport), 
      `Example server has valid transport: ${exampleServer.transport}`);
  } catch (err) {
    console.error(`Failed example config test: ${err.message}`);
    failed += 4;
  }

  // Test 6: Existing tool names still work
  console.log("\nTest 6: Existing internal tool names still exist");
  try {
    const gateway = await import(`file://${path.join(serverLib, "mcp-gateway.js")}`);
    const tools = gateway.listMcpTools();
    const toolNames = tools.map(t => t.name);
    
    const expectedTools = [
      "mcp__local__read_text_file",
      "mcp__local__write_text_file",
      "mcp__git__status",
      "mcp__memory__search",
      "mcp__web__search",
      "mcp__browser_agent__run",
      "mcp__browser__lightpanda_navigate",
      "mcp__ops__ollama_health",
    ];
    
    for (const expected of expectedTools) {
      assert(toolNames.includes(expected), `Expected tool exists: ${expected}`);
    }
  } catch (err) {
    console.error(`Failed tool names test: ${err.message}`);
    failed += 8;
  }

  // Test 7: Admin status helper is callable as MCP tool
  console.log("\nTest 7: Admin status helper is callable as MCP tool");
  try {
    const gateway = await import(`file://${path.join(serverLib, "mcp-gateway.js")}`);
    const tools = gateway.listMcpTools();
    
    // Check that the admin tool appears in the tool list with correct name
    const hasAdminTool = tools.some(t => t.name === "mcp__ops__mcp_architecture_status");
    assert(hasAdminTool, "mcp__ops__mcp_architecture_status appears in listMcpTools()");
    
    // Try calling the admin tool
    try {
      const result = await gateway.callMcpTool("mcp__ops__mcp_architecture_status", {});
      assert(result && result.builtinToolGroups && result.externalMcpServers, 
        "mcp__ops__mcp_architecture_status returns expected structure");
      console.log("  ✓ Admin tool is callable and returns correct structure");
      passed++;
    } catch (callErr) {
      console.error(`  ✗ Failed to call admin tool: ${callErr.message}`);
      failed++;
    }
  } catch (err) {
    console.error(`Failed admin tool test: ${err.message}`);
    failed++;
  }

  // Summary
  console.log("\n=== Test Summary ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.error("\n❌ Some tests failed. Please review the errors above.");
    process.exit(1);
  } else {
    console.log("\n✅ All smoke tests passed!");
    process.exit(0);
  }
}

// Run the tests
runTests().catch(err => {
  console.error("Unhandled error in smoke tests:", err);
  process.exit(1);
});
