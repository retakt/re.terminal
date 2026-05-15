import * as React from "react";
import { AlertCircle, Loader2, RotateCcw, Save } from "lucide-react";
import { fileApi } from "@/lib/file-api";
import { getBaseName, getMonacoLanguageId } from "@/lib/file-routing";
import { useApp } from "@/contexts/app-context";

interface Props {
  pageId: string;
  filePath: string;
}

const MONACO_THEME_DARK = "reterm-dark";
const MONACO_THEME_LIGHT = "reterm-light";

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

function getThemeName() {
  return document.documentElement.getAttribute("data-theme") === "light"
    ? MONACO_THEME_LIGHT
    : MONACO_THEME_DARK;
}

function readEditorMetrics() {
  const styles = getComputedStyle(document.documentElement);
  const fontSize = Number.parseFloat(styles.getPropertyValue("--term-font-size")) || 14;
  const fontFamily = styles.getPropertyValue("--term-font-family").trim() || '"Ubuntu Mono", monospace';
  const isCompact = window.matchMedia("(max-width: 760px)").matches;
  const compactFontSize = isCompact ? Math.max(11, fontSize - 3) : Math.max(12, fontSize - 1);

  return { fontSize: compactFontSize, fontFamily, isCompact };
}

function defineMonacoTheme(monaco: any) {
  const styles = getComputedStyle(document.documentElement);
  const isLight = document.documentElement.getAttribute("data-theme") === "light";

  const bgBase = styles.getPropertyValue("--bg-base").trim() || (isLight ? "#ffffff" : "#040404");
  const bgSurface = styles.getPropertyValue("--bg-surface").trim() || (isLight ? "#f6f6f7" : "#0a0a0a");
  const fgBase = styles.getPropertyValue("--fg-base").trim() || (isLight ? "#0f0f0f" : "#f5f5f3");
  const fgMuted = styles.getPropertyValue("--fg-muted").trim() || (isLight ? "#565a6e" : "#a9b0c3");
  const fgSubtle = styles.getPropertyValue("--fg-subtle").trim() || (isLight ? "#848cb3" : "#63697d");
  const border = styles.getPropertyValue("--border").trim() || (isLight ? "#d0d7de" : "#2a2a2a");
  const accentBlue = styles.getPropertyValue("--accent-blue").trim() || (isLight ? "#34548a" : "#7aa2f7");
  const accentRed = styles.getPropertyValue("--accent-red").trim() || (isLight ? "#8c4351" : "#f7768e");
  const accentYellow = styles.getPropertyValue("--accent-yellow").trim() || (isLight ? "#8f5e15" : "#e0af68");

  monaco.editor.defineTheme(getThemeName(), {
    base: isLight ? "vs" : "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": bgBase,
      "editor.foreground": fgBase,
      "editor.lineHighlightBackground": isLight ? "#ececf1" : "#111111",
      "editorLineNumber.foreground": fgSubtle,
      "editorLineNumber.activeForeground": fgBase,
      "editorCursor.foreground": fgBase,
      "editor.selectionBackground": isLight ? "#c7dbff" : "#264f78",
      "editor.inactiveSelectionBackground": isLight ? "#dde8ff" : "#1f3852",
      "editorIndentGuide.background1": border,
      "editorIndentGuide.activeBackground1": accentBlue,
      "editorWhitespace.foreground": fgMuted,
      "editorError.foreground": accentRed,
      "editorWarning.foreground": accentYellow,
      "editorGutter.background": bgBase,
      "editorWidget.background": bgSurface,
      "scrollbarSlider.background": isLight ? "#c8ccd8" : "#3b3b3b",
      "scrollbarSlider.hoverBackground": isLight ? "#aeb5c6" : "#505050",
      "scrollbarSlider.activeBackground": isLight ? "#8f96a8" : "#646464",
    },
  });

  monaco.editor.setTheme(getThemeName());
}

function buildEditorOptions() {
  const { fontSize, fontFamily, isCompact } = readEditorMetrics();

  return {
    automaticLayout: true,
    fontFamily,
    fontSize,
    lineHeight: Math.max(16, Math.round(fontSize * 1.35)),
    minimap: { enabled: !isCompact },
    wordWrap: isCompact ? "on" : "off",
    lineNumbers: isCompact ? "off" : "on",
    glyphMargin: !isCompact,
    folding: !isCompact,
    scrollBeyondLastLine: false,
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
      useShadows: false,
      alwaysConsumeMouseWheel: false,
    },
    padding: { top: 12, bottom: 12 },
    renderWhitespace: "selection",
    smoothScrolling: true,
    cursorSmoothCaretAnimation: "on",
    tabSize: 2,
    insertSpaces: true,
    fixedOverflowWidgets: true,
    overviewRulerLanes: 0,
    contextmenu: true,
    mouseWheelZoom: false,
    theme: getThemeName(),
    language: "plaintext",
    readOnly: false,
  } as const;
}

function normalizeValue(value: string) {
  return value.replace(/\r\n/g, "\n");
}

export function FileEditor({ pageId, filePath }: Props) {
  const { markDirty } = useApp();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<any>(null);
  const modelRef = React.useRef<any>(null);
  const monacoRef = React.useRef<any>(null);
  const dirtyRef = React.useRef(false);
  const saveRef = React.useRef<() => Promise<void>>(async () => {});

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const [saveState, setSaveState] = React.useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");

  const fileLabel = getBaseName(filePath);
  const statusText = loading
    ? "loading file…"
    : loadError
      ? loadError
      : saveError
        ? saveError
        : saving
          ? "saving…"
          : saveState === "saved"
            ? "saved"
            : saveState === "dirty"
              ? "not saved"
              : "idle";

  const saveFile = React.useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || loading || loadError) return;

    setSaving(true);
    setSaveError(null);
    setSaveState("saving");
    try {
      const value = normalizeValue(editor.getValue());
      await fileApi.write(filePath, value);
      dirtyRef.current = false;
      setDirty(false);
      markDirty(pageId, false);
      setSaveState("saved");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "save failed");
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  }, [filePath, loadError, loading, markDirty, pageId]);

  saveRef.current = saveFile;

  React.useEffect(() => {
    const editorHost = containerRef.current;
    if (!editorHost) return;

    let cancelled = false;
    let themeObserver: MutationObserver | null = null;
    let viewportQuery: MediaQueryList | null = null;
    let viewportHandler: ((event: MediaQueryListEvent) => void) | null = null;
    let resizeHandler: (() => void) | null = null;
    const disposables: Array<{ dispose: () => void }> = [];

    const disposeEditor = () => {
      while (disposables.length > 0) {
        disposables.pop()?.dispose();
      }
      editorRef.current?.dispose?.();
      editorRef.current = null;
      modelRef.current?.dispose?.();
      modelRef.current = null;
      monacoRef.current = null;
    };

    async function init() {
      setLoading(true);
      setLoadError(null);
      setSaveError(null);
      setSaving(false);
      setDirty(false);
      setSaveState("idle");
      dirtyRef.current = false;
      markDirty(pageId, false);
      disposeEditor();

      try {
        const [monaco, file] = await Promise.all([
          import("monaco-editor/esm/vs/editor/editor.api.js"),
          fileApi.read(filePath),
        ]);

        if (cancelled) return;

        monacoRef.current = monaco;

        const languageId = getMonacoLanguageId(filePath);
        const loadLanguage = LANGUAGE_LOADERS[languageId];
        if (loadLanguage) {
          await loadLanguage();
        }

        if (cancelled) return;

        defineMonacoTheme(monaco);

        const model = monaco.editor.createModel(
          normalizeValue(file.content),
          languageId === "plaintext" ? "plaintext" : languageId,
          monaco.Uri.file(filePath),
        );
        modelRef.current = model;

        const editorTarget = editorHost as HTMLDivElement;
        const editor = monaco.editor.create(editorTarget, {
          model,
          ...buildEditorOptions(),
        });
        editorRef.current = editor;

        const onChange = editor.onDidChangeModelContent(() => {
          if (!dirtyRef.current) {
            dirtyRef.current = true;
            setDirty(true);
            setSaveState("dirty");
            markDirty(pageId, true);
          }
        });
        disposables.push(onChange);

        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
          () => { void saveRef.current(); },
        );

        const syncLayout = () => {
          const monacoInstance = monacoRef.current;
          if (!editorRef.current || !monacoInstance) return;
          const metrics = readEditorMetrics();
          editorRef.current.updateOptions({
            fontFamily: metrics.fontFamily,
            fontSize: metrics.fontSize,
            lineHeight: Math.max(16, Math.round(metrics.fontSize * 1.35)),
            minimap: { enabled: !metrics.isCompact },
            wordWrap: metrics.isCompact ? "on" : "off",
            lineNumbers: metrics.isCompact ? "off" : "on",
            glyphMargin: !metrics.isCompact,
            folding: !metrics.isCompact,
          });
          defineMonacoTheme(monacoInstance);
        };

        themeObserver = new MutationObserver(syncLayout);
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme", "style"],
        });

        viewportQuery = window.matchMedia("(max-width: 760px)");
        viewportHandler = () => syncLayout();
        resizeHandler = syncLayout;
        viewportQuery.addEventListener("change", viewportHandler);

        window.addEventListener("resize", resizeHandler);
        syncLayout();
        editor.focus();
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "failed to load editor");
          setLoading(false);
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
      themeObserver?.disconnect();
      if (viewportQuery && viewportHandler) {
        viewportQuery.removeEventListener("change", viewportHandler);
      }
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
      }
      disposeEditor();
    };
  }, [filePath, markDirty, pageId, revision]);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveRef.current();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="fe-root">
      <div className="fe-toolbar">
        <div className="fe-toolbar__title" title={filePath}>
          <span>{fileLabel}</span>
        </div>
        <div className={`fe-toolbar__status ${loadError || saveError || saveState === "error" ? "fe-toolbar__status--error" : saveState === "dirty" ? "fe-toolbar__status--dirty" : saveState === "saved" ? "fe-toolbar__status--saved" : "fe-toolbar__status--idle"}`}>
          {loading ? <Loader2 size={11} className="reterm-spin" /> : loadError || saveError || saveState === "error" ? <AlertCircle size={11} /> : saveState === "dirty" ? <Save size={11} /> : saveState === "saved" ? <span className="reterm-conn-dot reterm-conn-dot--connected" /> : <span className="reterm-conn-dot reterm-conn-dot--idle" />}
          <span>{statusText}</span>
        </div>
        <button
          type="button"
          className="fe-toolbar__button"
          onClick={() => void saveRef.current()}
          disabled={loading || saving || !!loadError || !dirty}
          title="save file"
        >
          <Save size={11} />
          <span>save</span>
        </button>
        {loadError && (
          <button
            type="button"
            className="fe-toolbar__button"
            onClick={() => setRevision(r => r + 1)}
            title="retry"
          >
            <RotateCcw size={11} />
            <span>retry</span>
          </button>
        )}
      </div>

      <div className="fe-editor" ref={containerRef}>
        {loading && (
          <div className="fe-state">
            <Loader2 size={13} className="reterm-spin" />
            <span>loading editor…</span>
          </div>
        )}
        {loadError && !loading && (
          <div className="fe-state fe-state--error">
            <AlertCircle size={13} />
            <span>{loadError}</span>
          </div>
        )}
      </div>
    </div>
  );
}
