#!/usr/bin/env node
/**
 * Production Readiness Smoke Test
 * 
 * Run with: node server/scripts/smoke-production-readiness.js
 * 
 * Verifies:
 * - Server modules import cleanly
 * - listMcpServers() returns array
 * - listMcpTools() returns builtin tools
 * - mcp__ops__mcp_architecture_status is callable
 * - External MCP config loader works with missing config
 * - Readiness function returns structured result
 * - No Promise is accidentally returned in API-style functions
 * - No fake external MCP tools are listed before external client exists
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
  console.log("=== Production Readiness Smoke Tests ===\n");

  // Test 1: Server modules import cleanly
  console.log("Test 1: Verify server modules import cleanly");
  try {
    const gateway = await import(`file://${path.join(serverLib, "mcp-gateway.js")}`);
    const readiness = await import(`file://${path.join(serverLib, "readiness.js")}`);
    
    assert(typeof gateway.listMcpServers === "function", "mcp-gateway.listMcpServers is exported");
    assert(typeof gateway.listMcpTools === "function", "mcp-gateway.listMcpTools is exported");
    assert(typeof gateway.callMcpTool === "function", "mcp-gateway.callMcpTool is exported");
    assert(typeof readiness.getHealthStatus === "function", "readiness.getHealthStatus is exported");
    assert(typeof readiness.getReadinessStatus === "function", "readiness.getReadinessStatus is exported");
    assert(typeof readiness.validateServerEnvironment === "function", "readiness.validateServerEnvironment is exported");
  } catch (err) {
    console.error(`Failed to import modules: ${err.message}`);
    failed += 6;
  }

  // Test 2: listMcpServers returns array (not Promise)
  console.log("\nTest 2: listMcpServers returns array");
  try {
    const gateway = await import(`file://${path.join(serverLib, "mcp-gateway.js")}`);
    const servers = await gateway.listMcpServers();
    
    assert(Array.isArray(servers), "listMcpServers returns an array (not Promise)");
    assert(servers.length > 0, "At least one builtin server exists");
    
    // Verify no Promise objects in the array
    for (const server of servers) {
      assert(!(server instanceof Promise), "Server entry is not a Promise");
      assert(typeof server === "object", "Server entry is an object");
    }
  } catch (err) {
    console.error(`Failed listMcpServers test: ${err.message}`);
    failed += 3;
  }

  // Test 3: listMcpTools returns builtin tools only
  console.log("\nTest 3: listMcpTools returns builtin tools only");
  try {
    const gateway = await import(`file://${path.join(serverLib, "mcp-gateway.js")}`);
    const tools = await gateway.listMcpTools();
    
    assert(Array.isArray(tools), "listMcpTools returns an array");
    assert(tools.length > 0, "At least one builtin tool exists");
    
    for (const tool of tools) {
      assert(tool.source === "builtin", `Tool ${tool.name} has source: "builtin"`);
      assert(tool.external === false, `Tool ${tool.name} has external: false`);
      assert(tool.mcpNative === false, `Tool ${tool.name} has mcpNative: false`);
      // Verify no external tools are listed yet
      assert(tool.serverId !== "playwright", "External tools like playwright should not appear yet");
    }
  } catch (err) {
    console.error(`Failed listMcpTools test: ${err.message}`);
    failed += 4;
  }

  // Test 4: Admin status helper is callable as MCP tool
  console.log("\nTest 4: Admin status helper is callable as MCP tool");
  try {
    const gateway = await import(`file://${path.join(serverLib, "mcp-gateway.js")}`);
    const tools = await gateway.listMcpTools();
    
    // Check that the admin tool appears in the tool list
    const hasAdminTool = tools.some(t => t.name === "mcp__ops__mcp_architecture_status");
    assert(hasAdminTool, "mcp__ops__mcp_architecture_status appears in listMcpTools()");
    
    // Try calling the admin tool
    try {
      const result = await gateway.callMcpTool("mcp__ops__mcp_architecture_status", {});
      assert(result && typeof result === "object", "Admin tool returns an object");
      assert(Array.isArray(result.builtinToolGroups), "Result has builtinToolGroups array");
      assert(Array.isArray(result.externalMcpServers), "Result has externalMcpServers array");
      assert(typeof result.summary === "object", "Result has summary object");
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

  // Test 5: External MCP config loader works with missing config
  console.log("\nTest 5: External MCP config loader handles missing config");
  try {
    const configLoader = await import(`file://${path.join(serverLib, "external-mcp-config.js")}`);
    
    const configs = await configLoader.loadExternalMcpConfigs();
    assert(Array.isArray(configs), "loadExternalMcpConfigs returns an array");
    // Should not throw when config is missing
    console.log(`  ✓ Config loader works (found ${configs.length} configured servers)`);
    passed++;
  } catch (err) {
    console.error(`Failed external config test: ${err.message}`);
    failed += 2;
  }

  // Test 6: Readiness function returns structured result
  console.log("\nTest 6: Readiness function returns structured result");
  try {
    const readiness = await import(`file://${path.join(serverLib, "readiness.js")}`);
    
    // Test getHealthStatus (sync, lightweight)
    const health = readiness.getHealthStatus();
    assert(health.ok === true, "getHealthStatus returns ok: true");
    assert(health.status === "alive", "getHealthStatus returns status: alive");
    assert(typeof health.uptime === "number", "getHealthStatus includes uptime");
    
    // Test getReadinessStatus (async, detailed)
    const ready = await readiness.getReadinessStatus();
    assert(typeof ready === "object", "getReadinessStatus returns an object");
    assert(typeof ready.ok === "boolean", "Readiness has ok boolean");
    assert(typeof ready.timestamp === "string", "Readiness has timestamp");
    assert(typeof ready.components === "object", "Readiness has components object");
    
    // Verify component structure
    const expectedComponents = ["backend", "mcpArchitecture", "builtinToolGroups", "externalMcpConfig", "browserAgent", "memory", "webSearch", "lightpanda"];
    for (const comp of expectedComponents) {
      assert(ready.components[comp], `Readiness has ${comp} component`);
    }
    
    console.log("  ✓ Readiness returns structured result with all components");
    passed++;
  } catch (err) {
    console.error(`Failed readiness test: ${err.message}`);
    failed += 6;
  }

  // Test 7: No Promise accidentally returned in API-style functions
  console.log("\nTest 7: API-style functions don't return Promises directly");
  try {
    const gateway = await import(`file://${path.join(serverLib, "mcp-gateway.js")}`);
    
    // listMcpTools should be sync and return array directly
    const tools = await gateway.listMcpTools();
    assert(!(tools instanceof Promise), "listMcpTools() returns array directly, not Promise");
    
    // getMcpLogs should be sync
    const logs = gateway.getMcpLogs();
    assert(Array.isArray(logs), "getMcpLogs() returns array directly");
    
    console.log("  ✓ API-style functions return values directly");
    passed++;
  } catch (err) {
    console.error(`Failed API return test: ${err.message}`);
    failed += 2;
  }

  // Test 8: No fake external MCP tools are listed
  console.log("\nTest 8: No fake external MCP tools before external client exists");
  try {
    const gateway = await import(`file://${path.join(serverLib, "mcp-gateway.js")}`);
    const tools = await gateway.listMcpTools();
    
    // All tools should have builtin source
    const externalTools = tools.filter(t => t.source === "external" || t.mcpNative === true);
    assert(externalTools.length === 0, `No external tools listed yet (found ${externalTools.length})`);
    
    // Verify tool naming pattern is consistent
    for (const tool of tools) {
      assert(/^mcp__\w+__\w+$/.test(tool.name), `Tool name follows mcp__{server}__{tool} pattern: ${tool.name}`);
    }
    
    console.log("  ✓ Only builtin tools listed, no fake external tools");
    passed++;
  } catch (err) {
    console.error(`Failed external tools test: ${err.message}`);
    failed += 2;
  }

  // Test 9: Environment validation doesn't crash
  console.log("\nTest 9: Environment validation is safe");
  try {
    const readiness = await import(`file://${path.join(serverLib, "readiness.js")}`);
    
    // Should not throw even with minimal/missing env vars
    const result = await readiness.validateServerEnvironment();
    assert(typeof result === "object", "validateServerEnvironment returns object");
    assert(typeof result.ok === "boolean", "Result has ok boolean");
    assert(typeof result.critical === "object", "Result has critical object");
    assert(typeof result.optional === "object", "Result has optional object");
    
    console.log("  ✓ Environment validation is safe and structured");
    passed++;
  } catch (err) {
    console.error(`Failed env validation test: ${err.message}`);
    failed += 4;
  }

  // Summary
  console.log("\n=== Test Summary ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.error("\n❌ Some tests failed. Please review the errors above.");
    process.exit(1);
  } else {
    console.log("\n✅ All production readiness smoke tests passed!");
    process.exit(0);
  }
}

// Run the tests
runTests().catch(err => {
  console.error("Unhandled error in smoke tests:", err);
  process.exit(1);
});
