import { Blocks, ListTree, PlugZap } from "lucide-react";

const servers = [
  { name: "local", state: "ready" },
  { name: "remote", state: "later" },
  { name: "env", state: "pending" },
];

export function McpShell() {
  return (
    <div className="program-shell tool-compact-page mcp-page">
      <main className="tool-compact-body">
        <section className="tool-compact-card">
          <div className="tool-card-title">
            <Blocks size={14} />
            <h2>servers</h2>
          </div>
          <div className="tool-table-list">
            {servers.map(server => (
              <div key={server.name} className="tool-table-row">
                <span>{server.name}</span>
                <strong>{server.state}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="tool-compact-card">
          <div className="tool-card-title">
            <ListTree size={14} />
            <h2>tools</h2>
          </div>
          <div className="tool-check-list">
            <span>list tools</span>
            <span>resources</span>
            <span>logs</span>
          </div>
        </section>

        <section className="tool-compact-note">
          <PlugZap size={14} />
          <span>terminal and workflow bridge comes after backend wiring.</span>
        </section>
      </main>
    </div>
  );
}
