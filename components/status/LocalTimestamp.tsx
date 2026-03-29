"use client";

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
});

function formatLocalTimestamp(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return timestampFormatter.format(parsed);
}

export default function LocalTimestamp({
  value,
  fallback = "—",
}: {
  value?: string | null;
  fallback?: string;
}) {
  if (!value) return <>{fallback}</>;
  const label =
    typeof window === "undefined"
      ? fallback
      : formatLocalTimestamp(value) ?? fallback;

  return (
    <time dateTime={value} suppressHydrationWarning>
      {label}
    </time>
  );
}
