const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069]/g;
const CONTROL_CHARS_TEST_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const BIDI_CONTROL_TEST_RE = /[\u202A-\u202E\u2066-\u2069]/;
const MAX_DEPTH = 40;
const MAX_ARRAY_LENGTH = 5000;
const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function toWellFormed(value: string): string {
  const withMethod = value as string & { toWellFormed?: () => string };
  if (typeof withMethod.toWellFormed === "function") return withMethod.toWellFormed();
  return value;
}

export function sanitizeInputString(value: unknown): string {
  const source = typeof value === "string" ? value : String(value ?? "");
  return toWellFormed(source).replace(CONTROL_CHARS_RE, "").replace(BIDI_CONTROL_RE, "");
}

function sanitizeUnknownDeepInternal(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return null;
  if (typeof value === "string") return sanitizeInputString(value);
  if (Array.isArray(value)) {
    const bounded = value.length > MAX_ARRAY_LENGTH ? value.slice(0, MAX_ARRAY_LENGTH) : value;
    return bounded.map((entry) => sanitizeUnknownDeepInternal(entry, depth + 1));
  }
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = sanitizeInputString(rawKey);
    if (!key || PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    out[key] = sanitizeUnknownDeepInternal(rawValue, depth + 1);
  }
  return out;
}

export function sanitizeUnknownDeep<T>(value: T): T {
  return sanitizeUnknownDeepInternal(value, 0) as T;
}

export async function readSanitizedJson<T = unknown>(req: Request, fallback: T | null = null): Promise<T | null> {
  try {
    const raw = await req.json();
    return sanitizeUnknownDeep(raw) as T;
  } catch {
    return sanitizeUnknownDeep(fallback) as T | null;
  }
}

function sanitizeFormDataValue(value: FormDataEntryValue): FormDataEntryValue {
  if (typeof value === "string") return sanitizeInputString(value);
  const safeName = sanitizeInputString(value.name);
  if (safeName === value.name || typeof File === "undefined") return value;
  return new File([value], safeName || "upload", {
    type: value.type,
    lastModified: value.lastModified,
  });
}

export function sanitizeFormData(form: FormData): FormData {
  const out = new FormData();
  for (const [key, value] of form.entries()) {
    out.append(key, sanitizeFormDataValue(value));
  }
  return out;
}

export async function readSanitizedFormData(req: Request, fallback: FormData | null = null): Promise<FormData | null> {
  try {
    const form = await req.formData();
    return sanitizeFormData(form);
  } catch {
    return fallback;
  }
}

export function isUnsafePathname(pathname: string): boolean {
  try {
    const decoded = decodeURIComponent(String(pathname || ""));
    return CONTROL_CHARS_TEST_RE.test(decoded) || BIDI_CONTROL_TEST_RE.test(decoded);
  } catch {
    return true;
  }
}

export function sanitizeQueryParamValue(value: string): string {
  return sanitizeInputString(value);
}
