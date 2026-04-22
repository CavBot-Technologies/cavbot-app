import { AdminPage } from "@/components/admin/AdminPrimitives";
import { AdminCaseWorkbench } from "@/components/admin/AdminCaseWorkbench";
import { resolveAdminDepartment } from "@/lib/admin/access";
import { listAdminCases, syncOperationalCasesFromSignals } from "@/lib/admin/cases.server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const ctx = await requireAdminAccessFromRequestContext("/cases", { scopes: ["security.read"] });
  const department = resolveAdminDepartment(ctx.staff);
  if (department !== "COMMAND" && department !== "SECURITY") {
    redirect("/security");
  }
  await syncOperationalCasesFromSignals();
  const [cases, staff] = await Promise.all([
    listAdminCases({ take: 80 }),
    prisma.staffProfile.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ positionTitle: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        positionTitle: true,
        user: {
          select: {
            email: true,
            username: true,
            displayName: true,
            fullName: true,
          },
        },
      },
    }),
  ]);

  return (
    <AdminPage
      title="Case Management"
      subtitle="Security-owned workbench for queues, assignees, outcomes, trust actions, and unresolved customer signals."
    >
      <AdminCaseWorkbench
        initialCases={JSON.parse(JSON.stringify(cases))}
        staffOptions={JSON.parse(JSON.stringify(
          staff.map((member) => ({
            id: member.id,
            name: member.user.displayName || member.user.fullName || member.user.username || member.user.email,
            positionTitle: member.positionTitle,
          })),
        ))}
      />
    </AdminPage>
  );
}
