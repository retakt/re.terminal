# MCP Architecture in re.terminal

This document explains the Model Context Protocol (MCP) architecture in re.terminal, clearly distinguishing between **built-in tool groups** and **external MCP servers**.

## Overview

re.terminal uses MCP-style naming and interfaces for tool discovery and invocation, but the architecture consists of two distinct layers:

```
re.terminal
├─ builtin/internal tool groups          ← Internal JavaScript tools
│  ├─ local       (filesystem ops)
│  ├─ git         (read-only git inspection)
│  ├─ memory      (graph memory via FalkorDB/Graphiti)
│  ├─ web         (search/fetch via SearXNG)
│  ├─ browser_agent (LLM-driven browser agent)
│  ├─ browser     (Lightpanda CDP browser engine)
│  ├─ extensions  (site-skill browser extensions)
│  └─ ops         (Docker, Ollama, monitor status)
│
└─ external MCP servers                  ← Future: real MCP protocol servers
   └─ [future] playwright via npx -y @playwright/mcp@latest
```

## Built-in Tool Groups (Internal)

### Characteristics
- **Transport**: `internal` (direct JavaScript function calls)
- **Protocol**: `internal-function` (not MCP protocol)
- **Source**: `builtin`
- **Type**: `builtin`
- **External**: `false`
- **MCP Native**: `false`

### Purpose
Built-in tool groups are internal JavaScript modules that expose tools using MCP-style names (`mcp__{group}__{tool}`). They provide:

- Scoped filesystem access (within `FILE_ROOT`)
- Read-only git repository inspection
- Graph memory operations
- Web search/fetch via configured SearXNG
- Browser automation via Lightpanda CDP
- Runtime browser-agent with observe-plan-act loop
- Local ops monitoring (Docker, Ollama, health checks)

### Status Fields
Each built-in tool group reports:

```json
{
  "id": "local",
  "title": "Local System",
  "source": "builtin",
  "type": "builtin",
  "transport": "internal",
  "protocol": "internal-function",
  "external": false,
  "mcpNative": false,
  "description": "Scoped local workspace and host context...",
  "status": "ready",
  "enabled": true,
  "toolCount": 6,
  "responseMs": 12
}
```

## External MCP Servers (Future)

### Characteristics
- **Transport**: `stdio`, `sse`, or `http`
- **Protocol**: `mcp` (real MCP protocol)
- **Source**: `external`
- **Type**: `external`
- **External**: `true`
- **MCP Native**: `true`

### Configuration
External MCP servers are configured via `server/config/mcp-servers.json`:

```json
{
  "servers": {
    "playwright": {
      "id": "playwright",
      "title": "Playwright MCP",
      "source": "external",
      "type": "external",
      "transport": "stdio",
      "enabled": false,
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
      "description": "Official Microsoft Playwright MCP server."
    }
  }
}
```

### Status Fields (Before Connection)
External servers that are configured but not yet connected report:

```json
{
  "id": "playwright",
  "title": "Playwright MCP",
  "source": "external",
  "type": "external",
  "transport": "stdio",
  "protocol": "mcp",
  "external": true,
  "mcpNative": true,
  "status": "configured",
  "connected": false,
  "toolCount": null,
  "responseMs": null
}
```

### Security Notes
- Commands in config must come from a trusted allowlist (`npx`, `npm`, `node`, etc.)
- Sensitive values (env vars, tokens in URLs) are redacted in status responses
- External servers are **not spawned** by the config loader - connection is handled separately
- User prompts cannot inject arbitrary commands into the config

## Tool Naming Convention

All tools use the prefix `mcp__{serverId}__{toolName}` for consistency:

| Tool Name | Source | Transport | Protocol |
|-----------|--------|-----------|----------|
| `mcp__local__read_text_file` | builtin | internal | internal-function |
| `mcp__git__status` | builtin | internal | internal-function |
| `mcp__browser_agent__run` | builtin | internal | internal-function |
| `mcp__playwright__click` | external (future) | stdio | mcp |

## API Behavior

### `listMcpServers()`
Returns both built-in and configured external servers:
- Built-in servers: `source: "builtin"`, `mcpNative: false`
- External servers: `source: "external"`, `mcpNative: true`, `connected: false` (until real client exists)

### `listMcpTools()`
**Only lists built-in/internal tools.** External MCP servers do not contribute tools until:
1. A real external MCP client is implemented (`external-mcp-client.js`)
2. The client successfully connects to the external server
3. Tools are discovered via the MCP protocol

This prevents fake or stubbed external tools from appearing in the tool list.

### `callMcpTool()`
Only callable for built-in tools at this time. External MCP tool invocation requires:
- Real MCP client implementation
- Active connection to external server
- Protocol-compliant tool discovery and invocation

## Admin/Status Helper

The built-in tool `mcp__ops__mcp_architecture_status` provides a read-only overview:

```json
{
  "builtinToolGroups": [...],
  "externalMcpServers": [...],
  "summary": {
    "builtinCount": 8,
    "externalConfiguredCount": 1,
    "externalConnectedCount": 0
  }
}
```

## Future Work

1. **external-mcp-client.js**: Implement real MCP protocol client for stdio/SSE/HTTP transports
2. **Tool discovery**: Fetch and cache tools from connected external servers
3. **Tool invocation**: Route `callMcpTool()` to external servers when appropriate
4. **Playwright MCP**: Enable `playwright` server in config and connect via external client

## Key Distinctions

| Aspect | Built-in Tool Groups | External MCP Servers |
|--------|---------------------|---------------------|
| Implementation | Internal JavaScript functions | External process/service |
| Transport | Direct function call | stdio / SSE / HTTP |
| Protocol | Internal function signature | MCP protocol spec |
| Tool Discovery | Static at import time | Dynamic via MCP initialize/list_tools |
| Connection State | Always "ready" if enabled | "configured" → "connected" → "ready" |
| Security Model | Scoped by FILE_ROOT, path traversal checks | Command allowlist, env redaction, process isolation |
| Naming | `mcp__{group}__{tool}` | `mcp__{server}__{tool}` (after discovery) |

## Do Not Confuse

- ❌ Built-in tool groups are **not** "real MCP servers"
- ❌ `mcp__local__read_text_file` is **not** an external MCP tool
- ✅ Built-in tools use MCP-style names for UI/UX consistency only
- ✅ External MCP support is being prepared but not yet implemented
- ✅ Playwright MCP will be configured as an external stdio server in a future task
