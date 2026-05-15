"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import {
  Check,
  Copy,
  ExternalLink,
  FileCode,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
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
import { getMonacoLanguageId } from "@/lib/file-routing";

export interface ApiComponent {
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

// --- Monaco Editor Viewer ---
function MonacoViewer({
  code,
  filePath,
  onChange,
}: {
  code: string;
  filePath: string;
  onChange?: (value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);

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
        monaco.editor.defineTheme("file-viewer-theme", {
          base: isLight ? "vs" : "vs-dark",
          inherit: true,
          rules: [],
          colors: {
            "editor.background": isLight ? "#ffffff" : "#1e1e1e",
            "editor.foreground": isLight ? "#0f0f0f" : "#d4d4d4",
            "editor.lineHighlightBackground": isLight ? "#ececf1" : "#2a2a2a",
            "editorLineNumber.foreground": isLight ? "#848cb3" : "#6e7681",
            "editorCursor.foreground": isLight ? "#0f0f0f" : "#aeafad",
          },
        });

        const editor = monaco.editor.create(container as HTMLElement, {
          value: code,
          language: languageId === "plaintext" ? "plaintext" : languageId,
          theme: "file-viewer-theme",
          automaticLayout: true,
          readOnly: !onChange,
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
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

        if (onChange) {
          editor.onDidChangeModelContent(() => {
            onChange(editor.getValue());
          });
        }
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

// --- File Header ---
function FileHeader({
  file,
  onCopy,
  copied,
}: {
  file: { path: string; content?: string };
  onCopy: () => void;
  copied: boolean;
}) {
  const getFileType = (filePath: string) => {
    if (filePath.endsWith(".tsx")) return "TSX";
    if (filePath.endsWith(".ts")) return "TS";
    if (filePath.endsWith(".js")) return "JS";
    if (filePath.endsWith(".jsx")) return "JSX";
    if (filePath.endsWith(".md")) return "MD";
    if (filePath.endsWith(".css")) return "CSS";
    if (filePath.endsWith(".json")) return "JSON";
    return "TXT";
  };
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b">
      <div className="flex items-center gap-2 min-w-0">
        <Badge variant="outline" className="text-xs">
          {getFileType(file.path)}
        </Badge>
        <span className="text-xs text-oklch(0.556 0 0) truncate dark:text-oklch(0.708 0 0)">
          {file.path}
        </span>
      </div>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopy}
          className="cursor-pointer h-8 w-8 p-0"
          title="Copy file content"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="h-8 w-8 p-0"
          title="View on GitHub"
        >
          <a
            href="https://21st.dev/bankkroll/file-viewer/default"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </Button>
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
        "absolute left-1.5 h-full w-px rounded-md bg-oklch(0.97 0 0) py-3 transition-colors hover:bg-slate-300 rtl:right-1.5 dark:bg-oklch(0.269 0 0)",
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
          "flex items-center gap-1 rounded-md text-sm px-2 py-1 hover:bg-oklch(0.97 0 0) hover:text-oklch(0.205 0 0) cursor-pointer dark:hover:bg-oklch(0.269 0 0) dark:hover:text-oklch(0.985 0 0)",
          isSelect && isSelectable && "bg-oklch(0.97 0 0) dark:bg-oklch(0.269 0 0)",
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
      <AccordionPrimitive.Content className="relative h-full overflow-hidden text-sm">
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
        "flex w-fit items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors cursor-pointer",
        isSelected && isSelectable && "bg-oklch(0.97 0 0) dark:bg-oklch(0.269 0 0)",
        !isSelectable
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-oklch(0.97 0 0) hover:text-oklch(0.205 0 0) dark:hover:bg-oklch(0.269 0 0) dark:hover:text-oklch(0.985 0 0)",
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
  elements,
  initialSelectedId,
  initialExpandedItems,
  children,
  className,
  indicator = true,
  openIcon,
  closeIcon,
  dir = "ltr",
}: {
  elements?: TreeViewElement[];
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
  const getAllExpandableItems = useCallback(
    (elements?: TreeViewElement[]): string[] => {
      const expandableItems: string[] = [];
      const traverse = (items: TreeViewElement[]) => {
        items.forEach((item) => {
          if (item.children?.length) {
            expandableItems.push(item.id);
            traverse(item.children);
          }
        });
      };
      if (elements) traverse(elements);
      return expandableItems;
    },
    []
  );
  const selectItem = useCallback((id: string) => setSelectedId(id), []);
  const handleExpand = useCallback((id: string) => {
    setExpandedItems((prev) => {
      if (prev?.includes(id)) return prev.filter((item) => item !== id);
      return [...(prev ?? []), id];
    });
  }, []);
  useEffect(() => {
    if (elements) setExpandedItems(getAllExpandableItems(elements));
  }, [elements, getAllExpandableItems]);
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
}: {
  tree: TreeViewElement[];
  selectedFile?: string;
  onFileSelect: (file: string) => void;
  component: ApiComponent;
}) {
  const allExpandableItems = useMemo(() => {
    const expandableItems: string[] = [];
    const traverse = (elements: TreeViewElement[]) => {
      elements.forEach((element) => {
        if (element.children?.length) {
          expandableItems.push(element.id);
          traverse(element.children);
        }
      });
    };
    traverse(tree);
    return expandableItems;
  }, [tree]);
  return (
    <div className="w-full h-full border-r">
      <div className="p-3 border-b flex items-center gap-2">
        <FileCode className="h-4 w-4" />
        <span className="text-sm font-medium">{component.name} {component.version}</span>
      </div>
      <ScrollArea className="h-96 lg:h-[calc(100vh-300px)]">
        <div className="p-2">
          <Tree
            elements={tree}
            initialExpandedItems={allExpandableItems}
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
      </ScrollArea>
    </div>
  );
}

// --- Main Component ---
export default function ComponentFileViewer({
  component,
}: {
  component: ApiComponent;
}) {
  const [selectedFile, setSelectedFile] = useState<string | undefined>(
    undefined
  );
  const [copied, setCopied] = useState(false);
  const files = component.files.filter((f) => f.content);
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
  const selected = files.find((f) => f.path === selectedFile) || files[0];
  useEffect(() => {
    if (!selectedFile && files.length > 0) {
      setSelectedFile(files[0].path);
    }
  }, [files, selectedFile]);
  const handleCopy = () => {
    if (selected?.content) {
      navigator.clipboard.writeText(selected.content);
      setCopied(true);
      toast.success("File content copied");
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="min-h-[600px] rounded-lg border border-oklch(0.922 0 0) overflow-hidden dark:border-oklch(1 0 0 / 10%)"
    >
      <ResizablePanel defaultSize={25} minSize={20} maxSize={40}>
        <FileTree
          tree={tree}
          selectedFile={selectedFile}
          onFileSelect={setSelectedFile}
          component={component}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={75} minSize={40}>
        {selected && (
          <div className="h-full flex flex-col">
            <FileHeader
              file={selected}
              onCopy={handleCopy}
              copied={copied}
            />
            <div className="flex-1 overflow-hidden">
              <MonacoViewer
                code={selected.content || ""}
                filePath={selected.path}
              />
            </div>
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}