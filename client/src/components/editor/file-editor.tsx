/**
 * FileEditor — CodeMirror editor for a server-side file.
 * Auto-saves on Ctrl+S. Marks tab dirty on change.
 */

import * as React from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { php } from "@codemirror/lang-php";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { drawSelection, dropCursor, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { Save, AlertCircle, Loader2 } from "lucide-react";
import { fileApi } from "@/lib/file-api";
import { useApp } from "@/contexts/app-context";

// ─── GitHub Dark Legacy theme for CodeMirror ──────────────────────────────────

const githubDarkLegacyTheme = EditorView.theme({
  "&": {
    backgroundColor: "#0d1117",
    color: "#c9d1d9",
    fontSize: "14px",
  },
  ".cm-content": {
    fontFamily: '"Ubuntu Mono", "JetBrains Mono", "Fira Code", "Consolas", monospace',
    lineHeight: "1.25",
    padding: "8px 0",
  },
  ".cm-line": {
    padding: "0 4px",
  },
  ".cm-gutters": {
    backgroundColor: "#0d1117",
    color: "#8b949e",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#161b22",
    color: "#c9d1d9",
  },
  ".cm-activeLine": {
    backgroundColor: "#161b22",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(110, 118, 129, 0.4) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "#c9d1d9",
  },
  ".cm-selectionMatch": {
    backgroundColor: "#388bfd26",
  },
  ".cm-matchingBracket": {
    backgroundColor: "#3fb95040",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "#3fb95040",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-scrollbar": {
    "&::-webkit-scrollbar": {
      width: "6px",
      height: "6px",
    },
    "&::-webkit-scrollbar-thumb": {
      backgroundColor: "#30363d",
    },
    "&::-webkit-scrollbar-thumb:hover": {
      backgroundColor: "#484f58",
    },
  },
});

// Syntax highlighting colors (GitHub Dark Legacy)
const githubDarkLegacyHighlightStyle = EditorView.baseTheme({
  ".cm-comment": { color: "#8b949e", fontStyle: "italic" },
  ".cm-keyword": { color: "#ff7b72" },
  ".cm-string": { color: "#a5d6ff" },
  ".cm-number": { color: "#79c0ff" },
  ".cm-typeName": { color: "#79c0ff" },
  ".cm-function": { color: "#d2a8ff" },
  ".cm-variableName": { color: "#ffa657" },
  ".cm-operator": { color: "#ff7b72" },
  ".cm-property": { color: "#79c0ff" },
  ".cm-atom": { color: "#ff7b72" },
  ".cm-tag": { color: "#7ee787" },
  ".cm-attribute": { color: "#79c0ff" },
  ".cm-definitionKeyword": { color: "#ff7b72" },
  ".cm-macroName": { color: "#d2a8ff" },
});

// ─── GitHub Light theme for CodeMirror ────────────────────────────────────────

const githubLightTheme = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#24292f",
    fontSize: "14px",
  },
  ".cm-content": {
    fontFamily: '"Ubuntu Mono", "JetBrains Mono", "Fira Code", "Consolas", monospace',
    lineHeight: "1.25",
    padding: "8px 0",
  },
  ".cm-line": {
    padding: "0 4px",
  },
  ".cm-gutters": {
    backgroundColor: "#ffffff",
    color: "#57606a",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#f6f8fa",
    color: "#24292f",
  },
  ".cm-activeLine": {
    backgroundColor: "#f6f8fa",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(175, 184, 193, 0.2) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "#24292f",
  },
  ".cm-selectionMatch": {
    backgroundColor: "#0969da1a",
  },
  ".cm-matchingBracket": {
    backgroundColor: "#1a7f3740",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "#1a7f3740",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-scrollbar": {
    "&::-webkit-scrollbar": {
      width: "6px",
      height: "6px",
    },
    "&::-webkit-scrollbar-thumb": {
      backgroundColor: "#d0d7de",
    },
    "&::-webkit-scrollbar-thumb:hover": {
      backgroundColor: "#8c959f",
    },
  },
});

// Syntax highlighting colors (GitHub Light)
const githubLightHighlightStyle = EditorView.baseTheme({
  ".cm-comment": { color: "#57606a", fontStyle: "italic" },
  ".cm-keyword": { color: "#cf222e" },
  ".cm-string": { color: "#0a3069" },
  ".cm-number": { color: "#0969da" },
  ".cm-typeName": { color: "#0969da" },
  ".cm-function": { color: "#8250df" },
  ".cm-variableName": { color: "#953800" },
  ".cm-operator": { color: "#cf222e" },
  ".cm-property": { color: "#0969da" },
  ".cm-atom": { color: "#cf222e" },
  ".cm-tag": { color: "#116329" },
  ".cm-attribute": { color: "#0969da" },
  ".cm-definitionKeyword": { color: "#cf222e" },
  ".cm-macroName": { color: "#8250df" },
});

// Get current theme based on document data attribute
function getCurrentCodeMirrorTheme() {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'light') {
    return [githubLightTheme, githubLightHighlightStyle];
  }
  return [githubDarkLegacyTheme, githubDarkLegacyHighlightStyle];
}

// Detect CodeMirror language from file extension
function getLanguageExtension(filePath: string) {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "js":
    case "jsx":
      return javascript({ jsx: true });
    case "py":
      return python();
    case "rs":
      return rust();
    case "go":
      return go();
    case "sh":
    case "bash":
      return javascript(); // fallback for shell scripts
    case "json":
      return json();
    case "yaml":
    case "yml":
      return yaml();
    case "md":
      return markdown({ base: markdownLanguage });
    case "html":
      return html();
    case "css":
    case "scss":
      return css();
    case "c":
    case "cpp":
    case "h":
      return cpp();
    case "java":
      return java();
    case "rb":
      return javascript(); // fallback for ruby
    case "php":
      return php();
    case "sql":
      return sql();
    case "xml":
      return xml();
    default:
      return [];
  }
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

  // Load file on mount
  React.useEffect(() => {
    setLoading(true);
    setError(null);
    fileApi.read(filePath)
      .then(res => { setContent(res.content); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, [filePath]);

  const save = React.useCallback(async () => {
    if (content === null) return;
    setSaving(true);
    try {
      await fileApi.write(filePath, content);
      markDirty(pageId, false);
      setSaveMsg("saved");
      setTimeout(() => setSaveMsg(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }, [filePath, pageId, content, markDirty]);

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

  const handleChange = (value: string) => {
    setContent(value);
    markDirty(pageId, true);
  };

  // Get extensions for CodeMirror - MUST be before early returns to satisfy Rules of Hooks
  const languageExt = React.useMemo(() => getLanguageExtension(filePath), [filePath]);
  const extensions = React.useMemo(() => {
    const [currentTheme, currentHighlight] = getCurrentCodeMirrorTheme();
    const exts = [
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      history(),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      bracketMatching(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      currentTheme,
      currentHighlight,
    ];
    
    // Add language extension
    if (languageExt) {
      exts.push(languageExt);
    }
    
    return exts;
  }, [languageExt, filePath]);

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
    <div className="fe-root h-full w-full overflow-hidden">
      {/* Save indicator */}
      {(saving || saveMsg || error) && (
        <div className={`fe-save-bar ${error ? "fe-save-bar--error" : ""}`}>
          {saving  && <><Loader2 size={12} className="reterm-spin" />saving…</>}
          {saveMsg && <><Save size={12} />{saveMsg}</>}
          {error   && <><AlertCircle size={12} />{error}</>}
        </div>
      )}

      <CodeMirror
        value={content ?? ""}
        height="100%"
        extensions={extensions}
        onChange={handleChange}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          foldGutter: true,
          drawSelection: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          syntaxHighlighting: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          defaultKeymap: true,
          searchKeymap: true,
          historyKeymap: true,
          foldKeymap: true,
          completionKeymap: true,
          lintKeymap: false,
        }}
        style={{
          fontSize: `${getFontSize()}px`,
        }}
      />
    </div>
  );
}