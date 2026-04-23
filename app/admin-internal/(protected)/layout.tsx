import AdminShell from "@/components/admin/AdminShell";
import { ApiAuthError, getAppOrigin } from "@/lib/apiAuth";
import { getDefaultAdminPathForStaff, resolveAdminDepartment } from "@/lib/admin/access";
import { requireAdminAccessFromRequestContext, maskStaffCode } from "@/lib/admin/staff";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  let staff;
  try {
    const ctx = await requireAdminAccessFromRequestContext("/overview");
    staff = ctx.staff;
  } catch (error) {
    if (error instanceof ApiAuthError && error.code === "ADMIN_AUTH_REQUIRED") {
      redirect("/sign-in?next=%2F");
    }
    throw error;
  }
  const homeHref = getDefaultAdminPathForStaff(staff);
  const appAccountHref = new URL("/", `${getAppOrigin()}/`).toString();
  const ownerEmail = String(process.env.ADMIN_OWNER_EMAIL || process.env.CAVBOT_OWNER_EMAIL || "").trim().toLowerCase();
  const configuredOwnerName = String(process.env.ADMIN_OWNER_NAME || "").trim();
  const emailLocal = String(staff.user.email || "").trim().split("@")[0] || "";
  const username = String(staff.user.username || "").trim().toLowerCase();
  const displayName = String(staff.user.displayName || "").trim();
  const displayNameLower = displayName.toLowerCase();
  const isPlaceholderDisplayName =
    !displayName
    || displayNameLower === emailLocal.toLowerCase()
    || (username && displayNameLower === username);
  const preferredName =
    String(staff.user.fullName || "").trim()
    || (!isPlaceholderDisplayName ? displayName : "")
    || (String(staff.user.email || "").trim().toLowerCase() === ownerEmail ? configuredOwnerName : "")
    || emailLocal
    || "CavBot";

  return (
    <AdminShell
      staff={{
        displayName: preferredName,
        username: staff.user.username,
        avatarImage: staff.user.avatarImage,
        avatarTone: staff.user.avatarTone,
        positionTitle: staff.positionTitle,
        systemRole: staff.systemRole,
        department: resolveAdminDepartment(staff),
        scopes: staff.scopes,
        maskedStaffCode: maskStaffCode(staff.staffCode),
      }}
      homeHref={homeHref}
      appAccountHref={appAccountHref}
      initialMailUnreadCount={0}
      initialMailThreads={[]}
      initialMailReady={false}
    >
      {children}
    </AdminShell>
  );
}
