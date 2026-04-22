import Link from "next/link";

import { AdminPage, Badge, MetricCard, Panel } from "@/components/admin/AdminPrimitives";
import { listAdminCases } from "@/lib/admin/cases.server";
import { listAccountDisciplineStates } from "@/lib/admin/accountDiscipline.server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { listUserDisciplineStates } from "@/lib/admin/userDiscipline.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatDateLabel(value?: Date | string | null) {
  if (!value) return "Not set";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default async function TrustSafetyPage() {
  await requireAdminAccessFromRequestContext("/security/trust", { scopes: ["security.read"] });

  const [accountDiscipline, userDiscipline, trustCases] = await Promise.all([
    listAccountDisciplineStates({
      statuses: ["SUSPENDED", "REVOKED"],
      take: 40,
    }),
    listUserDisciplineStates({
      statuses: ["SUSPENDED", "REVOKED"],
      take: 40,
    }),
    listAdminCases({ queue: "TRUST_AND_SAFETY", take: 40 }),
  ]);

  const accountIds = Array.from(new Set(accountDiscipline.map((row) => row.accountId)));
  const userIds = Array.from(new Set(userDiscipline.map((row) => row.userId)));
  const [accounts, users] = await Promise.all([
    accountIds.length
      ? prisma.account.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            fullName: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const userMap = new Map(users.map((user) => [user.id, user]));

  return (
    <AdminPage
      title="Trust & Safety"
      subtitle="User suspensions, account suspensions, revokes, session actions, and the linked investigation queue."
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="User actions" value={userDiscipline.length} meta="Active user suspensions or revokes" />
        <MetricCard label="Account actions" value={accountDiscipline.length} meta="Active workspace suspensions or revokes" />
        <MetricCard label="Trust cases" value={trustCases.length} meta="Open or recent trust investigations" />
        <MetricCard label="Critical cases" value={trustCases.filter((caseItem) => caseItem.priority === "CRITICAL").length} meta="Cases requiring immediate response" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel title="Account discipline" subtitle="Workspace-level suspensions and permanent revokes.">
          <div className="hq-list">
            {accountDiscipline.length ? accountDiscipline.map((row) => {
              const account = accountMap.get(row.accountId);
              return (
                <div key={row.accountId} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">
                      <Link href={`/accounts/${row.accountId}`}>{account?.name || "Workspace"}</Link>
                    </div>
                    <div className="hq-listMeta">
                      Violations {row.violationCount} · updated {formatDateLabel(row.updatedAtISO)} · {row.note || "No note"}
                    </div>
                  </div>
                  <Badge tone={row.status === "REVOKED" ? "bad" : "watch"}>{row.status}</Badge>
                </div>
              );
            }) : <p className="hq-helperText">No account discipline currently active.</p>}
          </div>
        </Panel>

        <Panel title="User discipline" subtitle="Identity-level suspensions, revokes, and recovery intervention state.">
          <div className="hq-list">
            {userDiscipline.length ? userDiscipline.map((row) => {
              const user = userMap.get(row.userId);
              const label = user?.displayName || user?.fullName || user?.username || user?.email || "User";
              return (
                <div key={row.userId} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">
                      <Link href={`/clients/${row.userId}`}>{label}</Link>
                    </div>
                    <div className="hq-listMeta">
                      Violations {row.violationCount} · recovery {formatDateLabel(row.lastRecoveryResetAtISO)} · sessions {formatDateLabel(row.lastSessionKillAtISO)}
                    </div>
                  </div>
                  <Badge tone={row.status === "REVOKED" ? "bad" : "watch"}>{row.status}</Badge>
                </div>
              );
            }) : <p className="hq-helperText">No user discipline currently active.</p>}
          </div>
        </Panel>
      </section>

      <section className="hq-grid">
        <Panel title="Linked investigations" subtitle="Trust cases opened from discipline actions and security signals.">
          <div className="hq-list">
            {trustCases.length ? trustCases.map((caseItem) => (
              <div key={caseItem.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">
                    <Link href="/cases">{caseItem.caseCode}</Link>
                  </div>
                  <div className="hq-listMeta">{caseItem.subject} · {caseItem.status} · updated {formatDateLabel(caseItem.updatedAt)}</div>
                </div>
                <Badge tone={caseItem.priority === "CRITICAL" ? "bad" : caseItem.priority === "HIGH" ? "watch" : "good"}>{caseItem.priority}</Badge>
              </div>
            )) : <p className="hq-helperText">No trust investigations are open right now.</p>}
          </div>
        </Panel>
      </section>
    </AdminPage>
  );
}
