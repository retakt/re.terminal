/**
 * FileBrowser — terminal-style tree explorer.
 * No icons. Folders = yellow, files = default.
 * Chevron only for expand/collapse indicator.
 */

import * as React from "react";
import { ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { fileApi, type FileEntry } from "@/lib/file-api";
import { useApp } from "@/contexts/app-context";

interface TreeNode {
  entry:    FileEntry;
  depth:    number;
  expanded: boolean;
  loading?: boolean;
}

interface Props {
  pageId: string;
  dir:    string;
}

export function FileBrowser({ pageId, dir }: Props) {
  const { openEditor, openPath, updateDir } = useApp();

  const [rootDir,  setRootDir]  = React.useState(dir);
  const [nodes,    setNodes]    = React.useState<TreeNode[]>([]);
  const [loading,  setLoading]  = React.useState(true);
  const [error,    setError]    = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);

  const loadRoot = React.useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fileApi.list(path);
      setNodes(res.items.map(e => ({ entry: e, depth: 0, expanded: false })));
      setRootDir(path);
      updateDir(pageId, path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [pageId, updateDir]);

  React.useEffect(() => { loadRoot(dir); }, [dir, loadRoot]);

  const toggleDir = React.useCallback(async (node: TreeNode) => {
    if (node.entry.type !== "dir") return;

    if (node.expanded) {
      // Collapse — remove children
      setNodes(prev => {
        const idx = prev.findIndex(n => n.entry.path === node.entry.path);
        if (idx === -1) return prev;
        const next = [...prev];
        let end = idx + 1;
        while (end < next.length && next[end].depth > node.depth) end++;
        next.splice(idx + 1, end - idx - 1);
        next[idx] = { ...node, expanded: false };
        return next;
      });
    } else {
      // Mark loading
      setNodes(prev => {
        const idx = prev.findIndex(n => n.entry.path === node.entry.path);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...node, loading: true };
        return next;
      });
      try {
        const res = await fileApi.list(node.entry.path);
        const children: TreeNode[] = res.items.map(e => ({
          entry: e, depth: node.depth + 1, expanded: false,
        }));
        setNodes(prev => {
          const idx = prev.findIndex(n => n.entry.path === node.entry.path);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { ...node, expanded: true, loading: false };
          next.splice(idx + 1, 0, ...children);
          return next;
        });
      } catch {
        setNodes(prev => {
          const idx = prev.findIndex(n => n.entry.path === node.entry.path);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { ...node, loading: false };
          return next;
        });
      }
    }
  }, []);

  const handleClick = (node: TreeNode) => {
    setSelected(node.entry.path);
    if (node.entry.type === "dir") {
      toggleDir(node);
    } else {
      openPath(node.entry.path);
    }
  };

  const handleNewFile = async (parentPath?: string) => {
    const name = prompt("file name:");
    if (!name) return;
    const base = parentPath || rootDir;
    const filePath = `${base}/${name}`.replace(/\/+/g, "/");
    try {
      await fileApi.write(filePath, "");
      loadRoot(rootDir);
      openEditor(filePath, name);
    } catch (err) {
      alert(err instanceof Error ? err.message : "create failed");
    }
  };

  const handleNewDir = async (parentPath?: string) => {
    const name = prompt("folder name:");
    if (!name) return;
    const base = parentPath || rootDir;
    const dirPath = `${base}/${name}`.replace(/\/+/g, "/");
    try {
      await fileApi.mkdir(dirPath);
      loadRoot(rootDir);
    } catch (err) {
      alert(err instanceof Error ? err.message : "mkdir failed");
    }
  };

  const handleDelete = async (e: React.MouseEvent, node: TreeNode) => {
    e.stopPropagation();
    if (!confirm(`delete ${node.entry.name}?`)) return;
    try {
      await fileApi.delete(node.entry.path);
      loadRoot(rootDir);
    } catch (err) {
      alert(err instanceof Error ? err.message : "delete failed");
    }
  };

  const rootName = rootDir.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "/";

  return (
    <div className="fb-root">
      {/* Header bar */}
      <div className="fb-header">
        <span className="fb-header-title">explorer</span>
        <div className="fb-header-actions">
          <button className="fb-hbtn" onClick={() => handleNewFile()} title="new file">+f</button>
          <button className="fb-hbtn" onClick={() => handleNewDir()}  title="new folder">+d</button>
          <button className="fb-hbtn" onClick={() => loadRoot(rootDir)} title="refresh">↺</button>
        </div>
      </div>

      {/* Root label */}
      <div className="fb-root-row">
        <ChevronDown size={11} style={{ opacity: 0.4, flexShrink: 0 }} />
        <span className="fb-root-name">{rootName}</span>
      </div>

      {/* Tree */}
      <div className="fb-tree">
        {loading && (
          <div className="fb-msg">
            <Loader2 size={12} className="reterm-spin" style={{ marginRight: 6 }} />
            loading…
          </div>
        )}
        {error && <div className="fb-msg fb-msg--error">{error}</div>}
        {!loading && !error && nodes.length === 0 && (
          <div className="fb-msg">empty</div>
        )}

        {nodes.map(node => {
          const isDir      = node.entry.type === "dir";
          const isSelected = selected === node.entry.path;
          // 12px per depth level + 8px base
          const indent     = node.depth * 14 + 8;

          return (
            <div
              key={node.entry.path}
              className={`fb-node ${isSelected ? "fb-node--selected" : ""} ${isDir ? "fb-node--dir" : "fb-node--file"}`}
              style={{ paddingLeft: indent }}
              onClick={() => handleClick(node)}
              title={node.entry.path}
            >
              {/* Chevron for dirs, space for files */}
              <span className="fb-node-chevron">
                {isDir
                  ? node.loading
                    ? <Loader2 size={10} className="reterm-spin" />
                    : node.expanded
                      ? <ChevronDown  size={10} />
                      : <ChevronRight size={10} />
                  : null
                }
              </span>

              {/* Name — yellow for dirs, muted for files */}
              <span className="fb-node-name">{node.entry.name}</span>

              {/* Hover actions */}
              <span className="fb-node-actions" onClick={e => e.stopPropagation()}>
                {isDir && (
                  <>
                    <button
                      className="fb-abtn"
                      onClick={() => handleNewFile(node.entry.path)}
                      title="new file here"
                    >+f</button>
                    <button
                      className="fb-abtn"
                      onClick={() => handleNewDir(node.entry.path)}
                      title="new folder here"
                    >+d</button>
                  </>
                )}
                <button
                  className="fb-abtn fb-abtn--del"
                  onClick={e => handleDelete(e, node)}
                  title="delete"
                >✕</button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
