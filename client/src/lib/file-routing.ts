export type ViewerKind = "editor" | "image" | "pdf" | "spreadsheet" | "doc";

export type ProgramKind = "browser" | "chat" | "forum" | "community";

const IMAGE_EXTS = new Set(["bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const PDF_EXTS = new Set(["pdf"]);
const SPREADSHEET_EXTS = new Set(["csv", "xls", "xlsx"]);
const DOC_EXTS = new Set(["doc", "docx"]);

export function getBaseName(filePath: string) {
  return filePath.split(/[/\\]/).filter(Boolean).pop() || filePath;
}

export function getFileExtension(filePath: string) {
  const clean = getBaseName(filePath);
  const idx = clean.lastIndexOf(".");
  if (idx === -1) return "";
  return clean.slice(idx + 1).toLowerCase();
}

export function getViewerKind(filePath: string): ViewerKind {
  const ext = getFileExtension(filePath);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (PDF_EXTS.has(ext)) return "pdf";
  if (SPREADSHEET_EXTS.has(ext)) return "spreadsheet";
  if (DOC_EXTS.has(ext)) return "doc";
  return "editor";
}

export function getViewerTitle(filePath: string) {
  return getBaseName(filePath);
}

export function getMonacoLanguageId(filePath: string) {
  const ext = getFileExtension(filePath);

  switch (ext) {
    case "c":
    case "cc":
    case "cpp":
    case "cxx":
    case "h":
    case "hpp":
      return "cpp";
    case "cjs":
    case "js":
    case "jsx":
    case "mjs":
      return "javascript";
    case "css":
      return "css";
    case "go":
      return "go";
    case "html":
    case "htm":
      return "html";
    case "java":
      return "java";
    case "json":
    case "jsonc":
      return "json";
    case "md":
    case "markdown":
      return "markdown";
    case "php":
      return "php";
    case "py":
      return "python";
    case "rb":
      return "ruby";
    case "rs":
      return "rust";
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return "shell";
    case "sql":
      return "sql";
    case "ts":
    case "tsx":
      return "typescript";
    case "xml":
      return "xml";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "plaintext";
  }
}
