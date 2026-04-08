type DbErrorLike = {
  code?: unknown;
  message?: unknown;
  meta?: {
    code?: unknown;
    message?: unknown;
  };
};

function normalizeComparable(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function messageIncludesHint(message: string, hint: string) {
  const loweredMessage = String(message || "").toLowerCase();
  const loweredHint = String(hint || "").toLowerCase();
  if (!loweredHint) return false;
  if (loweredMessage.includes(loweredHint)) return true;
  const normalizedHint = normalizeComparable(hint);
  return normalizedHint ? normalizeComparable(message).includes(normalizedHint) : false;
}

function messageFor(err: unknown) {
  const candidate = err as DbErrorLike;
  return String(candidate?.meta?.message || candidate?.message || "").toLowerCase();
}

function prismaCodeFor(err: unknown) {
  return String((err as DbErrorLike)?.code || "").toUpperCase();
}

function dbCodeFor(err: unknown) {
  return String((err as DbErrorLike)?.meta?.code || "").toUpperCase();
}

export function isMissingTableError(err: unknown, hints: string[] = []) {
  const prismaCode = prismaCodeFor(err);
  const dbCode = dbCodeFor(err);
  const message = messageFor(err);

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  if (message.includes("does not exist in the current database")) return true;

  const mentionsTableShape =
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("table") ||
    message.includes("model");

  return mentionsTableShape && hints.some((hint) => messageIncludesHint(message, hint));
}

export function isMissingColumnError(err: unknown, hints: string[] = []) {
  const prismaCode = prismaCodeFor(err);
  const dbCode = dbCodeFor(err);
  const message = messageFor(err);

  if (prismaCode === "P2022") return true;
  if (dbCode === "42703") return true;

  const mentionsColumnShape =
    message.includes("unknown argument") ||
    message.includes("column") ||
    message.includes("field") ||
    message.includes("select");

  return mentionsColumnShape && hints.some((hint) => messageIncludesHint(message, hint));
}

export function isMissingFieldError(err: unknown, hints: string[] = []) {
  const message = messageFor(err);

  const mentionsFieldShape =
    message.includes("unknown argument") ||
    message.includes("unknown field") ||
    message.includes("field") ||
    message.includes("select") ||
    message.includes("include");

  return mentionsFieldShape && hints.some((hint) => messageIncludesHint(message, hint));
}

export function isSchemaMismatchError(
  err: unknown,
  opts: { tables?: string[]; columns?: string[]; fields?: string[] } = {}
) {
  return (
    isMissingTableError(err, opts.tables || []) ||
    isMissingColumnError(err, opts.columns || []) ||
    isMissingFieldError(err, opts.fields || [])
  );
}
