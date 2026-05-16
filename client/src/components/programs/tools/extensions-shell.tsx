import { FileJson, FolderOpen, ShieldCheck } from "lucide-react";

const details = [
  { label: "manifest", value: "mv3" },
  { label: "mode", value: "local" },
  { label: "target", value: "chrome" },
];

export function ExtensionsShell() {
  return (
    <div className="program-shell tool-compact-page extension-page">
      <main className="tool-compact-body extension-page__body">
        <section className="tool-compact-card">
          <div className="tool-card-title">
            <FileJson size={14} />
            <h2>extension</h2>
          </div>
          <div className="tool-detail-list">
            {details.map(item => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="tool-compact-card">
          <div className="tool-card-title">
            <FolderOpen size={14} />
            <h2>install</h2>
          </div>
          <div className="tool-check-list">
            <span>load unpacked</span>
            <span>reload after build</span>
            <span>check permissions</span>
          </div>
        </section>

        <section className="tool-compact-note">
          <ShieldCheck size={14} />
          <span>backend and native bridge can be added later.</span>
        </section>
      </main>
    </div>
  );
}
