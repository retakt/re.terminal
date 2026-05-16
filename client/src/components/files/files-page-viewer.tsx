import * as React from "react";
import ComponentFileViewer, { type ApiComponent } from "@/components/ui/file-viewer";
import { fileApi } from "@/lib/file-api";
import { getBaseName, getFileExtension } from "@/lib/file-routing";
import { AlertCircle, Loader2 } from "lucide-react";
import { useApp, type Page } from "@/contexts/app-context";

const PREVIEWABLE_EXTS = new Set([
  "c", "cc", "cpp", "cxx", "h", "hpp",
  "css", "csv", "gitignore", "gitattributes",
  "go", "htm", "html", "ini", "java", "js", "jsx",
  "json", "jsonc", "less", "md", "markdown",
  "mjs", "cjs", "php", "py", "rb", "rs", "scss",
  "sh", "bash", "zsh", "fish", "sql", "toml",
  "ts", "tsx", "txt", "xml", "yaml", "yml",
  "dockerfile", "makefile", "env", "lock",
]);

const MAX_DEPTH = 4;
const MAX_FILES = 180;

function isPreviewableTextFile(filePath: string) {
  const base = getBaseName(filePath).toLowerCase();
  const ext = getFileExtension(filePath).toLowerCase();

  if (PREVIEWABLE_EXTS.has(ext)) return true;
  return ["readme", "license", "changelog", "makefile", "dockerfile", ".env"].includes(base);
}

async function collectFiles(dir: string, depth = 0, acc: ApiComponent["files"] = []): Promise<ApiComponent["files"]> {
  if (depth > MAX_DEPTH || acc.length >= MAX_FILES) return acc;

  let listing;
  try {
    listing = await fileApi.list(dir);
  } catch {
    return acc;
  }

  const items = [...listing.items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of items) {
    if (acc.length >= MAX_FILES) break;

    if (item.type === "dir") {
      await collectFiles(item.path, depth + 1, acc);
      continue;
    }

    if (!isPreviewableTextFile(item.path)) continue;

    try {
      const file = await fileApi.read(item.path);
      acc.push({
        path: item.path.replace(/^\/+/, ""),
        content: file.content.replace(/\r\n/g, "\n"),
      });
    } catch {
      // Skip unreadable files and keep the viewer responsive.
    }
  }

  return acc;
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

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setComponent(null);

      try {
        const files = await collectFiles(dir);
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
  }, [dir]);

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

  return <ComponentFileViewer component={component} initialSelectedFile={effectiveSelectedPath} />;
}
