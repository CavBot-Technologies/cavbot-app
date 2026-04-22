import { AdminPage } from "@/components/admin/AdminPrimitives";
import { AdminBroadcastCenter } from "@/components/admin/AdminBroadcastCenter";
import { dispatchDueBroadcastCampaigns, listBroadcastCampaigns } from "@/lib/admin/broadcasts.server";
import { hasAdminScope } from "@/lib/admin/permissions";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BroadcastsPage() {
  const ctx = await requireAdminAccessFromRequestContext("/broadcasts", { scopes: ["notifications.read"] });
  await dispatchDueBroadcastCampaigns({
    userId: ctx.userSession.sub,
    staffId: ctx.staff.id,
  });
  const campaigns = await listBroadcastCampaigns({ includeDeliveries: true });
  const initialCampaigns = JSON.parse(JSON.stringify(campaigns));

  return (
    <AdminPage
      title="Broadcast Center"
      subtitle="Command, Operations, and Human Resources can schedule and deliver official CavBot communications with full campaign tracking."
    >
      <AdminBroadcastCenter
        initialCampaigns={initialCampaigns}
        canBroadcastUsers={hasAdminScope(ctx.staff, "broadcast.users")}
        canBroadcastStaff={hasAdminScope(ctx.staff, "broadcast.staff")}
      />
    </AdminPage>
  );
}
