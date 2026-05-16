import * as React from "react";
import ComponentFileViewer, { type ApiComponent } from "@/components/ui/file-viewer";
import { fileApi } from "@/lib/file-api";
import { getBaseName } from "@/lib/file-routing";
import { AlertCircle, Loader2 } from "lucide-react";
import { useApp, type Page } from "@/contexts/app-context";

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

async function collectEntries(dir: string): Promise<ApiComponent["files"]> {
  let listing;
  try {
    listing = await fileApi.list(dir);
  } catch {
    return [];
  }

  const items = [...listing.items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return items.map((item) => ({
    path: normalizePath(item.path),
    type: item.type,
  }));
}

async function collectAncestorEntries(filePath: string): Promise<ApiComponent["files"]> {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  const dirs: string[] = [];

  for (let i = 1; i < parts.length; i += 1) {
    dirs.push(parts.slice(0, i).join("/"));
  }

  const entries: ApiComponent["files"] = [];

  for (const dir of dirs) {
    const children = await collectEntries(`/${dir}`);
    entries.push(...children);
  }

  return entries;
}

export function FilesPageViewer({
  dir,
  selectedPath,
}: {
  dir: string;
  selectedPath?: string;
}) {
  const { pages, activePageId } = useApp();
  const [component, setComponent] = React.useState<ApiComponent | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const activeSelectedPath = React.useMemo(() => {
    const page = pages.find((p): p is Extract<Page, { filePath: string }> =>
      p.id === activePageId &&
      (p.type === "editor" || p.type === "image" || p.type === "pdf" || p.type === "spreadsheet" || p.type === "doc")
    );
    return page?.filePath;
  }, [activePageId, pages]);

  const effectiveSelectedPath = selectedPath ?? activeSelectedPath;
  const normalizedSelectedPath = React.useMemo(
    () => (effectiveSelectedPath ? normalizePath(effectiveSelectedPath) : undefined),
    [effectiveSelectedPath]
  );

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setComponent(null);

      try {
        const files = await collectEntries(dir);
        const selectedPathInTree = normalizedSelectedPath
          ? files.some((entry) => entry.path === normalizedSelectedPath)
          : true;

        if (normalizedSelectedPath && !selectedPathInTree) {
          files.push(...await collectAncestorEntries(normalizedSelectedPath));
        }

        if (cancelled) return;
        setComponent({
          author: "re.Term",
          name: getBaseName(dir) || "files",
          version: "1.0.4",
          files,
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "failed to load file viewer");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [dir, normalizedSelectedPath]);

  if (loading) {
    return (
      <div className="viewer-state">
        <Loader2 size={18} className="reterm-spin" />
        <span>loading file viewer…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="viewer-state viewer-state--error">
        <AlertCircle size={18} />
        <span>{error}</span>
      </div>
    );
  }

  if (!component) return null;

  return <ComponentFileViewer component={component} initialSelectedFile={normalizedSelectedPath} />;
}
