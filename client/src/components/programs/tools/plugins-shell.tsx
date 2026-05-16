import { Plug } from "lucide-react";

const plugins = [
  { name: "terminal tools", state: "enabled" },
  { name: "file actions", state: "draft" },
  { name: "workflow nodes", state: "later" },
];

export function PluginsShell() {
  return (
    <div className="program-shell tool-compact-page plugins-page">
      <main className="tool-compact-body">
        <section className="tool-compact-card tool-compact-card--wide">
          <div className="tool-card-title">
            <Plug size={14} />
            <h2>local plugins</h2>
          </div>
          <div className="tool-table-list">
          {plugins.map(plugin => (
            <div key={plugin.name} className="tool-table-row">
              <span>{plugin.name}</span>
              <strong>{plugin.state}</strong>
              </div>
          ))}
          </div>
        </section>
      </main>
    </div>
  );
}
