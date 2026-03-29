const TEXT_LIKE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "jsonc",
  "csv",
  "tsv",
  "xml",
  "log",
  "yml",
  "yaml",
  "ini",
  "cfg",
  "conf",
  "env",
  "toml",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "py",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "cc",
  "cxx",
  "h",
  "hpp",
  "hh",
  "hxx",
  "sh",
  "bash",
  "zsh",
  "fish",
  "sql",
  "properties",
  "lock",
  "dockerfile",
]);

const COMMON_TEXT_FILENAMES = new Set([
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
  ".prettierrc",
  ".prettierignore",
  ".eslintignore",
  ".eslintrc",
  ".stylelintignore",
  ".stylelintrc",
  "dockerfile",
  "makefile",
  "readme",
  "license",
  "changelog",
]);

const TEXT_LIKE_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/javascript",
  "text/javascript",
  "application/typescript",
  "text/typescript",
  "application/x-javascript",
  "application/x-sh",
  "application/x-shellscript",
  "application/x-yaml",
  "application/yaml",
]);

export const PREVIEW_SNIPPET_RANGE_BYTES = 4096;
export const PREVIEW_SNIPPET_MAX_CHARS = 800;
export const PREVIEW_THUMB_MAX_CHARS = 520;
export const PREVIEW_THUMB_MAX_LINES = 14;

function baseName(input: string): string {
  const value = String(input || "").trim();
  if (!value) return "";
  const clean = value.split("#")[0]?.split("?")[0] || value;
  const parts = clean.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : clean;
}

export function fileExtensionLower(input: string): string {
  const name = baseName(input).toLowerCase();
  if (!name) return "";
  const lastDot = name.lastIndexOf(".");
  if (lastDot > 0 && lastDot < name.length - 1) {
    return name.slice(lastDot + 1);
  }
  if (name.startsWith(".") && name.length > 1 && name.indexOf(".", 1) === -1) {
    return name.slice(1);
  }
  return "";
}

export function isTextLikeFile(name: string, mimeType?: string | null): boolean {
  const mime = String(mimeType || "").trim().toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (TEXT_LIKE_MIME_TYPES.has(mime)) return true;
  if (mime.includes("json") || mime.includes("xml") || mime.includes("yaml")) return true;

  const normalizedName = baseName(name).toLowerCase();
  if (!normalizedName) return false;
  if (normalizedName.startsWith(".env")) return true;
  if (COMMON_TEXT_FILENAMES.has(normalizedName)) return true;

  const ext = fileExtensionLower(normalizedName);
  return !!ext && TEXT_LIKE_EXTENSIONS.has(ext);
}

export function getExtensionLabel(name: string, mimeType?: string | null): string {
  const normalizedName = baseName(name).toLowerCase();
  if (normalizedName.startsWith(".env")) return "ENV";

  const ext = fileExtensionLower(normalizedName);
  if (ext) return ext.toUpperCase().slice(0, 6);

  const mime = String(mimeType || "").trim().toLowerCase();
  if (mime.startsWith("text/")) return "TXT";
  if (mime.includes("json")) return "JSON";
  if (mime.includes("xml")) return "XML";
  return "FILE";
}

export function normalizePreviewSnippetText(raw: string | null | undefined, maxChars = PREVIEW_SNIPPET_MAX_CHARS): string | null {
  const normalized = String(raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "");

  const limit = Math.max(0, Math.trunc(Number(maxChars) || PREVIEW_SNIPPET_MAX_CHARS));
  const sliced = limit > 0 ? normalized.slice(0, limit) : "";
  if (!sliced) return null;
  return sliced;
}

export function previewSnippetFromBytes(
  bytes: Uint8Array | Buffer | null | undefined,
  options: { name: string; mimeType?: string | null; maxChars?: number },
): string | null {
  if (!bytes || bytes.length === 0) return null;
  if (!isTextLikeFile(options.name, options.mimeType)) return null;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return normalizePreviewSnippetText(decoded, options.maxChars);
}

export function formatSnippetForThumbnail(
  raw: string | null | undefined,
  options?: { maxChars?: number; maxLines?: number },
): string | null {
  const maxChars = Math.max(1, Math.trunc(Number(options?.maxChars) || PREVIEW_THUMB_MAX_CHARS));
  const maxLines = Math.max(1, Math.trunc(Number(options?.maxLines) || PREVIEW_THUMB_MAX_LINES));
  const normalized = normalizePreviewSnippetText(raw, maxChars);
  if (!normalized) return null;
  const lines = normalized.split("\n").slice(0, maxLines);
  if (!lines.length) return null;
  return lines.join("\n");
}
