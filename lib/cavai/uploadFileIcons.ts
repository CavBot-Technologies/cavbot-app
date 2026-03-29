const FILE_ICON_BASE = "/icons/app/cavcode/code-pack/cavbot-default";
const DEFAULT_UPLOAD_FILE_ICON = `${FILE_ICON_BASE}/text-svgrepo-com.svg`;

export const CAVAI_UPLOAD_FILE_ICON_ASSETS: Record<string, string> = {
  tsx: `${FILE_ICON_BASE}/logo-ts-svgrepo-com.svg`,
  ts: `${FILE_ICON_BASE}/logo-ts-svgrepo-com.svg`,
  jsx: `${FILE_ICON_BASE}/js-svgrepo-com.svg`,
  js: `${FILE_ICON_BASE}/js-svgrepo-com.svg`,
  json: `${FILE_ICON_BASE}/json-svgrepo-com.svg`,
  css: `${FILE_ICON_BASE}/css-svgrepo-com.svg`,
  scss: `${FILE_ICON_BASE}/css-svgrepo-com.svg`,
  less: `${FILE_ICON_BASE}/css-svgrepo-com.svg`,
  md: `${FILE_ICON_BASE}/info-circle-svgrepo-com.svg`,
  txt: `${FILE_ICON_BASE}/text-svgrepo-com.svg`,
  html: `${FILE_ICON_BASE}/html-5-svgrepo-com.svg`,
  yml: `${FILE_ICON_BASE}/xml-document-svgrepo-com.svg`,
  git: `${FILE_ICON_BASE}/git-svgrepo-com.svg`,
  toml: `${FILE_ICON_BASE}/toml-svgrepo-com.svg`,
  prisma: `${FILE_ICON_BASE}/light-prisma-svgrepo-com.svg`,
  env: `${FILE_ICON_BASE}/dollar-sign-symbol-bold-text-svgrepo-com.svg`,
  sh: `${FILE_ICON_BASE}/text-svgrepo-com.svg`,
  svg: `${FILE_ICON_BASE}/image-document-svgrepo-com.svg`,
  xml: `${FILE_ICON_BASE}/xml-document-svgrepo-com.svg`,
  png: `${FILE_ICON_BASE}/png-svgrepo-com.svg`,
  jpg: `${FILE_ICON_BASE}/image-document-svgrepo-com.svg`,
  ico: `${FILE_ICON_BASE}/ico-svgrepo-com.svg`,
  image: `${FILE_ICON_BASE}/image-document-svgrepo-com.svg`,
  video: `${FILE_ICON_BASE}/video-document-svgrepo-com.svg`,
  csv: `${FILE_ICON_BASE}/csv-document-svgrepo-com.svg`,
  excel: `${FILE_ICON_BASE}/excel-document-svgrepo-com.svg`,
  pdf: `${FILE_ICON_BASE}/pdf-svgrepo-com.svg`,
  zip: `${FILE_ICON_BASE}/zip-document-svgrepo-com.svg`,
  psd: `${FILE_ICON_BASE}/psd-document-svgrepo-com.svg`,
  eps: `${FILE_ICON_BASE}/eps-document-svgrepo-com.svg`,
  nodot: `${FILE_ICON_BASE}/align-left-svgrepo-com.svg`,
  file: DEFAULT_UPLOAD_FILE_ICON,
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

export function uploadFileIconKey(name: string, mimeType?: string | null): string {
  const lower = s(name).toLowerCase();
  const mime = s(mimeType).toLowerCase();

  if (mime.startsWith("image/")) {
    if (mime.includes("svg")) return "svg";
    if (mime.includes("png")) return "png";
    return "image";
  }
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "video";
  if (mime.startsWith("text/")) {
    if (lower === ".gitignore" || lower.endsWith(".gitignore")) return "git";
    if (lower.endsWith(".tsx")) return "tsx";
    if (lower.endsWith(".mts") || lower.endsWith(".cts") || lower.endsWith(".d.ts") || lower.endsWith(".ts")) return "ts";
    if (lower.endsWith(".jsx")) return "jsx";
    if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "js";
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".less")) return "css";
    if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "md";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
    if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yml";
    if (lower.endsWith(".xml")) return "xml";
    if (lower.endsWith(".csv")) return "csv";
    if (lower.endsWith(".env") || lower.startsWith(".env.")) return "env";
    if (lower.endsWith(".toml")) return "toml";
    if (lower.endsWith(".prisma")) return "prisma";
    if (mime.includes("javascript") || mime.includes("ecmascript")) return "js";
    if (mime.includes("typescript") || mime.includes("tsx")) return lower.endsWith(".tsx") ? "tsx" : "ts";
    if (mime.includes("markdown")) return "md";
    if (mime.includes("css")) return "css";
    if (mime.includes("html")) return "html";
    if (mime.includes("xml")) return "xml";
    if (mime.includes("csv")) return "csv";
    return "txt";
  }
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("markdown")) return "md";
  if (mime.includes("json")) return "json";
  if (mime.includes("javascript")) return "js";
  if (mime.includes("typescript")) return "ts";
  if (mime.includes("html")) return "html";
  if (mime.includes("css")) return "css";
  if (mime.includes("xml")) return "xml";
  if (mime.includes("yaml")) return "yml";
  if (mime.includes("excel") || mime.includes("spreadsheet")) return "excel";
  if (mime.includes("zip") || mime.includes("compressed")) return "zip";

  if (!lower) return "file";
  if (lower === ".gitignore" || lower.endsWith(".gitignore")) return "git";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) return "excel";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".zip") || lower.endsWith(".gz") || lower.endsWith(".tar") || lower.endsWith(".tgz") || lower.endsWith(".rar") || lower.endsWith(".7z")) return "zip";
  if (lower.endsWith(".psd")) return "psd";
  if (lower.endsWith(".eps")) return "eps";
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "txt";
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".mts") || lower.endsWith(".cts") || lower.endsWith(".d.ts")) return "ts";
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "js";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".scss")) return "scss";
  if (lower.endsWith(".less")) return "less";
  if (lower.endsWith(".toml")) return "toml";
  if (lower.endsWith(".prisma")) return "prisma";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "md";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".webmanifest")) return "nodot";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yml";
  if (lower.endsWith(".env") || lower.startsWith(".env.")) return "env";
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) return "sh";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".ico")) return "ico";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico"].some((ext) => lower.endsWith(ext))) return "image";
  if ([".mp4", ".webm", ".mov", ".m4v", ".ogv"].some((ext) => lower.endsWith(ext))) return "video";
  if ([".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a"].some((ext) => lower.endsWith(ext))) return "video";
  if (lower.endsWith(".svg")) return "svg";
  if (lower.endsWith(".xml")) return "xml";
  if (!lower.includes(".")) return "nodot";
  return "file";
}

export function resolveUploadFileIcon(name: string, mimeType?: string | null): string {
  const key = uploadFileIconKey(name, mimeType);
  return CAVAI_UPLOAD_FILE_ICON_ASSETS[key] || DEFAULT_UPLOAD_FILE_ICON;
}
