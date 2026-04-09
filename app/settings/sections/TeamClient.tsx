// TeamClient.tsx
"use client";

import * as React from "react";
import { CavBotVerifyModal } from "@/components/CavBotVerifyModal";

type MemberRole = "OWNER" | "ADMIN" | "MEMBER";

type MemberRow = {
  id: string;
  role: MemberRole;
  createdAt: string;
  user: {
    id: string;
    username: string | null;
    email: string;
    displayName: string | null;
    createdAt: string;
    lastLoginAt: string | null;
  };
};

type InviteRow = {
  id: string;
  email: string;
  inviteeEmail?: string | null;
  inviteeUserId?: string | null;
  status?: "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED" | "EXPIRED";
  role: "ADMIN" | "MEMBER";
  createdAt: string;
  expiresAt: string;
  respondedAt?: string | null;
  sentById: string | null;
  invitee?: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
};

type MembersPayload = {
  ok: true;
  planId?: string | null;
  seatLimit?: number | null; // 0/undefined => unlimited
  seatsUsed?: number | null;
  currentMemberRole?: MemberRole | null;
  canManageAccessRequests?: boolean;
  degraded?: boolean;
  members: MemberRow[];
  invites: InviteRow[];
};

type AccessRequestRow = {
  id: string;
  accountId: string;
  status: "PENDING" | "APPROVED" | "DENIED";
  createdAtISO: string;
  respondedAtISO: string | null;
  respondedByUserId: string | null;
  requester: {
    userId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

type AccessRequestsPayload = {
  ok: boolean;
  requests: AccessRequestRow[];
  degraded?: boolean;
};

type ResolvedUser = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type ResolvedWorkspace = {
  id: string;
  name: string;
};

type AccessRequestSubmitResponse = {
  ok: boolean;
  deduped?: boolean;
  workspace?: {
    id?: string;
    name?: string;
  } | null;
  message?: string;
  error?: string;
};

type VerifyRequest = {
  actionType: "invite";
  sessionId?: string;
  identifierHint?: string;
};

type VerifyResult = {
  ok: boolean;
  verificationGrantToken?: string;
  sessionId?: string;
};

const VERIFY_GRANT_HEADER = "x-cavbot-verify-grant";
const VERIFY_SESSION_HEADER = "x-cavbot-verify-session";

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return "—";
  }
}

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function normalizeOrigin(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "";
  return input.replace(/\/+$/, "");
}

function publicProfilePath(username: string | null | undefined): string | null {
  const clean = String(username || "").trim();
  if (!clean) return null;
  return `/${encodeURIComponent(clean)}`;
}

function inviteTargetLabel(invite: InviteRow) {
  const username = String(invite.invitee?.username || "").trim();
  const displayName = String(invite.invitee?.displayName || "").trim();
  if (username) {
    return {
      title: displayName || `@${username}`,
      subtitle: `@${username}`,
    };
  }

  const email = String(invite.inviteeEmail || invite.email || "").trim();
  return {
    title: email || "—",
    subtitle: `Expires ${fmtDate(invite.expiresAt)}`,
  };
}

function roleTone(r: MemberRole) {
  if (r === "OWNER") return "owner";
  if (r === "ADMIN") return "admin";
  return "member";
}

function roleLabel(r: MemberRole) {
  if (r === "OWNER") return "Owner";
  if (r === "ADMIN") return "Admin";
  return "Member";
}

function formatPlanLabel(planId?: string | null) {
  const raw = String(planId || "").trim();
  if (!raw) return "—";

  const normalized = raw.toLowerCase().replace(/\s+/g, "");

  if (normalized === "free") return "Free";
  if (normalized === "premium") return "Premium";
  if (
    normalized === "premium_plus" ||
    normalized === "premium+" ||
    normalized === "premiumplus" ||
    normalized === "preium_plus" ||
    normalized === "preium+" ||
    normalized === "preiumplus" ||
    normalized === "enterprise"
  ) {
    return "Premium+";
  }

  if (normalized.includes("plus")) return "Premium+";
  if (normalized.includes("premium") || normalized.includes("preium")) return "Premium";
  if (normalized.includes("free")) return "Free";

  return raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function rankRole(r: MemberRole) {
  if (r === "OWNER") return 3;
  if (r === "ADMIN") return 2;
  return 1;
}

function rolePrivileges(r: MemberRole) {
  if (r === "OWNER") {
    return [
      "Full workspace ownership with account, security, and billing control",
      "Manage billing, plan tiers, seat limits, notifications, and integrations",
      "Create, rotate, and revoke API keys / protect secrets",
      "Invite, promote, demote, or remove any operator across roles",
      "Access every module — CavCode, CavCloud, Cav terminal, and settings",
    ];
  }

  if (r === "ADMIN") {
    return [
      "Work on CavCode + code viewer, edit/add files, and sync to CavCloud",
      "Run Cav terminal (launch, viewer, diagnostics) but not storage/billing",
      "Manage monitored targets, configuration, invites (non-owner) & diagnostics",
      "Access operational modules and CavCloud viewer, but NOT account settings or billing",
      "Cannot invite or change the owner (owner only controls sensitive settings)",
    ];
  }

  return [
    "Standard workspace access with dashboard + route monitoring",
    "View CavCode/code viewer pages but cannot edit files or run terminals",
    "No access to billing, role management, security, settings, or critical controls",
    "Cannot invite, promote, demote, or remove other members",
  ];
}

type JsonError = { message?: string; error?: string };

function extractErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object") {
    const err = value as JsonError;
    return String(err.message || err.error || fallback);
  }
  return fallback;
}

function parseVerifyStepUp(payload: Record<string, unknown>) {
  const verify = payload?.verify as Record<string, unknown> | undefined;
  const decision = String(verify?.decision || "").trim();
  if (decision !== "step_up_required" && decision !== "block") return null;
  return {
    decision,
    sessionId: String(verify?.sessionId || "").trim(),
    retryAfterSec: Number(verify?.retryAfterSec || 0),
    message: String(payload?.message || payload?.error || "").trim(),
  };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    credentials: "include",
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    throw new Error(extractErrorMessage(data, "Request failed"));
  }
  return data as T;
}

export default function TeamClient() {
  const [err, setErr] = React.useState<string>("");
  const [data, setData] = React.useState<MembersPayload | null>(null);
  const publicProfileOrigin = React.useMemo(() => {
    if (typeof window !== "undefined" && window.location?.origin) {
      return normalizeOrigin(window.location.origin);
    }
    return normalizeOrigin(process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "");
  }, []);

  // Invite form
  const [inviteByUsernameInput, setInviteByUsernameInput] = React.useState("");
  const [inviteCandidates, setInviteCandidates] = React.useState<ResolvedUser[]>([]);
  const [inviteLookupBusy, setInviteLookupBusy] = React.useState(false);
  const [selectedInvitee, setSelectedInvitee] = React.useState<ResolvedUser | null>(null);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<"MEMBER" | "ADMIN">("MEMBER");
  const [inviting, setInviting] = React.useState(false);
  const [verifyRequest, setVerifyRequest] = React.useState<VerifyRequest | null>(null);
  const verifyResolverRef = React.useRef<((value: VerifyResult) => void) | null>(null);
  const [accessRequests, setAccessRequests] = React.useState<AccessRequestRow[]>([]);
  const [requestActionBusyId, setRequestActionBusyId] = React.useState<string>("");

  // Request access modal
  const [requestModalOpen, setRequestModalOpen] = React.useState(false);
  const [requestInput, setRequestInput] = React.useState("");
  const [requestResults, setRequestResults] = React.useState<ResolvedUser[]>([]);
  const [requestLookupBusy, setRequestLookupBusy] = React.useState(false);
  const [requestSelected, setRequestSelected] = React.useState<ResolvedUser | null>(null);
  const [requestWorkspace, setRequestWorkspace] = React.useState<ResolvedWorkspace | null>(null);
  const [requestWorkspaceBusy, setRequestWorkspaceBusy] = React.useState(false);
  const [requestSubmitBusy, setRequestSubmitBusy] = React.useState(false);
  const [requestModalError, setRequestModalError] = React.useState("");
  const [requestModalSuccess, setRequestModalSuccess] = React.useState("");

  // Remove confirmation lightbox
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<{ id: string; title: string } | null>(null);
  const [removing, setRemoving] = React.useState(false);

  // Role change confirmation lightbox
  const [roleOpen, setRoleOpen] = React.useState(false);
  const [roleBusy, setRoleBusy] = React.useState(false);
  const [roleTarget, setRoleTarget] = React.useState<{
    membershipId: string;
    title: string;
    prevRole: MemberRole;
    nextRole: MemberRole;
  } | null>(null);

  const requestVerification = React.useCallback(
    (request: VerifyRequest) =>
      new Promise<VerifyResult>((resolve) => {
        verifyResolverRef.current = resolve;
        setVerifyRequest(request);
      }),
    [],
  );

  const closeVerifyModal = React.useCallback(() => {
    if (verifyResolverRef.current) {
      verifyResolverRef.current({ ok: false });
      verifyResolverRef.current = null;
    }
    setVerifyRequest(null);
  }, []);

  const completeVerifyModal = React.useCallback((value: { verificationGrantToken: string; sessionId: string }) => {
    if (verifyResolverRef.current) {
      verifyResolverRef.current({
        ok: true,
        verificationGrantToken: value.verificationGrantToken,
        sessionId: value.sessionId,
      });
      verifyResolverRef.current = null;
    }
    setVerifyRequest(null);
  }, []);

  React.useEffect(() => {
    return () => {
      if (verifyResolverRef.current) {
        verifyResolverRef.current({ ok: false });
        verifyResolverRef.current = null;
      }
    };
  }, []);

  // Track changes to detect invite acceptance (members up, invites down)
  const lastCountsRef = React.useRef<{ members: number; invites: number }>({ members: 0, invites: 0 });

  const refresh = React.useCallback(async () => {
    setErr("");

    try {
      const membersData = await api<MembersPayload>("/api/members");
      const canManageAccessRequests = Boolean(
        membersData?.canManageAccessRequests &&
        !membersData?.degraded &&
        (membersData?.currentMemberRole === "OWNER" || membersData?.currentMemberRole === "ADMIN"),
      );
      const requestsData = canManageAccessRequests
        ? await api<AccessRequestsPayload>("/api/workspaces/access-requests?status=PENDING").catch(() => ({
            ok: false,
            degraded: true,
            requests: [],
          }))
        : { ok: true, degraded: false, requests: [] };

      const prev = lastCountsRef.current;
      const next = {
        members: membersData?.members?.length ?? 0,
        invites: membersData?.invites?.length ?? 0,
      };

      // If someone accepted an invite: members went up and invites went down
      if (next.members > prev.members && next.invites < prev.invites) {
        try {
          window.dispatchEvent(
            new CustomEvent("cb:notice", {
              detail: {
                tone: "GOOD",
                title: "Invite accepted",
                body: "A new operator joined your workspace.",
                ts: Date.now(),
              },
            })
          );
        } catch {
          // ignore
        }
      }

      lastCountsRef.current = next;
      setData(membersData);
      setAccessRequests(Array.isArray(requestsData?.requests) ? requestsData.requests : []);
    } catch (e: unknown) {
      setErr(extractErrorMessage(e, "Failed to load members"));
    }
  }, []);

  React.useEffect(() => {
    refresh();

    const t = window.setInterval(() => {
      refresh();
    }, 15000);

    function onTeamRefresh() {
      void refresh();
    }

    window.addEventListener("cb:team:refresh", onTeamRefresh as EventListener);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("cb:team:refresh", onTeamRefresh as EventListener);
    };
  }, [refresh]);

  const seatsUsed = Number(data?.seatsUsed ?? (data ? data.members.length + data.invites.length : 0));
  const seatLimit = Number(data?.seatLimit ?? 0);
  const hasLimit = seatLimit > 0;
  const seatPct = hasLimit ? Math.max(0, Math.min(100, Math.round((seatsUsed / seatLimit) * 100))) : 0;

  React.useEffect(() => {
    const raw = String(inviteByUsernameInput || "").trim();
    const normalizedInput = raw.replace(/^@+/, "").toLowerCase();
    const selectedUsername = String(selectedInvitee?.username || "").trim().toLowerCase();

    if (selectedInvitee?.userId && selectedUsername && normalizedInput && normalizedInput !== selectedUsername) {
      setSelectedInvitee(null);
    }

    if (!raw) {
      setInviteCandidates([]);
      setInviteLookupBusy(false);
      return;
    }

    if (selectedUsername && normalizedInput === selectedUsername) {
      return;
    }

    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setInviteLookupBusy(true);
      try {
        const res = await fetch(`/api/users/resolve?q=${encodeURIComponent(raw)}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal: ctrl.signal,
        });
        const payload = (await res.json().catch(() => ({}))) as { users?: ResolvedUser[] };
        if (!res.ok) return;
        setInviteCandidates(Array.isArray(payload.users) ? payload.users : []);
      } catch {
        setInviteCandidates([]);
      } finally {
        setInviteLookupBusy(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(t);
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
    };
  }, [inviteByUsernameInput, selectedInvitee]);

  const openRequestAccessModal = () => {
    setRequestModalError("");
    setRequestModalSuccess("");
    setRequestModalOpen(true);
  };

  const closeRequestAccessModal = () => {
    if (requestSubmitBusy) return;
    setRequestModalOpen(false);
    setRequestInput("");
    setRequestResults([]);
    setRequestLookupBusy(false);
    setRequestSelected(null);
    setRequestWorkspace(null);
    setRequestWorkspaceBusy(false);
    setRequestModalError("");
    setRequestModalSuccess("");
  };

  React.useEffect(() => {
    if (!requestModalOpen) return;
    document.body.classList.add("cb-modal-open");
    return () => {
      document.body.classList.remove("cb-modal-open");
    };
  }, [requestModalOpen]);

  React.useEffect(() => {
    if (!requestModalOpen) return;

    const query = s(requestInput);
    if (!query) {
      setRequestResults([]);
      setRequestLookupBusy(false);
      setRequestWorkspace(null);
      return;
    }

    const selectedUsername = s(requestSelected?.username).toLowerCase();
    const normalized = query.replace(/^@+/, "").toLowerCase();

    if (requestSelected?.userId && selectedUsername && normalized && normalized !== selectedUsername) {
      setRequestSelected(null);
    }

    if (selectedUsername && normalized === selectedUsername) return;

    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setRequestLookupBusy(true);
      try {
        const res = await fetch(`/api/users/resolve?q=${encodeURIComponent(query)}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal: ctrl.signal,
        });
        const payload = (await res.json().catch(() => ({}))) as { users?: ResolvedUser[] };
        if (!res.ok) return;
        setRequestResults(Array.isArray(payload.users) ? payload.users : []);
      } catch {
        setRequestResults([]);
      } finally {
        setRequestLookupBusy(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(t);
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
    };
  }, [requestInput, requestModalOpen, requestSelected]);

  React.useEffect(() => {
    if (!requestModalOpen) return;

    const raw = s(requestInput);
    if (!raw) {
      setRequestWorkspace(null);
      setRequestWorkspaceBusy(false);
      return;
    }

    const selectedUsername = s(requestSelected?.username).toLowerCase();
    const normalized = raw.replace(/^@+/, "").toLowerCase();
    const targetOwnerUsername = selectedUsername && normalized === selectedUsername
      ? s(requestSelected?.username)
      : "";

    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setRequestWorkspaceBusy(true);
      try {
        const qs = new URLSearchParams();
        if (targetOwnerUsername) {
          qs.set("targetOwnerUsername", targetOwnerUsername);
        } else {
          qs.set("targetOwnerProfileUrl", raw);
        }

        const res = await fetch(`/api/workspaces/access-requests/resolve?${qs.toString()}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal: ctrl.signal,
        });

        const payload = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          workspace?: { id?: string; name?: string } | null;
        };

        if (!res.ok || payload.ok !== true || !payload.workspace?.id) {
          setRequestWorkspace(null);
          return;
        }

        setRequestWorkspace({
          id: s(payload.workspace.id),
          name: s(payload.workspace.name) || "Workspace",
        });
      } catch {
        setRequestWorkspace(null);
      } finally {
        setRequestWorkspaceBusy(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(t);
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
    };
  }, [requestInput, requestModalOpen, requestSelected]);

  const onSubmitRequestAccess = async () => {
    setRequestModalError("");
    setRequestModalSuccess("");

    const raw = s(requestInput);
    if (!raw) {
      setRequestModalError("Enter an owner username or CavBot profile URL.");
      return;
    }

    if (!requestWorkspace?.id) {
      setRequestModalError("Select a valid workspace target before requesting access.");
      return;
    }

    const selectedUsername = s(requestSelected?.username).toLowerCase();
    const normalized = raw.replace(/^@+/, "").toLowerCase();
    const targetOwnerUsername = selectedUsername && normalized === selectedUsername
      ? s(requestSelected?.username)
      : "";
    const requestBody: Record<string, string> = { targetWorkspaceId: requestWorkspace.id };
    if (targetOwnerUsername) {
      requestBody.targetOwnerUsername = targetOwnerUsername;
    } else {
      requestBody.targetOwnerProfileUrl = raw;
    }

    setRequestSubmitBusy(true);
    try {
      const res = await fetch("/api/workspaces/access-requests", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify(requestBody),
      });
      const payload = (await res.json().catch(() => ({}))) as AccessRequestSubmitResponse;

      if (!res.ok || !payload.ok) {
        throw new Error(s(payload.message || payload.error || "Request failed."));
      }

      const workspaceName = s(payload.workspace?.name) || s(requestWorkspace.name) || "workspace";
      setRequestModalSuccess(
        payload.deduped
          ? `Request already pending for ${workspaceName}.`
          : `Request sent to ${workspaceName}.`
      );
      setRequestInput("");
      setRequestSelected(null);
      setRequestResults([]);
      setRequestWorkspace(null);
    } catch (error) {
      setRequestModalError(s(error instanceof Error ? error.message : "Request failed."));
    } finally {
      setRequestSubmitBusy(false);
    }
  };

  const sendInviteWithVerify = React.useCallback(
    async (payload: Record<string, unknown>, identifierHint: string) => {
      let verificationGrantToken = "";
      let verificationSessionId = "";

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        };
        if (verificationGrantToken) headers[VERIFY_GRANT_HEADER] = verificationGrantToken;
        if (verificationSessionId) headers[VERIFY_SESSION_HEADER] = verificationSessionId;

        const res = await fetch("/api/workspaces/invites", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers,
          body: JSON.stringify({
            ...payload,
            verificationSessionId: verificationSessionId || undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

        if (res.ok) return data;

        const verifyStep = parseVerifyStepUp(data);
        if (verifyStep?.decision === "step_up_required") {
          const verification = await requestVerification({
            actionType: "invite",
            sessionId: verifyStep.sessionId || verificationSessionId,
            identifierHint,
          });
          if (!verification.ok || !verification.verificationGrantToken) {
            throw new Error("Verification cancelled.");
          }
          verificationGrantToken = verification.verificationGrantToken;
          verificationSessionId = verification.sessionId || verifyStep.sessionId || verificationSessionId;
          continue;
        }

        if (verifyStep?.decision === "block") {
          if (verifyStep.retryAfterSec > 0) {
            throw new Error(`Too many attempts. Retry in ${verifyStep.retryAfterSec}s.`);
          }
          throw new Error(verifyStep.message || "Temporarily blocked. Please retry shortly.");
        }

        throw new Error(extractErrorMessage(data, "Invite failed"));
      }

      throw new Error("Invite verification failed.");
    },
    [requestVerification],
  );

  const onInvite = async () => {
    const usernameInput = String(inviteByUsernameInput || "").trim();
    const email = String(inviteEmail || "").trim().toLowerCase();
    const hasUsernameIntent = Boolean(usernameInput);
    const hasEmailIntent = Boolean(email);

    setInviting(true);
    setErr("");

    try {
      if (!hasUsernameIntent && !hasEmailIntent) {
        throw new Error("Enter a username or email to send an invite.");
      }

      if (hasUsernameIntent) {
        const selectedUsername = String(selectedInvitee?.username || "").trim().toLowerCase();
        const normalizedInput = usernameInput.replace(/^@+/, "").toLowerCase();
        if (!selectedInvitee?.userId || !selectedUsername || normalizedInput !== selectedUsername) {
          throw new Error("Select a user from the username results before sending.");
        }
      } else if (!email || !email.includes("@")) {
        throw new Error("Enter a valid email address.");
      }

      const payload = hasUsernameIntent
        ? { inviteeUserId: selectedInvitee?.userId, role: inviteRole }
        : { inviteeEmail: email, role: inviteRole };
      const identifierHint = hasUsernameIntent ? usernameInput : email;
      await sendInviteWithVerify(payload, identifierHint);

      setInviteByUsernameInput("");
      setInviteCandidates([]);
      setSelectedInvitee(null);
      setInviteEmail("");
      setInviteRole("MEMBER");

      await refresh();
    } catch (e: unknown) {
      setErr(extractErrorMessage(e, "Invite failed"));
    } finally {
      setInviting(false);
    }
  };

  const onRevokeInvite = async (inviteId: string) => {
    setErr("");
    try {
      await api<{ ok: true }>(`/api/members/invite/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
      await refresh();
    } catch (e: unknown) {
      setErr(extractErrorMessage(e, "Failed to revoke invite"));
    }
  };

  const onAccessRequestAction = async (requestId: string, action: "approve" | "deny") => {
    setErr("");
    const busyId = `${requestId}:${action}`;
    setRequestActionBusyId(busyId);
    try {
      await api<{ ok: true }>(`/api/workspaces/access-requests/${encodeURIComponent(requestId)}/${action}`, {
        method: "POST",
      });
      await refresh();
    } catch (e: unknown) {
      setErr(extractErrorMessage(e, `Failed to ${action} request`));
    } finally {
      setRequestActionBusyId((current) => (current === busyId ? "" : current));
    }
  };

  const openRoleConfirm = (membershipId: string, title: string, prevRole: MemberRole, nextRole: MemberRole) => {
    // No-op if unchanged
    if (prevRole === nextRole) return;

    setRoleTarget({ membershipId, title, prevRole, nextRole });
    setRoleOpen(true);
  };

  const closeRoleConfirm = () => {
    if (roleBusy) return;
    setRoleOpen(false);
    setRoleTarget(null);
  };

  const confirmRoleChange = async () => {
    if (!roleTarget?.membershipId) return;
    setErr("");
    setRoleBusy(true);

    try {
      await api<{ ok: true }>(`/api/members/${encodeURIComponent(roleTarget.membershipId)}`, {
        method: "PATCH",
        body: JSON.stringify({ role: roleTarget.nextRole }),
      });

      closeRoleConfirm();
      await refresh();
    } catch (e: unknown) {
      setErr(extractErrorMessage(e, "Failed to update role"));
    } finally {
      setRoleBusy(false);
    }
  };

  const openRemove = (membershipId: string, title: string) => {
    setRemoveTarget({ id: membershipId, title });
    setRemoveOpen(true);
  };

  const closeRemove = () => {
    if (removing) return;
    setRemoveOpen(false);
    setRemoveTarget(null);
  };

  const confirmRemove = async () => {
    if (!removeTarget?.id) return;
    setErr("");
    setRemoving(true);

    try {
      await api<{ ok: true }>(`/api/members/${encodeURIComponent(removeTarget.id)}`, { method: "DELETE" });
      closeRemove();
      await refresh();
    } catch (e: unknown) {
      setErr(extractErrorMessage(e, "Failed to remove member"));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="sx-panel" aria-label="Team settings">
      <header className="sx-panelHead">
        <div>
          <h2 className="sx-h2">Team</h2>
          <p className="sx-sub">Members, roles, invitations, and workspace access.</p>
        </div>
<br />
        <span className="sx-badge sx-badgeSeat" title="Seats used">
          {hasLimit ? `${seatsUsed}/${seatLimit} seats` : `${seatsUsed} seats`}
        </span>
      </header>

      <div className="sx-body">
        {/* Top summary row */}
        <div className="sx-teamTop">
          <div className="sx-card">
            <div className="sx-kicker">Workspace Seats</div>
            <div className="sx-cardSub">Track usage and access capacity. Pending invites count as occupied seats.</div>

            <div className="sx-seatBar" aria-hidden="true">
              <div className="sx-seatBarFill" style={{ width: hasLimit ? `${seatPct}%` : "14%" }} />
            </div>
            <br />
            <br />
            <div className="sx-seatMeta">
              <div className="sx-seatLine">
                <span className="sx-seatK">Used</span>
                <span className="sx-seatV">{seatsUsed}</span>
              </div>
              <br />
              <div className="sx-seatLine">
                <span className="sx-seatK">Limit</span>
                <span className="sx-seatV">{hasLimit ? seatLimit : "Unlimited"}</span>
              </div>
              <br />
              <div className="sx-seatLine">
                <span className="sx-seatK">Plan</span>
                <span className="sx-seatV">{formatPlanLabel(data?.planId)}</span>
              </div>
              <br />
            </div>
          </div>

          {/* Invite */}
          <div className="sx-card">
            <div className="sx-kicker">Invite member</div>
            <div className="sx-cardSub">Invite by username or email. Existing invite permissions are enforced server-side.</div>
            <br />
            <div className="sx-inviteGrid">
              <div className="sx-field sx-fieldUsernameInvite">
                <div className="sx-label">Invite by username</div>
                <input
                  id="sx-team-invite-username"
                  name="inviteUsername"
                  className="sx-input"
                  placeholder="@username"
                  value={inviteByUsernameInput}
                  onChange={(e) => setInviteByUsernameInput(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                {inviteLookupBusy ? <div className="sx-typeaheadState">Searching…</div> : null}
                {!inviteLookupBusy && inviteByUsernameInput.trim() && inviteCandidates.length ? (
                  <div className="sx-typeaheadList" role="listbox" aria-label="Username matches">
                    {inviteCandidates.map((candidate) => (
                      <button
                        key={candidate.userId}
                        type="button"
                        className={`sx-typeaheadOption ${selectedInvitee?.userId === candidate.userId ? "is-active" : ""}`}
                        onClick={() => {
                          setSelectedInvitee(candidate);
                          setInviteByUsernameInput(`@${candidate.username}`);
                          setInviteCandidates([]);
                        }}
                      >
                        <span className="sx-typeaheadOptionRow">
                          {candidate.avatarUrl ? (
                            <span
                              className="sx-typeaheadAvatar"
                              aria-hidden="true"
                              style={{
                                backgroundImage: `url("${candidate.avatarUrl}")`,
                                backgroundPosition: "center",
                                backgroundRepeat: "no-repeat",
                                backgroundSize: "cover",
                              }}
                            />
                          ) : (
                            <span className="sx-typeaheadAvatar sx-typeaheadAvatarFallback" aria-hidden="true">
                              {(candidate.displayName || candidate.username || "?").slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span className="sx-typeaheadText">
                            <span className="sx-typeaheadPrimary">
                              {candidate.displayName || `@${candidate.username}`}
                            </span>
                            <span className="sx-typeaheadSecondary">@{candidate.username}</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="sx-field">
                <div className="sx-label">Invite by email</div>
                <input
                  id="sx-team-invite-email"
                  name="inviteEmail"
                  className="sx-input"
                  placeholder="Enter an email address"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  inputMode="email"
                  autoComplete="email"
                />
              </div>

              <div className="sx-field">
                <div className="sx-label">Role</div>
                <select
                  id="sx-team-invite-role"
                  name="inviteRole"
                  className="sx-select"
                  value={inviteRole}
                  onChange={(e) => {
                    const val = (e.target.value as "MEMBER" | "ADMIN") || "MEMBER";
                    setInviteRole(val);
                  }}
                >
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>

              <div className="sx-inviteActions">
                <button
                  className={`sx-btn sx-btnPrimary sx-btnToneLinked sx-inviteSendBtn ${inviting ? "is-disabled" : ""}`}
                  type="button"
                  onClick={onInvite}
                  disabled={inviting}
                >
                  {inviting ? "Inviting…" : "Send invite"}
                </button>
              </div>
            </div>

            {/*Production: NO token box rendered */}
          </div>
        </div>
        <div className="sx-teamAccessLinkRow">
          <button
            className="sx-inviteHintLink sx-inviteHintBtn"
            type="button"
            onClick={openRequestAccessModal}
          >
            Need access instead?
          </button>
        </div>
        <br />
        {/* Error line */}
        {err ? <div className="sx-teamError">{err}</div> : null}

        {/* FULL-WIDTH STACK (NO SCROLL / NO SIDE CARD) */}
        <div className="sx-teamStack">
          {/* Members */}
          <div className="sx-card">
            <div className="sx-teamHead">
              <div>
                <div className="sx-kicker">Members</div>
                <div className="sx-cardSub">Active access to this workspace.</div>
              </div>
              <span className="sx-pill">{data?.members?.length ?? 0}</span>
            </div>

           
            <br /><br />
            {data?.members?.length ? (
              <div className="sx-tableScroll sx-tableScrollNoUi sx-membersListScroll">
                <table className="sx-table sx-tableFixed sx-tableMembers" aria-label="Members">
                  <thead>
                    <tr>
                      <th className="sx-thLeft">Member</th>
                      <th className="sx-thCenter">Role</th>
                      <th className="sx-thCenter">Joined</th>
                      <th className="sx-thCenter">Last Login</th>
                      <th className="sx-thCenter">Profile</th>
                      <th className="sx-thCenter">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.members.map((m) => {
                      const email = m.user.email || "";
                      const cleanName =
                        (m.user.displayName && m.user.displayName.trim()) ||
                        (email.includes("@") ? email.split("@")[0] : "");
                      const name = cleanName || "—";
                      const last = m.user.lastLoginAt ? `${fmtDate(m.user.lastLoginAt)} • ${fmtTime(m.user.lastLoginAt)}` : "—";
                      const profileUsername = s(m.user.username).replace(/^@+/, "");
                      const profilePath = publicProfilePath(profileUsername || null);
                      const profileHref = profilePath ? `${publicProfileOrigin}${profilePath}` : null;
                      const profileLabel = profileUsername ? `@${profileUsername}` : "—";
                      const roleActionLabel = m.role === "MEMBER" ? "Promote to Admin" : "Demote to Member";
                      const isPromoteAction = m.role === "MEMBER";
                      const roleActionIconClass = `sx-actionIcon ${isPromoteAction ? "sx-actionIconUp" : "sx-actionIconDown"}`;

                      return (
                        <tr key={m.id}>
                        <td data-label="Member">
                          <div className="sx-mem">
                            <div className="sx-memName">{name}</div>
                            <div className="sx-memEmail">{email || "—"}</div>
                          </div>
                        </td>

                          {/* OWNER = STATIC PILL (NO DROPDOWN) */}
                          <td className="sx-cellCenter" data-label="Role">
                            <span className={`sx-roleStatic is-${roleTone(m.role)}`}>{roleLabel(m.role)}</span>
                          </td>

                          <td className="sx-cellCenter sx-muted" data-label="Joined">
                            {fmtDate(m.user.createdAt)}
                          </td>

                          <td className="sx-cellCenter sx-muted" data-label="Last Login">
                            {last}
                          </td>

                          <td className="sx-cellCenter" data-label="Profile">
                            {profileHref ? (
                              <a
                                className="sx-profileMemberLink"
                                href={profileHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={profileHref}
                              >
                                {profileLabel}
                              </a>
                            ) : (
                              <span className="sx-muted">—</span>
                            )}
                          </td>

                          <td className="sx-cellCenter" data-label="Actions">
                            <div className="sx-actionsColumn sx-actionsIconsRow">
                              {m.role !== "OWNER" ? (
                                <button
                                  className="sx-btn sx-btnSecondary sx-btnMini sx-btnIconOnly"
                                  type="button"
                                  onClick={() =>
                                    openRoleConfirm(
                                      m.id,
                                      name !== "—" ? name : email,
                                      m.role,
                                      m.role === "MEMBER" ? "ADMIN" : "MEMBER"
                                    )
                                  }
                                  aria-label={roleActionLabel}
                                  title={roleActionLabel}
                                >
                                  <span className={roleActionIconClass} aria-hidden="true" />
                                </button>
                              ) : null}
                              {m.role === "OWNER" ? (
                                <button
                                  className="sx-btn sx-btnGhost sx-btnMini sx-btnRevoke sx-btnNoAccess sx-btnIconOnly"
                                  type="button"
                                  disabled
                                  aria-disabled="true"
                                  aria-label="Revoke"
                                  title="Owners cannot be removed."
                                >
                                  <span className="sx-revokeIcon" aria-hidden="true" />
                                </button>
                              ) : (
                                <button
                                  className="sx-btn sx-btnGhost sx-btnMini sx-btnRevoke sx-btnIconOnly"
                                  type="button"
                                  onClick={() => openRemove(m.id, name !== "—" ? name : email)}
                                  aria-label="Revoke"
                                  title="Revoke"
                                >
                                  <span className="sx-revokeIcon" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="sx-scrollCue" aria-hidden="true">
                  <svg viewBox="0 0 24 10" focusable="false" aria-hidden="true">
                    <polyline points="6 1 1 5 6 9" />
                    <polyline points="18 1 23 5 18 9" />
                    <line x1="2" y1="5" x2="22" y2="5" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="sx-emptyMini">No members found.</div>
            )}
          </div>
          <br />
          {/* Pending Invites (RIGHT UNDER MEMBERS / SAME LENGTH) */}
          <div className="sx-card">
            <div className="sx-teamHead">
              <div>
                <div className="sx-kicker">Pending Invites</div>
                <div className="sx-cardSub">Invited operators who haven’t joined yet.</div>
              </div>
              <span className="sx-pill">{data?.invites?.length ?? 0}</span>
            </div>

           
            <br /><br />
            {data?.invites?.length ? (
              <div className="sx-tableScroll">
                <table className="sx-table sx-tableFixed" aria-label="Pending invites">
                  <thead>
                    <tr>
                      <th className="sx-thLeft">Invitee</th>
                      <th className="sx-thCenter">Invited</th>
                      <th className="sx-thCenter">Role</th>
                      <th className="sx-thCenter">Status</th>
                      <th className="sx-thCenter">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invites.map((i) => {
                      const target = inviteTargetLabel(i);
                      const inviteStatus = String(i.status || "PENDING").toUpperCase();
                      return (
                        <tr key={i.id}>
                          <td data-label="Invitee">
                            <div className="sx-mem">
                              <div className="sx-memName">{target.title || "—"}</div>
                              <div className="sx-memEmail">{target.subtitle || `Expires ${fmtDate(i.expiresAt)}`}</div>
                            </div>
                          </td>

                          <td className="sx-cellCenter sx-muted" data-label="Invited">
                            {fmtDate(i.createdAt)}
                          </td>

                          <td className="sx-cellCenter" data-label="Role">
                            <span className={`sx-roleChip is-${i.role === "ADMIN" ? "admin" : "member"}`}>
                              {i.role === "ADMIN" ? "Admin" : "Member"}
                            </span>
                          </td>

                          <td className="sx-cellCenter" data-label="Status">
                            <span className="sx-statusChip">
                              <span className="sx-dot" aria-hidden="true" />
                              {inviteStatus === "PENDING" ? "Pending" : inviteStatus}
                            </span>
                          </td>

                          <td className="sx-cellCenter" data-label="Actions">
                            <button
                              className="sx-btn sx-btnGhost sx-btnMini sx-btnIconOnly"
                              type="button"
                              onClick={() => onRevokeInvite(i.id)}
                              aria-label="Revoke"
                              title="Revoke"
                            >
                              <span className="sx-revokeIcon" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="sx-scrollCue" aria-hidden="true">
                  <svg viewBox="0 0 24 10" focusable="false" aria-hidden="true">
                    <polyline points="6 1 1 5 6 9" />
                    <polyline points="18 1 23 5 18 9" />
                    <line x1="2" y1="5" x2="22" y2="5" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="sx-emptyMini">No pending invites.</div>
            )}
          </div>

          <br />
          <div className="sx-card">
            <div className="sx-teamHead">
              <div>
                <div className="sx-kicker">Access requests</div>
                <div className="sx-cardSub">Pending workspace access requests from users.</div>
              </div>
              <span className="sx-pill">{accessRequests.length}</span>
            </div>

            <br /><br />
            {accessRequests.length ? (
              <div className="sx-tableScroll">
                <table className="sx-table sx-tableFixed" aria-label="Access requests">
                  <thead>
                    <tr>
                      <th className="sx-thLeft">Requester</th>
                      <th className="sx-thCenter">Requested</th>
                      <th className="sx-thCenter">Status</th>
                      <th className="sx-thCenter">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accessRequests.map((request) => {
                      const requesterLabel = request.requester.displayName || `@${request.requester.username}`;
                      const requestBusyApprove = requestActionBusyId === `${request.id}:approve`;
                      const requestBusyDeny = requestActionBusyId === `${request.id}:deny`;
                      return (
                        <tr key={request.id}>
                          <td data-label="Requester">
                            <div className="sx-mem">
                              <div className="sx-memName">{requesterLabel || "—"}</div>
                              <div className="sx-memEmail">@{request.requester.username}</div>
                            </div>
                          </td>

                          <td className="sx-cellCenter sx-muted" data-label="Requested">
                            {fmtDate(request.createdAtISO)}
                          </td>

                          <td className="sx-cellCenter" data-label="Status">
                            <span className="sx-statusChip">
                              <span className="sx-dot" aria-hidden="true" />
                              Pending
                            </span>
                          </td>

                          <td className="sx-cellCenter" data-label="Actions">
                            <div className="sx-actionsColumn">
                              <button
                                className={`sx-btn sx-btnSecondary sx-btnMini ${requestBusyApprove ? "is-disabled" : ""}`}
                                type="button"
                                onClick={() => onAccessRequestAction(request.id, "approve")}
                                disabled={requestBusyApprove || Boolean(requestActionBusyId)}
                              >
                                {requestBusyApprove ? "Approving…" : "Approve"}
                              </button>
                              <button
                                className={`sx-btn sx-btnGhost sx-btnMini ${requestBusyDeny ? "is-disabled" : ""}`}
                                type="button"
                                onClick={() => onAccessRequestAction(request.id, "deny")}
                                disabled={requestBusyDeny || Boolean(requestActionBusyId)}
                              >
                                {requestBusyDeny ? "Denying…" : "Deny"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="sx-scrollCue" aria-hidden="true">
                  <svg viewBox="0 0 24 10" focusable="false" aria-hidden="true">
                    <polyline points="6 1 1 5 6 9" />
                    <polyline points="18 1 23 5 18 9" />
                    <line x1="2" y1="5" x2="22" y2="5" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="sx-emptyMini">No pending access requests.</div>
            )}
          </div>
        </div>
      </div>

      {/* Request access modal */}
      {requestModalOpen ? (
        <div className="cb-modal" role="dialog" aria-modal="true" aria-label="Request workspace access">
          <div className="cb-modal-backdrop" onClick={closeRequestAccessModal} />
          <div className="cb-modal-card">
            <div className="cb-modal-top">
              <div className="cb-modal-title">Request workspace access</div>
              <button className="cb-modal-close" type="button" onClick={closeRequestAccessModal} aria-label="Close" disabled={requestSubmitBusy}>
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>

            <div className="cb-modal-body sx-requestAccessModalBody">
              <div className="cb-modal-section sx-requestAccessOwnerSection">
                <label className="cb-modal-label" htmlFor="sx-request-access-target-input">
                  OWNER USERNAME OR CAVBOT PROFILE URL
                </label>
                <input
                  id="sx-request-access-target-input"
                  name="requestAccessTarget"
                  className="sx-input"
                  value={requestInput}
                  onChange={(event) => {
                    setRequestInput(event.currentTarget.value);
                    setRequestModalError("");
                    setRequestModalSuccess("");
                    if (
                      requestSelected
                      && event.currentTarget.value.replace(/^@+/, "").toLowerCase() !== s(requestSelected.username).toLowerCase()
                    ) {
                      setRequestSelected(null);
                    }
                    setRequestWorkspace(null);
                  }}
                  placeholder="@owner • app.cavbot.io/owner"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              {requestLookupBusy || requestWorkspaceBusy ? (
                <div className="sx-requestAccessStatusRow" aria-live="polite">
                  {requestLookupBusy ? <span className="sx-requestAccessStatus">Searching…</span> : null}
                  {requestWorkspaceBusy ? <span className="sx-requestAccessStatus">Resolving workspace…</span> : null}
                </div>
              ) : null}

              {!requestLookupBusy && s(requestInput) && requestResults.length ? (
                <div className="sx-typeaheadList" role="listbox" aria-label="Owner matches">
                  {requestResults.map((user) => (
                    <button
                      key={user.userId}
                      type="button"
                      className={`sx-typeaheadOption ${requestSelected?.userId === user.userId ? "is-active" : ""}`}
                      onClick={() => {
                        setRequestSelected(user);
                        setRequestInput(`@${user.username}`);
                        setRequestResults([]);
                        setRequestModalError("");
                        setRequestModalSuccess("");
                      }}
                    >
                      <span className="sx-typeaheadOptionRow">
                        {user.avatarUrl ? (
                          <span
                            className="sx-typeaheadAvatar"
                            aria-hidden="true"
                            style={{
                              backgroundImage: `url("${user.avatarUrl}")`,
                              backgroundPosition: "center",
                              backgroundRepeat: "no-repeat",
                              backgroundSize: "cover",
                            }}
                          />
                        ) : (
                          <span className="sx-typeaheadAvatar sx-typeaheadAvatarFallback" aria-hidden="true">
                            {(user.displayName || user.username || "?").slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span className="sx-typeaheadText">
                          <span className="sx-typeaheadPrimary">{user.displayName || `@${user.username}`}</span>
                          <span className="sx-typeaheadSecondary">@{user.username}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="cb-modal-section sx-requestAccessWorkspaceSection">
                <div className="cb-modal-label">Workspace</div>
                {!requestWorkspaceBusy && requestWorkspace ? (
                  <div className="sx-requestAccessTarget">
                    Target workspace: <strong>{requestWorkspace.name}</strong>
                  </div>
                ) : (
                  <div className="sx-requestAccessStatusRow">
                    <span className="sx-requestAccessStatus">Workspace not resolved yet.</span>
                  </div>
                )}
              </div>

              {requestModalError ? <div className="sx-requestAccessError">{requestModalError}</div> : null}
              {requestModalSuccess ? <div className="sx-requestAccessSuccess">{requestModalSuccess}</div> : null}
            </div>

            <div className="cb-modal-actions sx-requestAccessModalActionsRelaxed">
              <button className="cb-modal-action" type="button" onClick={closeRequestAccessModal} disabled={requestSubmitBusy}>
                Cancel
              </button>
              <button
                className="cb-modal-action cb-modal-actionPrimary"
                type="button"
                onClick={onSubmitRequestAccess}
                disabled={requestSubmitBusy || !requestWorkspace}
              >
                {requestSubmitBusy ? "Sending…" : "Request access"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Remove member confirm lightbox */}
      {removeOpen ? (
        <div className="sx-modalBackdrop" role="dialog" aria-modal="true" aria-label="Remove member confirmation">
          <div className="sx-modalCard">
            <div className="sx-modalTop">
              <div className="sx-modalTitle">Remove member</div>
              <button className="sx-modalClose" type="button" onClick={closeRemove} aria-label="Close">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>

            <div className="sx-modalBody">
              <p className="sx-modalText">
                Are you sure you want to remove <strong>{removeTarget?.title || "this member"}</strong> from this workspace?
              </p>
              <p className="sx-modalHint">This will immediately revoke access.</p>
            </div>

            <div className="sx-modalActions">
              <button className="sx-btn sx-btnGhost" type="button" onClick={closeRemove} disabled={removing}>
                Cancel
              </button>
              <button
                className={`sx-btn sx-btnDanger ${removing ? "is-disabled" : ""}`}
                type="button"
                onClick={confirmRemove}
                disabled={removing}
              >
                {removing ? "Removing…" : "Proceed"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Role change confirmation lightbox */}
      {roleOpen ? (
        <div className="sx-modalBackdrop" role="dialog" aria-modal="true" aria-label="Role change confirmation">
          <div className="sx-modalCard">
            <div className="sx-modalTop">
              <div className="sx-modalTitle">Confirm role change</div>
              <button className="sx-modalClose" type="button" onClick={closeRoleConfirm} aria-label="Close">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>

            <div className="sx-modalBody">
              <p className="sx-modalText">
                You are about to change <strong>{roleTarget?.title || "this operator"}</strong> from{" "}
                <strong>{roleTarget?.prevRole ? roleLabel(roleTarget.prevRole) : "—"}</strong> to{" "}
                <strong>{roleTarget?.nextRole ? roleLabel(roleTarget.nextRole) : "—"}</strong>.
              </p>

              {roleTarget?.prevRole && roleTarget?.nextRole ? (
                <div className="sx-roleDeltaBox">
                  {rankRole(roleTarget.nextRole) > rankRole(roleTarget.prevRole) ? (
                    <>
                      <div className="sx-roleDeltaTitle">Upgrade impact</div>
                      <div className="sx-roleDeltaSub">This operator will gain the following permissions:</div>
                      <ul className="sx-roleDeltaList">
                        {rolePrivileges(roleTarget.nextRole).slice(0, 4).map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <>
                      <div className="sx-roleDeltaTitle">Downgrade impact</div>
                      <div className="sx-roleDeltaSub">This operator will lose the following permissions:</div>
                      <ul className="sx-roleDeltaList">
                        {rolePrivileges(roleTarget.prevRole).slice(0, 4).map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ) : null}

              <p className="sx-modalHint">Proceed only if you intend to modify workspace authority.</p>
            </div>

            <div className="sx-modalActions">
              <button className="sx-btn sx-btnGhost" type="button" onClick={closeRoleConfirm} disabled={roleBusy}>
                Cancel
              </button>
              <button
                className={`sx-btn sx-btnPrimary sx-btnToneLinked ${roleBusy ? "is-disabled" : ""}`}
                type="button"
                onClick={confirmRoleChange}
                disabled={roleBusy}
              >
                {roleBusy ? "Updating…" : "Proceed"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {verifyRequest ? (
        <CavBotVerifyModal
          open={Boolean(verifyRequest)}
          actionType="invite"
          route="/settings?section=team"
          sessionId={verifyRequest.sessionId}
          identifierHint={verifyRequest.identifierHint}
          onClose={closeVerifyModal}
          onVerified={completeVerifyModal}
        />
      ) : null}
    </section>
  );
}
