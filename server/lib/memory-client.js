import net from "net";
import { randomUUID } from "crypto";

const DISABLED_VALUES = new Set(["0", "false", "off", "no", "disabled"]);

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !DISABLED_VALUES.has(String(raw).trim().toLowerCase());
}

function parseRedisUrl(rawUrl) {
  if (!rawUrl) return {};
  try {
    const parsed = new URL(rawUrl);
    return {
      host: parsed.hostname || undefined,
      port: parsed.port ? Number(parsed.port) : undefined,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    };
  } catch {
    return {};
  }
}

const urlConfig = parseRedisUrl(process.env.FALKORDB_URI || process.env.MEMORY_FALKORDB_URI);
const MEMORY_ENABLED = envFlag(
  "MEMORY_ENABLED",
  true,
);
const MEMORY_PROVIDER = (process.env.MEMORY_PROVIDER || "falkordb").toLowerCase();
const MEMORY_TIMEOUT_MS = Math.max(250, Number(process.env.MEMORY_TIMEOUT_MS || 1500));
const FALKORDB_HOST = process.env.FALKORDB_HOST || urlConfig.host || "127.0.0.1";
const FALKORDB_PORT = Number(process.env.FALKORDB_PORT || urlConfig.port || 6380);
const FALKORDB_USERNAME = process.env.FALKORDB_USERNAME || urlConfig.username || "";
const FALKORDB_PASSWORD = process.env.FALKORDB_PASSWORD || urlConfig.password || "";
const FALKORDB_DATABASE = process.env.FALKORDB_DATABASE || process.env.MEMORY_GRAPH_NAME || "graphiti_memory";

let graphPromise = null;
let dbClient = null;
let lastError = "";
let lastReadyAt = null;

function safeMessage(err) {
  return err?.message || String(err || "unknown memory error");
}

function skipped(reason) {
  lastError = reason;
  return { ok: false, success: false, skipped: true, reason };
}

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${MEMORY_TIMEOUT_MS}ms`)), MEMORY_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeRows(result) {
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.records)) return result.records;
  if (Array.isArray(result?.results)) return result.results;
  if (Array.isArray(result)) return result;
  return [];
}

function readCell(row, index, key) {
  if (Array.isArray(row)) return row[index];
  if (row && typeof row === "object") return row[key] ?? Object.values(row)[index];
  return undefined;
}

function nodeProperties(node) {
  if (!node || typeof node !== "object") return {};
  return node.properties && typeof node.properties === "object" ? node.properties : node;
}

function inferType(properties, labels = []) {
  const labelText = Array.isArray(labels) ? labels.join(" ").toLowerCase() : String(labels || "").toLowerCase();
  if (labelText.includes("preference") || properties.key != null) return "preference";
  if (labelText.includes("fix") || properties.description != null) return "fix";
  if (labelText.includes("error") || properties.message != null) return "error";
  return "command";
}

function normalizeMemoryRow(row) {
  const node = readCell(row, 0, "n");
  const nodeId = readCell(row, 1, "nodeId");
  const labels = node?.labels || node?.label || readCell(row, 1, "labels") || [];
  const properties = nodeProperties(node);
  if (Object.keys(properties).length === 0) return null;
  const normalizedNodeId = Number(nodeId);
  const memoryId = properties.memoryId ? String(properties.memoryId) : "";
  return {
    id: memoryId || (Number.isFinite(normalizedNodeId) ? String(normalizedNodeId) : ""),
    memoryId,
    nodeId: Number.isFinite(normalizedNodeId) ? normalizedNodeId : undefined,
    type: inferType(properties, labels),
    ...properties,
  };
}

function firstMemory(rows) {
  return rows.map(normalizeMemoryRow).find(Boolean) || null;
}

export function getMemoryStatus() {
  return {
    enabled: MEMORY_ENABLED,
    provider: MEMORY_PROVIDER,
    ready: Boolean(dbClient && graphPromise),
    lastReadyAt,
    lastError,
    timeoutMs: MEMORY_TIMEOUT_MS,
    falkordb: {
      host: FALKORDB_HOST,
      port: FALKORDB_PORT,
      database: FALKORDB_DATABASE,
    },
  };
}

async function connectGraph() {
  if (!MEMORY_ENABLED) throw new Error("memory is disabled");
  if (MEMORY_PROVIDER !== "falkordb") throw new Error(`unsupported memory provider: ${MEMORY_PROVIDER}`);

  await checkTcpConnection();

  const { FalkorDB } = await import("falkordb");
  const options = {
    socket: {
      host: FALKORDB_HOST,
      port: FALKORDB_PORT,
      connectTimeout: MEMORY_TIMEOUT_MS,
      reconnectStrategy: false,
    },
  };

  if (FALKORDB_USERNAME) options.username = FALKORDB_USERNAME;
  if (FALKORDB_PASSWORD) options.password = FALKORDB_PASSWORD;

  const db = await FalkorDB.connect(options);
  db.on?.("error", (err) => {
    lastError = safeMessage(err);
  });
  const graph = db.selectGraph(FALKORDB_DATABASE);
  await graph.query("RETURN 1");

  dbClient = db;
  lastError = "";
  lastReadyAt = new Date().toISOString();
  return graph;
}

function checkTcpConnection() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: FALKORDB_HOST, port: FALKORDB_PORT });
    let settled = false;

    function finish(err) {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (err) reject(err);
      else resolve();
    }

    socket.setTimeout(MEMORY_TIMEOUT_MS);
    socket.once("connect", () => finish());
    socket.once("timeout", () => finish(new Error(`cannot reach FalkorDB at ${FALKORDB_HOST}:${FALKORDB_PORT}`)));
    socket.once("error", (err) => finish(err));
  });
}

async function getGraph() {
  if (!graphPromise) {
    graphPromise = connectGraph().catch((err) => {
      dbClient = null;
      graphPromise = null;
      lastError = safeMessage(err);
      throw err;
    });
  }

  try {
    return await withTimeout(graphPromise, "memory connection");
  } catch (err) {
    if (safeMessage(err).includes("timed out")) {
      dbClient = null;
      graphPromise = null;
    }
    throw err;
  }
}

async function runQuery(query, params = {}) {
  const graph = await getGraph();
  const result = await withTimeout(graph.query(query, { params }), "memory query");
  return normalizeRows(result);
}

async function writeMemory(operation) {
  if (!MEMORY_ENABLED) return skipped("memory is disabled");
  try {
    const memory = await operation();
    return { ok: true, success: true, skipped: false, memory };
  } catch (err) {
    return skipped(safeMessage(err));
  }
}

export async function checkMemoryHealth() {
  if (!MEMORY_ENABLED) return { ...getMemoryStatus(), ok: false, skipped: true, reason: "memory is disabled" };
  try {
    await runQuery("RETURN 1 AS ok");
    return { ...getMemoryStatus(), ok: true };
  } catch (err) {
    return { ...getMemoryStatus(), ok: false, skipped: true, reason: safeMessage(err) };
  }
}

export async function saveCommand(projectId, command, output = "") {
  return writeMemory(async () => {
    const rows = await runQuery(
      `
        MERGE (p:Project {id: $projectId})
        CREATE (c:Command {
          memoryId: $memoryId,
          text: $command,
          output: $output,
          timestamp: $timestamp,
          createdAt: $createdAt,
          updatedAt: $createdAt
        })
        CREATE (p)-[:HAS_COMMAND]->(c)
        RETURN c, ID(c) AS nodeId
      `,
      {
        projectId: String(projectId),
        memoryId: randomUUID(),
        command: String(command || ""),
        output: String(output || ""),
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
      },
    );
    return firstMemory(rows);
  });
}

export async function saveError(projectId, error, context = "") {
  return writeMemory(async () => {
    const rows = await runQuery(
      `
        MERGE (p:Project {id: $projectId})
        CREATE (e:Error {
          memoryId: $memoryId,
          message: $error,
          context: $context,
          timestamp: $timestamp,
          createdAt: $createdAt,
          updatedAt: $createdAt
        })
        CREATE (p)-[:HAS_ERROR]->(e)
        RETURN e, ID(e) AS nodeId
      `,
      {
        projectId: String(projectId),
        memoryId: randomUUID(),
        error: String(error || ""),
        context: String(context || ""),
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
      },
    );
    return firstMemory(rows);
  });
}

export async function saveFix(projectId, error, fix) {
  return writeMemory(async () => {
    const rows = await runQuery(
      `
        MERGE (p:Project {id: $projectId})
        CREATE (f:Fix {
          memoryId: $memoryId,
          error: $error,
          description: $fix,
          timestamp: $timestamp,
          createdAt: $createdAt,
          updatedAt: $createdAt
        })
        CREATE (p)-[:HAS_FIX]->(f)
        RETURN f, ID(f) AS nodeId
      `,
      {
        projectId: String(projectId),
        memoryId: randomUUID(),
        error: String(error || ""),
        fix: String(fix || ""),
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
      },
    );
    return firstMemory(rows);
  });
}

export async function savePreference(projectId, key, value) {
  return writeMemory(async () => {
    const rows = await runQuery(
      `
        MERGE (p:Project {id: $projectId})
        MERGE (pref:Preference {projectId: $projectId, key: $key})
        ON CREATE SET pref.memoryId = $memoryId,
                      pref.createdAt = $updatedAt
        SET pref.value = $value,
            pref.timestamp = $timestamp,
            pref.updatedAt = $updatedAt
        MERGE (p)-[:HAS_PREFERENCE]->(pref)
        RETURN pref, ID(pref) AS nodeId
      `,
      {
        projectId: String(projectId),
        memoryId: randomUUID(),
        key: String(key || ""),
        value: String(value || ""),
        timestamp: Date.now(),
        updatedAt: new Date().toISOString(),
      },
    );
    return firstMemory(rows);
  });
}

export async function updateMemory(projectId, memory = {}) {
  return writeMemory(async () => {
    const type = String(memory.type || "command").toLowerCase();
    const memoryId = String(memory.memoryId || (/^\d+$/.test(String(memory.id || "")) ? "" : memory.id || ""));
    const nodeId = Number(memory.nodeId ?? (!memoryId && /^\d+$/.test(String(memory.id || "")) ? memory.id : NaN));
    const matchClause = memoryId ? "n.memoryId = $memoryId" : "ID(n) = $nodeId";

    if (!memoryId && !Number.isFinite(nodeId)) {
      throw new Error("memory id is required");
    }

    const baseParams = {
      projectId: String(projectId),
      memoryId,
      nodeId,
      timestamp: Date.now(),
      updatedAt: new Date().toISOString(),
    };

    const byType = {
      command: {
        set: "n.text = $text, n.output = $output",
        params: {
          text: String(memory.text || ""),
          output: String(memory.output || ""),
        },
      },
      error: {
        set: "n.message = $message, n.context = $context",
        params: {
          message: String(memory.message || ""),
          context: String(memory.context || ""),
        },
      },
      fix: {
        set: "n.error = $error, n.description = $description",
        params: {
          error: String(memory.error || ""),
          description: String(memory.description || ""),
        },
      },
      preference: {
        set: "n.key = $key, n.value = $value",
        params: {
          key: String(memory.key || ""),
          value: String(memory.value || ""),
        },
      },
    };

    const update = byType[type] || byType.command;
    const rows = await runQuery(
      `
        MATCH (p:Project {id: $projectId})-->(n)
        WHERE ${matchClause}
        SET ${update.set},
            n.timestamp = $timestamp,
            n.updatedAt = $updatedAt
        RETURN n, ID(n) AS nodeId
      `,
      {
        ...baseParams,
        ...update.params,
      },
    );

    const updated = firstMemory(rows);
    if (!updated) throw new Error("memory not found");
    return updated;
  });
}

export async function searchMemory(projectId, query) {
  if (!MEMORY_ENABLED) return [];

  try {
    const rows = await runQuery(
      `
        MATCH (p:Project {id: $projectId})-->(n)
        WHERE toLower(coalesce(n.text, '')) CONTAINS toLower($query)
           OR toLower(coalesce(n.output, '')) CONTAINS toLower($query)
           OR toLower(coalesce(n.message, '')) CONTAINS toLower($query)
           OR toLower(coalesce(n.context, '')) CONTAINS toLower($query)
           OR toLower(coalesce(n.error, '')) CONTAINS toLower($query)
           OR toLower(coalesce(n.description, '')) CONTAINS toLower($query)
           OR toLower(coalesce(n.key, '')) CONTAINS toLower($query)
           OR toLower(coalesce(n.value, '')) CONTAINS toLower($query)
        RETURN n, ID(n) AS nodeId
        ORDER BY n.timestamp DESC
        LIMIT 10
      `,
      {
        projectId: String(projectId),
        query: String(query || ""),
      },
    );

    return rows.map(normalizeMemoryRow).filter(Boolean);
  } catch (err) {
    lastError = safeMessage(err);
    return [];
  }
}

export async function getGraphSnapshot(projectId) {
  if (!MEMORY_ENABLED) return { nodes: [], edges: [] };

  try {
    const rows = await runQuery(
      `
        MATCH (p:Project {id: $projectId})-->(n)
        OPTIONAL MATCH (n)-[r]->(m)
        RETURN n, ID(n) AS sourceId, m, ID(m) AS targetId, r
      `,
      { projectId: String(projectId) },
    );

    const nodesMap = new Map();
    const edges = [];

    for (const row of rows) {
      const n = readCell(row, 0, "n");
      const sourceId = readCell(row, 1, "sourceId");
      const m = readCell(row, 2, "m");
      const targetId = readCell(row, 3, "targetId");
      const r = readCell(row, 4, "r");

      if (n && !nodesMap.has(sourceId)) {
        const props = nodeProperties(n);
        nodesMap.set(sourceId, {
          id: String(sourceId),
          label: props.text || props.message || props.key || props.error || "Memory",
          type: inferType(props, n?.labels || []),
          ...props,
        });
      }

      if (m && !nodesMap.has(targetId)) {
        const props = nodeProperties(m);
        nodesMap.set(targetId, {
          id: String(targetId),
          label: props.text || props.message || props.key || props.error || "Memory",
          type: inferType(props, m?.labels || []),
          ...props,
        });
      }

      if (r) {
        const edgeProps = r.properties && typeof r.properties === "object" ? r.properties : {};
        edges.push({
          id: `e-${sourceId}-${targetId}`,
          source: String(sourceId),
          target: String(targetId),
          label: r.type || "RELATED",
          ...edgeProps,
        });
      }
    }

    return {
      nodes: Array.from(nodesMap.values()),
      edges,
    };
  } catch (err) {
    lastError = safeMessage(err);
    return { nodes: [], edges: [] };
  }
}
