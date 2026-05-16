import fetch from 'node-fetch';

const GRAPHITI_URL = process.env.GRAPHITI_URL || 'http://localhost:8000/mcp/';

class MemoryClient {
  private async call(method: string, params: any) {
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

  async saveCommand(projectId: string, command: string, output?: string) {
    return this.call('graphiti.upsert', {
      projectId,
      entities: [{ name: 'Command', properties: { command, output, timestamp: new Date().toISOString() } }]
    });
  }

  async saveError(projectId: string, error: string, context?: string) {
    return this.call('graphiti.upsert', {
      projectId,
      entities: [{ name: 'Error', properties: { message: error, context, timestamp: new Date().toISOString() } }]
    });
  }

  async saveFix(projectId: string, error: string, fix: string) {
    return this.call('graphiti.upsert', {
      projectId,
      entities: [{ name: 'Fix', properties: { error, fix, timestamp: new Date().toISOString() } }]
    });
  }

  async savePreference(projectId: string, key: string, value: string) {
    return this.call('graphiti.upsert', {
      projectId,
      entities: [{ name: 'Preference', properties: { key, value, timestamp: new Date().toISOString() } }]
    });
  }

  async searchMemory(projectId: string, query: string) {
    return this.call('graphiti.search', {
      projectId,
      query,
      limit: 10
    });
  }
}

export const memoryClient = new MemoryClient();
