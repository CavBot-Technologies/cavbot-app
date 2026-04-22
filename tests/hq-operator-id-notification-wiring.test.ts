import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("operator onboarding delivers staff ID through notifications instead of email", () => {
  const onboardingSource = read("lib/admin/operatorOnboarding.server.ts");
  const acceptSource = read("app/api/admin/staff/invites/accept/route.ts");

  assert.equal(onboardingSource.includes('const title = truncateText(args.title || "You have successfully been onboarded"'), true);
  assert.equal(onboardingSource.includes('const body = truncateText(args.body || "Click to view your staff ID."'), true);
  assert.equal(onboardingSource.includes('revealType: "staff_id"'), true);
  assert.equal(onboardingSource.includes("sendOperatorIdReadyEmail"), false);

  assert.equal(acceptSource.includes("createOperatorIdReadyNotification({"), true);
  assert.equal(acceptSource.includes("sendOperatorIdReadyEmail"), false);
  assert.equal(acceptSource.includes("Check your notifications to view your staff ID."), true);
});

test("operator staff ID reveal is fetched on demand and rendered in both notification surfaces", () => {
  const revealRoute = read("app/api/notifications/operator-id/route.ts");
  const shellSource = read("components/AppShell.tsx");
  const notificationsPage = read("app/notifications/page.tsx");

  assert.equal(revealRoute.includes("HQ_NOTIFICATION_KINDS.OPERATOR_ID_READY"), true);
  assert.equal(revealRoute.includes("staffCode: staffProfile.staffCode"), true);
  assert.equal(revealRoute.includes("formatAdminDepartmentLabel"), true);

  assert.equal(shellSource.includes("OperatorIdRevealModal"), true);
  assert.equal(shellSource.includes("isOperatorIdReadyNotification"), true);
  assert.equal(shellSource.includes("View staff ID"), true);

  assert.equal(notificationsPage.includes("OperatorIdRevealModal"), true);
  assert.equal(notificationsPage.includes("View staff ID"), true);
});

test("staff IDs are not exposed by HQ emails and recovery routes now point users back into CavBot", () => {
  const challengeSource = read("app/api/admin/session/challenge/route.ts");
  const forgotRoute = read("app/api/admin/forgot-staff-id/route.ts");
  const forgotPage = read("app/admin-internal/forgot-staff-id/page.tsx");
  const inviteSource = read("app/api/admin/staff/invites/route.ts");

  assert.equal(challengeSource.includes("Staff ID:"), false);

  assert.equal(forgotRoute.includes("createOperatorIdReadyNotification({"), true);
  assert.equal(forgotRoute.includes("staff IDs are no longer sent by email"), true);
  assert.equal(forgotRoute.includes("Use the staff ID below"), false);

  assert.equal(forgotPage.includes("surface the staff ID only inside CavBot notifications"), true);
  assert.equal(forgotPage.includes("Send secure notice"), true);

  assert.equal(inviteSource.includes("securely inside CavBot notifications"), true);
});
