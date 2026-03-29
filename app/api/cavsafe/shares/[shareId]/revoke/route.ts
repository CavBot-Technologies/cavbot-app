import { jsonNoStore } from "@/lib/cavsafe/http.server";
import { requireUserSession } from "@/lib/security/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  await requireUserSession(req);
  return jsonNoStore(
    {
      ok: false,
      error: "CAVSAFE_PRIVATE_SHARE_ONLY",
      message: "Invite-only. No public links. Stays inside CavSafe.",
    },
    403
  );
}
