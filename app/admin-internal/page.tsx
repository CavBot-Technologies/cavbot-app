import { redirect } from "next/navigation";

import { ApiAuthError } from "@/lib/apiAuth";
import { getDefaultAdminPathForStaff } from "@/lib/admin/access";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminRootPage() {
  try {
    const ctx = await requireAdminAccessFromRequestContext("/");
    redirect(getDefaultAdminPathForStaff(ctx.staff));
  } catch (error) {
    if (error instanceof ApiAuthError && error.code === "ADMIN_AUTH_REQUIRED") {
      redirect("/sign-in?next=%2F");
    }
    throw error;
  }
}
