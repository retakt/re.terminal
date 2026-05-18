import { useEffect, useMemo, useState } from "react";
import { Clipboard, ExternalLink, FileJson, FolderOpen, Search, ShieldCheck, Stethoscope, TerminalSquare } from "lucide-react";
import { listExtensionCatalog, type ExtensionCatalogItem } from "@/chat/api/mcp";

const FILTERS = ["all", "mcp", "tools", "browser", "high risk", "enabled", "disabled"] as const;
type CatalogFilter = typeof FILTERS[number];

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname.length > 18 ? `${parsed.pathname.slice(0, 18)}...` : parsed.pathname}`;
  } catch {
    return url.length > 34 ? `${url.slice(0, 31)}...` : url;
  }
}

function itemEnabled(item: ExtensionCatalogItem) {
  return item.target.toLowerCase() === "mcp" || item.type.toLowerCase() === "mcp";
}

export function ExtensionsShell() {
  const [items, setItems] = useState<ExtensionCatalogItem[]>([]);
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void listExtensionCatalog().then(setItems);
  }, []);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const haystack = `${item.name} ${item.type} ${item.target} ${item.risk} ${item.source} ${item.description}`.toLowerCase();
      if (needle && !haystack.includes(needle)) return false;
      if (filter === "all") return true;
      if (filter === "mcp") return item.type.toLowerCase().includes("mcp") || item.target.toLowerCase() === "mcp";
      if (filter === "tools") return item.type.toLowerCase().includes("tool") || item.type.toLowerCase().includes("function");
      if (filter === "browser") return item.type.toLowerCase().includes("browser");
      if (filter === "high risk") return item.risk.toLowerCase() === "high";
      if (filter === "enabled") return itemEnabled(item);
      if (filter === "disabled") return !itemEnabled(item);
      return true;
    });
  }, [filter, items, query]);

  const copyText = async (text: string, label = "copied") => {
    await navigator.clipboard?.writeText(text);
    setNotice(label);
    window.setTimeout(() => setNotice(""), 1400);
  };

  return (
    <div className="program-shell tool-compact-page extension-page">
      <main className="tool-compact-body extension-page__body extension-catalog">
        <section className="tool-compact-card tool-compact-card--wide">
          <div className="tool-card-title">
            <FileJson size={14} />
            <h2>catalog</h2>
            {notice && <span className="tool-card-title__note">{notice}</span>}
          </div>
          <div className="catalog-filter-bar">
            <div className="catalog-filter-chips">
              {FILTERS.map((entry) => (
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
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="search catalog"
              />
            </label>
          </div>
          <div className="extension-catalog-grid">
            {filteredItems.map((item) => (
              <article key={`${item.type}-${item.name}`} className="extension-catalog-card">
                <header>
                  <strong>{item.name}</strong>
                  <span className={`extension-risk extension-risk--${item.risk}`}>{item.risk}</span>
                </header>
                <p>{item.description}</p>
                <dl>
                  <div>
                    <dt>type</dt>
                    <dd>{item.type}</dd>
                  </div>
                  <div>
                    <dt>belongs</dt>
                    <dd>{item.target}</dd>
                  </div>
                </dl>
                <div className="catalog-url-row">
                  <a href={item.source} target="_blank" rel="noreferrer" title={item.source}>
                    <ExternalLink size={11} />
                    {shortUrl(item.source)}
                  </a>
                  <button type="button" onClick={() => void copyText(item.source, "url copied")} title="Copy URL">
                    <Clipboard size={11} />
                  </button>
                </div>
                <div className="catalog-card-actions">
                  <a href={item.source} target="_blank" rel="noreferrer">
                    <ExternalLink size={11} />
                    docs
                  </a>
                  <button type="button" onClick={() => void copyText(JSON.stringify(item, null, 2), "config copied")}>
                    <Clipboard size={11} />
                    copy
                  </button>
                  <button type="button" onClick={() => setNotice("test placeholder")}>
                    <Stethoscope size={11} />
                    test
                  </button>
                  <button type="button" onClick={() => setNotice(`${item.type} / ${item.target} / ${item.risk}`)}>
                    <TerminalSquare size={11} />
                    inspect
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="tool-compact-note">
          <ShieldCheck size={14} />
          <span>catalog only: OpenWebUI functions and browser bridges are not executed in v1.</span>
        </section>

        <section className="tool-compact-note">
          <FolderOpen size={14} />
          <span>MCP servers stay on the MCP page; extension import comes after the tool gateway is stable.</span>
        </section>
      </main>
    </div>
  );
}
