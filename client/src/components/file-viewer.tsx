"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import {
  Check,
  Copy,
  ChevronLeft,
  Ellipsis,
  FileCode,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  Pencil,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { toast } from "sonner";
import * as monaco from "monaco-editor";
import { getFileTypeLabel, getMonacoLanguageId } from "@/lib/file-routing";
import { fileApi } from "@/lib/file-api";

// Configure Monaco Editor web workers for Vite
// This fixes the "Could not create web worker(s)" error in development
if (typeof window !== "undefined") {
  (window as any).MonacoEnvironment = {
    getWorker(_: string, label: string) {
      if (label === "json") {
        return new Worker(new URL("monaco-editor/esm/vs/language/json/json.worker", import.meta.url), { type: "module" });
      }
      if (label === "css" || label === "scss" || label === "less") {
        return new Worker(new URL("monaco-editor/esm/vs/language/css/css.worker", import.meta.url), { type: "module" });
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new Worker(new URL("monaco-editor/esm/vs/language/html/html.worker", import.meta.url), { type: "module" });
      }
      if (label === "typescript" || label === "javascript") {
        return new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker", import.meta.url), { type: "module" });
      }
      return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker", import.meta.url), { type: "module" });
    },
  };
}

export interface ApiComponent {
  author?: string;
  name: string;
  version: string;
  files: Array<{
    path: string;
    type?: "file" | "dir";
    content?: string;
  }>;
}

interface TreeViewElement {
  id: string;
  name: string;
  type?: "file" | "dir";
  isSelectable?: boolean;
  children?: TreeViewElement[];
}

type ApiFileEntry = ApiComponent["files"][number];
interface TreeContextProps {
  selectedId: string | undefined;
  expandedItems: string[] | undefined;
  handleExpand: (id: string) => void;
  selectItem: (id: string) => void;
  setExpandedItems?: React.Dispatch<React.SetStateAction<string[] | undefined>>;
  indicator: boolean;
  openIcon?: React.ReactNode;
  closeIcon?: React.ReactNode;
  direction: "rtl" | "ltr";
}
const TreeContext = createContext<TreeContextProps | null>(null);
const useTree = () => {
  const context = useContext(TreeContext);
  if (!context) throw new Error("useTree must be used within a TreeProvider");
  return context;
};

const VIEWER_FONT_SIZE = 13;
const VIEWER_LINE_HEIGHT = 19;

function normalizeViewerPath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isLazyPreviewableTextFile(_filePath: string) {
  // Accept all file types for preview
  return true;
}

function mergeEntries(entries: ApiFileEntry[]) {
  const byPath = new Map<string, ApiFileEntry>();

  for (const rawEntry of entries) {
    const entry = {
      ...rawEntry,
      path: normalizeViewerPath(rawEntry.path),
    };
    const previous = byPath.get(entry.path);

    if (previous?.content !== undefined && entry.content === undefined) {
      byPath.set(entry.path, { ...entry, content: previous.content });
    } else {
      byPath.set(entry.path, previous ? { ...previous, ...entry } : entry);
    }
  }

  return [...byPath.values()];
}

function sortTreeItems(items: TreeViewElement[]) {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function collapseSingleFolderChains(item: TreeViewElement): TreeViewElement {
  let current: TreeViewElement = {
    ...item,
    children: item.children
      ? sortTreeItems(item.children.map(collapseSingleFolderChains))
      : undefined,
  };
  const names = [current.name];

  while (current.type === "dir" && current.children?.length === 1) {
    const child = current.children[0];
    if (child.type !== "dir") break;

    names.push(child.name);
    current = {
      ...child,
      name: names.join(" / "),
      children: child.children,
    };
  }

  return current;
}

function ScrollableMarquee({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    const textEl = textRef.current;
    if (!scrollEl || !textEl) return;

    const update = () => {
      const distance = Math.max(0, textEl.scrollWidth - scrollEl.clientWidth);
      scrollEl.style.setProperty("--marquee-distance", `${distance}px`);
      setOverflowing(distance > 2);
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(scrollEl);
    observer.observe(textEl);

    return () => observer.disconnect();
  }, [children]);

  const pause = () => {
    scrollRef.current?.setAttribute("data-marquee-paused", "true");
  };

  const resume = () => {
    window.setTimeout(() => {
      scrollRef.current?.removeAttribute("data-marquee-paused");
    }, 1200);
  };

  return (
    <span
      ref={scrollRef}
      className="file-tree-marquee"
      data-overflow={overflowing ? "true" : "false"}
      onPointerDown={pause}
      onPointerUp={resume}
      onPointerCancel={resume}
      onWheel={pause}
    >
      <span ref={textRef} className="file-tree-marquee__text">
        {children}
      </span>
    </span>
  );
}

// --- Monaco Editor Viewer ---
function MonacoViewer({
  code,
  filePath,
  onChange,
  onSave,
}: {
  code: string;
  filePath: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    async function init() {
      try {
        const monacoInstance = await import("monaco-editor");
        if (cancelled) return;
        
        monacoRef.current = monacoInstance.default || monacoInstance;

        const languageId = getMonacoLanguageId(filePath);
        
        // Load language support dynamically
        const LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = {
          cpp: () => import("monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js"),
          css: () => import("monaco-editor/esm/vs/language/css/monaco.contribution.js"),
          go: () => import("monaco-editor/esm/vs/basic-languages/go/go.contribution.js"),
          html: () => import("monaco-editor/esm/vs/language/html/monaco.contribution.js"),
          java: () => import("monaco-editor/esm/vs/basic-languages/java/java.contribution.js"),
          javascript: () => import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js"),
          json: () => import("monaco-editor/esm/vs/language/json/monaco.contribution.js"),
          markdown: () => import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js"),
          php: () => import("monaco-editor/esm/vs/basic-languages/php/php.contribution.js"),
          python: () => import("monaco-editor/esm/vs/basic-languages/python/python.contribution.js"),
          ruby: () => import("monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js"),
          rust: () => import("monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js"),
          shell: () => import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js"),
          sql: () => import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js"),
          typescript: () => import("monaco-editor/esm/vs/language/typescript/monaco.contribution.js"),
          xml: () => import("monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js"),
          yaml: () => import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js"),
        };

        const loadLanguage = LANGUAGE_LOADERS[languageId];
        if (loadLanguage) {
          await loadLanguage();
        }

        if (cancelled) return;

        // Define custom theme
        const isLight = document.documentElement.getAttribute("data-theme") === "light";
        const rootStyle = getComputedStyle(document.documentElement);
        const bgBase = rootStyle.getPropertyValue("--bg-base").trim() || (isLight ? "#ffffff" : "#0d1117");
        const fgBase = rootStyle.getPropertyValue("--fg-base").trim() || (isLight ? "#0f0f0f" : "#f5f5f3");
        const bgHighlight = rootStyle.getPropertyValue("--bg-highlight").trim() || (isLight ? "#ececf1" : "#161b22");
        const fgSubtle = rootStyle.getPropertyValue("--fg-subtle").trim() || (isLight ? "#848cb3" : "#6e7681");
        const accentCyan = rootStyle.getPropertyValue("--accent-cyan").trim() || (isLight ? "#0f4b6e" : "#7dcfff");

        monaco.editor.defineTheme("file-viewer-theme", {
          base: isLight ? "vs" : "vs-dark",
          inherit: true,
          rules: [],
          colors: {
            "editor.background": bgBase,
            "editor.foreground": fgBase,
            "editor.lineHighlightBackground": bgHighlight,
            "editorLineNumber.foreground": fgSubtle,
            "editorCursor.foreground": accentCyan,
          },
        });

        const editor = monaco.editor.create(container as HTMLElement, {
          value: code,
          language: languageId === "plaintext" ? "plaintext" : languageId,
          theme: "file-viewer-theme",
          automaticLayout: true,
          readOnly: !onChange,
          minimap: { enabled: false },
          fontSize: VIEWER_FONT_SIZE,
          lineHeight: VIEWER_LINE_HEIGHT,
          lineNumbersMinChars: 2,
          lineDecorationsWidth: 0,
          glyphMargin: false,
          scrollBeyondLastLine: false,
          scrollbar: {
            verticalScrollbarSize: 0,
            horizontalScrollbarSize: 0,
            useShadows: false,
          },
          padding: { top: 8, bottom: 8 },
          renderWhitespace: "selection",
          smoothScrolling: true,
          tabSize: 2,
          insertSpaces: true,
          wordWrap: "on",
        });

        editorRef.current = editor;

        editor.onDidChangeModelContent(() => {
          onChangeRef.current?.(editor.getValue());
        });

        editor.addCommand(
          monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
          () => onSaveRef.current?.()
        );
      } catch (error) {
        console.error("Failed to initialize Monaco editor:", error);
      }
    }

    void init();

    return () => {
      cancelled = true;
      editorRef.current?.dispose();
      editorRef.current = null;
      monacoRef.current = null;
    };
  }, [filePath]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !onChange });
  }, [onChange]);

  // Update content when code changes
  useEffect(() => {
    if (editorRef.current && code !== editorRef.current.getValue()) {
      editorRef.current.setValue(code);
    }
  }, [code]);

  return (
    <div className="w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

function useIsCompactFileViewer() {
  const getIsCompact = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 640px)").matches;

  const [isCompact, setIsCompact] = useState(getIsCompact);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const query = window.matchMedia("(max-width: 640px)");
    const handleChange = () => setIsCompact(query.matches);

    handleChange();
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return isCompact;
}

// --- File Header ---
function FileHeader({
  file,
  onCopy,
  copied,
  onToggleTree,
  isTreeOpen = false,
  onEdit,
  onSave,
  onRevert,
  isDirty = false,
  isSaving = false,
}: {
  file: { path: string; content?: string };
  onCopy: () => void;
  copied: boolean;
  onToggleTree?: () => void;
  isTreeOpen?: boolean;
  onEdit?: () => void;
  onSave?: () => void;
  onRevert?: () => void;
  isDirty?: boolean;
  isSaving?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  const runMenuAction = (action?: () => void) => {
    setMenuOpen(false);
    action?.();
  };

  return (
    <div className="file-viewer-header flex items-center justify-between px-2.5 py-1 border-b">
      <div className="flex items-center gap-1.5 min-w-0">
        {onToggleTree && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleTree}
            className="file-viewer-tree-toggle file-viewer-action h-7 w-7 p-0"
            aria-label={isTreeOpen ? "close file tree" : "open file tree"}
            aria-expanded={isTreeOpen}
            title={isTreeOpen ? "close files" : "files"}
          >
            {isTreeOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <FolderOpenIcon className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        <Badge variant="outline" className="file-viewer-type-badge text-xs">
          {getFileTypeLabel(file.path)}
        </Badge>
        <span className="file-viewer-path text-xs truncate">
          {file.path}
        </span>
        {isDirty && (
          <span
            className="file-viewer-dirty-dot"
            aria-label="unsaved changes"
            title="unsaved changes"
          />
        )}
      </div>
      <div className="file-viewer-actions flex gap-1">
        {onSave && isDirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onSave}
            disabled={isSaving}
            className="file-viewer-action h-7 w-7 p-0"
            title="save"
          >
            <Save className="h-3 w-3" />
          </Button>
        )}
        <div className="file-viewer-menu" ref={menuRef}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMenuOpen((open) => !open)}
            className="file-viewer-action h-7 w-7 p-0"
            aria-label="file actions"
            aria-expanded={menuOpen}
            title="file actions"
          >
            <Ellipsis className="h-3 w-3" />
          </Button>
          {menuOpen && (
            <div className="file-viewer-menu-popover" role="menu">
              {onEdit && (
                <button
                  type="button"
                  className="file-viewer-menu-item"
                  role="menuitem"
                  onClick={() => runMenuAction(onEdit)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>edit</span>
                </button>
              )}
              {onSave && (
                <button
                  type="button"
                  className="file-viewer-menu-item"
                  role="menuitem"
                  onClick={() => runMenuAction(onSave)}
                  disabled={!isDirty || isSaving}
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{isSaving ? "saving" : "save"}</span>
                </button>
              )}
              <button
                type="button"
                className="file-viewer-menu-item"
                role="menuitem"
                onClick={() => runMenuAction(onCopy)}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? "copied" : "copy"}</span>
              </button>
              {onRevert && (
                <button
                  type="button"
                  className="file-viewer-menu-item"
                  role="menuitem"
                  onClick={() => runMenuAction(onRevert)}
                  disabled={!isDirty || isSaving}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>revert</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- File Tree ---
function TreeIndicator({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "file-tree-indicator absolute h-full w-px transition-colors",
        className
      )}
      {...props}
    />
  );
}
function Folder({
  element,
  value,
  isSelectable = true,
  isSelect,
  children,
  className,
  onOpen,
}: {
  element: string;
  value: string;
  isSelectable?: boolean;
  isSelect?: boolean;
  children: React.ReactNode;
  className?: string;
  onOpen?: (value: string) => void;
}) {
  const {
    handleExpand,
    expandedItems,
    indicator,
    openIcon,
    closeIcon,
  } = useTree();
  return (
    <AccordionPrimitive.Item
      value={value}
      className="relative h-full overflow-hidden"
    >
      <AccordionPrimitive.Trigger
        className={cn(
          "file-tree-row flex items-center gap-1 rounded-md text-[13px] px-2 py-1 cursor-pointer",
          isSelect && isSelectable && "file-tree-row--selected",
          !isSelectable && "opacity-50 cursor-not-allowed",
          className
        )}
        disabled={!isSelectable}
        onClick={() => {
          handleExpand(value);
          onOpen?.(value);
        }}
      >
        {expandedItems?.includes(value)
          ? openIcon ?? <FolderOpenIcon className="h-4 w-4" />
          : closeIcon ?? <FolderIcon className="h-4 w-4" />}
        <ScrollableMarquee>{element}</ScrollableMarquee>
      </AccordionPrimitive.Trigger>
      <AccordionPrimitive.Content className="relative h-full overflow-hidden text-[13px]">
        {indicator && <TreeIndicator />}
        <AccordionPrimitive.Root
          type="multiple"
          className={cn(
            "ml-3 flex flex-col gap-0.5 py-0.5"
          )}
          value={expandedItems}
        >
          {children}
        </AccordionPrimitive.Root>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
}
function File({
  value,
  isSelectable = true,
  isSelect,
  fileIcon,
  children,
  className,
  onClick,
}: {
  value: string;
  isSelectable?: boolean;
  isSelect?: boolean;
  fileIcon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const { selectedId, selectItem } = useTree();
  const isSelected = isSelect ?? selectedId === value;
  return (
    <button
      disabled={!isSelectable}
      className={cn(
        "file-tree-row flex w-fit items-center gap-1 rounded-md px-2 py-1 text-[13px] transition-colors cursor-pointer",
        isSelected && isSelectable && "file-tree-row--selected",
        !isSelectable
          ? "opacity-50 cursor-not-allowed"
          : "",
        className
      )}
      onClick={() => {
        selectItem(value);
        onClick?.();
      }}
    >
      {fileIcon ?? <FileIcon className="h-4 w-4" />}
      <ScrollableMarquee>{children}</ScrollableMarquee>
    </button>
  );
}
function Tree({
  initialSelectedId,
  initialExpandedItems,
  children,
  className,
  indicator = true,
  openIcon,
  closeIcon,
  dir = "ltr",
}: {
  initialSelectedId?: string;
  initialExpandedItems?: string[];
  children: React.ReactNode;
  className?: string;
  indicator?: boolean;
  openIcon?: React.ReactNode;
  closeIcon?: React.ReactNode;
  dir?: "rtl" | "ltr";
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialSelectedId
  );
  const [expandedItems, setExpandedItems] = useState<string[] | undefined>(
    initialExpandedItems
  );
  const selectItem = useCallback((id: string) => setSelectedId(id), []);
  const handleExpand = useCallback((id: string) => {
    setExpandedItems((prev) => {
      if (prev?.includes(id)) return prev.filter((item) => item !== id);
      return [...(prev ?? []), id];
    });
  }, []);
  return (
    <TreeContext.Provider
      value={{
        selectedId,
        expandedItems,
        handleExpand,
        selectItem,
        setExpandedItems,
        indicator,
        openIcon,
        closeIcon,
        direction: dir,
      }}
    >
      <div className={cn("size-full", className)}>
        <div className="relative h-full px-2">
          <AccordionPrimitive.Root
            type="multiple"
            value={expandedItems}
            className="flex flex-col gap-1"
          >
            {children}
          </AccordionPrimitive.Root>
        </div>
      </div>
    </TreeContext.Provider>
  );
}
function TreeItem({
  item,
  selectedFile,
  onFileSelect,
  onFolderOpen,
}: {
  item: TreeViewElement;
  selectedFile?: string;
  onFileSelect: (file: string) => void;
  onFolderOpen: (folder: string) => void;
}) {
  if (item.type === "dir" || item.children?.length) {
    return (
      <Folder
        key={item.id}
        element={item.name}
        value={item.id}
        className="truncate"
        onOpen={onFolderOpen}
      >
        {(item.children ?? []).map((child) => (
          <TreeItem
            key={child.id}
            item={child}
            selectedFile={selectedFile}
            onFileSelect={onFileSelect}
            onFolderOpen={onFolderOpen}
          />
        ))}
      </Folder>
    );
  }
  return (
    <File
      key={item.id}
      value={item.id}
      onClick={() => onFileSelect(item.id)}
      isSelectable={true}
      isSelect={selectedFile === item.id}
      className="truncate whitespace-nowrap"
    >
      {item.name}
    </File>
  );
}
function FileTree({
  tree,
  selectedFile,
  onFileSelect,
  onFolderOpen,
  component,
  onCloseTree,
}: {
  tree: TreeViewElement[];
  selectedFile?: string;
  onFileSelect: (file: string) => void;
  onFolderOpen: (folder: string) => void;
  component: ApiComponent;
  onCloseTree?: () => void;
}) {
  const initialExpandedItems = useMemo(() => {
    const targetPath = selectedFile ?? component.files[0]?.path;
    if (!targetPath) return [];

    const normalized = targetPath.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const expanded: string[] = [];

    for (let i = 1; i < parts.length; i += 1) {
      expanded.push(parts.slice(0, i).join("/"));
    }

    return expanded;
  }, [component.files, selectedFile]);
  const treeKey = useMemo(
    () => initialExpandedItems.join("\u0000") || "root",
    [initialExpandedItems]
  );
  return (
    <div className="file-viewer-tree w-full h-full min-h-0 border-r flex flex-col">
      <div className="file-viewer-tree-header px-3 py-2 border-b flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileCode className="h-3.5 w-3.5" />
          <span className="text-[13px] font-medium">{component.name} {component.version}</span>
        </div>
        {onCloseTree && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCloseTree}
            className="file-viewer-tree-close file-viewer-action h-7 w-7 p-0"
            aria-label="close file tree"
            title="close files"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="file-viewer-tree-scroll flex-1 min-h-0">
        <div className="p-2">
          <Tree
            key={treeKey}
            initialExpandedItems={initialExpandedItems}
            initialSelectedId={selectedFile}
            indicator
          >
            {tree.map((item) => (
              <TreeItem
                key={item.id}
                item={item}
                selectedFile={selectedFile}
                onFileSelect={onFileSelect}
                onFolderOpen={onFolderOpen}
              />
            ))}
          </Tree>
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---
export default function ComponentFileViewer({
  component,
  initialSelectedFile,
}: {
  component: ApiComponent;
  initialSelectedFile?: string;
}) {
  const [selectedFile, setSelectedFile] = useState<string | undefined>(
    initialSelectedFile
  );
  const [copied, setCopied] = useState(false);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [savedContents, setSavedContents] = useState<Record<string, string>>({});
  const [dirtyPaths, setDirtyPaths] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [extraEntries, setExtraEntries] = useState<ApiFileEntry[]>([]);
  const [loadedDirs, setLoadedDirs] = useState<Record<string, boolean>>({});
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});
  const isCompact = useIsCompactFileViewer();
  const entries = useMemo(
    () => mergeEntries([...component.files, ...extraEntries]),
    [component.files, extraEntries]
  );
  const files = useMemo(
    () => entries.filter((f) => f.content !== undefined),
    [entries]
  );

  useEffect(() => {
    setExtraEntries([]);
    setLoadedDirs({});
    setLoadingDirs({});
  }, [component.files]);

  const loadFolderEntries = useCallback(async (folderPath: string) => {
    const normalizedFolderPath = normalizeViewerPath(folderPath);
    if (!normalizedFolderPath || loadedDirs[normalizedFolderPath] || loadingDirs[normalizedFolderPath]) return;

    setLoadingDirs((prev) => ({ ...prev, [normalizedFolderPath]: true }));

    try {
      const listing = await fileApi.list(`/${normalizedFolderPath}`);
      const nextEntries = listing.items.map((item) => ({
        path: normalizeViewerPath(item.path),
        type: item.type,
      }));

      setExtraEntries((prev) => mergeEntries([...prev, ...nextEntries]));
      setLoadedDirs((prev) => ({ ...prev, [normalizedFolderPath]: true }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "failed to load folder");
    } finally {
      setLoadingDirs((prev) => {
        const next = { ...prev };
        delete next[normalizedFolderPath];
        return next;
      });
    }
  }, [loadedDirs, loadingDirs]);

  // Build tree structure
  const tree = useMemo(() => {
    const root: Record<string, any> = {};
    for (const file of entries) {
      const parts = file.path.split("/").filter(Boolean);
      let current = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const id = parts.slice(0, i + 1).join("/");
        const isLeaf = i === parts.length - 1;
        if (!current[part]) {
          current[part] =
            isLeaf && file.type !== "dir"
              ? { ...file, id: file.path, name: part, type: "file", isSelectable: true }
              : {
                  id,
                  name: part,
                  type: "dir",
                  children: {},
                  isSelectable: false,
                };
        }
        current = current[part].children || current[part];
      }
    }
    const toArray = (obj: Record<string, any>): TreeViewElement[] =>
      sortTreeItems(
        Object.values(obj).map((item: any) =>
          item.children ? { ...item, children: toArray(item.children) } : item
        )
      );

    return toArray(root).map(collapseSingleFolderChains);
  }, [entries]);
  const firstFileEntry = entries.find((f) => f.type !== "dir");
  const selectedBase = entries.find((f) => f.path === selectedFile && f.type !== "dir")
    || files[0]
    || firstFileEntry;
  const selected = selectedBase
    ? selectedBase.content !== undefined
      ? {
          ...selectedBase,
          content: fileContents[selectedBase.path] ?? selectedBase.content,
        }
      : selectedBase
    : undefined;
  const selectedPath = selected?.path;
  const selectedContent = selected?.content ?? "";
  const selectedIsEditable = selected?.content !== undefined;
  const isDirty = selectedPath ? !!dirtyPaths[selectedPath] : false;

  useEffect(() => {
    if (!selectedPath || selectedIsEditable || !isLazyPreviewableTextFile(selectedPath)) return;

    let cancelled = false;

    async function loadSelectedContent() {
      try {
        const file = await fileApi.read(`/${selectedPath}`);
        if (cancelled) return;
        setExtraEntries((prev) => mergeEntries([
          ...prev,
          {
            path: normalizeViewerPath(file.path),
            type: "file",
            content: file.content.replace(/\r\n/g, "\n"),
          },
        ]));
      } catch {
        // Leave binary, large, or unreadable files visible but not editable.
      }
    }

    void loadSelectedContent();

    return () => {
      cancelled = true;
    };
  }, [selectedIsEditable, selectedPath]);

  useEffect(() => {
    const nextContents = Object.fromEntries(
      files.map((file) => [file.path, file.content ?? ""])
    );
    setFileContents(nextContents);
    setSavedContents(nextContents);
    setDirtyPaths({});
  }, [files]);

  useEffect(() => {
    const selectableEntries = entries.filter((entry) => entry.type !== "dir");

    if (selectableEntries.length === 0) {
      if (selectedFile) setSelectedFile(undefined);
      return;
    }

    const hasSelected = selectedFile
      ? selectableEntries.some((entry) => entry.path === selectedFile)
      : false;

    if (!hasSelected) {
      const fallback =
        initialSelectedFile && selectableEntries.some((entry) => entry.path === initialSelectedFile)
          ? initialSelectedFile
          : selectableEntries[0].path;
      setSelectedFile(fallback);
    }
  }, [entries, initialSelectedFile, selectedFile]);
  useEffect(() => {
    if (!isCompact) setMobileTreeOpen(false);
  }, [isCompact]);
  useEffect(() => {
    if (isCompact && !selected) setMobileTreeOpen(true);
  }, [isCompact, selected]);
  useEffect(() => {
    if (!isCompact) setMobileEditorOpen(false);
  }, [isCompact]);
  useEffect(() => {
    if (!mobileTreeOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileTreeOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileTreeOpen]);
  const handleSelectFile = useCallback(
    (filePath: string) => {
      setSelectedFile(filePath);
      if (isCompact) setMobileTreeOpen(false);
    },
    [isCompact]
  );
  const handleContentChange = useCallback(
    (value: string) => {
      if (!selectedPath) return;
      if (!selectedIsEditable) return;
      setFileContents((prev) => ({ ...prev, [selectedPath]: value }));
      setDirtyPaths((prev) => ({
        ...prev,
        [selectedPath]: value !== (savedContents[selectedPath] ?? ""),
      }));
    },
    [savedContents, selectedIsEditable, selectedPath]
  );
  const handleSave = useCallback(async () => {
    if (!selectedPath || !selectedIsEditable || isSaving) return;

    const content = fileContents[selectedPath] ?? "";
    setIsSaving(true);

    try {
      await fileApi.write(selectedPath, content);
      setSavedContents((prev) => ({ ...prev, [selectedPath]: content }));
      setDirtyPaths((prev) => ({ ...prev, [selectedPath]: false }));
      toast.success("file saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "failed to save file");
    } finally {
      setIsSaving(false);
    }
  }, [fileContents, isSaving, selectedIsEditable, selectedPath]);
  const handleRevert = useCallback(() => {
    if (!selectedPath || !selectedIsEditable) return;

    const saved = savedContents[selectedPath] ?? "";
    setFileContents((prev) => ({ ...prev, [selectedPath]: saved }));
    setDirtyPaths((prev) => ({ ...prev, [selectedPath]: false }));
  }, [savedContents, selectedIsEditable, selectedPath]);
  const handleCopy = () => {
    if (selected?.content) {
      navigator.clipboard.writeText(selected.content);
      setCopied(true);
      toast.success("File content copied");
      setTimeout(() => setCopied(false), 2000);
    }
  };
  const handleMobileEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void handleSave();
    }
  };

  if (isCompact) {
    return (
      <div
        className={cn(
          "component-file-viewer component-file-viewer--mobile h-full w-full border overflow-hidden",
          mobileTreeOpen && "component-file-viewer--tree-open"
        )}
      >
        <button
          type="button"
          className="file-viewer-mobile-backdrop"
          aria-label="close file tree"
          onClick={() => setMobileTreeOpen(false)}
        />
        <aside className="file-viewer-mobile-drawer" aria-hidden={!mobileTreeOpen}>
          <FileTree
            tree={tree}
            selectedFile={selectedFile}
            onFileSelect={handleSelectFile}
            onFolderOpen={loadFolderEntries}
            component={component}
            onCloseTree={() => setMobileTreeOpen(false)}
          />
        </aside>
        {selected && mobileEditorOpen && (
          <div className="file-viewer-mobile-edit">
            <div className="file-viewer-mobile-edit-header">
              <button
                type="button"
                className="file-viewer-mobile-edit-icon"
                onClick={() => setMobileEditorOpen(false)}
                aria-label="close editor"
                title="close"
              >
                <X className="h-5 w-5" />
              </button>
              <span className="file-viewer-mobile-edit-title">{selected.path}</span>
              <div className="file-viewer-mobile-edit-actions">
                <button
                  type="button"
                  className="file-viewer-mobile-edit-icon"
                  onClick={handleRevert}
                  disabled={!isDirty || isSaving}
                  aria-label="revert changes"
                  title="revert"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="file-viewer-mobile-edit-save"
                  onClick={handleSave}
                  disabled={!isDirty || isSaving}
                >
                  {isSaving ? "saving" : "save"}
                </button>
              </div>
            </div>
            <textarea
              className="file-viewer-mobile-textarea"
              value={selectedContent}
              onChange={(event) => handleContentChange(event.currentTarget.value)}
              onKeyDown={handleMobileEditorKeyDown}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
        )}
        <section className="file-viewer-mobile-editor">
          {selected ? (
            <>
              <FileHeader
                file={selected}
                onCopy={handleCopy}
                copied={copied}
                onToggleTree={() => setMobileTreeOpen((open) => !open)}
                isTreeOpen={mobileTreeOpen}
                onEdit={selectedIsEditable ? () => {
                  setMobileTreeOpen(false);
                  setMobileEditorOpen(true);
                } : undefined}
                onSave={selectedIsEditable ? handleSave : undefined}
                onRevert={selectedIsEditable ? handleRevert : undefined}
                isDirty={isDirty}
                isSaving={isSaving}
              />
              <div className="flex-1 overflow-hidden">
                {selectedIsEditable ? (
                  <MonacoViewer
                    code={selectedContent}
                    filePath={selected.path}
                  />
                ) : (
                  <div className="viewer-state">
                    <span>preview unavailable for this file</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="viewer-state">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMobileTreeOpen(true)}
                className="file-viewer-tree-toggle file-viewer-action"
              >
                files
              </Button>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="component-file-viewer h-full w-full border overflow-hidden"
    >
      <ResizablePanel
        defaultSize="280px"
        minSize="210px"
        maxSize="460px"
        groupResizeBehavior="preserve-pixel-size"
      >
        <FileTree
          tree={tree}
          selectedFile={selectedFile}
          onFileSelect={handleSelectFile}
          onFolderOpen={loadFolderEntries}
          component={component}
        />
      </ResizablePanel>
      <ResizableHandle className="file-viewer-separator" />
      <ResizablePanel minSize="40%">
        {selected ? (
          <div className="h-full flex flex-col">
            <FileHeader
              file={selected}
              onCopy={handleCopy}
              copied={copied}
              onSave={selectedIsEditable ? handleSave : undefined}
              onRevert={selectedIsEditable ? handleRevert : undefined}
              isDirty={isDirty}
              isSaving={isSaving}
            />
            <div className="flex-1 overflow-hidden">
              {selectedIsEditable ? (
                <MonacoViewer
                  code={selectedContent}
                  filePath={selected.path}
                  onChange={handleContentChange}
                  onSave={handleSave}
                />
              ) : (
                <div className="viewer-state">
                  <span>preview unavailable for this file</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="viewer-state">
            <span>select a file from the tree</span>
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
