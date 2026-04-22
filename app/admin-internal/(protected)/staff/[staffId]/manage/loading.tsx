import { AdminPage, Panel } from "@/components/admin/AdminPrimitives";

export default function LoadingTeamManageSurface() {
  return (
    <AdminPage
      title="Loading team management"
      subtitle="Preparing placement, lifecycle, onboarding, and access controls."
    >
      <section className="hq-grid hq-gridTwo hq-manageIntroGrid">
        <Panel title="Manage overview" subtitle="Identity and access context for the selected team record.">
          <div className="hq-loadingGrid">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={`team-manage-overview-${index}`} className="hq-kvItem">
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

        <Panel title="Operational posture" subtitle="Live readiness, access, and onboarding context.">
          <div className="hq-loadingGrid">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={`team-manage-posture-${index}`} className="hq-kvItem">
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

      <Panel title="Action Center" subtitle="Preparing team placement, lifecycle, onboarding, and access controls.">
        <div className="hq-opSectionStack">
          <div className="hq-opSummaryGrid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`team-manage-summary-${index}`} className="hq-opSummaryCard">
                <span className="hq-loadingBar is-label" aria-hidden="true" />
                <span className="hq-loadingBar is-value" aria-hidden="true" />
                <span className="hq-loadingBar is-meta" aria-hidden="true" />
              </div>
            ))}
          </div>
          <div className="hq-opGrid">
            {Array.from({ length: 2 }).map((_, sectionIndex) => (
              <section key={`team-manage-section-${sectionIndex}`} className="hq-opSection">
                <div className="hq-loadingGrid">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={`team-manage-card-${sectionIndex}-${index}`} className="hq-opActionCard">
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
