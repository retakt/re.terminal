import fetch from 'node-fetch';

const GRAPHITI_URL = process.env.GRAPHITI_URL || 'http://localhost:8000/mcp/';

async function call(method, params) {
  try {
    const response = await fetch(GRAPHITI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: method,
        params: params
      })
    });
    return await response.json();
  } catch (error) {
    console.error('Graphiti MCP Error:', error);
    throw error;
  }
}

export async function saveCommand(projectId, command, output) {
  return call('graphiti.upsert', {
    projectId,
    entities: [{ name: 'Command', properties: { command, output, timestamp: new Date().toISOString() } }]
  });
}

export async function saveError(projectId, error, context) {
  return call('graphiti.upsert', {
    projectId,
    entities: [{ name: 'Error', properties: { message: error, context, timestamp: new Date().toISOString() } }]
  });
}

export async function saveFix(projectId, error, fix) {
  return call('graphiti.upsert', {
    projectId,
    entities: [{ name: 'Fix', properties: { error, fix, timestamp: new Date().toISOString() } }]
  });
}

export async function savePreference(projectId, key, value) {
  return call('graphiti.upsert', {
    projectId,
    entities: [{ name: 'Preference', properties: { key, value, timestamp: new Date().toISOString() } }]
  });
}

export async function searchMemory(projectId, query) {
  return call('graphiti.search', {
    projectId,
    query,
    limit: 10
  });
}
