/**
FileEditor — CodeMirror editor for a server-side file.
Auto-saves on Ctrl+S. Marks tab dirty on change.
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

// ─── Tokyo Night Dark theme for CodeMirror ──────────────────────────────────
const tokyoNightDarkTheme = EditorView.theme({
  "&": {
    backgroundColor: "#040404",
    color: "#f5f5f3",
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
    backgroundColor: "#040404",
    color: "#63697d",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#0a0a0a",
    color: "#f5f5f3",
  },
  ".cm-activeLine": {
    backgroundColor: "#0a0a0a",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(125, 207, 255, 0.25) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "#f5f5f3",
  },
  ".cm-selectionMatch": {
    backgroundColor: "#7dcfff30",
  },
  ".cm-matchingBracket": {
    backgroundColor: "#9ece6a40",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "#9ece6a40",
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
      backgroundColor: "#2a2a2a",
    },
    "&::-webkit-scrollbar-thumb:hover": {
      backgroundColor: "#414868",
    },
  },
});

// Syntax highlighting colors (Tokyo Night Dark)
const tokyoNightDarkHighlightStyle = EditorView.baseTheme({
  ".cm-comment": { color: "#63697d", fontStyle: "italic" },
  ".cm-keyword": { color: "#f7768e" },
  ".cm-string": { color: "#9ece6a" },
  ".cm-number": { color: "#7aa2f7" },
  ".cm-typeName": { color: "#7aa2f7" },
  ".cm-function": { color: "#bb9af7" },
  ".cm-variableName": { color: "#e0af68" },
  ".cm-operator": { color: "#f7768e" },
  ".cm-property": { color: "#7aa2f7" },
  ".cm-atom": { color: "#f7768e" },
  ".cm-tag": { color: "#9ece6a" },
  ".cm-attribute": { color: "#7aa2f7" },
  ".cm-definitionKeyword": { color: "#f7768e" },
  ".cm-macroName": { color: "#bb9af7" },
});

// ─── Tokyo Night Light theme for CodeMirror ─────────────────────────────────
const tokyoNightLightTheme = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#0f0f0f",
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
    color: "#848cb3",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#f6f6f7",
    color: "#0f0f0f",
  },
  ".cm-activeLine": {
    backgroundColor: "#f6f6f7",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(44, 125, 150, 0.2) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "#0f0f0f",
  },
  ".cm-selectionMatch": {
    backgroundColor: "#2c7d9630",
  },
  ".cm-matchingBracket": {
    backgroundColor: "#33635c40",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "#33635c40",
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
      backgroundColor: "#848cb3",
    },
  },
});

// Syntax highlighting colors (Tokyo Night Light)
const tokyoNightLightHighlightStyle = EditorView.baseTheme({
  ".cm-comment": { color: "#848cb3", fontStyle: "italic" },
  ".cm-keyword": { color: "#8c4351" },
  ".cm-string": { color: "#33635c" },
  ".cm-number": { color: "#34548a" },
  ".cm-typeName": { color: "#34548a" },
  ".cm-function": { color: "#5a4a78" },
  ".cm-variableName": { color: "#8f5e15" },
  ".cm-operator": { color: "#8c4351" },
  ".cm-property": { color: "#34548a" },
  ".cm-atom": { color: "#8c4351" },
  ".cm-tag": { color: "#33635c" },
  ".cm-attribute": { color: "#34548a" },
  ".cm-definitionKeyword": { color: "#8c4351" },
  ".cm-macroName": { color: "#5a4a78" },
});

// Get current theme based on document data attribute
function getCurrentCodeMirrorTheme() {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'light') {
    return [tokyoNightLightTheme, tokyoNightLightHighlightStyle];
  }
  return [tokyoNightDarkTheme, tokyoNightDarkHighlightStyle];
}

// Detect CodeMirror language from file extension
function getLanguageExtension(filePath: string) {
  // FIX: Changed split(" ") to split(".") to correctly parse extensions
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
  if (typeof window === "undefined") return 14;
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
  
  // FIX: State to trigger re-render when theme changes
  const [themeVersion, setThemeVersion] = React.useState(0);

  // FIX: Watch for theme changes on the HTML tag
  React.useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-theme') {
          // Force a re-render of extensions
          setThemeVersion(v => v + 1);
        }
      }
    });

    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

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
  
  // FIX: Added themeVersion to dependencies so it updates when theme changes
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
  }, [languageExt, filePath, themeVersion]);

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
          {saving && <><Loader2 size={12} className="reterm-spin" />saving…</>}
          {saveMsg && <><Save size={12} />{saveMsg}</>}
          {error && <><AlertCircle size={12} />{error}</>}
        </div>
      )}
      {/* FIX: Added key={themeVersion} to force a hard reset on theme change */}
      <CodeMirror
        key={themeVersion}
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