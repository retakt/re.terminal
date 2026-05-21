/**
 * External MCP Server Configuration Loader
 * 
 * Loads and validates external MCP server configurations from server/config/mcp-servers.json.
 * This module does NOT spawn or connect to external servers - it only provides configuration metadata.
 * Real MCP client implementation is handled separately in external-mcp-client.js (future).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, "..", "config", "mcp-servers.json");
const VALID_TRANSPORTS = ["stdio", "sse", "http"];
const VALID_PROTOCOLS = ["mcp"];

/**
 * Validates the shape of a single server configuration entry.
 * @param {string} id - The server ID (key in the config)
 * @param {object} config - The server configuration object
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateServerConfig(id, config) {
  const errors = [];

  if (!config || typeof config !== "object") {
    errors.push(`Server "${id}" config must be an object`);
    return { valid: false, errors };
  }

  // Required fields
  if (!config.id || config.id !== id) {
    errors.push(`Server "${id}" must have matching id field`);
  }

  if (!config.title || typeof config.title !== "string") {
    errors.push(`Server "${id}" must have a string title`);
  }

  if (config.source !== "external") {
    errors.push(`Server "${id}" source must be "external"`);
  }

  if (config.type !== "external") {
    errors.push(`Server "${id}" type must be "external"`);
  }

  if (!VALID_TRANSPORTS.includes(config.transport)) {
    errors.push(`Server "${id}" transport must be one of: ${VALID_TRANSPORTS.join(", ")}`);
  }

  if (config.protocol && !VALID_PROTOCOLS.includes(config.protocol)) {
    errors.push(`Server "${id}" protocol must be one of: ${VALID_PROTOCOLS.join(", ")}`);
  }

  // Command validation for stdio transport
  if (config.transport === "stdio") {
    if (!config.command || typeof config.command !== "string") {
      errors.push(`Server "${id}" with stdio transport must have a string command`);
    }
    if (!Array.isArray(config.args)) {
      errors.push(`Server "${id}" with stdio transport must have args as an array`);
    }
  }

  // URL validation for sse/http transport
  if (["sse", "http"].includes(config.transport)) {
    if (!config.url || typeof config.url !== "string") {
      errors.push(`Server "${id}" with ${config.transport} transport must have a string url`);
    }
  }

  // Security: command must be from trusted allowlist, not arbitrary user input
  // This validation ensures only pre-approved commands can be configured
  const trustedCommands = [
    "npx",
    "npm",
    "node",
    "bun",
    "deno",
    "uvx",
    "pipx",
  ];
  if (config.command && !trustedCommands.includes(config.command)) {
    errors.push(`Server "${id}" command "${config.command}" is not in trusted allowlist`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Redacts sensitive values from a server config for safe status reporting.
 * @param {object} config - The server configuration
 * @returns {object} - Redacted config
 */
function redactSensitiveValues(config) {
  const redacted = { ...config };
  
  // Redact any env-related fields
  if (redacted.env) {
    redacted.env = Object.keys(redacted.env).reduce((acc, key) => {
      acc[key] = "[redacted]";
      return acc;
    }, {});
  }

  // Redact auth tokens in URL if present
  if (redacted.url && /token=|auth=|key=|password=|secret=/i.test(redacted.url)) {
    redacted.url = redacted.url.replace(/(token|auth|key|password|secret)=[^&]+/gi, "$1=[redacted]");
  }

  return redacted;
}

/**
 * Loads external MCP server configurations from file.
 * Returns empty list if config file is missing or invalid.
 * @returns {Promise<Array<object>>} - Array of validated, redacted server configs
 */
export async function loadExternalMcpConfigs() {
  try {
    // Return empty list if config file doesn't exist
    if (!fs.existsSync(CONFIG_PATH)) {
      return [];
    }

    const rawContent = fs.readFileSync(CONFIG_PATH, "utf8");
    const config = JSON.parse(rawContent);

    // Validate top-level shape
    if (!config || typeof config !== "object") {
      console.warn("Invalid mcp-servers.json: root must be an object");
      return [];
    }

    if (!config.servers || typeof config.servers !== "object") {
      console.warn("Invalid mcp-servers.json: missing or invalid servers object");
      return [];
    }

    const servers = [];
    const validationErrors = [];

    // Validate each server entry
    for (const [id, serverConfig] of Object.entries(config.servers)) {
      const validation = validateServerConfig(id, serverConfig);
      
      if (validation.valid) {
        // Only include servers that are explicitly enabled or have no enabled flag (default enabled)
        if (serverConfig.enabled !== false) {
          servers.push({
            ...redactSensitiveValues(serverConfig),
            // Add runtime status fields for external servers
            protocol: serverConfig.protocol || "mcp",
            external: true,
            mcpNative: true,
            status: "configured",
            connected: false,
            toolCount: null,
            responseMs: null,
          });
        }
      } else {
        validationErrors.push(...validation.errors);
        console.warn(`MCP config validation errors for "${id}":`, validation.errors);
      }
    }

    if (validationErrors.length > 0) {
      console.warn("Some MCP server configs were skipped due to validation errors");
    }

    return servers;
  } catch (err) {
    console.warn("Failed to load external MCP configs:", err.message);
    return [];
  }
}

/**
 * Gets the path to the MCP servers config file.
 * Useful for documentation or admin tools.
 * @returns {string} - Absolute path to config file
 */
export function getMcpConfigPath() {
  return CONFIG_PATH;
}

/**
 * Checks if the external MCP config file exists.
 * @returns {boolean}
 */
export function hasExternalMcpConfig() {
  return fs.existsSync(CONFIG_PATH);
}

/**
 * Example configuration object for documentation purposes.
 */
export const EXAMPLE_CONFIG = {
  servers: {
    playwright: {
      id: "playwright",
      title: "Playwright MCP",
      source: "external",
      type: "external",
      transport: "stdio",
      enabled: false,
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"],
      description: "Official Microsoft Playwright MCP server.",
    },
  },
};
