const MIME_BY_EXT: Record<string, string> = {
  // Web and text
  txt: "text/plain",
  text: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  scss: "text/x-scss",
  sass: "text/x-sass",
  less: "text/less",
  js: "application/javascript",
  mjs: "application/javascript",
  cjs: "application/javascript",
  jsx: "application/javascript",
  ts: "application/typescript",
  tsx: "application/typescript",
  json: "application/json",
  jsonc: "application/json",
  map: "application/json",
  xml: "application/xml",
  yml: "text/yaml",
  yaml: "text/yaml",
  md: "text/markdown",
  markdown: "text/markdown",
  toml: "application/toml",
  ini: "text/plain",
  cfg: "text/plain",
  conf: "text/plain",
  env: "text/plain",
  properties: "text/plain",

  // Common source/code files
  py: "text/x-python",
  rb: "text/x-ruby",
  go: "text/x-go",
  rs: "text/x-rustsrc",
  java: "text/x-java-source",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++src",
  hpp: "text/x-c++src",
  sh: "application/x-sh",
  bash: "application/x-sh",
  zsh: "application/x-sh",
  sql: "application/sql",
  graphql: "application/graphql",
  gql: "application/graphql",

  // Images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",

  // Video/audio
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
  "3gp": "video/3gpp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",

  // Documents and archives
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

function extensionLower(name: string): string {
  const normalized = String(name || "").trim().toLowerCase();
  const idx = normalized.lastIndexOf(".");
  if (idx < 0) return "";
  return normalized.slice(idx + 1);
}

function baseMimeType(raw: string | null | undefined): string {
  return String(raw || "").trim().split(";")[0].trim().toLowerCase();
}

export function isGenericBinaryMimeType(raw: string | null | undefined): boolean {
  const base = baseMimeType(raw);
  if (!base) return true;
  if (base === "application/octet-stream") return true;
  if (base === "binary/octet-stream") return true;
  if (base === "multipart/form-data") return true;
  return false;
}

export function inferMimeTypeFromFilename(name: string): string | null {
  const ext = extensionLower(name);
  if (!ext) return null;
  return MIME_BY_EXT[ext] || null;
}

export function preferredMimeType(args: {
  providedMimeType?: string | null;
  fileName?: string | null;
  fallbackPath?: string | null;
  fallbackMimeType?: string | null;
}): string | null {
  const svgExt = extensionLower(String(args.fileName || "")) || extensionLower(String(args.fallbackPath || ""));
  if (svgExt === "svg") return "image/svg+xml";

  const provided = String(args.providedMimeType || "").trim();
  if (!isGenericBinaryMimeType(provided)) return provided;

  const byFileName = inferMimeTypeFromFilename(String(args.fileName || ""));
  if (byFileName) return byFileName;

  const byFallbackPath = inferMimeTypeFromFilename(String(args.fallbackPath || ""));
  if (byFallbackPath) return byFallbackPath;

  const fallbackMime = String(args.fallbackMimeType || "").trim();
  if (!isGenericBinaryMimeType(fallbackMime)) return fallbackMime;

  return null;
}
