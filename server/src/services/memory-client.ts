export interface MemoryCommand {
  userId: string;
  command: string;
  output?: string;
}

export interface MemoryError {
  userId: string;
  error: string;
  context?: string;
}

type RuntimeMemoryClient = {
  saveCommand(projectId: string, command: string, output?: string): Promise<unknown>;
  saveError(projectId: string, error: string, context?: string): Promise<unknown>;
  searchMemory(projectId: string, query: string): Promise<unknown[]>;
};

async function runtime(): Promise<RuntimeMemoryClient> {
  // @ts-ignore JS runtime module is the source of truth for the ESM server.
  return import("../../lib/memory-client.js") as Promise<RuntimeMemoryClient>;
}

export const MemoryClient = {
  async saveCommand(data: MemoryCommand) {
    const client = await runtime();
    return client.saveCommand(data.userId, data.command, data.output || "");
  },

  async saveError(data: MemoryError) {
    const client = await runtime();
    return client.saveError(data.userId, data.error, data.context || "");
  },

  async searchMemories(userId: string, queryText: string) {
    const client = await runtime();
    return client.searchMemory(userId, queryText);
  },
};
