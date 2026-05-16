import { FileTerminal, ScrollText } from "lucide-react";

const scripts = [
  { name: "health-check.sh", group: "system" },
  { name: "ai-tools-status.sh", group: "status" },
  { name: "check-all-services.sh", group: "ai" },
  { name: "deploy.sh", group: "root" },
];

export function ScriptsShell() {
  return (
    <div className="program-shell tool-compact-page scripts-page">
      <main className="tool-compact-body scripts-page__body">
        <section className="tool-compact-card">
          <div className="tool-card-title">
            <FileTerminal size={14} />
            <h2>library</h2>
          </div>
          <div className="tool-table-list">
            {scripts.map(script => (
              <div key={script.name} className="tool-table-row">
                <span>{script.group}</span>
                <strong>{script.name}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="tool-compact-card scripts-output-card">
          <div className="tool-card-title">
            <ScrollText size={14} />
            <h2>output</h2>
          </div>
          <pre className="scripts-output"><code>$ no script selected</code></pre>
        </section>
      </main>
    </div>
  );
}
