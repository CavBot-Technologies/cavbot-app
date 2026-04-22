"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AdminAuthHero } from "@/components/admin/AdminAuthHero";
import { AvatarBadge } from "@/components/admin/AdminPrimitives";
import CavBotLoadingScreen from "@/components/CavBotLoadingScreen";
import { CavBotVerifyModal } from "@/components/CavBotVerifyModal";
import { PasswordVisibilityIcon } from "@/components/icons/PasswordVisibilityIcon";
import type { AdminDepartment } from "@/lib/admin/access";
import { getDepartmentAvatarTone } from "@/lib/admin/staffDisplay";

type Stage =
  | "credentials"
  | "client2fa"
  | "adminReady"
  | "adminCode"
  | "done";

type SessionResponse = {
  ok?: boolean;
  authenticated?: boolean;
  adminAuthenticated?: boolean;
  staffEligible?: boolean;
  staff?: {
    email?: string;
    displayName?: string;
    avatarImage?: string | null;
    staffCode?: string;
    department?: AdminDepartment;
    positionTitle?: string;
    systemRole?: string;
  } | null;
};

type AdminChallengeResponse = {
  challengeId?: string;
  error?: string;
};

type LoginResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  challengeRequired?: boolean;
  method?: "email" | "app";
  challengeId?: string;
  verify?: {
    challengeRequired?: boolean;
    sessionId?: string;
  };
};

type VerifyRequest = {
  actionType: "login";
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

export default function AdminSignInClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => String(searchParams?.get("next") || "/"), [searchParams]);

  const [stage, setStage] = useState<Stage>("credentials");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [clientChallengeId, setClientChallengeId] = useState("");
  const [clientChallengeMethod, setClientChallengeMethod] = useState<"email" | "app">("email");
  const [clientChallengeCode, setClientChallengeCode] = useState("");
  const [adminChallengeId, setAdminChallengeId] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionInfo, setSessionInfo] = useState<SessionResponse | null>(null);
  const [verifyRequest, setVerifyRequest] = useState<VerifyRequest | null>(null);
  const verifyResolverRef = useRef<((value: VerifyResult) => void) | null>(null);
  const identifierInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const accessTooltip = [
    "Active staff only.",
    "",
    "After your password is verified, CavBot sends a short Caverify access code to finish sign-in.",
  ].join("\n");

  function handleIdentifierChange(event: ChangeEvent<HTMLInputElement>) {
    setIdentifier(event.target.value);
  }

  function handleIdentifierBlur() {
    setIdentifier((current: string) => normalizeStaffCodeInput(current) || current.trim().toUpperCase());
  }

  function handlePasswordChange(event: ChangeEvent<HTMLInputElement>) {
    setPassword(event.target.value);
  }

  function handleClientChallengeCodeChange(event: ChangeEvent<HTMLInputElement>) {
    setClientChallengeCode(event.target.value);
  }

  function handleAdminCodeChange(event: ChangeEvent<HTMLInputElement>) {
    setAdminCode(event.target.value);
  }

  function togglePasswordVisibility() {
    setShowPassword((value: boolean) => !value);
  }

  function normalizeStaffCodeInput(value: string) {
    const digits = String(value || "").replace(/\D+/g, "");
    if (!digits) return "";
    return `CAV-${digits.padStart(6, "0").slice(-6)}`;
  }

  const readCredentialSnapshot = useCallback(() => {
    const domIdentifier = String(identifierInputRef.current?.value || "");
    const domPassword = String(passwordInputRef.current?.value || "");
    const nextIdentifier = domIdentifier || identifier;
    const nextPassword = domPassword || password;

    if (domIdentifier && domIdentifier !== identifier) setIdentifier(domIdentifier);
    if (domPassword && domPassword !== password) setPassword(domPassword);

    return {
      identifier: nextIdentifier,
      password: nextPassword,
    };
  }, [identifier, password]);

  const requestVerification = useCallback(
    (request: VerifyRequest) =>
      new Promise<VerifyResult>((resolve) => {
        verifyResolverRef.current = resolve;
        setVerifyRequest(request);
      }),
    [],
  );

  const closeVerifyModal = useCallback(() => {
    if (verifyResolverRef.current) {
      verifyResolverRef.current({ ok: false });
      verifyResolverRef.current = null;
    }
    setVerifyRequest(null);
  }, []);

  const completeVerifyModal = useCallback((value: { verificationGrantToken: string; sessionId: string }) => {
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

  useEffect(() => {
    return () => {
      if (verifyResolverRef.current) {
        verifyResolverRef.current({ ok: false });
        verifyResolverRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const syncAutofill = () => {
      readCredentialSnapshot();
    };

    const rafId = window.requestAnimationFrame(syncAutofill);
    const timeoutId = window.setTimeout(syncAutofill, 180);
    window.addEventListener("pageshow", syncAutofill);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      window.removeEventListener("pageshow", syncAutofill);
    };
  }, [readCredentialSnapshot]);

  useEffect(() => {
    async function readSessionState() {
      const response = await fetch("/api/admin/session", {
        cache: "no-store",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as SessionResponse | null;
      if (!payload) return;
      setSessionInfo(payload);

      if (payload.adminAuthenticated) {
        router.replace(nextPath);
        return;
      }

      if (payload.authenticated && payload.staffEligible) {
        setStage("adminReady");
      }
    }

    void readSessionState();
  }, [nextPath, router]);

  async function beginAdminChallenge() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/session/challenge", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ next: nextPath }),
      });
      const payload = (await response.json().catch(() => null)) as AdminChallengeResponse | null;
      if (!response.ok || !payload?.challengeId) {
        throw new Error(payload?.error || "Could not send Caverify access code.");
      }
      setAdminChallengeId(String(payload.challengeId));
      setAdminCode("");
      setStage("adminCode");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send Caverify access code.");
    } finally {
      setBusy(false);
    }
  }

  const performVerifyAwareLogin = useCallback(
    async (normalizedStaffCode: string, nextPassword: string) => {
      let verificationGrantToken = "";
      let verificationSessionId = "";

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          accept: "application/json",
        };
        if (verificationGrantToken) headers[VERIFY_GRANT_HEADER] = verificationGrantToken;
        if (verificationSessionId) headers[VERIFY_SESSION_HEADER] = verificationSessionId;

        const response = await fetch("/api/auth/login", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers,
          body: JSON.stringify({
            identifier: normalizedStaffCode,
            password: nextPassword,
            verificationGrantToken: verificationGrantToken || undefined,
            verificationSessionId: verificationSessionId || undefined,
          }),
        });

        const raw = await response.text();
        let payload: LoginResponse | Record<string, unknown> = {};
        try {
          payload = raw ? (JSON.parse(raw) as LoginResponse | Record<string, unknown>) : {};
        } catch {
          payload = {};
        }

        if (response.ok) return payload as LoginResponse;

        const verifyStep = parseVerifyStepUp(payload as Record<string, unknown>);
        if (verifyStep?.decision === "step_up_required") {
          const verification = await requestVerification({
            actionType: "login",
            sessionId: verifyStep.sessionId || verificationSessionId,
            identifierHint: normalizedStaffCode,
          });
          if (!verification.ok || !verification.verificationGrantToken) {
            throw new Error("Caverify cancelled.");
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

        throw new Error(
          String(
            (payload as LoginResponse)?.message ||
              (payload as LoginResponse)?.error ||
              raw ||
              "Sign-in failed.",
          ),
        );
      }

      throw new Error("Verification failed.");
    },
    [requestVerification],
  );

  async function handleCredentialsSubmit() {
    setBusy(true);
    setError("");
    try {
      const credentialSnapshot = readCredentialSnapshot();
      const normalizedStaffCode = normalizeStaffCodeInput(credentialSnapshot.identifier);
      if (!normalizedStaffCode) {
        throw new Error("Enter your CavBot staff ID.");
      }
      if (String(credentialSnapshot.identifier || "").includes("@")) {
        throw new Error("HQ sign-in uses staff ID only.");
      }

      const payload = await performVerifyAwareLogin(normalizedStaffCode, credentialSnapshot.password);
      if (!payload?.ok) {
        throw new Error(payload?.message || payload?.error || "Sign-in failed.");
      }

      if (payload.challengeRequired && payload.challengeId) {
        setClientChallengeId(String(payload.challengeId));
        setClientChallengeMethod(payload.method || "email");
        setClientChallengeCode("");
        setStage("client2fa");
        return;
      }

      setStage("adminReady");
      await beginAdminChallenge();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleClientChallengeVerify() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/challenge/verify", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          challengeId: clientChallengeId,
          method: clientChallengeMethod,
          code: clientChallengeCode,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || payload?.error || "Verification failed.");
      }

      setStage("adminReady");
      await beginAdminChallenge();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdminVerify() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/session/verify", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          challengeId: adminChallengeId,
          code: adminCode,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; nextPath?: string; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "HQ access verification failed.");
      }

      setStage("done");
      router.replace(String(payload.nextPath || nextPath || "/"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "HQ access verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return stage === "done" ? (
    <CavBotLoadingScreen title="Welcome Back" className="hq-auth-loading" />
  ) : (
    <div className="hq-authShell">
      <div className="hq-authCard">
        <AdminAuthHero
          title="CavBot HQ"
          subtitle="Sign in with your CavBot staff ID."
        />

        <div className="hq-formGrid">
          {stage === "credentials" ? (
            <>
              <label className="hq-formLabel">
                Staff ID
                <input
                  ref={identifierInputRef}
                  className="hq-input"
                  name="staff-id"
                  value={identifier}
                  onChange={handleIdentifierChange}
                  onBlur={handleIdentifierBlur}
                  placeholder="CAV-000001"
                  autoComplete="username"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <label className="hq-formLabel">
                Password
                <div className="hq-passwordWrap">
                  <input
                    ref={passwordInputRef}
                    className="hq-input hq-inputPassword"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={handlePasswordChange}
                    placeholder="Password"
                    autoComplete="current-password"
                  />
                  <button
                    className="hq-passwordToggle"
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    onClick={togglePasswordVisibility}
                  >
                    <PasswordVisibilityIcon shown={showPassword} size={16} />
                  </button>
                </div>
              </label>
              <div className="hq-authFooter">
                <button
                  type="button"
                  className="hq-infoHint hq-authInfoHint"
                  title={accessTooltip}
                  aria-label="HQ access details"
                >
                  <span className="hq-infoHintGlyph" aria-hidden="true" />
                </button>
                <div className="hq-inline hq-authActions">
                  <a className="hq-buttonGhost" href="/forgot-staff-id">
                    Forgot staff ID
                  </a>
                  <button type="button" className="hq-button" disabled={busy} onClick={handleCredentialsSubmit}>
                    {busy ? "Signing in..." : "Proceed"}
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {stage === "client2fa" ? (
            <>
              <label className="hq-formLabel">
                {clientChallengeMethod === "app" ? "Authenticator code" : "Client sign-in code"}
                <input className="hq-input" value={clientChallengeCode} onChange={handleClientChallengeCodeChange} placeholder="6-digit code" />
              </label>
              <div className="hq-inline hq-authActions">
                <button type="button" className="hq-button" disabled={busy} onClick={handleClientChallengeVerify}>
                  {busy ? "Verifying..." : "Verify sign-in"}
                </button>
              </div>
            </>
          ) : null}

          {stage === "adminReady" ? (
              <>
              <div className="hq-empty">
                <p className="hq-emptyTitle">Secured by Caverify.</p>
                <p className="hq-emptySub">
                  Your staff session is verified. Send the Caverify access code to complete sign-in.
                </p>
              </div>
              <div className="hq-inline hq-authActions">
                <button type="button" className="hq-button" disabled={busy} onClick={beginAdminChallenge}>
                  {busy ? "Sending..." : "Send access code"}
                </button>
              </div>
            </>
          ) : null}

          {stage === "adminCode" ? (
            <>
              <label className="hq-formLabel">
                <span className="cb-sr-only">Caverify access code</span>
                <input
                  aria-label="Caverify access code"
                  className="hq-input"
                  value={adminCode}
                  onChange={handleAdminCodeChange}
                  placeholder="6-digit code"
                />
              </label>
              <div className="hq-inline hq-authActions">
                <button type="button" className="hq-buttonGhost" disabled={busy} onClick={beginAdminChallenge}>
                  Resend code
                </button>
                <button type="button" className="hq-button" disabled={busy} onClick={handleAdminVerify}>
                  {busy ? "Verifying..." : "Enter HQ"}
                </button>
              </div>
            </>
          ) : null}

          {error ? <div className="hq-error"><p className="hq-errorTitle">Sign-in issue</p><p className="hq-errorSub">{error}</p></div> : null}

          {sessionInfo?.staff ? (
            <div className="hq-helperStaff">
              <AvatarBadge
                name={sessionInfo.staff.displayName || sessionInfo.staff.email || sessionInfo.staff.staffCode || "CavBot staff"}
                email={sessionInfo.staff.email}
                image={sessionInfo.staff.avatarImage}
                tone={getDepartmentAvatarTone(sessionInfo.staff.department || "COMMAND")}
                size="sm"
              />
              <p className="hq-helperText hq-helperStaffCopy">
                Position: {sessionInfo.staff.positionTitle || "Staff"} · Staff ID: {sessionInfo.staff.staffCode || "Hidden"}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <CavBotVerifyModal
        open={Boolean(verifyRequest)}
        actionType="login"
        route="/sign-in"
        sessionId={verifyRequest?.sessionId}
        identifierHint={verifyRequest?.identifierHint}
        brandTitle="CavBot HQ"
        brandSubtitle="Complete the Caverify security check to continue protected staff sign-in."
        onClose={closeVerifyModal}
        onVerified={completeVerifyModal}
      />
    </div>
  );
}
