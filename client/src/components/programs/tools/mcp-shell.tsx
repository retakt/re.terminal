import { useEffect, useMemo, useState } from "react";
import { Blocks, Clipboard, ExternalLink, ListTree, PlugZap, RefreshCcw, Search, ScrollText, ServerCog, Stethoscope, TerminalSquare } from "lucide-react";
import { callMcpTool, listMcpLogs, listMcpServers, listMcpTools, type ApiResult, type McpLog, type McpServer, type McpTool } from "@/chat/api/mcp";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

const PHONE_QUERY = "(max-width: 767px), (hover: none) and (pointer: coarse)";

function preview(value: unknown, limit = 220) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function statusLabel(server: McpServer) {
  if (server.status === "needs_config") return "needs config";
  if (server.status === "degraded") return "degraded";
  return server.status;
}

function isSafeAutoTestTool(tool: McpTool) {
  const name = tool.name.toLowerCase();
  return !/(write|replace|delete|remove|restart|start|stop|kill|deploy)/.test(name);
}

function sampleArgsForTool(tool: McpTool): Record<string, unknown> | null {
  const name = tool.name.toLowerCase();
  if (!isSafeAutoTestTool(tool)) return null;
  if (name.includes("list_directory")) return { path: "." };
  if (name.includes("read_text_file")) return { path: "README.md" };
  if (name.includes("lightpanda_navigate")) return { url: "https://example.com", waitms: 500 };
  if (name.includes("browser") && name.includes("navigate")) return { url: "https://example.com", waitms: 500 };
  if (name.includes("search")) return { query: "model context protocol", mode: "general" };
  return {};
}

function useIsPhoneLayout() {
  const getIsPhone = () =>
    typeof window !== "undefined" &&
    window.matchMedia(PHONE_QUERY).matches;

  const [isPhone, setIsPhone] = useState(getIsPhone);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(query.matches);

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isPhone;
}

// Classification helpers - backward compatible with old backend shapes
function isBuiltinServer(server: McpServer & { source?: string; mcpNative?: boolean; external?: boolean; type?: string; transport?: string }): boolean {
  // New metadata fields take precedence
  if (server.source === "builtin" || server.mcpNative === false || server.external === false) return true;
  if (server.source === "external" || server.mcpNative === true || server.external === true) return false;

  // Backward compatibility for old backend shape
  if (server.type === "builtin") return true;
  if (server.transport === "internal" || server.transport === "cdp") return true;

  // Fallback to known builtin server IDs
  const builtinIds = new Set([
    "local",
    "git",
    "memory",
    "web",
    "browser_agent",
    "browser",
    "extensions",
    "ops",
  ]);

  return builtinIds.has(server.id);
}

function isExternalServer(server: McpServer & { source?: string; mcpNative?: boolean; external?: boolean }): boolean {
  // New metadata fields take precedence
  if (server.source === "external" || server.mcpNative === true || server.external === true) return true;
  return false;
}

function isBuiltinTool(tool: McpTool & { source?: string; external?: boolean; mcpNative?: boolean; serverId?: string }): boolean {
  // New metadata fields take precedence
  if (tool.source === "builtin" || tool.external === false || tool.mcpNative === false) return true;
  if (tool.source === "external" || tool.external === true || tool.mcpNative === true) return false;

  // Fallback to known builtin server IDs
  const builtinIds = new Set([
    "local",
    "git",
    "memory",
    "web",
    "browser_agent",
    "browser",
    "extensions",
    "ops",
  ]);

  return builtinIds.has(tool.serverId);
}

function isExternalTool(tool: McpTool & { source?: string; external?: boolean; mcpNative?: boolean }): boolean {
  // New metadata fields take precedence
  if (tool.source === "external" || tool.external === true || tool.mcpNative === true) return true;
  return false;
}

export function McpShell({ isActive = true }: { isActive?: boolean }) {
  const isPhone = useIsPhoneLayout();
  const [servers, setServers] = useState<Array<McpServer & { source?: string; mcpNative?: boolean }>>([]);
  const [tools, setTools] = useState<Array<McpTool & { source?: string; external?: boolean; mcpNative?: boolean }>>([]);
  const [logs, setLogs] = useState<McpLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [inspectTitle, setInspectTitle] = useState("inspect");
  const [inspectBody, setInspectBody] = useState("select a tool group or tool to inspect details.");
  const [inspectExpanded, setInspectExpanded] = useState(!isPhone);

  async function refresh() {
    setLoading(true);
    try {
      const [serversResult, toolsResult, logsResult] = await Promise.all([
        listMcpServers(),
        listMcpTools(),
        listMcpLogs(),
      ]);
      
      // Handle API errors - show visible message instead of silently showing 0
      if (!serversResult.ok) {
        setNotice(`Failed to load servers: ${serversResult.error.slice(0, 50)}`);
        console.error("Failed to load MCP servers:", serversResult.error);
      } else {
        setServers(serversResult.data as Array<McpServer & { source?: string; mcpNative?: boolean }>);
      }
      
      if (!toolsResult.ok) {
        setNotice(`Failed to load tools: ${toolsResult.error.slice(0, 50)}`);
        console.error("Failed to load MCP tools:", toolsResult.error);
      } else {
        setTools(toolsResult.data as Array<McpTool & { source?: string; external?: boolean; mcpNative?: boolean }>);
      }
      
      if (logsResult.ok) {
        setLogs(logsResult.data);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setNotice(`Failed to load tool gateway data: ${message.slice(0, 60)}`);
      console.error("MCP UI refresh error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isActive) return;
    void refresh();
    const interval = window.setInterval(() => {
      void listMcpLogs().then((result) => {
        if (result.ok) setLogs(result.data);
      });
    }, 2500);
    return () => window.clearInterval(interval);
  }, [isActive]);

  // Classify servers
  const builtinServers = useMemo(() => servers.filter(isBuiltinServer), [servers]);
  const externalServers = useMemo(() => servers.filter(isExternalServer), [servers]);

  // Counts
  const builtinReadyCount = useMemo(() => builtinServers.filter((s) => s.status === "ready").length, [builtinServers]);
  const builtinToolCount = useMemo(() => tools.filter((t) => isBuiltinTool(t) && t.enabled).length, [tools]);
  const externalConnectedCount = useMemo(() => externalServers.filter((s) => s.status === "ready").length, [externalServers]);
  const externalConfiguredCount = useMemo(() => externalServers.length, [externalServers]);

  const filteredBuiltinServers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return builtinServers.filter((server) => {
      const haystack = `${server.id} ${server.title} ${server.type} ${server.transport} ${server.status} ${server.description}`.toLowerCase();
      if (needle && !haystack.includes(needle)) return false;
      if (filter === "enabled") return server.enabled;
      if (filter === "disabled") return !server.enabled;
      if (filter === "builtin") return true;
      if (filter === "browser") return /browser|lightpanda/.test(haystack);
      if (filter === "high risk") return server.type === "remote";
      return true;
    });
  }, [filter, query, builtinServers]);

  const filteredExternalServers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return externalServers.filter((server) => {
      const haystack = `${server.id} ${server.title} ${server.type} ${server.transport} ${server.status} ${server.description}`.toLowerCase();
      if (needle && !haystack.includes(needle)) return false;
      if (filter === "enabled") return server.enabled;
      if (filter === "disabled") return !server.enabled;
      if (filter === "external" || filter === "mcp") return true;
      return true;
    });
  }, [filter, query, externalServers]);

  const filteredTools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tools.filter((tool) => {
      const haystack = `${tool.name} ${tool.serverId} ${tool.serverTitle} ${tool.description}`.toLowerCase();
      if (needle && !haystack.includes(needle)) return false;
      if (filter === "enabled") return tool.enabled;
      if (filter === "disabled") return !tool.enabled;
      if (filter === "browser") return /browser|lightpanda/.test(haystack);
      if (filter === "tools" || filter === "all" || filter === "builtin") return true;
      return false;
    });
  }, [filter, query, tools]);

  const groupedLogs = useMemo(() => {
    const groups: Array<McpLog & { count: number }> = [];
    for (const log of logs) {
      const previous = groups[groups.length - 1];
      const same =
        previous &&
        previous.tool === log.tool &&
        previous.status === log.status &&
        preview(previous.args, 100) === preview(log.args, 100) &&
        preview(previous.result, 100) === preview(log.result, 100);
      if (same) {
        previous.count += 1;
        previous.durationMs = log.durationMs;
      } else {
        groups.push({ ...log, count: 1 });
      }
    }
    return groups;
  }, [logs]);

  const copyText = async (text: string, label = "copied") => {
    await navigator.clipboard?.writeText(text);
    setNotice(label);
    window.setTimeout(() => setNotice(""), 1400);
  };

  const testServer = async (server: McpServer) => {
    const tool = tools.find((entry) => entry.serverId === server.id && entry.enabled && isSafeAutoTestTool(entry));
    if (!tool) {
      setNotice("no safe enabled test tool");
      return;
    }
    const args = sampleArgsForTool(tool);
    if (!args) {
      setNotice("tool needs manual args");
      return;
    }
    setNotice("testing...");
    setInspectTitle(`test ${server.id}`);
    setInspectBody(`calling ${tool.name}\nargs: ${JSON.stringify(args, null, 2)}`);
    try {
      const result = await callMcpTool(tool.name, args);
      setNotice("test ok");
      setInspectBody(`tool: ${tool.name}\nstatus: ok\nargs:\n${JSON.stringify(args, null, 2)}\n\nresult:\n${result}`);
      void refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "test failed";
      setNotice(message.slice(0, 80));
      setInspectBody(`tool: ${tool.name}\nstatus: error\nargs:\n${JSON.stringify(args, null, 2)}\n\nerror:\n${message}`);
    }
  };

  const inspectServer = (server: McpServer) => {
    const serverTools = tools.filter((tool) => tool.serverId === server.id);
    setInspectTitle(`inspect ${server.id}`);
    setInspectBody(JSON.stringify({ server, tools: serverTools }, null, 2));
    setInspectExpanded(true);
  };

  const testTool = async (tool: McpTool) => {
    const args = sampleArgsForTool(tool);
    if (!args) {
      const message = "write/edit tools need manual args";
      setNotice(message);
      setInspectTitle(`test ${tool.name}`);
      setInspectBody(message);
      return;
    }
    setNotice("testing...");
    setInspectTitle(`test ${tool.name}`);
    setInspectBody(`calling ${tool.name}\nargs: ${JSON.stringify(args, null, 2)}`);
    try {
      const result = await callMcpTool(tool.name, args);
      setNotice("test ok");
      setInspectBody(`tool: ${tool.name}\nstatus: ok\nargs:\n${JSON.stringify(args, null, 2)}\n\nresult:\n${result}`);
      void refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "test failed";
      setNotice(message.slice(0, 80));
      setInspectBody(`tool: ${tool.name}\nstatus: error\nargs:\n${JSON.stringify(args, null, 2)}\n\nerror:\n${message}`);
    }
  };

  // Tool list card
  const toolListCard = (
    <section className="tool-compact-card mcp-list-card">
      <div className="tool-card-title">
        <ListTree size={14} />
        <h2>builtin tools</h2>
      </div>
      <div className="mcp-tool-list">
        {filteredTools
          .filter(isBuiltinTool)
          .map((tool) => (
          <article key={tool.name} className={`mcp-tool-row ${!tool.enabled ? "mcp-tool-row--disabled" : ""}`}>
            <header>
              <span>{tool.name}</span>
              <strong>{tool.serverTitle}</strong>
            </header>
            <p>{tool.description}</p>
            <code>{preview(tool.inputSchema, 180)}</code>
            <div className="catalog-card-actions">
              <button type="button" onClick={() => void copyText(JSON.stringify(tool, null, 2), "schema copied")}>
                <Clipboard size={11} />
                copy
              </button>
              <button type="button" onClick={() => void testTool(tool)}>
                <Stethoscope size={11} />
                test
              </button>
              <button type="button" onClick={() => {
                setInspectTitle(`inspect ${tool.name}`);
                setInspectBody(JSON.stringify(tool, null, 2));
                setInspectExpanded(true);
              }}>
                <TerminalSquare size={11} />
                inspect
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  // Log list card
  const logListCard = (
    <section className="tool-compact-card mcp-list-card">
      <div className="tool-card-title">
        <ScrollText size={14} />
        <h2>logs</h2>
      </div>
      <div className="mcp-log-list">
        {logs.length === 0 ? (
          <div className="mcp-empty-log">
            <Blocks size={14} />
            <span>tool activity appears here after a chat call</span>
          </div>
        ) : groupedLogs.map((log) => (
          <article key={log.id} className={`mcp-log-row mcp-log-row--${log.status}`}>
            <header>
              <span>{log.tool}</span>
              <strong>
                {log.count > 1 && <em className="mcp-repeat-badge">x{log.count}</em>}
                {log.durationMs}ms
              </strong>
            </header>
            <code>{preview(log.args, 140)}</code>
            <p>{preview(log.result, 260)}</p>
          </article>
        ))}
      </div>
    </section>
  );

  // External server status badge
  function externalServerStatus(server: McpServer) {
    if (!server.enabled) return "disabled";
    if (server.status === "needs_config") return "configured / not connected";
    if (server.status === "ready") return "ready / connected";
    if (server.status === "error") return "error";
    return server.status;
  }

  // Render builtin server card
  function renderBuiltinServerCard(server: McpServer) {
    return (
      <article key={server.id} className={`mcp-server-card mcp-server-card--${server.status} ${!server.enabled ? "is-disabled" : ""}`}>
        <header>
          <strong>{server.title}</strong>
          <span className="mcp-pill mcp-pill--builtin">builtin</span>
        </header>
        <p>{server.description}</p>
        <footer>
          <span>{server.transport}</span>
          <span>{server.toolCount} tools</span>
          <span>{typeof server.responseMs === "number" ? `${server.responseMs}ms` : "no ping"}</span>
        </footer>
        <div className="catalog-card-actions">
          <button type="button" onClick={() => void copyText(JSON.stringify(server, null, 2), "config copied")}>
            <Clipboard size={11} />
            copy
          </button>
          <button type="button" onClick={() => inspectServer(server)}>
            <TerminalSquare size={11} />
            inspect
          </button>
        </div>
      </article>
    );
  }

  // Render external server card
  function renderExternalServerCard(server: McpServer) {
    return (
      <article key={server.id} className={`mcp-server-card mcp-server-card--${server.status} ${!server.enabled ? "is-disabled" : ""}`}>
        <header>
          <strong>{server.title}</strong>
          <span className={`mcp-pill mcp-pill--${server.status === "ready" ? "ready" : "needs_config"}`}>
            {externalServerStatus(server)}
          </span>
        </header>
        <p>{server.description}</p>
        <footer>
          <span>{server.transport}</span>
          <span>{server.toolCount} tools</span>
          <span>{typeof server.responseMs === "number" ? `${server.responseMs}ms` : "no ping"}</span>
        </footer>
        <div className="catalog-card-actions">
          {server.enabled && server.status === "ready" && (
            <button type="button" onClick={() => void copyText(JSON.stringify(server, null, 2), "config copied")}>
              <Clipboard size={11} />
              copy
            </button>
          )}
          {server.enabled && server.status === "ready" && (
            <button type="button" onClick={() => inspectServer(server)}>
              <TerminalSquare size={11} />
              inspect
            </button>
          )}
          {!server.enabled && (
            <span className="mcp-pill mcp-pill--needs_config">disabled</span>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="program-shell tool-compact-page mcp-page">
      <main className="tool-compact-body mcp-dashboard">
        {/* Header / Toolbar */}
        <section className="tool-compact-card tool-compact-card--wide mcp-toolbar">
          <div className="tool-card-title">
            <PlugZap size={14} />
            <h2>tool gateway</h2>
            {notice && <span className="tool-card-title__note">{notice}</span>}
          </div>
          <div className="mcp-toolbar__stats">
            <span>{builtinReadyCount}/{builtinServers.length} builtin groups ready</span>
            <span>{builtinToolCount} builtin tools</span>
            {externalConfiguredCount > 0 && (
              <span>
                {externalConnectedCount}/{externalConfiguredCount} external MCP connected
              </span>
            )}
            {externalConfiguredCount === 0 && (
              <span>0 external MCP configured</span>
            )}
            <button type="button" className="mcp-icon-button" onClick={() => void refresh()} title="Refresh">
              <RefreshCcw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </section>

        {/* Search and Filters */}
        <section className="tool-compact-card tool-compact-card--wide">
          <div className="catalog-filter-bar">
            <div className="catalog-filter-chips">
              {["all", "builtin", "external", "enabled", "disabled", "browser"].map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={`catalog-filter-chip ${filter === entry ? "is-active" : ""}`}
                  onClick={() => setFilter(entry)}
                >
                  {entry}
                </button>
              ))}
            </div>
            <label className="catalog-search">
              <Search size={12} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="search tools" />
            </label>
          </div>
        </section>

        {/* Section A: Builtin Tool Groups */}
        <section className="tool-compact-card tool-compact-card--wide">
          <div className="tool-card-title">
            <ServerCog size={14} />
            <h2>builtin tool groups</h2>
          </div>
          <p style={{ color: "var(--fg-muted)", fontSize: "12px", marginBottom: "8px" }}>
            Internal JavaScript tools exposed through MCP-style names. These are not external MCP protocol servers.
          </p>
          <div className="mcp-server-grid">
            {filteredBuiltinServers.map(renderBuiltinServerCard)}
            {filteredBuiltinServers.length === 0 && builtinServers.length === 0 && (
              <div className="mcp-empty-log">
                <Blocks size={14} />
                <span>no builtin tool groups loaded</span>
              </div>
            )}
            {filteredBuiltinServers.length === 0 && builtinServers.length > 0 && (
              <div className="mcp-empty-log">
                <Blocks size={14} />
                <span>no builtin tool groups match your filter</span>
              </div>
            )}
          </div>
        </section>

        {/* Section B: External MCP Servers */}
        <section className="tool-compact-card tool-compact-card--wide">
          <div className="tool-card-title">
            <ServerCog size={14} />
            <h2>external MCP servers</h2>
          </div>
          <p style={{ color: "var(--fg-muted)", fontSize: "12px", marginBottom: "8px" }}>
            Native MCP servers connected over stdio/SSE/HTTP. Tools appear only after real MCP discovery.
          </p>
          <div className="mcp-server-grid">
            {filteredExternalServers.length === 0 && externalServers.length === 0 && (
              <div className="mcp-empty-log">
                <Blocks size={14} />
                <span>no external MCP servers configured.</span>
              </div>
            )}
            {filteredExternalServers.length === 0 && externalServers.length > 0 && (
              <div className="mcp-empty-log">
                <Blocks size={14} />
                <span>no external MCP servers match your filter</span>
              </div>
            )}
            {filteredExternalServers.map(renderExternalServerCard)}
          </div>
        </section>

        {/* Inspect Panel - collapsible on mobile */}
        {(inspectTitle !== "inspect" || !isPhone) && (
          <section className={`tool-compact-card tool-compact-card--wide mcp-inspect-card ${isPhone && !inspectExpanded ? "mcp-inspect-card--collapsed" : ""}`}>
            <div className="tool-card-title">
              <TerminalSquare size={14} />
              <h2>{inspectTitle}</h2>
              {isPhone && (
                <button
                  type="button"
                  className="mcp-icon-button"
                  onClick={() => setInspectExpanded(!inspectExpanded)}
                  title={inspectExpanded ? "collapse" : "expand"}
                  style={{ marginLeft: "auto" }}
                >
                  {inspectExpanded ? "−" : "+"}
                </button>
              )}
            </div>
            {(isPhone ? inspectExpanded : true) && (
              <pre style={{ maxWidth: "100%", overflowX: "auto" }}>{inspectBody}</pre>
            )}
          </section>
        )}

        {/* Debug: show message if truly empty after API load */}
        {servers.length === 0 && tools.length === 0 && !loading && (
          <section className="tool-compact-card tool-compact-card--wide">
            <div className="mcp-empty-log">
              <Blocks size={14} />
              <span>No tool gateway data loaded. This usually means the backend is not running, not restarted, or /api/mcp/servers failed.</span>
            </div>
          </section>
        )}

        {/* Tools and Logs - stacked on mobile */}
        {isPhone ? (
          <div className="mcp-stacked-row">
            {toolListCard}
            {logListCard}
          </div>
        ) : (
          <ResizablePanelGroup orientation="horizontal" className="mcp-resizable-row">
            <ResizablePanel minSize="360px">
              {toolListCard}
            </ResizablePanel>
            <ResizableHandle className="chat-resize-handle" />
            <ResizablePanel
              defaultSize="420px"
              minSize="320px"
              maxSize="620px"
              groupResizeBehavior="preserve-pixel-size"
            >
              {logListCard}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </main>
    </div>
  );
}
