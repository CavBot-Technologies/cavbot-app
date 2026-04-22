import { AdminPage, Panel } from "@/components/admin/AdminPrimitives";

export default function LoadingTeamDossier() {
  return (
    <AdminPage
      title="Loading team dossier"
      subtitle="Preparing team identity, access posture, onboarding state, and audit history."
    >
      <section className="hq-detailGrid">
        <div className="hq-stack">
          <Panel title="Team identity" subtitle="Linked CavBot user identity and authorization posture.">
            <div className="hq-loadingGrid">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={`team-identity-${index}`} className="hq-kvItem">
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

          <Panel title="Permissions and notes" subtitle="Department presets, overrides, mailbox, and notes.">
            <div className="hq-loadingGrid">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={`team-permissions-${index}`} className="hq-kvItem">
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
        </div>

        <div className="hq-stack">
          <Panel title="Management handoff" subtitle="Preparing lifecycle, access, and placement context.">
            <div className="hq-loadingGrid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`team-handoff-${index}`} className="hq-kvItem">
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

          <Panel title="Audit history" subtitle="Preparing recent team-specific audit records.">
            <div className="hq-loadingList">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={`team-audit-${index}`} className="hq-listRow">
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
