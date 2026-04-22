import { AdminPage, Panel } from "@/components/admin/AdminPrimitives";

export default function ClientDetailLoading() {
  return (
    <AdminPage
      title="Loading client dossier"
      subtitle="Preparing identity, workspace membership, usage, and internal activity."
    >
      <section className="hq-detailGrid">
        <div className="hq-stack">
          <Panel title="Overview" subtitle="Identity, contact, membership, and lifecycle state.">
            <p className="hq-helperText">Loading client overview…</p>
          </Panel>
          <Panel title="Workspace membership" subtitle="All account relationships, tiers, plan status, and workspace footprint.">
            <p className="hq-helperText">Loading workspace membership…</p>
          </Panel>
          <Panel title="Projects, sites, and origins" subtitle="Current active projects and monitored site origins across every workspace membership.">
            <p className="hq-helperText">Loading project inventory…</p>
          </Panel>
        </div>

        <div className="hq-stack">
          <Panel title="Usage" subtitle="Session, message, and security usage attributed to this client.">
            <p className="hq-helperText">Loading usage totals…</p>
          </Panel>
          <Panel title="Recent sessions" subtitle="Latest persisted CavBot session surfaces for this client.">
            <p className="hq-helperText">Loading recent sessions…</p>
          </Panel>
          <Panel title="Internal activity" subtitle="Latest client-side notifications and relevant audit trail entries.">
            <p className="hq-helperText">Loading internal activity…</p>
          </Panel>
        </div>
      </section>
    </AdminPage>
  );
}
