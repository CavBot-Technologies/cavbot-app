import { AdminPage, Panel } from "@/components/admin/AdminPrimitives";

export default function LoadingAccountManageSurface() {
  return (
    <AdminPage
      title="Loading workspace management"
      subtitle="Preparing trust, billing, customer success, and note controls."
    >
      <section className="hq-grid hq-gridTwo hq-manageIntroGrid">
        <Panel title="Manage overview" subtitle="Identity and billing context for the selected workspace.">
          <div className="hq-loadingGrid">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={`account-manage-overview-${index}`} className="hq-kvItem">
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

        <Panel title="Operational posture" subtitle="Preparing trust, billing, and customer context.">
          <div className="hq-loadingGrid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`account-manage-posture-${index}`} className="hq-kvItem">
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
      </section>

      <Panel title="Action Center" subtitle="Preparing workspace trust, billing, and customer controls.">
        <div className="hq-opSectionStack">
          <div className="hq-opSummaryGrid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`account-manage-summary-${index}`} className="hq-opSummaryCard">
                <span className="hq-loadingBar is-label" aria-hidden="true" />
                <span className="hq-loadingBar is-value" aria-hidden="true" />
                <span className="hq-loadingBar is-meta" aria-hidden="true" />
              </div>
            ))}
          </div>
          <div className="hq-opGrid">
            {Array.from({ length: 2 }).map((_, sectionIndex) => (
              <section key={`account-manage-section-${sectionIndex}`} className="hq-opSection">
                <div className="hq-loadingGrid">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={`account-manage-card-${sectionIndex}-${index}`} className="hq-opActionCard">
                      <span className="hq-loadingBar is-row" aria-hidden="true" />
                      <span className="hq-loadingBar is-metaWide" aria-hidden="true" />
                      <span className="hq-loadingBar is-value" aria-hidden="true" />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </Panel>
    </AdminPage>
  );
}
