/**
 * Production Readiness Validation
 * 
 * Provides environment validation and readiness checks for the re.Term server.
 * Does not crash the server for optional services - marks them as degraded/missing.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadExternalMcpConfigs, getMcpConfigPath, hasExternalMcpConfig } from "./external-mcp-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Validates a single environment variable with optional constraints.
 * @param {string} name - Env var name
 * @param {object} options - Validation options
 * @param {boolean} [options.required] - If true, missing value is an error
 * @param {string} [options.type] - Expected type: "url", "port", "path", "string"
 * @param {string} [options.safety] - For paths: "file_root" checks for dangerous values
 * @returns {{ok: boolean, status: string, message?: string, value?: string}}
 */
function validateEnvVar(name, options = {}) {
  const value = process.env[name];
  const { required = false, type, safety } = options;

  if (!value) {
    if (required) {
      return {
        ok: false,
        status: "missing_config",
        message: `Required environment variable ${name} is not set`,
      };
    }
    return {
      ok: true,
      status: "disabled",
      message: `Optional environment variable ${name} is not set`,
    };
  }

  // Type validation
  if (type === "url") {
    try {
      new URL(value);
    } catch {
      return {
        ok: false,
        status: "error",
        message: `${name} must be a valid URL: ${value}`,
      };
    }
  } else if (type === "port") {
    const port = parseInt(value, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return {
        ok: false,
        status: "error",
        message: `${name} must be a valid port number (1-65535): ${value}`,
      };
    }
  } else if (type === "path" && safety === "file_root") {
    // FILE_ROOT safety: prevent dangerous paths
    const normalized = path.resolve(value);
    const dangerous = ["/", "C:\\", "C:/"];
    if (dangerous.some((d) => normalized.toLowerCase().startsWith(d.toLowerCase()) && normalized.length <= d.length)) {
      return {
        ok: false,
        status: "error",
        message: `${name} cannot be root filesystem: ${value}`,
      };
    }
    // Also check if path exists and is accessible
    if (!fs.existsSync(normalized)) {
      return {
        ok: false,
        status: "error",
        message: `${name} path does not exist: ${value}`,
      };
    }
  }

  return {
    ok: true,
    status: "ready",
    value,
  };
}

/**
 * Validates the server environment configuration.
 * Returns structured results for each critical config area.
 * Does NOT throw - returns status objects for UI/display.
 * @returns {Promise<object>} Validation results
 */
export async function validateServerEnvironment() {
  const results = {
    ok: true,
    critical: {},
    optional: {},
    summary: {
      criticalErrors: 0,
      optionalWarnings: 0,
      totalChecks: 0,
    },
  };

  // ── Critical: Server basics ────────────────────────────────────────────────
  
  // PORT - required, must be valid
  const portCheck = validateEnvVar("TERMINAL_PORT", { required: false, type: "port" });
  // Default to 3003 if not set - not an error
  results.critical.port = {
    ...portCheck,
    value: portCheck.value || "3003",
    message: portCheck.value ? undefined : `Using default port 3003`,
  };
  results.summary.totalChecks++;
  if (!results.critical.port.ok) results.summary.criticalErrors++;

  // FILE_ROOT - safety critical if set
  const fileRootCheck = validateEnvVar("FILE_ROOT", { type: "path", safety: "file_root" });
  results.critical.fileRoot = fileRootCheck;
  results.summary.totalChecks++;
  if (!fileRootCheck.ok) results.summary.criticalErrors++;

  // ── Optional: AI/LLM services ─────────────────────────────────────────────

  // OLLAMA_BASE_URL - optional but important for chat
  const ollamaCheck = validateEnvVar("OLLAMA_BASE_URL", { type: "url" });
  results.optional.ollama = ollamaCheck;
  results.summary.totalChecks++;
  if (!ollamaCheck.ok && ollamaCheck.status !== "disabled") results.summary.optionalWarnings++;

  // OLLAMA_MODEL - optional, has default
  const modelCheck = validateEnvVar("OLLAMA_MODEL");
  results.optional.ollamaModel = {
    ...modelCheck,
    value: modelCheck.value || "llama3.1",
    message: modelCheck.value ? undefined : `Using default model: llama3.1`,
  };
  results.summary.totalChecks++;

  // ── Optional: Browser Agent ───────────────────────────────────────────────

  // BROWSER_AGENT_BASE_URL - optional
  const browserAgentUrl = validateEnvVar("BROWSER_AGENT_BASE_URL", { type: "url" });
  results.optional.browserAgentUrl = browserAgentUrl;
  results.summary.totalChecks++;
  if (!browserAgentUrl.ok && browserAgentUrl.status !== "disabled") results.summary.optionalWarnings++;

  // BROWSER_AGENT_MODEL - optional
  const browserAgentModel = validateEnvVar("BROWSER_AGENT_MODEL");
  results.optional.browserAgentModel = browserAgentModel;
  results.summary.totalChecks++;
  if (!browserAgentModel.ok && browserAgentModel.status !== "disabled") results.summary.optionalWarnings++;

  // ── Optional: Memory service ──────────────────────────────────────────────

  // Memory config presence check (not a single env var)
  const memoryConfig = {
    ok: true,
    status: "ready",
    message: "Memory client module is available",
  };
  // Check if memory-related env vars are set (optional)
  const hasMemoryEnv = !!(process.env.MEMORY_PROJECT_ID || process.env.FALKORDB_URL);
  if (!hasMemoryEnv) {
    memoryConfig.status = "missing_config";
    memoryConfig.message = "No memory backend configured (FALKORDB_URL or MEMORY_PROJECT_ID not set)";
  }
  results.optional.memory = memoryConfig;
  results.summary.totalChecks++;

  // ── Optional: Web Search ──────────────────────────────────────────────────

  // SEARXNG_URL - optional but needed for web search
  const searxngCheck = validateEnvVar("SEARXNG_URL", { type: "url" });
  results.optional.searxng = searxngCheck;
  results.summary.totalChecks++;
  if (!searxngCheck.ok && searxngCheck.status !== "disabled") results.summary.optionalWarnings++;

  // ── Optional: Lightpanda Browser ──────────────────────────────────────────

  // Lightpanda config presence
  const lightpandaConfig = {
    ok: true,
    status: "ready",
    message: "Lightpanda client module is available",
  };
  // Lightpanda uses default CDP endpoint if not configured
  results.optional.lightpanda = lightpandaConfig;
  results.summary.totalChecks++;

  // ── Optional: External MCP Config ─────────────────────────────────────────

  // External MCP config file validity
  try {
    const hasConfig = hasExternalMcpConfig();
    const configPath = getMcpConfigPath();
    
    if (!hasConfig) {
      results.optional.externalMcpConfig = {
        ok: true,
        status: "missing_config",
        message: `External MCP config not found at ${configPath} (optional)`,
        configPath,
      };
    } else {
      // Try to load and validate
      const configs = await loadExternalMcpConfigs();
      results.optional.externalMcpConfig = {
        ok: true,
        status: "ready",
        message: `External MCP config loaded: ${configs.length} server(s) configured`,
        configPath,
        serverCount: configs.length,
      };
    }
  } catch (err) {
    results.optional.externalMcpConfig = {
      ok: false,
      status: "error",
      message: `Failed to validate external MCP config: ${err.message}`,
    };
    results.summary.optionalWarnings++;
  }
  results.summary.totalChecks++;

  // Overall OK status: only false if critical errors exist
  results.ok = results.summary.criticalErrors === 0;

  return results;
}

/**
 * Gets structured readiness status for the /readiness endpoint.
 * Checks core app readiness without starting heavy services.
 * @returns {Promise<object>} Readiness status object
 */
export async function getReadinessStatus() {
  const startedAt = Date.now();
  
  // Get environment validation results
  const envValidation = await validateServerEnvironment();

  // Check MCP architecture status
  let mcpStatus = {
    ok: true,
    status: "ready",
    builtinToolGroups: 0,
    externalServersConfigured: 0,
  };
  
  try {
    // Import gateway functions dynamically to avoid circular deps
    const { listMcpServers } = await import("./mcp-gateway.js");
    const servers = await listMcpServers();
    
    mcpStatus.builtinToolGroups = servers.filter(s => s.source === "builtin").length;
    mcpStatus.externalServersConfigured = servers.filter(s => s.source === "external").length;
    mcpStatus.status = "ready";
  } catch (err) {
    mcpStatus = {
      ok: false,
      status: "error",
      message: `Failed to check MCP status: ${err.message}`,
    };
  }

  // Build readiness response
  const readiness = {
    ok: envValidation.ok,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || "1.0.0",
    
    // Component status
    components: {
      backend: {
        ok: true,
        status: "ready",
        message: "Express server is running",
      },
      mcpArchitecture: mcpStatus,
      builtinToolGroups: {
        ok: true,
        status: "ready",
        count: mcpStatus.builtinToolGroups,
        message: `${mcpStatus.builtinToolGroups} internal tool groups available`,
      },
      externalMcpConfig: {
        ...envValidation.optional.externalMcpConfig,
      },
      browserAgent: {
        ok: !envValidation.optional.browserAgentUrl?.ok || envValidation.optional.browserAgentUrl.status === "ready",
        status: envValidation.optional.browserAgentUrl?.status || "disabled",
        message: envValidation.optional.browserAgentUrl?.message || "Browser agent not configured",
      },
      memory: {
        ok: envValidation.optional.memory.ok,
        status: envValidation.optional.memory.status,
        message: envValidation.optional.memory.message,
      },
      webSearch: {
        ok: !envValidation.optional.searxng?.ok || envValidation.optional.searxng.status === "ready",
        status: envValidation.optional.searxng?.status || "disabled",
        message: envValidation.optional.searxng?.message || "Web search not configured (SEARXNG_URL)",
      },
      lightpanda: {
        ok: envValidation.optional.lightpanda.ok,
        status: envValidation.optional.lightpanda.status,
        message: envValidation.optional.lightpanda.message,
      },
    },
    
    // Environment summary
    environment: {
      port: envValidation.critical.port.value,
      fileRoot: envValidation.critical.fileRoot.value,
      criticalErrors: envValidation.summary.criticalErrors,
      optionalWarnings: envValidation.summary.optionalWarnings,
    },
    
    // Summary
    summary: {
      totalChecks: envValidation.summary.totalChecks,
      ready: envValidation.summary.criticalErrors === 0,
      degraded: envValidation.summary.optionalWarnings > 0,
      errors: envValidation.summary.criticalErrors,
    },
    
    durationMs: Date.now() - startedAt,
  };

  return readiness;
}

/**
 * Gets simple health status for the /health endpoint.
 * Lightweight liveness check - returns immediately.
 * @returns {object} Health status object
 */
export function getHealthStatus() {
  return {
    ok: true,
    status: "alive",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid,
    memory: {
      rss: process.memoryUsage().rss,
      heapUsed: process.memoryUsage().heapUsed,
      heapTotal: process.memoryUsage().heapTotal,
    },
  };
}

// Re-export for convenience
export { validateEnvVar };
