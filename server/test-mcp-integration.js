/**
 * Smoke tests for MCP integration fixes
 * Run with: node test-mcp-integration.js
 */

import { listMcpServers, listMcpTools, callMcpTool } from './lib/mcp-gateway.js';

const REQUIRED_OPS_TOOLS = [
  'mcp__ops__external_mcp_servers',
  'mcp__ops__external_mcp_status',
  'mcp__ops__external_mcp_tools',
  'mcp__ops__external_mcp_refresh',
  'mcp__ops__playwright_mcp_status',
  'mcp__ops__mcp_architecture_status',
];

const REQUIRED_EXTERNAL_METADATA = [
  'source',
  'protocol',
  'external',
  'mcpNative',
];

async function runTests() {
  let passed = 0;
  let failed = 0;

  console.log('🧪 Running MCP integration smoke tests...\n');

  // Test 1: listMcpTools includes required ops tools
  console.log('✅ Test 1: Checking ops tools in listMcpTools()...');
  try {
    const tools = await listMcpTools();
    const toolNames = tools.map(t => t.name);
    
    for (const requiredTool of REQUIRED_OPS_TOOLS) {
      if (toolNames.includes(requiredTool)) {
        console.log(`   ✓ ${requiredTool}`);
        passed++;
      } else {
        console.log(`   ✗ MISSING: ${requiredTool}`);
        failed++;
      }
    }
  } catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed += REQUIRED_OPS_TOOLS.length;
  }

  // Test 2: External servers have required metadata
  console.log('\n✅ Test 2: Checking external server metadata...');
  try {
    const servers = await listMcpServers();
    const externalServers = servers.filter(s => s.source === 'external');
    
    if (externalServers.length === 0) {
      console.log('   ⚠ No external servers configured (this is OK if none are set up)');
      passed++;
    } else {
      for (const server of externalServers) {
        let serverOk = true;
        for (const field of REQUIRED_EXTERNAL_METADATA) {
          if (field in server) {
            console.log(`   ✓ ${server.id}.${field} = ${JSON.stringify(server[field])}`);
          } else {
            console.log(`   ✗ ${server.id} missing ${field}`);
            serverOk = false;
            failed++;
          }
        }
        if (serverOk) passed++;
      }
    }
  } catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
  }

  // Test 3: callMcpTool can invoke ops tools
  console.log('\n✅ Test 3: Checking callMcpTool() for ops tools...');
  try {
    // Test a simple ops tool that doesn't require external config
    const result = await callMcpTool('mcp__ops__mcp_architecture_status', {});
    if (result && typeof result === 'object' && 'builtinToolGroups' in result) {
      console.log('   ✓ mcp__ops__mcp_architecture_status callable and returns expected shape');
      passed++;
    } else {
      console.log('   ✗ mcp__ops__mcp_architecture_status returned unexpected result');
      failed++;
    }
  } catch (err) {
    console.log(`   ✗ Error calling mcp__ops__mcp_architecture_status: ${err.message}`);
    failed++;
  }

  // Test 4: Verify API contract structure
  console.log('\n✅ Test 4: Checking API response structure...');
  try {
    const servers = await listMcpServers();
    const tools = await listMcpTools();
    
    if (Array.isArray(servers) && Array.isArray(tools)) {
      console.log(`   ✓ listMcpServers() returns array with ${servers.length} items`);
      console.log(`   ✓ listMcpTools() returns array with ${tools.length} items`);
      passed += 2;
    } else {
      console.log('   ✗ Unexpected return type from list functions');
      failed += 2;
    }
  } catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed += 2;
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('✨ All smoke tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Please review the output above.');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('💥 Test runner error:', err);
  process.exit(1);
});
