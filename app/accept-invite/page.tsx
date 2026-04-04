// app/accept-invite/page.tsx
"use client";

import Link from "next/link";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CdnBadgeEyes from "@/components/CdnBadgeEyes";
import "./accept-invite.css";

type Tone = "good" | "watch" | "bad";
type State = "boot" | "redeeming" | "needsAuth" | "accepted" | "invalid";

async function apiJSON(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw Object.assign(new Error(data?.error || "REQUEST_FAILED"), {
      status: res.status,
      data,
    });
  }

  return data;
}

function buildNext(token: string) {
  return `/accept-invite?token=${encodeURIComponent(token)}`;
}

function labelForState(state: State) {
  if (state === "redeeming") return "redeeming";
  if (state === "accepted") return "granted";
  if (state === "needsAuth") return "action required";
  if (state === "invalid") return "invalid";
  return "initializing";
}

export default function AcceptInvitePage() {
  return (
    <React.Suspense fallback={null}>
      <AcceptInvitePageInner />
    </React.Suspense>
  );
}

function AcceptInvitePageInner() {
  const sp = useSearchParams();
  const router = useRouter();

  const token = sp.get("token") || "";

  const [state, setState] = React.useState<State>("boot");
  const [tone, setTone] = React.useState<Tone>("watch");
  const [title, setTitle] = React.useState<string>("Preparing invitation…");
  const [body, setBody] = React.useState<string>(
    "Verifying this invitation and securing access to the workspace."
  );

  const nextUrl = React.useMemo(() => buildNext(token), [token]);

  // IMPORTANT: preserve token through auth so returning user auto-redeems
  const loginHref = React.useMemo(
    () => `/auth?mode=login&next=${encodeURIComponent(nextUrl)}`,
    [nextUrl]
  );
  const signupHref = React.useMemo(
    () => `/auth?mode=signup&next=${encodeURIComponent(nextUrl)}`,
    [nextUrl]
  );

  React.useEffect(() => {
    let alive = true;

    async function redeem() {
      if (!token) {
        setState("invalid");
        setTone("bad");
        setTitle("Invite link missing");
        setBody("This invitation link is missing a token.");
        return;
      }

      setState("redeeming");
      setTone("watch");
      setTitle("Accepting invite…");
      setBody("One moment — validating membership and access permissions.");

      try {
        await apiJSON("/api/members/accept", {
          method: "POST",
          body: JSON.stringify({ token }),
        });

        if (!alive) return;

        setState("accepted");
        setTone("good");
        setTitle("Invite accepted");
        setBody("Welcome to CavBot. Redirecting you to your workspace…");

        setTimeout(() => {
          router.replace("/settings?tab=team");
        }, 850);
      } catch (error: unknown) {
        if (!alive) return;

        const inviteError = error as { status?: number; data?: { message?: string } };
        const status = Number(inviteError?.status ?? 0);
        const msg = inviteError?.data?.message ?? "";

        // Not logged in -> gateway
        if (status === 401 || status === 403) {
          setState("needsAuth");
          setTone("watch");
          setTitle("Complete your join");
          setBody(
            "To accept this invitation, sign in or create a CavBot account using the email address that received the invite."
          );
          return;
        }

        // Expired / used / email mismatch
        setState("invalid");
        setTone("bad");
        setTitle("Unable to accept invite");
        setBody(
          msg ||
            "This invite may be expired, already used, or issued for a different email address."
        );
      }
    }

    redeem();

    return () => {
      alive = false;
    };
  }, [token, router]);

  return (
    <main className="invite-main">
      <section className="invite-stage" aria-label="Accept CavBot invitation">
        <div className="invite-card" data-tone={tone}>
          {/* Top row: badge + CavBot mark + status chip */}
          <div className="invite-top">
            <div className="invite-brand">
              {/* CavBot badge snippet (SAME STRUCTURE AS AUTH) */}
              <div className="invite-badge cb-badge cb-badge-inline" aria-hidden="false">
                <div className="cavbot-badge-frame">
                  <CdnBadgeEyes />
                </div>
              </div>

            </div>

            <div className="invite-chip" data-state={state}>
              {labelForState(state)}
            </div>
          </div>

          <div className="invite-divider" />
<br />
          {/* Title + body */}
          <h1 className="invite-title">{title}</h1>
          <p className="invite-body">{body}</p>
      
<br /><br />
          {/* Actions */}
          {state === "needsAuth" && (
            <>
          <div className="invite-actions">
            <Link className="invite-btn invite-btn-primary" href={signupHref}>
              Create CavBot account
              <span className="invite-btn-glow" aria-hidden="true"></span>
            </Link>

            <Link className="invite-btn invite-btn-ghost" href={loginHref}>
              Sign in to accept invite
            </Link>
          </div>

              <p className="invite-note">
                Use the <b>same email address</b> that received the invitation. Once authenticated,
                CavBot will automatically complete the join.
              </p>
            </>
          )}

          {state === "invalid" && (
            <>
              <div className="invite-actions">
                <Link className="invite-btn invite-btn-ghost" href="/auth?mode=login">
                  Go to Sign in
                  <br />
                </Link>

                <Link className="invite-btn invite-btn-primary" href="/auth?mode=signup">
                  Create account
                  <span className="invite-btn-glow" aria-hidden="true"></span>
                </Link>
              </div>

              <p className="invite-note">
                If you believe this is a mistake, request a fresh invite from the workspace administrator.
              </p>
            </>
          )}
<br /><br />
          {/* Footer */}
          <div className="invite-foot">
            <Link className="invite-link" href="/">
              Return to CavBot
            </Link>

            {token ? (
              <Link className="invite-link" href={nextUrl}>
                Retry redemption
              </Link>
            ) : (
              <span className="invite-link invite-link-dim">Invite token missing</span>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
