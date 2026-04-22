import { AdminPage, Panel } from "@/components/admin/AdminPrimitives";

export default function Loading() {
  return (
    <AdminPage
      title="Loading account dossier"
      subtitle="Preparing workspace identity, plan state, seat usage, project inventory, and recent activity."
    >
      <section className="hq-detailGrid">
        <div className="hq-stack">
          <Panel title="Account overview" subtitle="Workspace identity, billing posture, and lifecycle context.">
            <div className="hq-loadingGrid">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={`overview-${index}`} className="hq-kvItem">
                  <div className="hq-kvLabel">
                    <span className="hq-loadingBar is-label" aria-hidden="true" />
                  </div>
                  <div className="hq-kvValue">
                    <span className="hq-loadingBar is-value" aria-hidden="true" />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Projects and sites" subtitle="Active project inventory across the workspace.">
            <div className="hq-loadingTable">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`project-${index}`} className="hq-loadingTableRow hq-loadingTableRowFour">
                  <span className="hq-loadingBar is-row" aria-hidden="true" />
                  <span className="hq-loadingBar is-row" aria-hidden="true" />
                  <span className="hq-loadingBar is-metaWide" aria-hidden="true" />
                  <span className="hq-loadingBar is-row" aria-hidden="true" />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Members" subtitle="Workspace seats, owner/admin/member roles, and recent last-login activity.">
            <div className="hq-loadingTable">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`member-${index}`} className="hq-loadingTableRow hq-loadingTableRowFour">
                  <span className="hq-loadingBar is-row" aria-hidden="true" />
                  <span className="hq-loadingBar is-row" aria-hidden="true" />
                  <span className="hq-loadingBar is-row" aria-hidden="true" />
                  <span className="hq-loadingBar is-row" aria-hidden="true" />
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="hq-stack">
          <Panel title="Plan and usage" subtitle="Commercial health plus platform and security traffic.">
            <div className="hq-loadingGrid">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={`usage-${index}`} className="hq-kvItem">
                  <div className="hq-kvLabel">
                    <span className="hq-loadingBar is-label" aria-hidden="true" />
                  </div>
                  <div className="hq-kvValue">
                    <span className="hq-loadingBar is-value" aria-hidden="true" />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Alerts and incidents" subtitle="Recent workspace notices and active or recent incidents relevant to operators.">
            <div className="hq-loadingList">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={`notice-${index}`} className="hq-listRow">
                  <div className="hq-loadingStack">
                    <span className="hq-loadingBar is-row" aria-hidden="true" />
                    <span className="hq-loadingBar is-meta" aria-hidden="true" />
                  </div>
                  <span className="hq-loadingBar is-chip" aria-hidden="true" />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Recent scans" subtitle="Latest scan jobs across projects in this workspace.">
            <div className="hq-loadingList">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={`scan-${index}`} className="hq-listRow">
                  <div className="hq-loadingStack">
                    <span className="hq-loadingBar is-row" aria-hidden="true" />
                    <span className="hq-loadingBar is-metaWide" aria-hidden="true" />
                  </div>
                  <span className="hq-loadingBar is-chip" aria-hidden="true" />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </section>
    </AdminPage>
  );
}
