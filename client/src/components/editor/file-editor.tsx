/**
 * FileEditor — Monaco editor for a server-side file.
 * Auto-saves on Ctrl+S. Marks tab dirty on change.
 */

import * as React from "react";
import Editor, { type OnMount, loader } from "@monaco-editor/react";
import { Loader2, Save, AlertCircle } from "lucide-react";
import { fileApi } from "@/lib/file-api";
import { useApp } from "@/contexts/app-context";

// ─── Tokyo Night theme for Monaco ─────────────────────────────────────────────

loader.init().then(monaco => {
  monaco.editor.defineTheme("tokyo-night", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment",    foreground: "565f89", fontStyle: "italic" },
      { token: "keyword",    foreground: "bb9af7" },
      { token: "string",     foreground: "9ece6a" },
      { token: "number",     foreground: "ff9e64" },
      { token: "type",       foreground: "2ac3de" },
      { token: "function",   foreground: "7aa2f7" },
      { token: "variable",   foreground: "c0caf5" },
      { token: "operator",   foreground: "89ddff" },
      { token: "delimiter",  foreground: "89ddff" },
      { token: "tag",        foreground: "f7768e" },
      { token: "attribute",  foreground: "e0af68" },
    ],
    colors: {
      "editor.background":            "#1a1b26",
      "editor.foreground":            "#c0caf5",
      "editor.lineHighlightBackground":"#1f2335",
      "editor.selectionBackground":   "#283457",
      "editor.inactiveSelectionBackground": "#1f2335",
      "editorLineNumber.foreground":  "#3b4261",
      "editorLineNumber.activeForeground": "#737aa2",
      "editorCursor.foreground":      "#c0caf5",
      "editorWhitespace.foreground":  "#3b4261",
      "editorIndentGuide.background": "#1f2335",
      "editorIndentGuide.activeBackground": "#292e42",
      "editor.findMatchBackground":   "#3d59a1",
      "editor.findMatchHighlightBackground": "#1f2335",
      "editorGutter.background":      "#1a1b26",
      "scrollbar.shadow":             "#00000000",
      "scrollbarSlider.background":   "#292e4280",
      "scrollbarSlider.hoverBackground": "#3b426180",
      "scrollbarSlider.activeBackground": "#565f8980",
    },
  });
});

// Detect Monaco language from file extension
function langFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", sh: "shell", bash: "shell",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    md: "markdown", html: "html", css: "css", scss: "scss",
    c: "c", cpp: "cpp", h: "cpp", java: "java", rb: "ruby",
    php: "php", sql: "sql", xml: "xml",
  };
  return map[ext] || "plaintext";
}

// Responsive font size: 14 (desktop) -> 10 (small mobile)
function getFontSize() {
  if (window.innerWidth <= 375) return 10; // iPhone 6/7/8 and smaller
  if (window.innerWidth <= 480) return 11; // Small phones
  if (window.innerWidth <= 768) return 12; // Tablets
  return 14; // Desktop
}

interface Props {
  pageId:   string;
  filePath: string;
}

export function FileEditor({ pageId, filePath }: Props) {
  const { markDirty } = useApp();
  const [content,  setContent]  = React.useState<string | null>(null);
  const [loading,  setLoading]  = React.useState(true);
  const [saving,   setSaving]   = React.useState(false);
  const [error,    setError]    = React.useState<string | null>(null);
  const [saveMsg,  setSaveMsg]  = React.useState<string | null>(null);
  const editorRef = React.useRef<Parameters<OnMount>[0] | null>(null);

  // Load file on mount
  React.useEffect(() => {
    setLoading(true);
    setError(null);
    fileApi.read(filePath)
      .then(res => { setContent(res.content); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, [filePath]);

  const save = React.useCallback(async () => {
    const value = editorRef.current?.getValue();
    if (value === undefined) return;
    setSaving(true);
    try {
      await fileApi.write(filePath, value);
      markDirty(pageId, false);
      setSaveMsg("saved");
      setTimeout(() => setSaveMsg(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }, [filePath, pageId, markDirty]);

  // Ctrl+S to save
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    // Add Ctrl+S keybinding inside Monaco
    editor.addCommand(
      // Monaco.KeyMod.CtrlCmd | Monaco.KeyCode.KeyS
      2048 | 49,
      () => save()
    );
  };

  const handleChange = (value: string | undefined) => {
    if (value !== undefined) markDirty(pageId, true);
  };

  if (loading) {
    return (
      <div className="fe-state">
        <Loader2 size={18} className="reterm-spin" />
        <span>loading {filePath.split(/[/\\]/).pop()}…</span>
      </div>
    );
  }

  if (error && content === null) {
    return (
      <div className="fe-state fe-state--error">
        <AlertCircle size={18} />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="fe-root">
      {/* Save indicator */}
      {(saving || saveMsg || error) && (
        <div className={`fe-save-bar ${error ? "fe-save-bar--error" : ""}`}>
          {saving  && <><Loader2 size={12} className="reterm-spin" />saving…</>}
          {saveMsg && <><Save size={12} />{saveMsg}</>}
          {error   && <><AlertCircle size={12} />{error}</>}
        </div>
      )}

      <Editor
        height="100%"
        language={langFromPath(filePath)}
        value={content ?? ""}
        theme="tokyo-night"
        onMount={handleMount}
        onChange={handleChange}
        options={{
          fontSize:             getFontSize(),
          fontFamily:           '"Ubuntu Mono", "JetBrains Mono", "Fira Code", "Consolas", monospace',
          fontLigatures:        true,
          lineHeight:           1.25,
          minimap:              { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap:             "off",
          tabSize:              2,
          renderWhitespace:     "boundary",
          smoothScrolling:      true,
          cursorBlinking:       "smooth",
          cursorStyle:          "block",
          padding:              { top: 8, bottom: 8 },
          lineNumbers:          "on",
          lineNumbersMinChars:  3,
          glyphMargin:          false,
          folding:              true,
          renderLineHighlight:  "line",
          scrollbar: {
            verticalScrollbarSize:   6,
            horizontalScrollbarSize: 6,
          },
        }}
      />
    </div>
  );
}
