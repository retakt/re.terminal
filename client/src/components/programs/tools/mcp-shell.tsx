import { useEffect, useMemo, useState } from "react";
import { Blocks, Clipboard, ExternalLink, ListTree, PlugZap, RefreshCcw, Search, ScrollText, ServerCog, Stethoscope, TerminalSquare } from "lucide-react";
import { callMcpTool, listMcpLogs, listMcpServers, listMcpTools, type McpLog, type McpServer, type McpTool } from "@/chat/api/mcp";
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

export function McpShell({ isActive = true }: { isActive?: boolean }) {
  const isPhone = useIsPhoneLayout();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [logs, setLogs] = useState<McpLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [inspectTitle, setInspectTitle] = useState("inspect");
  const [inspectBody, setInspectBody] = useState("select inspect or run a test to view raw MCP data.");

  async function refresh() {
    setLoading(true);
    try {
      const [nextServers, nextTools, nextLogs] = await Promise.all([
        listMcpServers(),
        listMcpTools(),
        listMcpLogs(),
      ]);
      setServers(nextServers);
      setTools(nextTools);
      setLogs(nextLogs);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isActive) return;
    void refresh();
    const interval = window.setInterval(() => void listMcpLogs().then(setLogs), 2500);
    return () => window.clearInterval(interval);
  }, [isActive]);

  const readyCount = useMemo(() => servers.filter((server) => server.status === "ready").length, [servers]);
  const filteredServers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return servers.filter((server) => {
      const haystack = `${server.id} ${server.title} ${server.type} ${server.transport} ${server.status} ${server.description}`.toLowerCase();
      if (needle && !haystack.includes(needle)) return false;
      if (filter === "enabled") return server.enabled;
      if (filter === "disabled") return !server.enabled;
      if (filter === "mcp") return true;
      if (filter === "browser") return /browser|lightpanda/.test(haystack);
      if (filter === "high risk") return server.type === "remote";
      return true;
    });
  }, [filter, query, servers]);
  const filteredTools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tools.filter((tool) => {
      const haystack = `${tool.name} ${tool.serverId} ${tool.serverTitle} ${tool.description}`.toLowerCase();
      if (needle && !haystack.includes(needle)) return false;
      if (filter === "enabled") return tool.enabled;
      if (filter === "disabled") return !tool.enabled;
      if (filter === "browser") return /browser|lightpanda/.test(haystack);
      if (filter === "tools" || filter === "all" || filter === "mcp") return true;
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

  const toolListCard = (
    <section className="tool-compact-card mcp-list-card">
      <div className="tool-card-title">
        <ListTree size={14} />
        <h2>tools</h2>
      </div>
      <div className="mcp-tool-list">
        {filteredTools.map((tool) => (
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

  return (
    <div className="program-shell tool-compact-page mcp-page">
      <main className="tool-compact-body mcp-dashboard">
        <section className="tool-compact-card tool-compact-card--wide mcp-toolbar">
          <div className="tool-card-title">
            <PlugZap size={14} />
            <h2>mcp gateway</h2>
            {notice && <span className="tool-card-title__note">{notice}</span>}
          </div>
          <div className="mcp-toolbar__stats">
            <span>{readyCount}/{servers.length} servers ready</span>
            <span>{tools.filter((tool) => tool.enabled).length} enabled tools</span>
            <button type="button" className="mcp-icon-button" onClick={() => void refresh()} title="Refresh MCP gateway">
              <RefreshCcw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </section>

        <section className="tool-compact-card tool-compact-card--wide">
          <div className="tool-card-title">
            <ServerCog size={14} />
            <h2>servers</h2>
          </div>
          <div className="catalog-filter-bar">
            <div className="catalog-filter-chips">
              {["all", "mcp", "tools", "browser", "high risk", "enabled", "disabled"].map((entry) => (
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
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="search mcp" />
            </label>
          </div>
          <div className="mcp-server-grid">
            {filteredServers.map((server) => (
              <article key={server.id} className={`mcp-server-card mcp-server-card--${server.status} ${!server.enabled ? "is-disabled" : ""}`}>
                <header>
                  <strong>{server.title}</strong>
                  <span className={`mcp-pill mcp-pill--${server.status}`}>{statusLabel(server)}</span>
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
                  <button type="button" onClick={() => void testServer(server)}>
                    <Stethoscope size={11} />
                    test
                  </button>
                  <button type="button" onClick={() => inspectServer(server)}>
                    <TerminalSquare size={11} />
                    inspect
                  </button>
                  <button type="button" onClick={() => window.open("https://modelcontextprotocol.io/docs/learn/server-concepts", "_blank", "noopener,noreferrer")}>
                    <ExternalLink size={11} />
                    docs
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="tool-compact-card tool-compact-card--wide mcp-inspect-card">
          <div className="tool-card-title">
            <TerminalSquare size={14} />
            <h2>{inspectTitle}</h2>
          </div>
          <pre>{inspectBody}</pre>
        </section>

        {isPhone ? (
          <div className="mcp-stacked-row">
            {logListCard}
            {toolListCard}
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
