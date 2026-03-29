import { NextResponse } from "next/server";

import { requireCavsafePremiumPlusSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function asPositiveInt(raw: string | null, fallback: number, max = 500): number {
  const n = Number(String(raw || "").trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(max, n));
}

function csvEscape(value: unknown): string {
  const input = String(value ?? "");
  if (/[",\n]/.test(input)) {
    return `"${input.replace(/"/g, "\"\"")}"`;
  }
  return input;
}

export async function GET(req: Request) {
  try {
    const sess = await requireCavsafePremiumPlusSession(req);
    const url = new URL(req.url);
    const limit = asPositiveInt(url.searchParams.get("limit"), 100, 1000);
    const format = String(url.searchParams.get("format") || "").trim().toLowerCase();

    const rows = await prisma.cavSafeOperationLog.findMany({
      where: {
        accountId: sess.accountId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
      select: {
        id: true,
        kind: true,
        subjectType: true,
        subjectId: true,
        label: true,
        meta: true,
        createdAt: true,
        operatorUserId: true,
      },
    });

    if (format === "csv" || format === "export") {
      const header = ["id", "kind", "subjectType", "subjectId", "label", "operatorUserId", "createdAtISO", "metaJson"];
      const lines = rows.map((row) => (
        [
          row.id,
          row.kind,
          row.subjectType,
          row.subjectId,
          row.label,
          row.operatorUserId || "",
          new Date(row.createdAt).toISOString(),
          JSON.stringify(row.meta || {}),
        ].map(csvEscape).join(",")
      ));
      const csv = [header.join(","), ...lines].join("\n");
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="cavsafe-audit-${Date.now()}.csv"`,
        },
      });
    }

    return jsonNoStore({
      ok: true,
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        label: row.label,
        operatorUserId: row.operatorUserId || null,
        meta: row.meta || null,
        createdAtISO: new Date(row.createdAt).toISOString(),
      })),
    }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to load CavSafe audit log.");
  }
}

