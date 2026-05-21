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
} from "lucide-react";
import {
  callMcpTool,
  listMcpLogs,
  listMcpServers,
  listMcpTools,
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

// ============ SHARED COMPONENTS ============

// Activity Logs - SINGLE compact component, near top
function ActivityLogsCompact({
  logs,
  groupedLogs,
  showLogs,
  setShowLogs,
}: {
  logs: McpLog[];
  groupedLogs: Array<McpLog & { count: number }>;
  showLogs: boolean;
  setShowLogs: (s: boolean) => void;
}) {
  return (
    <section className="tool-compact-card tool-compact-card--wide mcp-logs-card">
      <button
        type="button"
        className="mcp-logs-header"
        onClick={() => setShowLogs(!showLogs)}
      >
        <div className="mcp-logs-header-left">
          <ScrollText size={12} />
          <span>Activity Logs</span>
          {logs.length > 0 && <span className="mcp-logs-count">· {logs.length} entries</span>}
        </div>
        {showLogs ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {showLogs && (
        <div className="mcp-log-list">
          {logs.length === 0 ? (
            <div className="mcp-empty-row">No activity yet</div>
          ) : (
            groupedLogs.slice(0, 5).map((log) => (
              <article key={log.id} className={`mcp-log-row mcp-log-row--${log.status}`}>
                <div className="mcp-log-row-header">
                  <span className="mcp-log-tool-name">{log.tool}</span>
                  <span className="mcp-log-meta">
                    {log.durationMs}ms · {log.status === "complete" ? "success" : log.status}
                    {log.count > 1 && ` ×${log.count}`}
                  </span>
                </div>
                <code className="mcp-log-preview">{preview(log.args, 80)}</code>
              </article>
            ))
          )}
          {logs.length > 5 && (
            <div className="mcp-log-note">showing latest 5 logs. use terminal for full history.</div>
          )}
        </div>
      )}
    </section>
  );
}

// ============ MOBILE COMPONENT ============
function MobileMcpShell({
  tools, logs, loading, filter, query, setFilter, setQuery, notice, refresh,
  builtinServers, externalServers, filteredBuiltinServers, filteredExternalServers,
  filteredTools, groupedLogs, copyText, inspectServer, testTool,
  inspectTitle, inspectBody, inspectExpanded, setInspectExpanded, setInspectTitle, setInspectBody,
  developerActions,
}: {
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
  inspectServer: (server: McpServer) => void;
  testTool: (tool: McpTool) => Promise<void>;
  inspectTitle: string; inspectBody: string; inspectExpanded: boolean; setInspectExpanded: (e: boolean) => void;
  setInspectTitle: (title: string) => void; setInspectBody: (body: string) => void;
  developerActions: boolean;
}) {
  const builtinReadyCount = builtinServers.filter((s) => s.status === "ready").length;
  const builtinToolCount = tools.filter((t) => isBuiltinTool(t) && t.enabled).length;

  const [mobileLogsOpen, setMobileLogsOpen] = useState(false);
  const [mobileToolsExpanded, setMobileToolsExpanded] = useState(false);
  const visibleMobileTools = mobileToolsExpanded
    ? filteredTools.filter(isBuiltinTool)
    : filteredTools.filter(isBuiltinTool).slice(0, 5);

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

        {/* Activity Logs - Compact, Near Top (SINGLE component) */}
        <ActivityLogsCompact
          logs={logs}
          groupedLogs={groupedLogs}
          showLogs={mobileLogsOpen}
          setShowLogs={setMobileLogsOpen}
        />

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
                  <span className={`mcp-status-pill mcp-status-pill--${server.status === "ready" ? "ready" : "needs-config"}`} title={
  "lastError" in server && typeof server.lastError === "string"
    ? `Error: ${server.lastError}`
    : undefined
}>
                    {server.connected ? "connected" : server.status === "needs_config" ? "configured" : server.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Available Tools - Collapsible, 5 items by default */}
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
                    onClick={() => { setInspectTitle(`inspect ${tool.name}`); setInspectBody(JSON.stringify(tool, null, 2)); setInspectExpanded(true); }}
                    title="Inspect"><TerminalSquare size={11} /></button>
                  {developerActions && (
                    <>
                      <button type="button" className="mcp-icon-btn mcp-icon-btn--mobile"
                        onClick={() => void copyText(tool.name, "tool name copied")} title="Copy name">
                        <Clipboard size={11} />
                      </button>
                      {isSafeAutoTestTool(tool) && (
                        <button type="button" className="mcp-icon-btn mcp-icon-btn--mobile mcp-icon-btn--test"
                          onClick={() => void testTool(tool)} title="Test"><Stethoscope size={11} /></button>
                      )}
                    </>
                  )}
                </div>
              </article>
            ))}
            {filteredTools.filter(isBuiltinTool).length === 0 && <div className="mcp-empty-row">No tools match filters</div>}
            {filteredTools.filter(isBuiltinTool).length > 5 && !mobileToolsExpanded && (
              <button type="button" className="mcp-show-more-tools" onClick={() => setMobileToolsExpanded(true)}>
                Show all {filteredTools.filter(isBuiltinTool).length} tools
              </button>
            )}
            {mobileToolsExpanded && filteredTools.filter(isBuiltinTool).length > 5 && (
              <button type="button" className="mcp-show-less-tools" onClick={() => setMobileToolsExpanded(false)}>
                Show less
              </button>
            )}
          </div>
        </section>

        {/* Inspect - Modal/Bottom Sheet, HIDDEN BY DEFAULT */}
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
  showLogs, setShowLogs,
  inspectTitle, inspectBody, inspectExpanded, setInspectExpanded, setInspectTitle, setInspectBody,
  developerActions, setDeveloperActions,
  expandedTools,
  setExpandedTools,
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
  showLogs: boolean; setShowLogs: (s: boolean) => void;
  inspectTitle: string; inspectBody: string; inspectExpanded: boolean; setInspectExpanded: (e: boolean) => void;
  setInspectTitle: (title: string) => void; setInspectBody: (body: string) => void;
  developerActions: boolean; setDeveloperActions: (d: boolean) => void;
  expandedTools: boolean;
  setExpandedTools: (e: boolean) => void;
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
          <button type="button" className="mcp-action-btn" onClick={() => inspectServer(server)} title="Inspect details">
            <TerminalSquare size={14} /><span>Inspect</span>
          </button>
          {developerActions && (
            <>
              <button type="button" className="mcp-action-btn" onClick={() => void copyText(server.id, "server id copied")} title="Copy id">
                <Clipboard size={14} /><span>Copy</span>
              </button>
              <button type="button" className="mcp-action-btn" onClick={() => void testServer(server)} title="Test a safe tool from this group">
                <Stethoscope size={14} /><span>Test</span>
              </button>
            </>
          )}
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
              <button type="button" className="mcp-action-btn" onClick={() => inspectServer(server)} title="Inspect details">
                <TerminalSquare size={14} /><span>Inspect</span>
              </button>
              {developerActions && (
                <>
                  <button type="button" className="mcp-action-btn" onClick={() => void copyText(server.id, "server id copied")} title="Copy id">
                    <Clipboard size={14} /><span>Copy</span>
                  </button>
                  <button type="button" className="mcp-action-btn" onClick={() => void testServer(server)} title="Test a safe tool from this server">
                    <Stethoscope size={14} /><span>Test</span>
                  </button>
                </>
              )}
            </>
          )}
          {!server.enabled && <span className="mcp-pill mcp-pill--disabled">disabled</span>}
        </div>
      </article>
    );
  }

  function renderToolRow(tool: McpTool) {
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
        <div className="mcp-tool-actions">
          <button type="button" className="mcp-action-btn mcp-action-btn--small" onClick={() => { setInspectTitle(`inspect ${tool.name}`); setInspectBody(JSON.stringify(tool, null, 2)); setInspectExpanded(true); }} title="Inspect tool"><TerminalSquare size={12} /></button>
          {developerActions && (
            <>
              <button type="button" className="mcp-action-btn mcp-action-btn--small" onClick={() => void copyText(tool.name, "tool name copied")} title="Copy name"><Clipboard size={12} /></button>
              {isSafeAutoTestTool(tool) && <button type="button" className="mcp-action-btn mcp-action-btn--small mcp-action-btn--test" onClick={() => void testTool(tool)} title="Test tool"><Stethoscope size={12} /></button>}
            </>
          )}
        </div>
      </article>
    );
  }

  const builtinReadyCount = builtinServers.filter((s) => s.status === "ready").length;
  const builtinToolCount = tools.filter((t) => isBuiltinTool(t) && t.enabled).length;
  const externalConnectedCount = externalServers.filter((s) => s.status === "ready").length;

  return (
    <div className="program-shell tool-compact-page mcp-page">
      <main className="tool-compact-body mcp-dashboard">
        {/* Header - Matches Chat/Logs/Files style */}
        <header className="log-toolbar">
          <div className="log-toolbar-left">
            <PlugZap size={14} className="log-icon" />
            <span className="log-toolbar-title">tool gateway</span>
            {notice && <span className="log-status log-info">{notice}</span>}
          </div>
          <div className="log-toolbar-right">
            <span className="log-status log-muted">
              {builtinReadyCount} groups · {builtinToolCount} tools · {externalConnectedCount} external
            </span>
            <label className="log-btn" title="Developer actions" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', width: 'auto', padding: '0 6px', fontSize: '10px' }}>
              <span>Dev</span>
              <input type="checkbox" checked={developerActions} onChange={(e) => setDeveloperActions(e.target.checked)} style={{ accentColor: 'var(--accent-blue)', cursor: 'pointer' }} />
            </label>
            <button type="button" className="log-btn" onClick={() => void refresh()} title="Refresh" aria-label="Refresh data">
              <RefreshCcw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </header>

        {/* Filters */}
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

        {/* Activity Logs - Compact, Near Top (SINGLE component) */}
        <ActivityLogsCompact
          logs={logs}
          groupedLogs={groupedLogs}
          showLogs={showLogs}
          setShowLogs={setShowLogs}
        />

        {/* Builtin Tool Groups */}
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

        {/* External MCP Servers */}
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

        {servers.length === 0 && tools.length === 0 && !loading && !notice && (
          <section className="tool-compact-card tool-compact-card--wide">
            <div className="mcp-empty-state mcp-empty-state--full"><Blocks size={16} /><span>No tool gateway data loaded. This usually means the backend is not running, not restarted, or /api/mcp/servers failed.</span></div>
          </section>
        )}

        {/* Available Tools - Collapsible, 5 items by default */}
        <section className="tool-compact-card tool-compact-card--wide mcp-section">
          <header className="mcp-section-header">
            <button type="button" className="mcp-section-title-expand" onClick={() => setExpandedTools(!expandedTools)} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', width: '100%', justifyContent: 'space-between' }}>
              <div className="mcp-section-title"><ListTree size={14} /><h2>Available Tools</h2></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="mcp-section-count">{filteredTools.filter(isBuiltinTool).length} tools</span>
                {expandedTools ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>
          </header>
          <div className="mcp-tool-list">
            {(expandedTools ? filteredTools.filter(isBuiltinTool) : filteredTools.filter(isBuiltinTool).slice(0, 5)).map(renderToolRow)}
            {filteredTools.filter(isBuiltinTool).length === 0 && <div className="mcp-empty-state mcp-empty-state--full"><Blocks size={16} /><span>No tools match your current filters</span></div>}
            {!expandedTools && filteredTools.filter(isBuiltinTool).length > 5 && (
              <button type="button" className="mcp-show-more-tools" onClick={() => setExpandedTools(true)}>
                Show all {filteredTools.filter(isBuiltinTool).length} tools
              </button>
            )}
            {expandedTools && filteredTools.filter(isBuiltinTool).length > 5 && (
              <button type="button" className="mcp-show-less-tools" onClick={() => setExpandedTools(false)}>
                Show less
              </button>
            )}
          </div>
        </section>

        {/* Inspect Details - HIDDEN BY DEFAULT, only shown when selected */}
        {(inspectTitle !== "inspect" && inspectExpanded) && (
          <section className="tool-compact-card tool-compact-card--wide mcp-inspect-card">
            <header className="mcp-inspect-header">
              <div className="mcp-inspect-title"><TerminalSquare size={14} /><h2>{inspectTitle}</h2></div>
            </header>
            <pre className="mcp-inspect-content">{inspectBody}</pre>
          </section>
        )}


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
  const [inspectExpanded, setInspectExpanded] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [expandedTools, setExpandedTools] = useState(false);

  const [developerActions, setDeveloperActions] = useState(false);

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
    // Check if tool has required args - don't auto-test with {}
    const inputSchema = tool.inputSchema as any;
    if (inputSchema?.required?.length) {
      // Check for known tools that need prefill
      let args: Record<string, unknown> | null = null;
      if (tool.name === "mcp__ops__external_mcp_refresh" || tool.name === "mcp__ops__external_mcp_tools") {
        args = { serverId: "playwright" };
      }
      if (!args) {
        const missing = inputSchema.required.join(", ");
        setNotice(`Missing required argument: ${missing}`);
        setInspectTitle(`test ${tool.name}`);
        setInspectBody(`tool: ${tool.name}\nstatus: needs args\nmissing: ${missing}\n\nuse Inspect to see full schema`);
        return;
      }
      // Use prefilled args
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
      return;
    }
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
  
  if (isPhone) {
    return <MobileMcpShell tools={tools} logs={logs} loading={loading} filter={filter} query={query}
      setFilter={setFilter} setQuery={setQuery} notice={notice} refresh={refresh} builtinServers={builtinServers}
      externalServers={externalServers} filteredBuiltinServers={filteredBuiltinServers} filteredExternalServers={filteredExternalServers}
      filteredTools={filteredTools} groupedLogs={groupedLogs} copyText={copyText} inspectServer={inspectServer}
      testTool={testTool} inspectTitle={inspectTitle} inspectBody={inspectBody} inspectExpanded={inspectExpanded}
      setInspectExpanded={setInspectExpanded} setInspectTitle={setInspectTitle} setInspectBody={setInspectBody}
      developerActions={developerActions} />;
  }

  return <DesktopMcpShell servers={servers} tools={tools} logs={logs} loading={loading} filter={filter} query={query}
    setFilter={setFilter} setQuery={setQuery} notice={notice} refresh={refresh} builtinServers={builtinServers}
    externalServers={externalServers} filteredBuiltinServers={filteredBuiltinServers} filteredExternalServers={filteredExternalServers}
    filteredTools={filteredTools} groupedLogs={groupedLogs} copyText={copyText} testServer={testServer} inspectServer={inspectServer}
    testTool={testTool} showLogs={showLogs}
    setShowLogs={setShowLogs} inspectTitle={inspectTitle} inspectBody={inspectBody}
    inspectExpanded={inspectExpanded}
    setInspectExpanded={setInspectExpanded} setInspectTitle={setInspectTitle} setInspectBody={setInspectBody}
    developerActions={developerActions} setDeveloperActions={setDeveloperActions}
    expandedTools={expandedTools}
    setExpandedTools={setExpandedTools} />;
}
