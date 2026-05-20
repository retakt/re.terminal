export type ViewerKind = "editor" | "image" | "pdf" | "spreadsheet" | "doc";

export type ProgramKind =
  | "browser"
  | "chat"
  | "forum"
  | "community"
  | "mcp"
  | "extensions"
  | "plugins"
  | "scripts"
  | "playground"
  | "memory-graph";

const IMAGE_EXTS = new Set(["bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const PDF_EXTS = new Set(["pdf"]);
const SPREADSHEET_EXTS = new Set(["csv", "xls", "xlsx"]);
const DOC_EXTS = new Set(["doc", "docx"]);
const FILE_TYPE_LABELS: Record<string, string> = {
  // Code
  c: "C",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  h: "H",
  hpp: "H++",
  go: "GO",
  java: "JAVA",
  js: "JS",
  jsx: "JSX",
  mjs: "JS",
  cjs: "JS",
  php: "PHP",
  py: "PY",
  rb: "RB",
  rs: "RS",
  sh: "SH",
  bash: "SH",
  zsh: "SH",
  fish: "SH",
  sql: "SQL",
  ts: "TS",
  tsx: "TSX",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  json: "JSON",
  jsonc: "JSON",
  md: "MD",
  markdown: "MD",
  txt: "TXT",
  ini: "INI",
  toml: "TOML",
  env: "ENV",
  lock: "LOCK",
  // Data and documents
  csv: "CSV",
  xls: "XLS",
  xlsx: "XLSX",
  pdf: "PDF",
  doc: "DOC",
  docx: "DOCX",
  // Media
  bmp: "BMP",
  gif: "GIF",
  jpeg: "JPG",
  jpg: "JPG",
  png: "PNG",
  svg: "SVG",
  webp: "WEBP",
};

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

export function getFileTypeLabel(filePath: string) {
  const baseName = getBaseName(filePath).toLowerCase();
  if (baseName === "dockerfile") return "DOCKERFILE";
  if (baseName === "makefile") return "MAKEFILE";
  if (baseName === "caddyfile") return "CADDYFILE";
  if (baseName === "justfile") return "JUSTFILE";
  if (baseName === "vagrantfile") return "VAGRANTFILE";
  if (baseName.startsWith(".env")) return "ENV";
  if (baseName === ".bashrc") return "BASHRC";
  if (baseName === ".zshrc") return "ZSHRC";
  if (baseName === ".gitignore") return "GITIGNORE";
  if (baseName === ".gitattributes") return "GITATTR";
  if (baseName === ".gitconfig") return "GITCONFIG";
  if (baseName === ".editorconfig") return "EDITORCONFIG";
  if (baseName === "readme" || baseName.startsWith("readme.")) return "README";
  if (baseName === "license") return "LICENSE";
  if (baseName.startsWith("changelog")) return "CHANGELOG";

  const ext = getFileExtension(filePath);
  if (!ext) {
    // Handle dotfiles like .npmrc, .prettierrc, etc.
    if (baseName.startsWith(".")) return baseName.toUpperCase().slice(1);
    return "FILE";
  }
  return FILE_TYPE_LABELS[ext] ?? ext.toUpperCase();
}

export function getMonacoLanguageId(filePath: string) {
  const ext = getFileExtension(filePath);
  const baseName = getBaseName(filePath).toLowerCase();

  // Handle files without extensions
  if (ext === "") {
    if (baseName === "caddyfile") return "caddyfile";
    if (baseName === "dockerfile") return "dockerfile";
    if (baseName === "makefile") return "makefile";
    if (baseName === ".gitignore" || baseName === ".gitattributes") return "gitignore";
    if (baseName === ".bashrc" || baseName === ".zshrc") return "shell";
    if (baseName === ".editorconfig" || baseName === ".gitconfig") return "ini";
  }

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
