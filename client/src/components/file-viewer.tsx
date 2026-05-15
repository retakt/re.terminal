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

export interface ApiComponent {
  author?: string;
  name: string;
  version: string;
  files: Array<{
    path: string;
    content?: string;
  }>;
}

interface TreeViewElement {
  id: string;
  name: string;
  isSelectable?: boolean;
  children?: TreeViewElement[];
}
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
}: {
  element: string;
  value: string;
  isSelectable?: boolean;
  isSelect?: boolean;
  children: React.ReactNode;
  className?: string;
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
        onClick={() => handleExpand(value)}
      >
        {expandedItems?.includes(value)
          ? openIcon ?? <FolderOpenIcon className="h-4 w-4" />
          : closeIcon ?? <FolderIcon className="h-4 w-4" />}
        <span className="truncate">{element}</span>
      </AccordionPrimitive.Trigger>
      <AccordionPrimitive.Content className="relative h-full overflow-hidden text-[13px]">
        {indicator && <TreeIndicator />}
        <AccordionPrimitive.Root
          type="multiple"
          className={cn(
            "ml-5 flex flex-col gap-1 py-1"
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
      <span className="truncate">{children}</span>
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
}: {
  item: TreeViewElement;
  selectedFile?: string;
  onFileSelect: (file: string) => void;
}) {
  if (item.children?.length) {
    return (
      <Folder
        key={item.id}
        element={item.name}
        value={item.id}
        className="truncate"
      >
        {item.children.map((child) => (
          <TreeItem
            key={child.id}
            item={child}
            selectedFile={selectedFile}
            onFileSelect={onFileSelect}
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
  component,
  onCloseTree,
}: {
  tree: TreeViewElement[];
  selectedFile?: string;
  onFileSelect: (file: string) => void;
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
  const isCompact = useIsCompactFileViewer();
  const files = useMemo(
    () => component.files.filter((f) => f.content !== undefined),
    [component.files]
  );
  // Build tree structure
  const tree = useMemo(() => {
    const root: Record<string, any> = {};
    for (const file of files) {
      const parts = file.path.split("/");
      let current = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!current[part]) {
          current[part] =
            i === parts.length - 1
              ? { ...file, id: file.path, name: part, isSelectable: true }
              : {
                  id: parts.slice(0, i + 1).join("/"),
                  name: part,
                  children: {},
                  isSelectable: false,
                };
        }
        current = current[part].children || current[part];
      }
    }
    const toArray = (obj: Record<string, any>): TreeViewElement[] =>
      Object.values(obj).map((item: any) =>
        item.children ? { ...item, children: toArray(item.children) } : item
      );
    return toArray(root);
  }, [files]);
  const selectedBase = files.find((f) => f.path === selectedFile) || files[0];
  const selected = selectedBase
    ? {
        ...selectedBase,
        content: fileContents[selectedBase.path] ?? selectedBase.content ?? "",
      }
    : undefined;
  const selectedPath = selected?.path;
  const selectedContent = selected?.content ?? "";
  const isDirty = selectedPath ? !!dirtyPaths[selectedPath] : false;

  useEffect(() => {
    const nextContents = Object.fromEntries(
      files.map((file) => [file.path, file.content ?? ""])
    );
    setFileContents(nextContents);
    setSavedContents(nextContents);
    setDirtyPaths({});
  }, [files]);

  useEffect(() => {
    if (files.length === 0) {
      if (selectedFile) setSelectedFile(undefined);
      return;
    }

    const hasSelected = selectedFile
      ? files.some((file) => file.path === selectedFile)
      : false;

    if (!hasSelected) {
      const fallback =
        initialSelectedFile && files.some((file) => file.path === initialSelectedFile)
          ? initialSelectedFile
          : files[0].path;
      setSelectedFile(fallback);
    }
  }, [files, initialSelectedFile, selectedFile]);
  useEffect(() => {
    if (!isCompact) setMobileTreeOpen(false);
  }, [isCompact]);
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
      setFileContents((prev) => ({ ...prev, [selectedPath]: value }));
      setDirtyPaths((prev) => ({
        ...prev,
        [selectedPath]: value !== (savedContents[selectedPath] ?? ""),
      }));
    },
    [savedContents, selectedPath]
  );
  const handleSave = useCallback(async () => {
    if (!selectedPath || isSaving) return;

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
  }, [fileContents, isSaving, selectedPath]);
  const handleRevert = useCallback(() => {
    if (!selectedPath) return;

    const saved = savedContents[selectedPath] ?? "";
    setFileContents((prev) => ({ ...prev, [selectedPath]: saved }));
    setDirtyPaths((prev) => ({ ...prev, [selectedPath]: false }));
  }, [savedContents, selectedPath]);
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
          {selected && (
            <>
              <FileHeader
                file={selected}
                onCopy={handleCopy}
                copied={copied}
                onToggleTree={() => setMobileTreeOpen((open) => !open)}
                isTreeOpen={mobileTreeOpen}
                onEdit={() => {
                  setMobileTreeOpen(false);
                  setMobileEditorOpen(true);
                }}
                onSave={handleSave}
                onRevert={handleRevert}
                isDirty={isDirty}
                isSaving={isSaving}
              />
              <div className="flex-1 overflow-hidden">
                <MonacoViewer
                  code={selectedContent}
                  filePath={selected.path}
                />
              </div>
            </>
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
      <ResizablePanel defaultSize="220px" minSize="150px" maxSize="300px">
        <FileTree
          tree={tree}
          selectedFile={selectedFile}
          onFileSelect={handleSelectFile}
          component={component}
        />
      </ResizablePanel>
      <ResizableHandle className="file-viewer-separator" />
      <ResizablePanel minSize="40%">
        {selected && (
          <div className="h-full flex flex-col">
            <FileHeader
              file={selected}
              onCopy={handleCopy}
              copied={copied}
              onSave={handleSave}
              onRevert={handleRevert}
              isDirty={isDirty}
              isSaving={isSaving}
            />
            <div className="flex-1 overflow-hidden">
              <MonacoViewer
                code={selectedContent}
                filePath={selected.path}
                onChange={handleContentChange}
                onSave={handleSave}
              />
            </div>
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
