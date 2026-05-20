import { useEffect, useMemo, useState } from "react";
import {
  Clipboard,
  ExternalLink,
  FileJson,
  Puzzle,
  Search,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import {
  listBrowserExtensions,
  listExtensionCatalog,
  updateBrowserExtensionEnabled,
  type BrowserExtension,
  type ExtensionCatalogItem,
} from "@/chat/api/mcp";

const FILTERS = ["all", "enabled", "site skills", "catalog", "risky"] as const;
type CatalogFilter = typeof FILTERS[number];

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname.length > 18 ? `${parsed.pathname.slice(0, 18)}...` : parsed.pathname}`;
  } catch {
    return url.length > 34 ? `${url.slice(0, 31)}...` : url;
  }
}

function riskClass(risk: string) {
  return `extension-risk extension-risk--${risk || "low"}`;
}

function extensionCopySummary(extension: BrowserExtension) {
  return {
    name: extension.name,
    enabled: extension.enabled,
    type: extension.type,
    domains: extension.domains,
    actions: extension.actions.map((action) => ({
      label: action.label,
      requiresConfirmation: action.requiresConfirmation,
    })),
    protectedActionCount: extension.dangerousActions.length,
  };
}

export function ExtensionsShell() {
  const [extensions, setExtensions] = useState<BrowserExtension[]>([]);
  const [catalogItems, setCatalogItems] = useState<ExtensionCatalogItem[]>([]);
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  const refresh = async () => {
    const [dynamicExtensions, staticCatalog] = await Promise.all([
      listBrowserExtensions(),
      listExtensionCatalog(),
    ]);

    setExtensions(dynamicExtensions);
    setCatalogItems(staticCatalog);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filteredExtensions = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return extensions.filter((extension) => {
      const haystack = [
        extension.id,
        extension.name,
        extension.type,
        extension.source,
        extension.domains.join(" "),
        extension.permissions.join(" "),
        extension.dangerousActions.join(" "),
        extension.actions.map((action) => action.label).join(" "),
      ].join(" ").toLowerCase();

      if (needle && !haystack.includes(needle)) return false;
      if (filter === "enabled") return extension.enabled;
      if (filter === "site skills") return extension.type === "site_skill_extension";
      if (filter === "risky") return extension.dangerousActions.length > 0;
      if (filter === "catalog") return false;
      return true;
    });
  }, [extensions, filter, query]);

  const filteredCatalog = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return catalogItems.filter((item) => {
      const haystack = `${item.name} ${item.type} ${item.target} ${item.risk} ${item.source} ${item.description}`.toLowerCase();
      if (needle && !haystack.includes(needle)) return false;
      if (filter === "catalog" || filter === "all") return true;
      return false;
    });
  }, [catalogItems, filter, query]);

  const copyText = async (text: string, label = "copied") => {
    await navigator.clipboard?.writeText(text);
    setNotice(label);
    window.setTimeout(() => setNotice(""), 1400);
  };

  const toggleExtension = async (extension: BrowserExtension) => {
    setBusyId(extension.id);
    try {
      const updated = await updateBrowserExtensionEnabled(extension.id, !extension.enabled);
      if (updated) {
        setExtensions((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
        setNotice(updated.enabled ? "extension enabled" : "extension disabled");
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "extension update failed");
    } finally {
      setBusyId("");
      window.setTimeout(() => setNotice(""), 1800);
    }
  };

  return (
    <div className="program-shell tool-compact-page extension-page">
      <main className="tool-compact-body extension-page__body extension-catalog">
        <section className="tool-compact-card tool-compact-card--wide">
          <div className="tool-card-title">
            <Puzzle size={14} />
            <h2>extensions</h2>
            {notice && <span className="tool-card-title__note">{notice}</span>}
            <button type="button" className="catalog-filter-chip" onClick={() => void refresh()}>
              refresh
            </button>
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
                placeholder="search extensions"
              />
            </label>
          </div>

          <div className="extension-catalog-grid">
            {filteredExtensions.map((extension) => (
              <article key={extension.id} className="extension-catalog-card">
                <header>
                  <strong>{extension.name}</strong>
                  <button
                    type="button"
                    className={riskClass(extension.enabled ? "low" : "medium")}
                    disabled={busyId === extension.id}
                    onClick={() => void toggleExtension(extension)}
                    title={extension.enabled ? "Disable this extension for browser-agent routing" : "Enable this extension"}
                  >
                    {busyId === extension.id ? "saving" : extension.enabled ? "enabled" : "disabled"}
                  </button>
                </header>

                <p>{extension.description || `${extension.type} from ${extension.source || "site skill"}`}</p>

                <dl>
                  <div>
                    <dt>actions</dt>
                    <dd>{extension.actions.length}</dd>
                  </div>
                  <div>
                    <dt>domains</dt>
                    <dd>{extension.domains.join(", ") || "none"}</dd>
                  </div>
                  <div>
                    <dt>pages</dt>
                    <dd>{extension.pages.length ? `${extension.pages.length} observed` : "none"}</dd>
                  </div>
                  <div>
                    <dt>permissions</dt>
                    <dd>{extension.permissions.length ? `${extension.permissions.length} granted` : "none"}</dd>
                  </div>
                </dl>

                <div className="catalog-card-actions">
                  <button type="button" onClick={() => void copyText(JSON.stringify(extensionCopySummary(extension), null, 2), "summary copied")}>
                    <Clipboard size={11} />
                    summary
                  </button>
                  <button type="button" onClick={() => void copyText(extension.actions.map((action) => action.label).join("\n"), "actions copied")}>
                    <TerminalSquare size={11} />
                    actions
                  </button>
                </div>

                <div className="tool-compact-note">
                  <ShieldCheck size={13} />
                  <span>
                    {extension.dangerousActions.length
                      ? `${extension.dangerousActions.length} protected actions hidden; exact confirmation required before use`
                      : "no risky actions marked"}
                  </span>
                </div>

                <div className="extension-action-list">
                  {extension.actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="catalog-filter-chip"
                      title={action.requiresConfirmation ? "Requires explicit confirmation" : action.label}
                      onClick={() => void copyText(
                        JSON.stringify({
                          name: "mcp__extensions__plan_action",
                          args: {
                            extensionId: extension.id,
                            label: action.label,
                          },
                        }, null, 2),
                        "plan copied"
                      )}
                    >
                      {action.label}
                      {action.requiresConfirmation ? " · confirm" : ""}
                    </button>
                  ))}
                </div>
              </article>
            ))}

            {filteredExtensions.length === 0 && filter !== "catalog" && (
              <article className="extension-catalog-card">
                <header>
                  <strong>no enabled extensions found</strong>
                  <span className="extension-risk extension-risk--medium">empty</span>
                </header>
                <p>Check that /api/extensions returns your site-skill extensions.</p>
              </article>
            )}
          </div>
        </section>

        {(filter === "all" || filter === "catalog") && (
          <section className="tool-compact-card tool-compact-card--wide">
            <div className="tool-card-title">
              <FileJson size={14} />
              <h2>catalog</h2>
            </div>

            <div className="extension-catalog-grid">
              {filteredCatalog.map((item) => (
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
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="tool-compact-note">
          <ShieldCheck size={14} />
          <span>Extension actions are planned through MCP first. Risky actions require explicit confirmation.</span>
        </section>
      </main>
    </div>
  );
}
