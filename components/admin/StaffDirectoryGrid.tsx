"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AvatarBadge, Badge, EmptyState, KeyValueGrid } from "@/components/admin/AdminPrimitives";
import { getDepartmentAvatarTone, hasStaffLeadershipStar } from "@/lib/admin/staffDisplay";

export type StaffDirectoryCardData = {
  id: string;
  name: string;
  email: string;
  positionLabel: string;
  statusLabel: string;
  statusValue: string;
  statusTone: "good" | "watch" | "bad";
  onboardingLabel: string;
  onboardingValue: string;
  onboardingTone: "good" | "watch" | "bad";
  lifecycleStateLabel: string;
  lifecycleStateValue: string;
  departmentLabel: string;
  departmentValue: string;
  departmentTone: "good" | "watch" | "bad";
  systemRoleValue: string;
  usernameLabel: string;
  fullStaffCodeLabel: string;
  maskedStaffCode: string;
  shortStaffCodeLabel: string;
  lastAdminLoginLabel: string;
  lastStepUpLabel: string;
  linkedUserCreatedLabel: string;
  lastCavBotLoginLabel: string;
  invitedEmailLabel: string;
  invitedEmailValue: string;
  extraScopesLabel: string;
  overrideCountLabel: string;
  notesLabel: string;
  notesValue?: string | null;
  updatedLabel: string;
  suspendedUntilLabel: string;
  manageable: boolean;
  canSendAccessReminder?: boolean;
  managementLockedLabel?: string | null;
  avatarImage?: string | null;
  avatarTone?: string | null;
  detailHref?: string | null;
  helperNote?: string | null;
  isPreview?: boolean;
  previewNote?: string | null;
};

function staffDirectoryAvatarTone(member: StaffDirectoryCardData) {
  if (member.avatarImage) return member.avatarTone;
  return getDepartmentAvatarTone(member.departmentValue);
}

export function StaffDirectoryGrid(props: {
  staff: StaffDirectoryCardData[];
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const activeStaff = props.staff.find((member) => member.id === activeId) || null;

  useEffect(() => {
    if (!activeStaff) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingHref) setActiveId(null);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeStaff, pendingHref]);

  useEffect(() => {
    if (!pendingHref) return undefined;
    const timeout = window.setTimeout(() => setPendingHref(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [pendingHref]);

  if (!props.staff.length) {
    return <EmptyState title="No operators match these filters." subtitle="Adjust the search, department, status, or onboarding filters to widen the team directory." />;
  }

  const resolveNameSize = (value: string) => {
    const length = String(value || "").trim().length;
    if (length >= 24) return "xlong";
    if (length >= 18) return "long";
    return "default";
  };

  const openRoute = (href: string) => {
    setPendingHref(href);
    router.push(href);
  };

  const openCard = (staffId: string) => {
    setPendingHref(null);
    setActiveId(staffId);
  };

  const routePendingLabel = pendingHref?.endsWith("/manage") ? "Opening management surface..." : "Opening full dossier...";

  const hasLeadershipStar = (member: StaffDirectoryCardData) => (
    hasStaffLeadershipStar({
      positionTitle: member.positionLabel,
      department: member.departmentLabel,
      systemRole: member.systemRoleValue,
    })
  );

  const renderActions = (member: StaffDirectoryCardData) => {
    if (!member.detailHref) {
      return (
        <p className="hq-helperText">
          {member.previewNote || member.helperNote || "Team record detail is unavailable for this record."}
        </p>
      );
    }

    return (
      <div className="hq-clientModalActions">
        <button
          type="button"
          className="hq-buttonGhost"
          disabled={Boolean(pendingHref)}
          onClick={() => openRoute(member.detailHref!)}
        >
          Full dossier
        </button>
        <button
          type="button"
          className="hq-buttonGhost"
          disabled={Boolean(pendingHref)}
          onClick={() => openRoute(`${member.detailHref!}/manage`)}
        >
          Manage
        </button>
      </div>
    );
  };

  return (
    <>
      <div className="hq-clientDirectoryGrid">
        {props.staff.map((member) => (
          <button
            key={member.id}
            type="button"
            className="hq-clientDirectoryCard hq-staffDirectoryCard"
            onClick={() => openCard(member.id)}
            aria-haspopup="dialog"
            aria-label={`Open team card for ${member.name}`}
          >
            {hasLeadershipStar(member) ? (
              <span className="hq-staffDirectoryBoardStar" aria-hidden="true">
                ★
              </span>
            ) : null}
            {member.isPreview ? <span className="hq-clientPreviewChip">Preview</span> : null}
            <AvatarBadge
              name={member.name}
              email={member.email}
              image={member.avatarImage}
              tone={staffDirectoryAvatarTone(member)}
              size="lg"
            />
            <div className="hq-staffDirectoryIdentity">
              <div className="hq-clientDirectoryName" data-name-size={resolveNameSize(member.name)} title={member.name}>
                {member.name}
              </div>
              <div className="hq-staffDirectoryRole" title={member.positionLabel}>
                {member.positionLabel}
              </div>
            </div>
          </button>
        ))}
      </div>

      {activeStaff ? (
        <div className="hq-clientModalRoot" role="dialog" aria-modal="true" aria-labelledby={`team-modal-title-${activeStaff.id}`}>
          <button
            type="button"
            className="hq-clientModalBackdrop"
            aria-label="Close team card"
            onClick={() => {
              if (!pendingHref) {
                setPendingHref(null);
                setActiveId(null);
              }
            }}
          />
          <div className="hq-clientModalPanel" data-route-pending={pendingHref ? "true" : "false"} aria-busy={pendingHref ? "true" : undefined}>
            <div className="hq-clientModalTopbar">
              <div className="hq-clientModalHero">
                <AvatarBadge
                  name={activeStaff.name}
                  email={activeStaff.email}
                  image={activeStaff.avatarImage}
                  tone={staffDirectoryAvatarTone(activeStaff)}
                  size="lg"
                />
                <div className="hq-clientModalIdentity">
                  <div className="hq-clientModalTitleRow">
                    <h3 id={`team-modal-title-${activeStaff.id}`} className="hq-clientModalTitle">{activeStaff.name}</h3>
                    {hasLeadershipStar(activeStaff) ? (
                      <span className="hq-staffLeadershipInlineStar" aria-hidden="true">
                        ★
                      </span>
                    ) : null}
                    {activeStaff.isPreview ? <Badge className="hq-clientModalPreviewBadge">Preview</Badge> : null}
                  </div>
                  <p className="hq-clientModalSub">{activeStaff.positionLabel}</p>
                  <p className="hq-clientModalEmail">{activeStaff.email}</p>
                  {renderActions(activeStaff)}
                </div>
              </div>
              <button
                type="button"
                className="hq-clientModalClose"
                onClick={() => {
                  if (!pendingHref) {
                    setPendingHref(null);
                    setActiveId(null);
                  }
                }}
                aria-label="Close team card"
                disabled={Boolean(pendingHref)}
              >
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>

            {pendingHref ? (
              <div className="hq-clientModalRouteState" role="status" aria-live="polite">
                {routePendingLabel}
              </div>
            ) : null}

            <div className="hq-clientModalStats">
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Status</div>
                <div className="hq-clientStatValue">{activeStaff.statusLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Onboarding</div>
                <div className="hq-clientStatValue">{activeStaff.onboardingLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Team ID</div>
                <div className="hq-clientStatValue">{activeStaff.shortStaffCodeLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Department</div>
                <div className="hq-clientStatValue">{activeStaff.departmentLabel}</div>
              </article>
            </div>

            <KeyValueGrid
              items={[
                { label: "Masked team ID", value: activeStaff.maskedStaffCode },
                { label: "Username", value: activeStaff.usernameLabel },
                { label: "Department", value: activeStaff.departmentLabel },
                { label: "Title", value: activeStaff.positionLabel },
                { label: "Access", value: activeStaff.statusLabel },
                { label: "Onboarding", value: activeStaff.onboardingLabel },
                { label: "Lifecycle", value: activeStaff.lifecycleStateLabel },
                { label: "Suspended until", value: activeStaff.suspendedUntilLabel },
                { label: "Last admin login", value: activeStaff.lastAdminLoginLabel },
                { label: "Last step-up", value: activeStaff.lastStepUpLabel },
                { label: "Linked user created", value: activeStaff.linkedUserCreatedLabel },
                { label: "Last CavBot login", value: activeStaff.lastCavBotLoginLabel },
                { label: "Mailbox", value: activeStaff.invitedEmailLabel },
                { label: "Extra scopes", value: activeStaff.extraScopesLabel },
                { label: "Notes", value: activeStaff.notesLabel },
                { label: "Updated", value: activeStaff.updatedLabel },
              ]}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
