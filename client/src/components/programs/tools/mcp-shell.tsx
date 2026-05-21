import { useEffect, useMemo, useState } from "react";
import {
  Blocks,
  Clipboard,
  ExternalLink,
  ListTree,
  PlugZap,
  RefreshCcw,
  Search,
  ScrollText,
  ServerCog,
  Stethoscope,
  TerminalSquare,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import {
  callMcpTool,
  listMcpLogs,
  listMcpServers,
  listMcpTools,
  type ApiResult,
  type McpLog,
  type McpServer,
  type McpTool,
} from "@/chat/api/mcp";

const PHONE_QUERY = "(max-width: 767px), (hover: none) and (pointer: coarse)";

function preview(value: unknown, limit = 220) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function statusLabel(server: McpServer) {
  if (server.status === "needs_config") return "needs config";
  if (server.status === "degraded") return "degraded";
  return server.status;
}

function healthInfo(server: McpServer): string {
  // Show response time when known, otherwise "not checked" or "error"
  if (server.status === "error") return "error";
  if (typeof server.responseMs === "number") return `${server.responseMs}ms`;
  return "not checked";
}

function isSafeAutoTestTool(tool: McpTool) {
  const name = tool.name.toLowerCase();
  return !/(write|replace|delete|remove|restart|start|stop|kill|deploy)/.test(
    name
  );
}

function sampleArgsForTool(tool: McpTool): Record<string, unknown> | null {
  const name = tool.name.toLowerCase();
  if (!isSafeAutoTestTool(tool)) return null;
  if (name.includes("list_directory")) return { path: "." };
  if (name.includes("read_text_file")) return { path: "README.md" };
  if (name.includes("lightpanda_navigate"))
    return { url: "https://example.com", waitms: 500 };
  if (name.includes("browser") && name.includes("navigate"))
    return { url: "https://example.com", waitms: 500 };
  if (name.includes("search"))
    return { query: "model context protocol", mode: "general" };
  return {};
}

function useIsPhoneLayout() {
  const getIsPhone = () =>
    typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;

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

// Classification helpers
function isBuiltinServer(
  server: McpServer & {
    source?: string;
    mcpNative?: boolean;
    external?: boolean;
    type?: string;
    transport?: string;
  }
): boolean {
  if (
    server.source === "builtin" ||
    server.mcpNative === false ||
    server.external === false
  )
    return true;
  if (
    server.source === "external" ||
    server.mcpNative === true ||
    server.external === true
  )
    return false;
  if (server.type === "builtin") return true;
  if (server.transport === "internal" || server.transport === "cdp")
    return true;
  const builtinIds = new Set([
    "local", "git", "memory", "web", "browser_agent", "browser", "extensions", "ops",
  ]);
  return builtinIds.has(server.id);
}

function isExternalServer(
  server: McpServer & {
    source?: string;
    mcpNative?: boolean;
    external?: boolean;
  }
): boolean {
  if (
    server.source === "external" ||
    server.mcpNative === true ||
    server.external === true
  )
    return true;
  return false;
}

function isBuiltinTool(
  tool: McpTool & {
    source?: string;
    external?: boolean;
    mcpNative?: boolean;
    serverId?: string;
  }
): boolean {
  if (
    tool.source === "builtin" ||
    tool.external === false ||
    tool.mcpNative === false
  )
    return true;
  if (tool.source === "external" || tool.external === true || tool.mcpNative === true)
    return false;
  const builtinIds = new Set([
    "local", "git", "memory", "web", "browser_agent", "browser", "extensions", "ops",
  ]);
  return builtinIds.has(tool.serverId);
}

function isExternalTool(
  tool: McpTool & {
    source?: string;
    external?: boolean;
    mcpNative?: boolean;
  }
): boolean {
  if (tool.source === "external" || tool.external === true || tool.mcpNative === true)
    return true;
  return false;
}

// ============ MOBILE COMPONENT ============
function MobileMcpShell({
  servers, tools, logs, loading, filter, query, setFilter, setQuery, notice, refresh,
  builtinServers, externalServers, filteredBuiltinServers, filteredExternalServers,
  filteredTools, groupedLogs, copyText, testServer, inspectServer, testTool,
  toggleToolSchema, expandedToolSchemas, showLogs, setShowLogs,
  inspectTitle, inspectBody, inspectExpanded, setInspectExpanded,
}: {
  servers: Array<McpServer & { source?: string; mcpNative?: boolean }>;
  tools: Array<McpTool & { source?: string; external?: boolean; mcpNative?: boolean }>;
  logs: McpLog[]; loading: boolean; filter: string; query: string;
  setFilter: (f: string) => void; setQuery: (q: string) => void; notice: string;
  refresh: () => Promise<void>;
  builtinServers: Array<McpServer & { source?: string; mcpNative?: boolean }>;
  externalServers: Array<McpServer & { source?: string; mcpNative?: boolean }>;
  filteredBuiltinServers: Array<McpServer & { source?: string; mcpNative?: boolean }>;
  filteredExternalServers: Array<McpServer & { source?: string; mcpNative?: boolean }>;
  filteredTools: Array<McpTool & { source?: string; external?: boolean; mcpNative?: boolean }>;
  groupedLogs: Array<McpLog & { count: number }>;
  copyText: (text: string, label?: string) => Promise<void>;
  testServer: (server: McpServer) => Promise<void>;
  inspectServer: (server: McpServer) => void;
  testTool: (tool: McpTool) => Promise<void>;
  toggleToolSchema: (name: string) => void;
  expandedToolSchemas: Set<string>; showLogs: boolean; setShowLogs: (s: boolean) => void;
  inspectTitle: string; inspectBody: string; inspectExpanded: boolean; setInspectExpanded: (e: boolean) => void;
}) {
  const builtinReadyCount = builtinServers.filter((s) => s.status === "ready").length;
  const builtinToolCount = tools.filter((t) => isBuiltinTool(t) && t.enabled).length;
  const externalConnectedCount = externalServers.filter((s) => s.status === "ready").length;

  // Mobile-specific state for collapsible sections
  const [mobileLogsOpen, setMobileLogsOpen] = useState(false);
  const [mobileToolsExpanded, setMobileToolsExpanded] = useState(false);
  const visibleMobileTools = mobileToolsExpanded ? filteredTools.filter(isBuiltinTool) : filteredTools.filter(isBuiltinTool).slice(0, 3);

  return (
    <div className="program-shell tool-compact-page mcp-page mcp-page--mobile">
      <main className="tool-compact-body mcp-dashboard mcp-dashboard--mobile">
        {/* Header - Compact */}
        <section className="mcp-toolbar mcp-toolbar--mobile">
          <div className="mcp-toolbar-title">
            <PlugZap size={12} /><h1>Tool Gateway</h1>
          </div>
          <div className="mcp-toolbar-stats mcp-toolbar-stats--mobile">
            <span className="mcp-stat-line">
              {builtinReadyCount} groups · {builtinToolCount} tools · {externalServers.length} external
            </span>
            {notice && <span className="mcp-toolbar-notice">{notice}</span>}
            <button type="button" className="mcp-icon-button mcp-icon-button--mobile"
              onClick={() => void refresh()} title="Refresh" aria-label="Refresh data">
              <RefreshCcw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </section>

        {/* Search + Filters */}
        <section className="mcp-filters mcp-filters--mobile">
          <div className="mcp-filter-bar mcp-filter-bar--mobile">
            <div className="mcp-filter-chips mcp-filter-chips--mobile">
              {["all","builtin","external","enabled","disabled","browser"].map((entry) => (
                <button key={entry} type="button"
                  className={`mcp-filter-chip mcp-filter-chip--mobile ${filter === entry ? "is-active" : ""}`}
                  onClick={() => setFilter(entry)}>{entry}</button>
              ))}
            </div>
            <label className="mcp-search mcp-search--mobile">
              <Search size={12} />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..." aria-label="Search" />
            </label>
          </div>
        </section>

        {/* Activity Logs - Collapsed by Default, Near Top on Mobile */}
        <section className="mcp-logs-card mcp-logs-card--mobile">
          <button type="button" className="mcp-logs-header mcp-logs-header--mobile" onClick={() => setMobileLogsOpen(!mobileLogsOpen)}>
            <div className="mcp-logs-header-left">
              <ScrollText size={12} /><span>Activity Logs</span>
              {logs.length > 0 && <span className="mcp-logs-count">· {logs.length} entry{logs.length !== 1 ? 's' : ''}</span>}
            </div>
            {mobileLogsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {mobileLogsOpen && (
            <div className="mcp-log-list mcp-log-list--mobile">
              {logs.length === 0 ? <div className="mcp-empty-row">No activity yet</div> : (
                groupedLogs.slice(0, 3).map((log) => (
                  <article key={log.id} className={`mcp-log-row mcp-log-row--mobile mcp-log-row--${log.status}`}>
                    <div className="mcp-log-row-header">
                      <span className="mcp-log-tool-name">{log.tool}</span>
                      <span className="mcp-log-meta">{log.durationMs}ms · {log.status === "complete" ? "success" : log.status}{log.count > 1 && ` ×${log.count}`}</span>
                    </div>
                    <code className="mcp-log-preview">{preview(log.args, 100)}</code>
                  </article>
                ))
              )}
            </div>
          )}
        </section>

        {/* Builtin Tool Groups - Compact Rows */}
        <section className="mcp-section mcp-section--mobile">
          <header className="mcp-section-header mcp-section-header--mobile">
            <div className="mcp-section-title"><ServerCog size={12} /><h2>Builtin Tool Groups</h2></div>
            <span className="mcp-section-count">{filteredBuiltinServers.length}</span>
          </header>
          <div className="mcp-server-list mcp-server-list--mobile">
            {filteredBuiltinServers.map((server) => (
              <button key={server.id} type="button" className="mcp-server-row mcp-server-row--mobile"
                onClick={() => inspectServer(server)}>
                <div className="mcp-server-row-left">
                <span className="mcp-server-row-title">{server.title}</span>
                <span className="mcp-server-row-meta">{server.transport} · {server.toolCount} tools · {healthInfo(server)}</span>
                </div>
                <span className={`mcp-status-pill mcp-status-pill--${server.status}`}>{statusLabel(server)}</span>
              </button>
            ))}
            {filteredBuiltinServers.length === 0 && builtinServers.length === 0 && <div className="mcp-empty-row">No builtin groups</div>}
            {filteredBuiltinServers.length === 0 && builtinServers.length > 0 && <div className="mcp-empty-row">No matches</div>}
          </div>
        </section>

        {/* External MCP Servers - Compact */}
        <section className="mcp-section mcp-section--mobile">
          <header className="mcp-section-header mcp-section-header--mobile">
            <div className="mcp-section-title"><ExternalLink size={12} /><h2>External MCP</h2></div>
            <span className="mcp-section-count">{filteredExternalServers.length}</span>
          </header>
          {filteredExternalServers.length === 0 && externalServers.length === 0 ? (
            <div className="mcp-empty-row mcp-empty-row--compact">External MCP: none configured</div>
          ) : filteredExternalServers.length === 0 ? (
            <div className="mcp-empty-row mcp-empty-row--compact">No matches</div>
          ) : (
            <div className="mcp-server-list mcp-server-list--mobile">
              {filteredExternalServers.map((server) => (
                <button key={server.id} type="button" className="mcp-server-row mcp-server-row--mobile"
                  onClick={() => inspectServer(server)}>
                  <div className="mcp-server-row-left">
                    <span className="mcp-server-row-title">{server.title}</span>
                    <span className="mcp-server-row-meta">{server.protocol || "mcp"} · {server.toolCount ?? 0} tools · {healthInfo(server)}</span>
                  </div>
                  <span className={`mcp-status-pill mcp-status-pill--${server.status === "ready" ? "ready" : "needs-config"}`} title={server.lastError ? `Error: ${server.lastError}` : undefined}>
                    {server.connected ? "connected" : server.status === "needs_config" ? "configured" : server.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Available Tools - Collapsible, 3 items by default on mobile */}
        <section className="mcp-section mcp-section--mobile">
          <header className="mcp-section-header mcp-section-header--mobile">
            <button type="button" className="mcp-section-title-expand" onClick={() => setMobileToolsExpanded(!mobileToolsExpanded)} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}>
              <div className="mcp-section-title"><ListTree size={12} /><h2>Available Tools</h2></div>
              <span className="mcp-section-count">{filteredTools.filter(isBuiltinTool).length} tools</span>
              {mobileToolsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </header>
          <div className="mcp-tool-list mcp-tool-list--mobile">
            {visibleMobileTools.map((tool) => (
              <article key={tool.name} className={`mcp-tool-card mcp-tool-card--mobile ${!tool.enabled ? "is-disabled" : ""}`}>
                <header className="mcp-tool-card-header">
                  <div className="mcp-tool-card-title">
                    <strong>{tool.name}</strong>
                    <span className="mcp-tool-source-badge">{isBuiltinTool(tool) ? "builtin" : "external"}</span>
                  </div>
                  <span className="mcp-tool-server-name">{tool.serverTitle}</span>
                </header>
                <p className="mcp-tool-card-desc">{tool.description}</p>
                <div className="mcp-tool-card-actions">
                  <button type="button" className="mcp-icon-btn mcp-icon-btn--mobile"
                    onClick={() => void copyText(JSON.stringify(tool, null, 2), "copied")} title="Copy">
                    <Clipboard size={11} />
                  </button>
                  <button type="button" className="mcp-icon-btn mcp-icon-btn--mobile"
                    onClick={() => { setInspectTitle(`inspect ${tool.name}`); setInspectBody(JSON.stringify(tool, null, 2)); setInspectExpanded(true); }}
                    title="Inspect"><TerminalSquare size={11} /></button>
                  {isSafeAutoTestTool(tool) && (
                    <button type="button" className="mcp-icon-btn mcp-icon-btn--mobile mcp-icon-btn--test"
                      onClick={() => void testTool(tool)} title="Test"><Stethoscope size={11} /></button>
                  )}
                </div>
              </article>
            ))}
            {filteredTools.filter(isBuiltinTool).length === 0 && <div className="mcp-empty-row">No tools match filters</div>}
            {filteredTools.filter(isBuiltinTool).length > 3 && !mobileToolsExpanded && (
              <button type="button" className="mcp-show-more-tools" onClick={() => setMobileToolsExpanded(true)}>
                Show all {filteredTools.filter(isBuiltinTool).length} tools
              </button>
            )}
            {mobileToolsExpanded && filteredTools.filter(isBuiltinTool).length > 3 && (
              <button type="button" className="mcp-show-less-tools" onClick={() => setMobileToolsExpanded(false)}>
                Show less
              </button>
            )}
          </div>
        </section>

        {/* Inspect - Modal/Bottom Sheet */}
        {inspectExpanded && inspectTitle !== "inspect" && (
          <div className="mcp-inspect-modal mcp-inspect-modal--mobile" onClick={() => setInspectExpanded(false)}>
            <div className="mcp-inspect-modal-content" onClick={(e) => e.stopPropagation()}>
              <header className="mcp-inspect-modal-header">
                <h3>{inspectTitle}</h3>
                <button type="button" className="mcp-icon-btn mcp-icon-btn--mobile"
                  onClick={() => setInspectExpanded(false)} aria-label="Close">×</button>
              </header>
              <pre className="mcp-inspect-modal-body">{inspectBody}</pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ============ DESKTOP COMPONENT ============
function DesktopMcpShell({
  servers, tools, logs, loading, filter, query, setFilter, setQuery, notice, refresh,
  builtinServers, externalServers, filteredBuiltinServers, filteredExternalServers,
  filteredTools, groupedLogs, copyText, testServer, inspectServer, testTool,
  toggleToolSchema, expandedToolSchemas, showLogs, setShowLogs,
  inspectTitle, inspectBody, inspectExpanded, setInspectExpanded,
  externalConfiguredCount,
}: {
  servers: Array<McpServer & { source?: string; mcpNative?: boolean }>;
  tools: Array<McpTool & { source?: string; external?: boolean; mcpNative?: boolean }>;
  logs: McpLog[]; loading: boolean; filter: string; query: string;
  setFilter: (f: string) => void; setQuery: (q: string) => void; notice: string;
  refresh: () => Promise<void>;
  builtinServers: Array<McpServer & { source?: string; mcpNative?: boolean }>;
  externalServers: Array<McpServer & { source?: string; mcpNative?: boolean }>;
  filteredBuiltinServers: Array<McpServer & { source?: string; mcpNative?: boolean }>;
  filteredExternalServers: Array<McpServer & { source?: string; mcpNative?: boolean }>;
  filteredTools: Array<McpTool & { source?: string; external?: boolean; mcpNative?: boolean }>;
  groupedLogs: Array<McpLog & { count: number }>;
  copyText: (text: string, label?: string) => Promise<void>;
  testServer: (server: McpServer) => Promise<void>;
  inspectServer: (server: McpServer) => void;
  testTool: (tool: McpTool) => Promise<void>;
  toggleToolSchema: (name: string) => void;
  expandedToolSchemas: Set<string>; showLogs: boolean; setShowLogs: (s: boolean) => void;
  inspectTitle: string; inspectBody: string; inspectExpanded: boolean; setInspectExpanded: (e: boolean) => void;
  externalConfiguredCount: number;
}) {
  function externalServerStatus(server: McpServer) {
    if (!server.enabled) return "disabled";
    if (server.status === "needs_config") return "configured / not connected";
    if (server.status === "ready") return "ready / connected";
    if (server.status === "error") return "error";
    return server.status;
  }

  function renderBuiltinServerCard(server: McpServer) {
    return (
      <article key={server.id} className={`mcp-server-card mcp-server-card--${server.status} ${!server.enabled ? "is-disabled" : ""}`}>
        <header className="mcp-server-card-header">
          <div className="mcp-server-card-title-row">
            <strong className="mcp-server-card-title">{server.title}</strong>
            <span className="mcp-pill mcp-pill--builtin">builtin</span>
          </div>
          <span className="mcp-status-badge">{statusLabel(server)}</span>
        </header>
        <p className="mcp-server-card-description">{server.description}</p>
        <footer className="mcp-server-card-meta">
          <span className="mcp-meta-item"><span className="mcp-meta-label">transport:</span> {server.transport}</span>
          <span className="mcp-meta-item"><span className="mcp-meta-label">tools:</span> {server.toolCount}</span>
          <span className="mcp-meta-item"><span className="mcp-meta-label">latency:</span> {healthInfo(server)}</span>
        </footer>
        <div className="mcp-server-card-actions">
          <button type="button" className="mcp-action-btn" onClick={() => void copyText(JSON.stringify(server, null, 2), "config copied")} title="Copy config">
            <Clipboard size={14} /><span>Copy</span>
          </button>
          <button type="button" className="mcp-action-btn" onClick={() => inspectServer(server)} title="Inspect details">
            <TerminalSquare size={14} /><span>Inspect</span>
          </button>
        </div>
      </article>
    );
  }

  function renderExternalServerCard(server: McpServer) {
    return (
      <article key={server.id} className={`mcp-server-card mcp-server-card--${server.status} ${!server.enabled ? "is-disabled" : ""}`}>
        <header className="mcp-server-card-header">
          <div className="mcp-server-card-title-row">
            <strong className="mcp-server-card-title">{server.title}</strong>
            <span className="mcp-pill mcp-pill--external">external</span>
          </div>
          <span className={`mcp-status-badge mcp-status-badge--${server.status === "ready" ? "ready" : "needs-config"}`}>{externalServerStatus(server)}</span>
        </header>
        <p className="mcp-server-card-description">{server.description}</p>
        <footer className="mcp-server-card-meta">
          <span className="mcp-meta-item"><span className="mcp-meta-label">protocol:</span> {server.protocol || "mcp"}</span>
          <span className="mcp-meta-item"><span className="mcp-meta-label">tools:</span> {server.toolCount ?? 0}</span>
          <span className="mcp-meta-item"><span className="mcp-meta-label">latency:</span> {healthInfo(server)}</span>
        </footer>
        <div className="mcp-server-card-actions">
          {server.enabled && server.status === "ready" && (
            <>
              <button type="button" className="mcp-action-btn" onClick={() => void copyText(JSON.stringify(server, null, 2), "config copied")} title="Copy config">
                <Clipboard size={14} /><span>Copy</span>
              </button>
              <button type="button" className="mcp-action-btn" onClick={() => inspectServer(server)} title="Inspect details">
                <TerminalSquare size={14} /><span>Inspect</span>
              </button>
            </>
          )}
          {!server.enabled && <span className="mcp-pill mcp-pill--disabled">disabled</span>}
        </div>
      </article>
    );
  }

  function renderToolRow(tool: McpTool) {
    const isSchemaExpanded = expandedToolSchemas.has(tool.name);
    return (
      <article key={tool.name} className={`mcp-tool-row ${!tool.enabled ? "mcp-tool-row--disabled" : ""}`}>
        <header className="mcp-tool-row-header">
          <div className="mcp-tool-row-title">
            <strong>{tool.name}</strong>
            <span className="mcp-tool-source-badge">{isBuiltinTool(tool) ? "builtin" : "external"}</span>
          </div>
          <span className="mcp-tool-server">{tool.serverTitle}</span>
        </header>
        <p className="mcp-tool-description">{tool.description}</p>
        <details className="mcp-tool-schema" open={isSchemaExpanded}
          onToggle={(e) => {
            if ((e.target as HTMLDetailsElement).open) setExpandedToolSchemas((prev) => new Set(prev).add(tool.name));
            else setExpandedToolSchemas((prev) => { const next = new Set(prev); next.delete(tool.name); return next; });
          }}>
          <summary className="mcp-tool-schema-toggle">
            <span>{isSchemaExpanded ? "Hide schema" : "Show schema"}</span>
            {isSchemaExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </summary>
          <pre className="mcp-tool-schema-content">{preview(tool.inputSchema, 400)}</pre>
        </details>
        <div className="mcp-tool-actions">
          <button type="button" className="mcp-action-btn mcp-action-btn--small" onClick={() => void copyText(JSON.stringify(tool, null, 2), "schema copied")} title="Copy tool definition"><Clipboard size={12} /></button>
          <button type="button" className="mcp-action-btn mcp-action-btn--small" onClick={() => { setInspectTitle(`inspect ${tool.name}`); setInspectBody(JSON.stringify(tool, null, 2)); setInspectExpanded(true); }} title="Inspect tool"><TerminalSquare size={12} /></button>
          {isSafeAutoTestTool(tool) && <button type="button" className="mcp-action-btn mcp-action-btn--small mcp-action-btn--test" onClick={() => void testTool(tool)} title="Test tool"><Stethoscope size={12} /></button>}
        </div>
      </article>
    );
  }

  const logListCard = (
    <section className="tool-compact-card mcp-list-card mcp-logs-card">
      <button type="button" className="mcp-logs-header" onClick={() => setShowLogs(!showLogs)}>
        <div className="mcp-logs-header-left">
          <ScrollText size={12} /><h2>Activity Logs</h2>
          {logs.length > 0 && <span className="mcp-logs-count">{logs.length} entries</span>}
        </div>
        <div className="mcp-logs-header-right">{showLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</div>
      </button>
      {showLogs && (
        <div className="mcp-log-list">
          {logs.length === 0 ? (
            <div className="mcp-empty-state"><Info size={14} /><span>Tool activity appears here after a chat call</span></div>
          ) : (
            groupedLogs.slice(0, 10).map((log) => (
              <article key={log.id} className={`mcp-log-row mcp-log-row--${log.status}`}>
                <header className="mcp-log-row-header">
                  <span className="mcp-log-tool">{log.tool}</span>
                  <strong className="mcp-log-meta">{log.durationMs}ms · {log.status === "complete" ? "success" : log.status}</strong>
                  {log.count > 1 && <em className="mcp-repeat-badge">×{log.count}</em>}
                </header>
                <code className="mcp-log-args">{preview(log.args, 140)}</code>
                <p className="mcp-log-result">{preview(log.result, 260)}</p>
              </article>
            ))
          )}
          {logs.length > 10 && <button type="button" className="mcp-show-more-logs" onClick={() => setNotice("Showing latest 10 logs. Use terminal for full history.")}>Show more...</button>}
        </div>
      )}
    </section>
  );

  const builtinReadyCount = builtinServers.filter((s) => s.status === "ready").length;
  const builtinToolCount = tools.filter((t) => isBuiltinTool(t) && t.enabled).length;
  const externalConnectedCount = externalServers.filter((s) => s.status === "ready").length;

  return (
    <div className="program-shell tool-compact-page mcp-page">
      <main className="tool-compact-body mcp-dashboard">
        <section className="tool-compact-card tool-compact-card--wide mcp-toolbar">
          <div className="mcp-toolbar-header">
            <div className="mcp-toolbar-title"><PlugZap size={14} /><h1>Tool Gateway</h1></div>
            {notice && <span className="mcp-toolbar-notice" role="status">{notice}</span>}
          </div>
          <div className="mcp-toolbar-stats">
            <div className="mcp-stat-group"><span className="mcp-stat-value">{builtinReadyCount}</span><span className="mcp-stat-label">of {builtinServers.length} builtin ready</span></div>
            <div className="mcp-stat-group"><span className="mcp-stat-value">{builtinToolCount}</span><span className="mcp-stat-label">builtin tools</span></div>
            {externalConfiguredCount > 0 && <div className="mcp-stat-group"><span className="mcp-stat-value">{externalConnectedCount}</span><span className="mcp-stat-label">of {externalConfiguredCount} external connected</span></div>}
            {externalConfiguredCount === 0 && <div className="mcp-stat-group"><span className="mcp-stat-value">0</span><span className="mcp-stat-label">external MCP configured</span></div>}
            <button type="button" className="mcp-icon-button" onClick={() => void refresh()} title="Refresh" aria-label="Refresh data">
              <RefreshCcw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </section>
        <section className="tool-compact-card tool-compact-card--wide mcp-filters">
          <div className="mcp-filter-bar">
            <div className="mcp-filter-chips">
              {["all","builtin","external","enabled","disabled","browser"].map((entry) => (
                <button key={entry} type="button" className={`mcp-filter-chip ${filter === entry ? "is-active" : ""}`} onClick={() => setFilter(entry)}>{entry}</button>
              ))}
            </div>
            <label className="mcp-search"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools and servers..." aria-label="Search" /></label>
          </div>
        </section>
        <section className="tool-compact-card tool-compact-card--wide mcp-section">
          <header className="mcp-section-header">
            <div className="mcp-section-title"><ServerCog size={14} /><h2>Builtin Tool Groups</h2></div>
            <span className="mcp-section-count">{filteredBuiltinServers.length} groups</span>
          </header>
          <p className="mcp-section-description">Internal JavaScript tools exposed through MCP-style names. These are not external MCP protocol servers.</p>
          <div className="mcp-server-grid">
            {filteredBuiltinServers.map(renderBuiltinServerCard)}
            {filteredBuiltinServers.length === 0 && builtinServers.length === 0 && <div className="mcp-empty-state mcp-empty-state--full"><Blocks size={16} /><span>No builtin tool groups loaded</span></div>}
            {filteredBuiltinServers.length === 0 && builtinServers.length > 0 && <div className="mcp-empty-state mcp-empty-state--full"><Blocks size={16} /><span>No builtin tool groups match your filter</span></div>}
          </div>
        </section>
        <section className="tool-compact-card tool-compact-card--wide mcp-section">
          <header className="mcp-section-header">
            <div className="mcp-section-title"><ExternalLink size={14} /><h2>External MCP Servers</h2></div>
            <span className="mcp-section-count">{filteredExternalServers.length} configured</span>
          </header>
          <p className="mcp-section-description">Native MCP servers connected over stdio/SSE/HTTP. Tools appear only after real MCP discovery.</p>
          <div className="mcp-server-grid">
            {filteredExternalServers.length === 0 && externalServers.length === 0 && <div className="mcp-empty-state mcp-empty-state--full"><Blocks size={16} /><div><strong>No external MCP servers configured yet</strong><p>Playwright MCP will appear here after configuration.</p></div></div>}
            {filteredExternalServers.length === 0 && externalServers.length > 0 && <div className="mcp-empty-state mcp-empty-state--full"><Blocks size={16} /><span>No external MCP servers match your filter</span></div>}
            {filteredExternalServers.map(renderExternalServerCard)}
          </div>
        </section>
        {(inspectTitle !== "inspect") && (
          <section className={`tool-compact-card tool-compact-card--wide mcp-inspect-card`}>
            <header className="mcp-inspect-header">
              <div className="mcp-inspect-title"><TerminalSquare size={14} /><h2>{inspectTitle}</h2></div>
            </header>
            <pre className="mcp-inspect-content">{inspectBody}</pre>
          </section>
        )}
        {servers.length === 0 && tools.length === 0 && !loading && !notice && (
          <section className="tool-compact-card tool-compact-card--wide">
            <div className="mcp-empty-state mcp-empty-state--full"><Blocks size={16} /><span>No tool gateway data loaded. This usually means the backend is not running, not restarted, or /api/mcp/servers failed.</span></div>
          </section>
        )}
        <section className="tool-compact-card tool-compact-card--wide mcp-section">
          <header className="mcp-section-header">
            <div className="mcp-section-title"><ListTree size={14} /><h2>Available Tools</h2></div>
            <span className="mcp-section-count">{filteredTools.filter(isBuiltinTool).length} tools</span>
          </header>
          <div className="mcp-tool-list">
            {filteredTools.filter(isBuiltinTool).map(renderToolRow)}
            {filteredTools.filter(isBuiltinTool).length === 0 && <div className="mcp-empty-state mcp-empty-state--full"><Blocks size={16} /><span>No tools match your current filters</span></div>}
          </div>
        </section>
        {logListCard}
      </main>
    </div>
  );
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
  const [showLogs, setShowLogs] = useState(false);
  const [expandedToolSchemas, setExpandedToolSchemas] = useState<Set<string>>(new Set());

  async function refresh() {
    setLoading(true);
    try {
      const [serversResult, toolsResult, logsResult] = await Promise.all([listMcpServers(), listMcpTools(), listMcpLogs()]);
      if (!serversResult.ok) { setNotice(`Failed to load servers: ${serversResult.error.slice(0, 50)}`); console.error("Failed to load MCP servers:", serversResult.error); }
      else setServers(serversResult.data as Array<McpServer & { source?: string; mcpNative?: boolean }>);
      if (!toolsResult.ok) { setNotice(`Failed to load tools: ${toolsResult.error.slice(0, 50)}`); console.error("Failed to load MCP tools:", toolsResult.error); }
      else setTools(toolsResult.data as Array<McpTool & { source?: string; external?: boolean; mcpNative?: boolean }>);
      if (logsResult.ok) setLogs(logsResult.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setNotice(`Failed to load tool gateway data: ${message.slice(0, 60)}`);
      console.error("MCP UI refresh error:", err);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!isActive) return;
    void refresh();
    const interval = window.setInterval(() => { void listMcpLogs().then((result) => { if (result.ok) setLogs(result.data); }); }, 2500);
    return () => window.clearInterval(interval);
  }, [isActive]);

  const builtinServers = useMemo(() => servers.filter(isBuiltinServer), [servers]);
  const externalServers = useMemo(() => servers.filter(isExternalServer), [servers]);
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
      const same = previous && previous.tool === log.tool && previous.status === log.status && preview(previous.args, 100) === preview(log.args, 100) && preview(previous.result, 100) === preview(log.result, 100);
      if (same) { previous.count += 1; previous.durationMs = log.durationMs; }
      else groups.push({ ...log, count: 1 });
    }
    return groups;
  }, [logs]);

  const copyText = async (text: string, label = "copied") => { await navigator.clipboard?.writeText(text); setNotice(label); window.setTimeout(() => setNotice(""), 1400); };
  const testServer = async (server: McpServer) => {
    const tool = tools.find((entry) => entry.serverId === server.id && entry.enabled && isSafeAutoTestTool(entry));
    if (!tool) { setNotice("no safe enabled test tool"); return; }
    const args = sampleArgsForTool(tool);
    if (!args) { setNotice("tool needs manual args"); return; }
    setNotice("testing..."); setInspectTitle(`test ${server.id}`); setInspectBody(`calling ${tool.name}\nargs: ${JSON.stringify(args, null, 2)}`);
    try {
      const result = await callMcpTool(tool.name, args);
      setNotice("test ok"); setInspectBody(`tool: ${tool.name}\nstatus: ok\nargs:\n${JSON.stringify(args, null, 2)}\n\nresult:\n${result}`);
      void refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "test failed";
      setNotice(message.slice(0, 80));
      setInspectBody(`tool: ${tool.name}\nstatus: error\nargs:\n${JSON.stringify(args, null, 2)}\n\nerror:\n${message}`);
    }
  };
  const inspectServer = (server: McpServer) => {
    const serverTools = tools.filter((tool) => tool.serverId === server.id);
    setInspectTitle(`inspect ${server.id}`); setInspectBody(JSON.stringify({ server, tools: serverTools }, null, 2)); setInspectExpanded(true);
  };
  const testTool = async (tool: McpTool) => {
    const args = sampleArgsForTool(tool);
    if (!args) { setNotice("write/edit tools need manual args"); setInspectTitle(`test ${tool.name}`); setInspectBody("write/edit tools need manual args"); return; }
    setNotice("testing..."); setInspectTitle(`test ${tool.name}`); setInspectBody(`calling ${tool.name}\nargs: ${JSON.stringify(args, null, 2)}`);
    try {
      const result = await callMcpTool(tool.name, args);
      setNotice("test ok"); setInspectBody(`tool: ${tool.name}\nstatus: ok\nargs:\n${JSON.stringify(args, null, 2)}\n\nresult:\n${result}`);
      void refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "test failed";
      setNotice(message.slice(0, 80));
      setInspectBody(`tool: ${tool.name}\nstatus: error\nargs:\n${JSON.stringify(args, null, 2)}\n\nerror:\n${message}`);
    }
  };
  const toggleToolSchema = (toolName: string) => {
    setExpandedToolSchemas((prev) => { const next = new Set(prev); if (next.has(toolName)) next.delete(toolName); else next.add(toolName); return next; });
  };

  // Conditional render: mobile gets simplified layout, desktop gets full layout
  if (isPhone) {
    return <MobileMcpShell servers={servers} tools={tools} logs={logs} loading={loading} filter={filter} query={query}
      setFilter={setFilter} setQuery={setQuery} notice={notice} refresh={refresh} builtinServers={builtinServers}
      externalServers={externalServers} filteredBuiltinServers={filteredBuiltinServers} filteredExternalServers={filteredExternalServers}
      filteredTools={filteredTools} groupedLogs={groupedLogs} copyText={copyText} testServer={testServer} inspectServer={inspectServer}
      testTool={testTool} toggleToolSchema={toggleToolSchema} expandedToolSchemas={expandedToolSchemas} showLogs={showLogs}
      setShowLogs={setShowLogs} inspectTitle={inspectTitle} inspectBody={inspectBody} inspectExpanded={inspectExpanded}
      setInspectExpanded={setInspectExpanded} />;
  }

  return <DesktopMcpShell servers={servers} tools={tools} logs={logs} loading={loading} filter={filter} query={query}
    setFilter={setFilter} setQuery={setQuery} notice={notice} refresh={refresh} builtinServers={builtinServers}
    externalServers={externalServers} filteredBuiltinServers={filteredBuiltinServers} filteredExternalServers={filteredExternalServers}
    filteredTools={filteredTools} groupedLogs={groupedLogs} copyText={copyText} testServer={testServer} inspectServer={inspectServer}
    testTool={testTool} toggleToolSchema={toggleToolSchema} expandedToolSchemas={expandedToolSchemas} showLogs={showLogs}
    setShowLogs={setShowLogs} inspectTitle={inspectTitle} inspectBody={inspectBody} inspectExpanded={inspectExpanded}
    setInspectExpanded={setInspectExpanded} externalConfiguredCount={externalConfiguredCount} />;
}
