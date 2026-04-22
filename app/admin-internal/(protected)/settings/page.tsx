import { redirect } from "next/navigation";

import {
  AdminPage,
  MetricCard,
  Panel,
} from "@/components/admin/AdminPrimitives";
import { AdminSettingsControlPanel } from "@/components/admin/AdminSettingsControlPanel";
import { getDefaultAdminPathForStaff, resolveAdminDepartment } from "@/lib/admin/access";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await requireAdminAccessFromRequestContext("/settings", { scopes: ["settings.read"] });
  if (resolveAdminDepartment(ctx.staff) !== "COMMAND") {
    redirect(getDefaultAdminPathForStaff(ctx.staff));
  }

  return (
    <AdminPage
      title="Settings"
      subtitle="Command controls for protected HQ routing, recovery, and core command operations."
    >
      <section className="hq-grid">
        <section className="hq-gridMetrics">
          <MetricCard
            label="Access"
            value="Command only"
            meta="Protected HQ settings stay limited to Command operators."
          />
          <MetricCard
            label="Scope"
            value="Core controls"
            meta="Routing, recovery, and command-level control actions live here."
          />
          <MetricCard
            label="Status"
            value="Active"
            meta="Diagnostic runtime sections were removed. Core command controls remain."
          />
        </section>

        <Panel
          title="Settings control"
          subtitle="Protected HQ command actions and operational routing live here. The runtime, auth, delivery, guardrail, and emergency detail sections were intentionally removed."
        >
          <AdminSettingsControlPanel
            platformHref="/platform"
            securityHref="/security"
            auditHref="/audit"
            alertsHref="/alerts"
          />
        </Panel>
      </section>
    </AdminPage>
  );
}
