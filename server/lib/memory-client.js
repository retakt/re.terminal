import net from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const MEMORY_FALLBACK_ENABLED = envFlag("MEMORY_FALLBACK_ENABLED", true);
const MEMORY_FALLBACK_FILE = process.env.MEMORY_FALLBACK_FILE || path.resolve(__dirname, "..", "data", "memory-fallback.json");
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

async function readFallbackStore() {
  try {
    const raw = await fs.promises.readFile(MEMORY_FALLBACK_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.memories) ? parsed.memories : [];
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

async function writeFallbackStore(memories) {
  await fs.promises.mkdir(path.dirname(MEMORY_FALLBACK_FILE), { recursive: true });
  await fs.promises.writeFile(
    MEMORY_FALLBACK_FILE,
    JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), memories }, null, 2),
    "utf8",
  );
}

async function saveFallbackMemory(memory, backendError = "") {
  if (!MEMORY_FALLBACK_ENABLED) return skipped(backendError || "memory backend unavailable");
  const now = new Date().toISOString();
  const next = {
    id: randomUUID(),
    memoryId: randomUUID(),
    type: memory.type || "fact",
    projectId: String(memory.projectId || "default-user"),
    timestamp: Date.now(),
    createdAt: now,
    updatedAt: now,
    fallback: true,
    backendError,
    ...memory,
  };
  const memories = await readFallbackStore();
  memories.unshift(next);
  await writeFallbackStore(memories.slice(0, 2000));
  lastError = backendError;
  return { ok: true, success: true, skipped: false, fallback: true, backendError, memory: next };
}

async function searchFallbackMemory(projectId, query, limit = 10) {
  if (!MEMORY_FALLBACK_ENABLED) return [];
  const needle = String(query || "").toLowerCase();
  const memories = await readFallbackStore().catch(() => []);
  return memories
    .filter((memory) => String(memory.projectId || "") === String(projectId))
    .filter((memory) => {
      if (!needle) return true;
      return [
        memory.text,
        memory.output,
        memory.message,
        memory.context,
        memory.error,
        memory.description,
        memory.key,
        memory.value,
        memory.summary,
        memory.subject,
        memory.predicate,
        memory.object,
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    })
    .slice(0, limit);
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
  if (labelText.includes("fact") || properties.type === "fact" || properties.summary != null) return "fact";
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
    fallback: {
      enabled: MEMORY_FALLBACK_ENABLED,
      ready: MEMORY_FALLBACK_ENABLED,
      file: MEMORY_FALLBACK_FILE,
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

async function writeMemory(operation, fallbackMemory = null) {
  if (!MEMORY_ENABLED) return skipped("memory is disabled");
  try {
    const memory = await operation();
    return { ok: true, success: true, skipped: false, memory };
  } catch (err) {
    const reason = safeMessage(err);
    if (fallbackMemory) return saveFallbackMemory(fallbackMemory, reason);
    return skipped(reason);
  }
}

export async function checkMemoryHealth() {
  if (!MEMORY_ENABLED) return { ...getMemoryStatus(), ok: false, skipped: true, reason: "memory is disabled" };
  try {
    await runQuery("RETURN 1 AS ok");
    return { ...getMemoryStatus(), ok: true };
  } catch (err) {
    const reason = safeMessage(err);
    return {
      ...getMemoryStatus(),
      ok: MEMORY_FALLBACK_ENABLED,
      degraded: MEMORY_FALLBACK_ENABLED,
      backendOk: false,
      skipped: !MEMORY_FALLBACK_ENABLED,
      reason,
    };
  }
}

export async function saveCommand(projectId, command, output = "") {
  const fallbackMemory = {
    projectId: String(projectId),
    type: "command",
    text: String(command || ""),
    output: String(output || ""),
  };
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
  }, fallbackMemory);
}

export async function saveError(projectId, error, context = "") {
  const fallbackMemory = {
    projectId: String(projectId),
    type: "error",
    message: String(error || ""),
    context: String(context || ""),
  };
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
  }, fallbackMemory);
}

export async function saveFix(projectId, error, fix) {
  const fallbackMemory = {
    projectId: String(projectId),
    type: "fix",
    error: String(error || ""),
    description: String(fix || ""),
  };
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
  }, fallbackMemory);
}

export async function savePreference(projectId, key, value) {
  const fallbackMemory = {
    projectId: String(projectId),
    type: "preference",
    key: String(key || ""),
    value: String(value || ""),
  };
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
  }, fallbackMemory);
}

export async function saveFact(projectId, memory = {}) {
  const subject = String(memory.subject || "user");
  const predicate = String(memory.predicate || memory.type || "remembers");
  const object = String(memory.object || memory.summary || memory.text || "");
  const summary = String(memory.summary || `${subject} ${predicate} ${object}`.trim());
  const fallbackMemory = {
    projectId: String(projectId),
    type: "fact",
    subject,
    predicate,
    object,
    summary,
    confidence: Number(memory.confidence ?? 0.7),
    source: String(memory.source || "chat"),
  };
  return writeMemory(async () => {
    if (!summary) throw new Error("memory summary is required");

    const rows = await runQuery(
      `
        MERGE (p:Project {id: $projectId})
        MERGE (s:Entity {projectId: $projectId, name: $subject})
        CREATE (f:Fact {
          memoryId: $memoryId,
          type: "fact",
          subject: $subject,
          predicate: $predicate,
          object: $object,
          summary: $summary,
          confidence: $confidence,
          source: $source,
          timestamp: $timestamp,
          createdAt: $createdAt,
          updatedAt: $createdAt
        })
        CREATE (s)-[:HAS_FACT]->(f)
        MERGE (p)-[:HAS_MEMORY]->(f)
        MERGE (p)-[:HAS_ENTITY]->(s)
        RETURN f, ID(f) AS nodeId
      `,
      {
        projectId: String(projectId),
        memoryId: randomUUID(),
        subject,
        predicate,
        object,
        summary,
        confidence: Number(memory.confidence ?? 0.7),
        source: String(memory.source || "chat"),
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
      },
    );
    return firstMemory(rows);
  }, fallbackMemory);
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
      fact: {
        set: "n.subject = $subject, n.predicate = $predicate, n.object = $object, n.summary = $summary, n.confidence = $confidence",
        params: {
          subject: String(memory.subject || ""),
          predicate: String(memory.predicate || ""),
          object: String(memory.object || ""),
          summary: String(memory.summary || ""),
          confidence: Number(memory.confidence ?? 0.7),
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
           OR toLower(coalesce(n.summary, '')) CONTAINS toLower($query)
           OR toLower(coalesce(n.subject, '')) CONTAINS toLower($query)
           OR toLower(coalesce(n.predicate, '')) CONTAINS toLower($query)
           OR toLower(coalesce(n.object, '')) CONTAINS toLower($query)
        RETURN n, ID(n) AS nodeId
        ORDER BY n.timestamp DESC
        LIMIT 10
      `,
      {
        projectId: String(projectId),
        query: String(query || ""),
      },
    );

    const graphResults = rows.map(normalizeMemoryRow).filter(Boolean);
    const fallbackResults = await searchFallbackMemory(projectId, query, Math.max(0, 10 - graphResults.length));
    return [...graphResults, ...fallbackResults].slice(0, 10);
  } catch (err) {
    lastError = safeMessage(err);
    return searchFallbackMemory(projectId, query, 10);
  }
}

function graphNodeLabel(props = {}) {
  return props.name
    || props.summary
    || props.text
    || props.message
    || props.key
    || props.error
    || props.object
    || "Memory";
}

export async function getGraphSnapshot(projectId, options = {}) {
  if (!MEMORY_ENABLED) return { nodes: [], edges: [] };

  try {
    const all = Boolean(options.all);
    const rows = await runQuery(
      all
        ? `
          MATCH (n)
          OPTIONAL MATCH (n)-[r]->(m)
          RETURN n, ID(n) AS sourceId, m, ID(m) AS targetId, r
          LIMIT 400
        `
        : `
          MATCH (p:Project {id: $projectId})-->(n)
          OPTIONAL MATCH (n)-[r]->(m)
          RETURN n, ID(n) AS sourceId, m, ID(m) AS targetId, r
          LIMIT 300
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
          label: graphNodeLabel(props),
          type: inferType(props, n?.labels || []),
          labels: n?.labels || [],
          ...props,
        });
      }

      if (m && !nodesMap.has(targetId)) {
        const props = nodeProperties(m);
        nodesMap.set(targetId, {
          id: String(targetId),
          label: graphNodeLabel(props),
          type: inferType(props, m?.labels || []),
          labels: m?.labels || [],
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
    const memories = await searchFallbackMemory(projectId, "", 200);
    return {
      nodes: memories.map((memory) => ({
        id: memory.id,
        label: graphNodeLabel(memory),
        type: memory.type || "fact",
        ...memory,
      })),
      edges: [],
      fallback: true,
      backendError: safeMessage(err),
    };
  }
}
