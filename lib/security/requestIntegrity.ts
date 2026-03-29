import type { NextRequest } from "next/server";

export const REQUEST_INTEGRITY_HEADER = "x-cavbot-csrf";

function s(value: unknown): string {
  return String(value ?? "").trim();
}

export function hasRequestIntegrityHeader(req: Request | NextRequest): boolean {
  const value = s(req.headers.get(REQUEST_INTEGRITY_HEADER)).toLowerCase();
  return value === "1" || value === "true";
}
