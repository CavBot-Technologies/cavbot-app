// app/u/[username]/page.tsx
import "./public-profile.css";

import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type React from "react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import CdnBadgeEyes from "@/components/CdnBadgeEyes";
import { LockIcon } from "@/components/LockIcon";
import { getSession } from "@/lib/apiAuth";
import { findPublicProfileUserByUsername, getAuthPool } from "@/lib/authDb";
import { prisma } from "@/lib/prisma";
import {
  isAllowedReservedPublicUsername,
  isBasicUsername,
  isReservedUsername,
  normalizeUsername,
  RESERVED_ROUTE_SLUGS,
} from "@/lib/username";
import { buildPublicProfileViewModel } from "@/lib/publicProfile/publicProfile.server";
import {
  resolvePublicProfileViewerTeamState,
  resolvePublicProfileWorkspaceContext,
} from "@/lib/publicProfile/teamState.server";
import { PublicArtifactsCarousel } from "./PublicArtifactsCarousel";
import { PublicProfileIdentityCardClient } from "./PublicProfileIdentityCardClient";
import { OperationalHistoryConstellation } from "./OperationalHistoryConstellation";
import { PublicProfileTeamActionsClient } from "./PublicProfileTeamActionsClient";
import { PublicProfileMembersSearchNavClient } from "./PublicProfileMembersSearchNavClient";
import { PublicProfileViewSwitchClient } from "./PublicProfileViewSwitchClient";

const OWNER_USERNAME = normalizeUsername(process.env.CAVBOT_OWNER_USERNAME || "");

function isUnsafeProfileSlug(raw: string) {
  const v = String(raw || "").trim();
  if (!v) return true;
  if (v.includes(".") || v.includes("/") || v.includes("\\")) return true;
  return false;
}

async function getViewerUserIdSafe(): Promise<string | null> {
  try {
    const cookieHeader = cookies().toString().trim();
    if (!cookieHeader) return null;

    // getSession() only needs the incoming cookies for signature verification.
    // Use a fixed internal URL so host/header spoofing cannot affect session reads.
    const req = new Request("https://app.cavbot.internal/_public_profile", {
      headers: {
        cookie: cookieHeader,
      },
    });

    const sess = await getSession(req);
    if (!sess || sess.systemRole !== "user") return null;

    const uid = String(sess.sub || "").trim();
    if (!uid || uid === "system") return null;
    return uid;
  } catch {
    return null;
  }
}

type TeamActionsInitialTeamState = {
  ok: true;
  profile: {
    username: string;
    userId: string;
  };
  workspace: {
    id: string | null;
    name: string;
    planId: string;
  };
  viewer: {
    authenticated: boolean;
    userId: string | null;
    inWorkspace: boolean;
    workspaceRole: "OWNER" | "ADMIN" | "MEMBER" | null;
    canManageWorkspace: boolean;
    canInviteFromCurrentAccount: boolean;
    pendingInvite: null | {
      id: string;
      role: "OWNER" | "ADMIN" | "MEMBER";
      expiresAtISO: string;
    };
    pendingRequest: null | {
      id: string;
      createdAtISO: string;
    };
    membershipState: "OWNER" | "ADMIN" | "MEMBER" | "INVITED_PENDING" | "REQUEST_PENDING" | "NONE";
    canRequestAccess: boolean;
    canAcceptInvite: boolean;
  };
};

type TeamActionsInitialMember = {
  membershipId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  createdAtISO: string;
  user: {
    id: string;
    username: string | null;
    displayName: string | null;
    email: string | null;
    avatarImage: string | null;
    avatarTone: string | null;
  };
};

async function getTeamActionsBootstrap(username: string): Promise<{
  initialTeamState: TeamActionsInitialTeamState | null;
  initialMembers: TeamActionsInitialMember[];
}> {
  try {
    const workspace = await resolvePublicProfileWorkspaceContext(username);
    if (!workspace) {
      return {
        initialTeamState: null,
        initialMembers: [],
      };
    }

    const cookieHeader = cookies().toString().trim();
    const session = cookieHeader
      ? await getSession(
          new Request("https://app.cavbot.internal/_public_profile_team_actions", {
            headers: { cookie: cookieHeader },
          })
        ).catch(() => null)
      : null;

    const viewer = await resolvePublicProfileViewerTeamState({
      session,
      workspaceId: workspace.workspaceId,
    });

    const membershipState = viewer.inWorkspace
      ? viewer.workspaceRole === "OWNER"
        ? "OWNER"
        : viewer.workspaceRole === "ADMIN"
          ? "ADMIN"
          : "MEMBER"
      : viewer.pendingInvite
        ? "INVITED_PENDING"
        : viewer.pendingRequest
          ? "REQUEST_PENDING"
          : "NONE";

    const initialTeamState: TeamActionsInitialTeamState = {
      ok: true,
      profile: {
        username: workspace.username,
        userId: workspace.profileUserId,
      },
      workspace: {
        id: workspace.workspaceId,
        name: workspace.workspaceName,
        planId: String(workspace.planId || "FREE"),
      },
      viewer: {
        authenticated: viewer.authenticated,
        userId: viewer.viewerUserId,
        inWorkspace: viewer.inWorkspace,
        workspaceRole: viewer.workspaceRole,
        canManageWorkspace: viewer.canManageWorkspace,
        canInviteFromCurrentAccount: viewer.canInviteFromCurrentAccount,
        pendingInvite: viewer.pendingInvite,
        pendingRequest: viewer.pendingRequest,
        membershipState,
        canRequestAccess: viewer.authenticated && !viewer.inWorkspace && !viewer.pendingInvite && !viewer.pendingRequest,
        canAcceptInvite: Boolean(viewer.pendingInvite?.id),
      },
    };

    if (!viewer.authenticated || !viewer.canManageWorkspace || !viewer.viewerUserId || !workspace.workspaceId) {
      return {
        initialTeamState,
        initialMembers: [],
      };
    }

    const members = await prisma.membership.findMany({
      where: { accountId: workspace.workspaceId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            email: true,
            avatarImage: true,
            avatarTone: true,
          },
        },
      },
    }).catch(() => []);

    const initialMembers = members.map((row) => {
      const roleRaw = String(row.role || "MEMBER").toUpperCase();
      const role = (roleRaw === "OWNER" || roleRaw === "ADMIN" ? roleRaw : "MEMBER") as "OWNER" | "ADMIN" | "MEMBER";
      return {
        membershipId: String(row.id),
        role,
        createdAtISO: new Date(row.createdAt).toISOString(),
        user: {
          id: String(row.user.id),
          username: row.user.username ? String(row.user.username) : null,
          displayName: row.user.displayName ? String(row.user.displayName) : null,
          email: row.user.email ? String(row.user.email) : null,
          avatarImage: row.user.avatarImage ? String(row.user.avatarImage) : null,
          avatarTone: row.user.avatarTone ? String(row.user.avatarTone) : null,
        },
      };
    });

    return { initialTeamState, initialMembers };
  } catch {
    return {
      initialTeamState: null,
      initialMembers: [],
    };
  }
}

function PencilIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm2.92 2.83H5v-.92l8.06-8.06.92.92L5.92 20.08ZM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0L15.13 5.1l3.75 3.75 1.83-1.81Z"
      />
    </svg>
  );
}

function LockedKicker({ label }: { label: string }) {
  return (
    <div className="pp-kicker pp-lockedKicker" aria-label={label}>
      <LockIcon className="pp-lockIcon" width={14} height={14} />
      <span>{label}</span>
    </div>
  );
}

function isSafeHttpUrl(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return false;
  return /^https?:\/\//i.test(s);
}

function resolveCanonicalProfileUrlFromEnv(username: string): string {
  const normalized = normalizeUsername(username);
  if (!normalized) return "";

  const originRaw = String(
    process.env.APP_ORIGIN ||
      process.env.NEXT_PUBLIC_APP_ORIGIN ||
      process.env.CAVBOT_APP_ORIGIN ||
      ""
  ).trim();
  if (!originRaw) return "";

  const withScheme = /^https?:\/\//i.test(originRaw) ? originRaw : `https://${originRaw}`;
  try {
    const origin = new URL(withScheme).origin.replace(/\/+$/, "");
    return `${origin}/${encodeURIComponent(normalized)}`;
  } catch {
    return "";
  }
}

function compactHealthStatusLabel(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "Not available";
  if (/waiting for telemetry/i.test(s)) return "Telemetry pending";
  return s;
}

type ArtifactKind = "folder" | "document" | "data" | "archive" | "media" | "file";
type ArtifactPreviewKind = "image" | "video" | "text" | "code" | "unknown";

type ArtifactDisplayItem = {
  id: string;
  title: string;
  type: string;
  publishedAtISO: string;
  viewCount: number;
  href: string | null;
  kind: ArtifactKind;
  summary: string;
  isPreview: boolean;
  previewSrc: string | null;
  previewPath: string | null;
  previewMimeType: string | null;
  previewKind: ArtifactPreviewKind | null;
};

function artifactKindFromType(type: string, title: string): ArtifactKind {
  const s = `${String(type || "").toLowerCase()} ${String(title || "").toLowerCase()}`;
  if (s.includes("folder") || s.includes("directory")) return "folder";
  if (/(pdf|doc|docx|md|markdown|txt)/.test(s)) return "document";
  if (/(csv|tsv|json|xlsx|xls|dataset|report)/.test(s)) return "data";
  if (/(zip|tar|gz|rar|7z|bundle|archive)/.test(s)) return "archive";
  if (/(png|jpg|jpeg|webp|svg|gif|mp4|mov|mp3|wav|video|image|media)/.test(s)) return "media";
  return "file";
}

function artifactSummaryFromKind(kind: ArtifactKind) {
  if (kind === "folder") return "Published folder";
  if (kind === "document") return "Published document";
  if (kind === "data") return "Published dataset";
  if (kind === "archive") return "Published archive";
  if (kind === "media") return "Published media asset";
  return "Published file";
}

function renderInline(text: string): React.ReactNode[] {
  // Inline code: `code`
  // Links: [label](https://...)
  const out: React.ReactNode[] = [];
  const s = String(text ?? "");

  const parts = s.split("`");
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i] ?? "";
    const isCode = i % 2 === 1;
    if (isCode) {
      out.push(
        <code key={`c:${i}`} className="pp-md-code">
          {seg}
        </code>
      );
      continue;
    }

    let cursor = 0;
    const re = /\[([^\]]+)\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(seg))) {
      const [full, label, hrefRaw] = m;
      const idx = m.index ?? 0;
      if (idx > cursor) out.push(seg.slice(cursor, idx));
      const href = String(hrefRaw || "").trim();
      if (isSafeHttpUrl(href)) {
        out.push(
          <a key={`a:${i}:${idx}`} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        );
      } else {
        out.push(full);
      }
      cursor = idx + full.length;
    }
    if (cursor < seg.length) out.push(seg.slice(cursor));
  }

  return out;
}

function renderMarkdown(md: string): React.ReactNode {
  const src = String(md || "").replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  const blocks: React.ReactNode[] = [];

  let i = 0;
  const pushPara = (paraLines: string[]) => {
    const text = paraLines.join(" ").trim();
    if (!text) return;
    blocks.push(
      <p key={`p:${blocks.length}`} className="pp-md-p">
        {renderInline(text)}
      </p>
    );
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (/^```/.test(line)) {
      const fenceLang = String(line.slice(3).trim() || "");
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i] ?? "")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      if (i < lines.length && /^```/.test(lines[i] ?? "")) i++;

      blocks.push(
        <pre key={`pre:${blocks.length}`} className="pp-md-pre" data-lang={fenceLang || undefined}>
          <code>{buf.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]?.length ?? 1;
      const text = String(h[2] ?? "").trim();
      const key = `h:${blocks.length}`;
      if (level === 1) blocks.push(<h1 key={key} className="pp-md-h1">{renderInline(text)}</h1>);
      else if (level === 2) blocks.push(<h2 key={key} className="pp-md-h2">{renderInline(text)}</h2>);
      else blocks.push(<h3 key={key} className="pp-md-h3">{renderInline(text)}</h3>);
      i++;
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i] ?? "")) {
        items.push(String((lines[i] ?? "").replace(/^-+\s+/, "")));
        i++;
      }
      blocks.push(
        <ul key={`ul:${blocks.length}`} className="pp-md-ul">
          {items.map((t, idx) => (
            <li key={idx} className="pp-md-li">
              {renderInline(String(t || "").trim())}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (!l.trim()) break;
      if (/^```/.test(l)) break;
      if (/^(#{1,3})\s+/.test(l)) break;
      if (/^-\s+/.test(l)) break;
      para.push(l.trim());
      i++;
    }
    pushPara(para);
  }

  return <div className="pp-md">{blocks}</div>;
}

// Public profile page. Canonical URL is still https://app.cavbot.io/{username} via middleware rewrite.
export default async function PublicCavbotProfilePage({
  params,
  searchParams,
}: {
  params: { username: string };
  searchParams?: { view?: string | string[] };
}) {
  const raw = String(params?.username || "");
  if (isUnsafeProfileSlug(raw)) notFound();

  const username = normalizeUsername(raw);
  if (!username) notFound();

  if ((RESERVED_ROUTE_SLUGS as readonly string[]).includes(username)) notFound();
  if (isReservedUsername(username) && !isAllowedReservedPublicUsername(username, OWNER_USERNAME)) notFound();
  if (!isBasicUsername(username)) notFound();

  const vm = await buildPublicProfileViewModel(username);
  if (!vm) notFound();
  const { initialTeamState, initialMembers } = await getTeamActionsBootstrap(username);

  const { cta, isOwner, ownerStatus } = await (async () => {
    const viewerUserId = await getViewerUserIdSafe();
    if (!viewerUserId) {
      return {
        cta: null as { href: string; label: string } | null,
        isOwner: false,
        ownerStatus: null as {
          showStatusOnPublicProfile: boolean;
          userStatus: string | null;
          note: string | null;
          updatedAtISO: string | null;
        } | null,
      };
    }
    try {
      const authPool = (() => {
        try {
          return getAuthPool();
        } catch {
          return null;
        }
      })();
      try {
        const owner =
          (authPool ? await findPublicProfileUserByUsername(authPool, username).catch(() => null) : null) ??
          (await prisma.user.findUnique({
            where: { username },
            select: {
              id: true,
              showStatusOnPublicProfile: true,
              userStatus: true,
              userStatusNote: true,
              userStatusUpdatedAt: true,
              // Back-compat during rollout
              publicStatusEnabled: true,
              publicStatusMode: true,
              publicStatusNote: true,
              publicStatusUpdatedAt: true,
            },
          }).catch(() => null));
        const ok = Boolean(owner?.id) && owner!.id === viewerUserId;
        const showStatusOnPublicProfile =
          typeof (owner as { showStatusOnPublicProfile?: unknown })?.showStatusOnPublicProfile === "boolean"
            ? Boolean((owner as { showStatusOnPublicProfile?: unknown }).showStatusOnPublicProfile)
            : Boolean((owner as { publicStatusEnabled?: unknown }).publicStatusEnabled);
        const userStatusRaw = String((owner as { userStatus?: unknown }).userStatus ?? (owner as { publicStatusMode?: unknown }).publicStatusMode ?? "").trim();
        const userStatusNoteRaw = String((owner as { userStatusNote?: unknown }).userStatusNote ?? (owner as { publicStatusNote?: unknown }).publicStatusNote ?? "").trim();
        const updatedAtRaw =
          (owner as { userStatusUpdatedAt?: unknown }).userStatusUpdatedAt ??
          (owner as { publicStatusUpdatedAt?: unknown }).publicStatusUpdatedAt ??
          null;
        return {
          cta: ok ? ({ href: "/settings?tab=account", label: "Manage profile" } as const) : null,
          isOwner: ok,
          ownerStatus: ok
            ? {
                showStatusOnPublicProfile,
                userStatus: userStatusRaw ? userStatusRaw : null,
                note: userStatusNoteRaw ? userStatusNoteRaw : null,
                updatedAtISO: updatedAtRaw ? new Date(updatedAtRaw as never).toISOString() : null,
              }
            : null,
        };
      } catch {
        // Bootstrap safety: if status columns don't exist yet, still allow owner edit UI.
        const owner =
          (authPool ? await findPublicProfileUserByUsername(authPool, username).catch(() => null) : null) ??
          (await prisma.user.findUnique({ where: { username }, select: { id: true } }).catch(() => null));
        const ok = Boolean(owner?.id) && owner!.id === viewerUserId;
        return {
          cta: ok ? ({ href: "/settings?tab=account", label: "Manage profile" } as const) : null,
          isOwner: ok,
          ownerStatus: ok ? { showStatusOnPublicProfile: false, userStatus: null, note: null, updatedAtISO: null } : null,
        };
      }
    } catch {
      return {
        cta: null as { href: string; label: string } | null,
        isOwner: false,
        ownerStatus: null as {
          showStatusOnPublicProfile: boolean;
          userStatus: string | null;
          note: string | null;
          updatedAtISO: string | null;
        } | null,
      };
    }
  })();

  const isCavbotProfile = username === "cavbot";
  const isPrivateProfile = vm.visibility === "private";
  const rawView = Array.isArray(searchParams?.view) ? searchParams?.view[0] : searchParams?.view;
  const activeView = String(rawView || "").trim().toLowerCase() === "members" ? "members" : "overview";
  const allContentSectionsHidden =
    !vm.config.showReadme &&
    !vm.config.showWorkspaceSnapshot &&
    !vm.config.showHealthOverview &&
    !vm.config.showCapabilities &&
    !vm.config.showArtifacts &&
    !vm.config.showBio &&
    !vm.config.showIdentityLinks &&
    !vm.config.showIdentityLocation &&
    !vm.config.showIdentityEmail;

  type HealthTone = "good" | "ok" | "bad" | "neutral";
  type HealthSignalCard = {
    id: string;
    label: string;
    tone: HealthTone;
    value: string;
    sub?: string;
  };

  const healthOverview = vm.sections.healthOverview;
  const healthEntitlements = healthOverview?.entitlements || null;
  const healthAllowA11y = healthEntitlements ? healthEntitlements.a11y !== false : true;
  const healthAllowErrors = healthEntitlements ? healthEntitlements.errors !== false : true;
  const healthAllowSeo = healthEntitlements ? healthEntitlements.seo !== false : true;
  const guardianScore =
    healthOverview?.guardianScore == null ? null : Math.round(Math.max(0, Math.min(100, Number(healthOverview.guardianScore))));
  const healthRingRadius = 22;
  const healthRingCircumference = 2 * Math.PI * healthRingRadius;
  const healthRingProgress = guardianScore == null ? 0 : guardianScore / 100;
  const healthRingDashOffset = healthRingCircumference * (1 - healthRingProgress);
  const coreHealthSignals: HealthSignalCard[] = healthOverview
    ? [
        { id: "coverage", label: "Coverage", tone: healthOverview.coverage.tone, value: healthOverview.coverage.label },
        {
          id: "performance",
          label: "Performance",
          tone: healthOverview.performance.tone,
          value: healthOverview.performance.label,
        },
        { id: "routing", label: "Routing", tone: healthOverview.routing.tone, value: healthOverview.routing.label },
        {
          id: "reliability",
          label: "Reliability",
          tone: healthOverview.reliability.tone,
          value: healthOverview.reliability.label,
        },
        ...(healthAllowA11y
          ? [{ id: "accessibility", label: "Accessibility", tone: healthOverview.accessibility.tone, value: healthOverview.accessibility.label } as HealthSignalCard]
          : []),
        ...(healthAllowErrors ? [{ id: "errors", label: "Errors", tone: healthOverview.errors.tone, value: healthOverview.errors.label } as HealthSignalCard] : []),
        ...(healthAllowSeo ? [{ id: "seo", label: "SEO", tone: healthOverview.seo.tone, value: healthOverview.seo.label } as HealthSignalCard] : []),
      ]
    : [];
  const healthPendingCount = coreHealthSignals.reduce(
    (count, signal) => (compactHealthStatusLabel(signal.value) === "Telemetry pending" ? count + 1 : count),
    0
  );
  const healthSignalCoveragePct =
    coreHealthSignals.length > 0 ? Math.round(((coreHealthSignals.length - healthPendingCount) / coreHealthSignals.length) * 100) : 0;
  const healthHasIngest = healthOverview ? !/waiting for telemetry/i.test(String(healthOverview.updatedRelative || "")) : false;
  const telemetryTone: HealthTone =
    !healthHasIngest ? "neutral" : healthSignalCoveragePct >= 85 ? "good" : healthSignalCoveragePct >= 60 ? "ok" : "bad";
  const healthSignals: HealthSignalCard[] =
    coreHealthSignals.length > 0
      ? [
          ...coreHealthSignals,
          {
            id: "telemetry",
            label: "Telemetry",
            tone: telemetryTone,
            value: `${healthSignalCoveragePct}% coverage`,
            sub: healthHasIngest ? `Last ingest ${healthOverview?.updatedRelative}.` : "No ingest observed yet.",
          },
        ]
      : [];
  const hideWarmupSummary = healthPendingCount >= coreHealthSignals.length;
  const healthSignalSummary =
    healthPendingCount <= 0
      ? "Live telemetry is active across all public signals."
      : hideWarmupSummary
        ? null
        : `${healthPendingCount} of ${coreHealthSignals.length} signals are still collecting telemetry.`;
  const publishedArtifacts = vm.sections.artifacts?.items || [];
  const artifactDisplayItems: ArtifactDisplayItem[] = publishedArtifacts.slice(0, 12).map((a) => {
    const kind = artifactKindFromType(a.type, a.title);
    return {
      id: a.id,
      title: a.title,
      type: a.type || "File",
      publishedAtISO: a.publishedAtISO,
      viewCount: Math.max(0, Math.trunc(Number((a as { viewCount?: unknown }).viewCount ?? 0))),
      href: `/p/${encodeURIComponent(vm.username)}/artifact/${encodeURIComponent(a.id)}`,
      kind,
      summary: artifactSummaryFromKind(kind),
      isPreview: false,
      previewSrc: null,
      previewPath: null,
      previewMimeType: null,
      previewKind: null,
    };
  });
  const hasPublishedArtifacts = artifactDisplayItems.length > 0;
  const capabilityModulesVisible = vm.sections.capabilities?.modules || [];
  const capabilityVisibleActiveCount = capabilityModulesVisible.reduce(
    (count, module) => count + (/^(active|enabled)$/i.test(String(module.stateLabel || "").trim()) ? 1 : 0),
    0
  );
  const operationalHistory = vm.sections.operationalHistory;
  const operationalEntries = operationalHistory?.entries || [];
  const operationalHasTelemetry = Boolean(operationalHistory?.hasTelemetry);
  const operationalHasSignalData = Boolean(operationalHistory?.signalMetrics?.hasSignalData);
  const operationalSignalPointCount = (operationalHistory?.signalSeries || []).length;
  const operationalTrendLabel = operationalHasSignalData
    ? `${(operationalHistory?.signalMetrics?.delta7d || 0) > 0 ? "+" : ""}${(operationalHistory?.signalMetrics?.delta7d || 0).toFixed(1)}`
    : operationalSignalPointCount > 1
      ? "Warming"
      : "—";
  const readmeServerRevision = Math.max(0, Math.trunc(Number(vm.readme?.revision || 0)));
  const editProfileHref = cta?.href || "/settings?tab=account";
  const canonicalProfileUrl = resolveCanonicalProfileUrlFromEnv(vm.username);

  return (
    <main className="pp-page" aria-label="Public profile">
      <div className="pp-console">
        <header className="pp-topbar" aria-label="CavBot">
          <Link className="pp-logotype" href="/" aria-label="CavBot">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pp-logotypeImg" src="/logo/official-logotype-light.svg" alt="CavBot" decoding="async" />
          </Link>

          {isCavbotProfile ? (
            <div className="pp-topbarRight pp-topbarRightLink" aria-label="CavBot badge">
              <div className="cb-badge cb-badge-inline" aria-hidden="true">
                <CdnBadgeEyes />
              </div>
            </div>
          ) : (
            <div className="pp-topbarRight" aria-label="CavBot badge">
              <div className="cb-badge cb-badge-inline" aria-hidden="true">
                <CdnBadgeEyes />
              </div>
            </div>
          )}
        </header>
        <div className="pp-layout">
          {/* LEFT COLUMN — Identity (GitHub-style) */}
          <aside className="pp-left" aria-label="Identity">
            <PublicProfileIdentityCardClient
              username={vm.username}
              displayName={vm.displayName}
              isPremiumPlus={vm.isPremiumPlus}
              avatar={vm.avatar}
              status={vm.status}
              bio={vm.bio}
              identityDetails={vm.identity.details}
              isPrivateProfile={isPrivateProfile}
              allContentSectionsHidden={allContentSectionsHidden}
              isOwner={isOwner}
              ownerStatus={ownerStatus}
              editProfileHref={editProfileHref}
              canonicalProfileUrl={canonicalProfileUrl}
              showIdentityLinks={vm.config.showIdentityLinks}
              showIdentityLocation={vm.config.showIdentityLocation}
              showIdentityEmail={vm.config.showIdentityEmail}
              initialTeamState={initialTeamState}
              initialMembers={initialMembers}
            />
          </aside>

          {/* RIGHT COLUMN — Public Sections */}
          <div className="pp-right" aria-label="Public snapshot">
            {isPrivateProfile ? (
              <section className="pp-section pp-sectionCenter" aria-label="Private profile">
                <div className="pp-card pp-lockedCard">
                  <div className="pp-cardTop">
                    <div>
                      <div className="pp-title">Private profile</div>
                    </div>
                    <span className="pp-lockBadge" aria-hidden="true">
                      <LockIcon className="pp-lockIcon" width={18} height={18} />
                    </span>
                  </div>
                  <div className="pp-empty pp-lockedBody">This profile is not public.</div>
                </div>
              </section>
            ) : (
              <PublicProfileViewSwitchClient
                username={vm.username}
                initialView={activeView}
                membersNav={<PublicProfileMembersSearchNavClient username={vm.username} />}
                membersContent={
                  <section className="pp-section" aria-label="Workspace members">
                    <div className="pp-card pp-membersPageCard">
                      <div className="pp-cardTop">
                        <div>
                          <div className="pp-title pp-titlePrimary">Workspace members</div>
                          <div className="pp-titleSub">Team directory</div>
                        </div>
                      </div>
                      <PublicProfileTeamActionsClient
                        username={vm.username}
                        displayName={vm.displayName}
                        isOwner={isOwner}
                        editProfileHref={editProfileHref}
                        canonicalProfileUrl={canonicalProfileUrl}
                        mode="page"
                        showActionBar={false}
                        initialTeamState={initialTeamState}
                        initialMembers={initialMembers}
                      />
                    </div>
                  </section>
                }
              >
                {allContentSectionsHidden ? null : (
                  <div className="pp-overviewSections">
                    {/* SECTION 1 — README */}
                    <section className="pp-section" aria-label="README">
                      <div className={`pp-card pp-readmeCard ${vm.config.showReadme ? "" : "pp-lockedCard"}`}>
                        <div className="pp-cardTop pp-cardTopRow">
                          <div>
                            {!vm.config.showReadme ? <LockedKicker label="Private" /> : null}
                            <div className="pp-title pp-readmePath">
                              {vm.username}/README<span className="pp-mdExt">.md</span>
                            </div>
                          </div>
                          {isOwner ? (
                            <a
                              className="pp-icbtn"
                              href="/cavcode?sys=profile-readme"
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Edit README"
                              aria-label="Edit README"
                            >
                              <PencilIcon size={18} />
                            </a>
                          ) : null}
                        </div>

                        {vm.config.showReadme && vm.readme ? (
                          <>
                            <div className="pp-divider" aria-hidden="true" />
                            <div className="pp-readmeBody" id="pp-readme" data-username={vm.username}>
                              {renderMarkdown(vm.readme.markdown)}
                            </div>
                          </>
                        ) : (
                          <div className="pp-empty pp-lockedBody">This section isn&apos;t shared.</div>
                        )}
                      </div>
                    </section>

                    {isOwner && vm.config.showReadme ? (
                      <script
                        // Owner-only: instant cross-tab updates from CavCode autosave/save.
                        dangerouslySetInnerHTML={{
                          __html: `
(function(){
  try {
    var ROOT = document.getElementById('pp-readme');
    if (!ROOT) return;

    var LS_MD = 'cb_sys_profile_readme_md_v1';
    var LS_REV = 'cb_sys_profile_readme_rev_v1';
    var LS_SERVER_REV = 'cb_sys_profile_readme_server_rev_v1';
    var SERVER_REV = ${readmeServerRevision};
    var knownServerRevision = Number.isFinite(Number(SERVER_REV)) && Number(SERVER_REV) >= 0 ? Math.trunc(Number(SERVER_REV)) : 0;
    var BT = String.fromCharCode(96);
    var FENCE = BT + BT + BT;

    function esc(s){
      return String(s||'')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/\"/g,'&quot;')
        .replace(/'/g,'&#39;');
    }

    function isSafeHttpUrl(href){
      href = String(href||'').trim();
      return /^https?:\\/\\//i.test(href);
    }

    function renderInline(text){
      var s = String(text||'');
      var parts = s.split(String.fromCharCode(96));
      var out = '';
      for (var i=0;i<parts.length;i++){
        var seg = parts[i] || '';
        var isCode = (i % 2) === 1;
        if (isCode){
          out += '<code class=\"pp-md-code\">' + esc(seg) + '</code>';
          continue;
        }
        var cursor = 0;
        var re = /\\[([^\\]]+)\\]\\(([^)]+)\\)/g;
        var m;
        while ((m = re.exec(seg))){
          var full = m[0], label = m[1], hrefRaw = m[2];
          var idx = m.index || 0;
          if (idx > cursor) out += esc(seg.slice(cursor, idx));
          var href = String(hrefRaw||'').trim();
          if (isSafeHttpUrl(href)){
            out += '<a href=\"' + esc(href) + '\" target=\"_blank\" rel=\"noopener noreferrer\">' + esc(label) + '</a>';
          } else {
            out += esc(full);
          }
          cursor = idx + full.length;
        }
        if (cursor < seg.length) out += esc(seg.slice(cursor));
      }
      return out;
    }

    function renderMarkdown(md){
      var src = String(md||'').replace(/\\r\\n/g,'\\n');
      var lines = src.split('\\n');
      var html = '<div class=\"pp-md\">';
      var i = 0;
      function pushPara(buf){
        var text = buf.join(' ').trim();
        if (!text) return;
        html += '<p class=\"pp-md-p\">' + renderInline(text) + '</p>';
      }
      while (i < lines.length){
        var line = lines[i] || '';
        if (String(line).slice(0,3) === FENCE){
          var fenceLang = String(line.slice(3).trim() || '');
          i++;
          var code = [];
          while (i < lines.length && String(lines[i] || '').slice(0,3) !== FENCE){
            code.push(lines[i] || '');
            i++;
          }
          if (i < lines.length && String(lines[i] || '').slice(0,3) === FENCE) i++;
          html += '<pre class=\"pp-md-pre\"' + (fenceLang ? (' data-lang=\"' + esc(fenceLang) + '\"') : '') + '><code>' + esc(code.join('\\n')) + '</code></pre>';
          continue;
        }
        var hm = /^(#{1,3})\\s+(.*)$/.exec(line);
        if (hm){
          var level = (hm[1] || '#').length;
          var text = String(hm[2] || '').trim();
          if (level === 1) html += '<h1 class=\"pp-md-h1\">' + renderInline(text) + '</h1>';
          else if (level === 2) html += '<h2 class=\"pp-md-h2\">' + renderInline(text) + '</h2>';
          else html += '<h3 class=\"pp-md-h3\">' + renderInline(text) + '</h3>';
          i++;
          continue;
        }
        if (/^-\\s+/.test(line)){
          html += '<ul class=\"pp-md-ul\">';
          while (i < lines.length && /^-\\s+/.test(lines[i] || '')){
            var item = String((lines[i] || '').replace(/^-+\\s+/, '')).trim();
            html += '<li class=\"pp-md-li\">' + renderInline(item) + '</li>';
            i++;
          }
          html += '</ul>';
          continue;
        }
        if (!String(line).trim()){
          i++;
          continue;
        }
        var para = [];
        while (i < lines.length){
          var l = lines[i] || '';
          if (!String(l).trim()) break;
          if (String(l).slice(0,3) === FENCE) break;
          if (/^(#{1,3})\\s+/.test(l)) break;
          if (/^-\\s+/.test(l)) break;
          para.push(String(l).trim());
          i++;
        }
        pushPara(para);
      }
      html += '</div>';
      return html;
    }

    function persistReadmeDraft(md){
      var bodyMd = String(md || '');
      if (!bodyMd) return;
      try {
        var localServerRevRaw = Number(globalThis.__cbLocalStore.getItem(LS_SERVER_REV) || '0');
        var localServerRev = Number.isFinite(localServerRevRaw) && localServerRevRaw >= 0 ? Math.trunc(localServerRevRaw) : 0;
        var expectedRevisionRaw = Math.max(localServerRev, knownServerRevision);
        var hasExpectedRevision = Number.isFinite(expectedRevisionRaw) && expectedRevisionRaw >= 0;
        var payload = hasExpectedRevision
          ? { markdown: bodyMd, expectedRevision: Math.trunc(expectedRevisionRaw) }
          : { markdown: bodyMd };
        fetch('/api/profile/readme', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-cavbot-csrf': '1' },
          body: JSON.stringify(payload),
        })
          .then(function(res){ return res.json().catch(function(){ return null; }); })
          .then(function(data){
            if (!data || typeof data !== 'object') return;
            if (data.ok === true) {
              var rev = Number(data.revision);
              if (Number.isFinite(rev) && rev >= 0) {
                knownServerRevision = Math.max(knownServerRevision, Math.trunc(rev));
                try { globalThis.__cbLocalStore.setItem(LS_SERVER_REV, String(Math.trunc(rev))); } catch {}
              }
              return;
            }
            if (String(data.error || '') === 'REVISION_CONFLICT') {
              var currentRev = Number(data.currentRevision);
              if (Number.isFinite(currentRev) && currentRev >= 0) {
                knownServerRevision = Math.max(knownServerRevision, Math.trunc(currentRev));
                try { globalThis.__cbLocalStore.setItem(LS_SERVER_REV, String(Math.trunc(currentRev))); } catch {}
              }
            }
          })
          .catch(function(){});
      } catch {}
    }

    function readStoredServerRevision(){
      try {
        var raw = Number(globalThis.__cbLocalStore.getItem(LS_SERVER_REV) || '');
        if (Number.isFinite(raw) && raw >= 0) return Math.trunc(raw);
      } catch {}
      return 0;
    }

    function applyFromLocalStorage(){
      var md = '';
      try { md = String(globalThis.__cbLocalStore.getItem(LS_MD) || ''); } catch {}
      if (!md) return;
      ROOT.innerHTML = renderMarkdown(md);
      var localServerRevision = readStoredServerRevision();
      if (localServerRevision > knownServerRevision) {
        knownServerRevision = localServerRevision;
        return;
      }
      if (localServerRevision <= 0) {
        persistReadmeDraft(md);
      }
    }

    // Important: don't mutate the server-rendered README DOM before React hydration,
    // or we'll trigger a hydration mismatch when globalThis.__cbLocalStore contains newer content.
    // We only apply updates in response to a storage revision bump (cross-tab).
    // Still persist any local draft to server truth on load.
    try {
      var storedServerRevision = readStoredServerRevision();
      if (storedServerRevision > knownServerRevision) {
        knownServerRevision = storedServerRevision;
      } else if (storedServerRevision < knownServerRevision) {
        globalThis.__cbLocalStore.setItem(LS_SERVER_REV, String(knownServerRevision));
      }
      var bootMd = String(globalThis.__cbLocalStore.getItem(LS_MD) || '');
      if (bootMd) {
        var bootServerRevision = readStoredServerRevision();
        if (bootServerRevision <= 0) {
          setTimeout(function(){ persistReadmeDraft(bootMd); }, 0);
        }
      }
    } catch {}

    window.addEventListener('storage', function(ev){
      if (!ev) return;
      if (ev.key !== LS_REV) return;
      applyFromLocalStorage();
    });
  } catch {}
})();`,
                        }}
                      />
                    ) : null}

                    {/* SECTION 2 — Verified Workspace Snapshot */}
                    <section className="pp-section" aria-label="Verified workspace snapshot">
                      {vm.config.showWorkspaceSnapshot && vm.sections.workspaceSnapshot ? (
                        <div className="pp-card pp-wsPanel">
                          <div className="pp-wsHeader">
                            <div className="pp-wsIdentity">
                              <div>
                                <div className="pp-kicker" />
                              </div>
                            </div>
                            <div className={`pp-wsState tone-${vm.sections.workspaceSnapshot.status.tone}`}>
                              {vm.sections.workspaceSnapshot.status.label}
                            </div>
                          </div>

                          <div className="pp-wsRail" role="list" aria-label="Workspace facts">
                            <div className="pp-wsStat" role="listitem">
                              <div className="pp-wsStatK">Monitored sites</div>
                              <div className="pp-wsStatV">
                                {vm.sections.workspaceSnapshot.monitoredSitesCount == null
                                  ? "—"
                                  : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
                                      vm.sections.workspaceSnapshot.monitoredSitesCount
                                    )}
                              </div>
                            </div>

                            {vm.sections.workspaceSnapshot.planTierLabel ? (
                              <div className="pp-wsStat" role="listitem">
                                <div className="pp-wsStatK">Tier</div>
                                <div className="pp-wsStatV pp-wsStatV-tier">{vm.sections.workspaceSnapshot.planTierLabel}</div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="pp-card pp-lockedCard">
                          <div className="pp-cardTop">
                            <div>
                              <LockedKicker label="Private" />
                              <div className="pp-title">Workspace snapshot</div>
                            </div>
                          </div>
                          <div className="pp-empty pp-lockedBody">This section isn&apos;t shared.</div>
                        </div>
                      )}
                    </section>

                    {/* SECTION 3 — Public Health Overview */}
                    <section className="pp-section" aria-label="Public health overview">
                      {vm.config.showHealthOverview && healthOverview ? (
                        <div className="pp-card pp-healthCard">
                          <div className="pp-cardTop pp-healthTop">
                            <div>
                              <div className="pp-title pp-titlePrimary">Public health overview</div>
                              <div className="pp-titleSub">System health</div>
                            </div>
                          </div>

                          <div className="pp-healthScoreRingWrap">
                            <div
                              className={`pp-healthRing tone-${healthOverview.guardian.tone}${guardianScore == null ? " is-empty" : ""}`}
                              aria-label={guardianScore == null ? "Health score unavailable" : `Health score ${guardianScore} out of 100`}
                            >
                              <svg className="pp-healthRingSvg" viewBox="0 0 64 64" aria-hidden="true">
                                <circle className="pp-healthRingTrack" cx="32" cy="32" r={healthRingRadius} />
                                <circle
                                  className="pp-healthRingValue"
                                  cx="32"
                                  cy="32"
                                  r={healthRingRadius}
                                  style={{
                                    strokeDasharray: `${healthRingCircumference} ${healthRingCircumference}`,
                                    strokeDashoffset: healthRingDashOffset,
                                  }}
                                />
                              </svg>
                              <div className="pp-healthRingLabel">
                                <div className="pp-healthRingNum">{guardianScore == null ? "—" : guardianScore}</div>
                                <div className="pp-healthRingUnit">/100</div>
                              </div>
                            </div>
                          </div>

                          <div className="pp-healthSignalSummary" aria-hidden={healthSignalSummary == null ? true : undefined}>
                            {healthSignalSummary ?? "\u00A0"}
                          </div>

                          <div className="pp-healthGrid" role="list" aria-label="Posture rollups">
                            {healthSignals.map((signal) => {
                              const displayValue = compactHealthStatusLabel(signal.value);
                              const waiting = displayValue === "Telemetry pending";
                              const helperText = signal.sub || (waiting ? "Collecting baseline signal." : null);
                              return (
                                <article className={`pp-healthMetric tone-${signal.tone}`} role="listitem" key={signal.id}>
                                  <div className="pp-healthMetricK">{signal.label}</div>
                                  <div className={`pp-healthMetricV tone-${signal.tone}`}>{displayValue}</div>
                                  {helperText ? <div className="pp-healthMetricSub">{helperText}</div> : null}
                                </article>
                              );
                            })}
                          </div>
                          {healthPendingCount > 0 ? (
                            <div className="pp-healthFootnote">
                              Telemetry signals update automatically as route, reliability, and SEO summaries are observed.
                            </div>
                          ) : (
                            <div className="pp-healthFootnote">Telemetry signals update continuously.</div>
                          )}
                        </div>
                      ) : (
                        <div className="pp-card pp-lockedCard">
                          <div className="pp-cardTop">
                            <div>
                              <LockedKicker label="Private" />
                              <div className="pp-title">Health overview</div>
                            </div>
                          </div>
                          <div className="pp-empty pp-lockedBody">This section isn&apos;t shared.</div>
                        </div>
                      )}
                    </section>
                  </div>
                )}

                {allContentSectionsHidden ? null : (
                  <div className="pp-overviewSectionsTail">
                    {/* SECTION 5 — Capabilities */}
                    <section className="pp-section" aria-label="Capabilities">
                      {vm.config.showCapabilities && vm.sections.capabilities ? (
                        <div className="pp-card">
                          <div className="pp-cardTop">
                            <div>
                              <div className="pp-title pp-titlePrimary">Workspace modules</div>
                              <div className="pp-titleSub">Capabilities</div>
                            </div>
                          </div>

                          {capabilityModulesVisible.length ? (
                            <>
                              <div className="pp-capSummary" aria-label="Capability summary">
                                <div className="pp-capMeta">
                                  {capabilityVisibleActiveCount}/{capabilityModulesVisible.length} active
                                </div>
                              </div>

                              <div
                                className={`pp-capGrid${capabilityModulesVisible.length === 1 ? " is-single" : ""}${capabilityModulesVisible.length % 2 === 1 ? " is-odd" : ""}`}
                                role="list"
                                aria-label="Workspace capabilities"
                              >
                                {capabilityModulesVisible.map((module) => {
                                  const isActive = /^(active|enabled)$/i.test(String(module.stateLabel || "").trim());
                                  const capabilityStateLabel = isActive ? "Active" : "Not enabled";
                                  return (
                                    <article
                                      className={`pp-capCard ${isActive ? "is-active" : "is-off"}`}
                                      role="listitem"
                                      key={module.id}
                                    >
                                      <div className="pp-capCardTop">
                                        <div className="pp-capCardTitle">{module.label}</div>
                                        <span
                                          className={`pp-capState ${isActive ? "is-active" : "is-inactive"}`}
                                          aria-label={capabilityStateLabel}
                                          title={capabilityStateLabel}
                                        />
                                      </div>
                                      <div className="pp-capCardDesc">{module.description}</div>
                                    </article>
                                  );
                                })}
                              </div>
                            </>
                          ) : (
                            <div className="pp-empty">No verified modules yet.</div>
                          )}
                        </div>
                      ) : (
                        <div className="pp-card pp-lockedCard">
                          <div className="pp-cardTop">
                            <div>
                              <LockedKicker label="Private" />
                              <div className="pp-title">Workspace modules</div>
                            </div>
                          </div>
                          <div className="pp-empty pp-lockedBody">This section isn&apos;t shared.</div>
                        </div>
                      )}
                    </section>

                    {/* SECTION 6 — Public Artifacts */}
                    <section className="pp-section" aria-label="Public artifacts">
                      {vm.config.showArtifacts && vm.sections.artifacts ? (
                        <div className="pp-card">
                          <div className="pp-cardTop">
                            <div>
                              <div className="pp-title pp-titlePrimary">Public artifacts</div>
                              <div className="pp-titleSub">Published items</div>
                            </div>
                          </div>

                          {hasPublishedArtifacts ? (
                            <PublicArtifactsCarousel
                              username={vm.username}
                              items={artifactDisplayItems}
                              isOwner={isOwner}
                            />
                          ) : (
                            <div className="pp-empty">
                              No published artifacts yet.
                              <div className="pp-emptySub">
                                Publish files or folders from CavCloud or CavSafe to surface them here.
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="pp-card pp-lockedCard">
                          <div className="pp-cardTop">
                            <div>
                              <LockedKicker label="Private" />
                              <div className="pp-title">Published items</div>
                            </div>
                          </div>
                          <div className="pp-empty pp-lockedBody">This section isn&apos;t shared.</div>
                        </div>
                      )}
                    </section>

                    {/* SECTION 7 — Operational History */}
                <section className="pp-section" aria-label="Operational history">
                  <div className="pp-card pp-ohCard">
                    <div className="pp-ohTopRow">
                      <div className="pp-ohTitleWrap">
                        {/* Signal stream */}
                        <div className="pp-ohTitle">Signal Timeline</div>
                        <div className="pp-ohLead">
                          {operationalHasTelemetry
                            ? "Live route, reliability, error, and SEO summaries."
                            : "Telemetry warming up across monitored public signals."}
                        </div>
                      </div>
                      <div className={`pp-ohStatus ${operationalHasTelemetry ? "is-live" : "is-warming"}`}>
                        <span className="pp-ohStatusRing" aria-hidden="true" />
                        <span className="pp-ohStatusText">{operationalHasTelemetry ? "Live telemetry" : "Warming"}</span>
                      </div>
                    </div>

                    <div className="pp-ohMetricsGrid" role="list" aria-label="Operational summary metrics">
                      <article className="pp-ohMetric" role="listitem">
                        <div className="pp-ohMetricLabel">Signal points</div>
                        <div className="pp-ohMetricValue">{operationalSignalPointCount || "—"}</div>
                      </article>
                      <article className="pp-ohMetric" role="listitem">
                        <div className="pp-ohMetricLabel">7d trend</div>
                        <div className="pp-ohMetricValue">{operationalTrendLabel}</div>
                      </article>
                      <article className="pp-ohMetric" role="listitem">
                        <div className="pp-ohMetricLabel">Event count</div>
                        <div className="pp-ohMetricValue">{operationalEntries.length}</div>
                      </article>
                    </div>

                    <div className="pp-ohHeader">
                      <OperationalHistoryConstellation
                        username={vm.username}
                        hasTelemetry={operationalHasTelemetry}
                        entries={operationalEntries}
                        signalSeries={vm.sections.operationalHistory?.signalSeries || []}
                      />
                      <div className="pp-ohHeaderInner">
                        {operationalHistory?.primarySignal ? (
                          <div className="pp-ohSignalLead">{operationalHistory.primarySignal}</div>
                        ) : (
                          <div className="pp-ohSignalLead">Baseline signal summary appears here once telemetry is active.</div>
                        )}
                      </div>
                    </div>

                    {operationalEntries.length ? (
                      <>
                        <div className="pp-divider pp-ohDivider" aria-hidden="true" />
                        <div className="pp-ohList" role="list" aria-label="Operational history events">
                          {operationalEntries.slice(0, 12).map((e) => (
                            <article
                              key={e.id}
                              className={`pp-ohEntry tone-${e.tone}`}
                              role="listitem"
                            >
                              <div className="pp-ohEntryTop">
                                <div className="pp-ohEvent">{e.event}</div>
                                <div className="pp-ohAge">{e.windowLabel}</div>
                              </div>
                              <div className="pp-ohSignal">{e.signal}</div>
                              <div className="pp-ohExplain">{e.explanation}</div>
                            </article>
                          ))}
                        </div>
                      </>
                    ) : operationalHasTelemetry ? (
                      <>
                        <div className="pp-divider pp-ohDivider" aria-hidden="true" />
                        <div className="pp-empty">
                          No material operational deltas in the current window.
                          <div className="pp-emptySub">
                            Signal monitoring is live. This feed auto-populates when meaningful movement is detected.
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="pp-empty pp-ohWarmupEmpty">
                          Telemetry warming up.
                          <div className="pp-emptySub">
                            Operational history appears after route, reliability, error, and SEO summaries are ingested.
                          </div>
                        </div>
                      </>
                    )}

                    <div className="pp-ohFooter">Summarized signal deltas only.</div>
                  </div>
                </section>
                  </div>
                )}
              </PublicProfileViewSwitchClient>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
