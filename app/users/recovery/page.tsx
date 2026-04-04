"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import CdnBadgeEyes from "@/components/CdnBadgeEyes";
import { isValidUsername, normalizeUsername } from "@/lib/username";
import { CavBotVerifyModal } from "@/components/CavBotVerifyModal";

type RecoveryMode = "password" | "email";
type VerifyRequest = {
  actionType: "reset";
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

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(v || "").trim());
}

function normalizeDomain(v: string) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+.*$/, "");
}

function isValidDomain(v: string) {
  const s = normalizeDomain(v);
  if (!s) return false;
  // very safe, human-friendly domain check
  // allows: company.com, my.company.co, sub.domain.io
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
}

function detectInitialMode(): RecoveryMode {
  if (typeof window === "undefined") return "password";
  const params = new URLSearchParams(window.location.search);
  const q = (params.get("mode") || "").toLowerCase();
  const h = (window.location.hash || "").toLowerCase();

  if (q === "email" || h === "#email") return "email";
  if (q === "password" || h === "#password") return "password";
  return "password";
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

export default function RecoveryPage() {
  const [mode, setMode] = useState<RecoveryMode>("password");
  const isPassword = mode === "password";

  // ------------------------------------------------------------
  // Badge eye states (error flash)
  // ------------------------------------------------------------
  const [eyeError, setEyeError] = useState(false);
  const eyeErrTimer = useRef<number | null>(null);

  function flashErrorEyes() {
    setEyeError(true);
    if (eyeErrTimer.current) window.clearTimeout(eyeErrTimer.current);
    eyeErrTimer.current = window.setTimeout(() => setEyeError(false), 900);
  }

  // ------------------------------------------------------------
  // Field state
  // ------------------------------------------------------------
  const [rpEmail, setRpEmail] = useState("");
  const [rpHuman, setRpHuman] = useState(false);

  const [reDomain, setReDomain] = useState("");
  const [reHuman, setReHuman] = useState(false);

  const [status, setStatus] = useState("");
  const [statusOn, setStatusOn] = useState(false);

  // Loading (prevents double submits)
  const [loading, setLoading] = useState(false);

  // Field errors (map by your data-error-for IDs)
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [verifyRequest, setVerifyRequest] = useState<VerifyRequest | null>(null);
  const verifyResolverRef = useRef<((value: VerifyResult) => void) | null>(null);

  function clearAllErrors() {
    setErrors({});
  }

  function setError(fieldId: string, msg: string) {
    setErrors((prev) => ({ ...prev, [fieldId]: msg }));
    if (msg) flashErrorEyes();
  }

  function clearError(fieldId: string) {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }

  function showStatus(msg: string) {
    setStatus(msg);
    setStatusOn(true);
  }

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

  // ------------------------------------------------------------
  // INITIAL MODE FROM QUERY OR HASH
  // supports:
  // /users/recovery?mode=password
  // /users/recovery?mode=email
  // /users/recovery#password
  // /users/recovery#email
  // ------------------------------------------------------------
  // ------------------------------------------------------------
  // MODE -> hash sync + status reset + error reset
  // ------------------------------------------------------------
  const handleModeChange = useCallback(
    (nextMode: RecoveryMode) => {
      setStatus("");
      setStatusOn(false);
      clearAllErrors();
      setMode(nextMode);
    },
    []
  );

  useEffect(() => {
    setMode(detectInitialMode());
  }, []);

  useEffect(() => {
    const nextHash = isPassword ? "#password" : "#email";
    if (window.location.hash !== nextHash) {
      history.replaceState(null, "", nextHash);
    }
  }, [isPassword, mode, handleModeChange]);

  // Keep UI in sync if user manually edits hash
  useEffect(() => {
    function onHashChange() {
      const h = (window.location.hash || "").toLowerCase();
      if (h === "#email") handleModeChange("email");
      if (h === "#password") handleModeChange("password");
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [handleModeChange]);

  useEffect(() => {
    return () => {
      if (verifyResolverRef.current) {
        verifyResolverRef.current({ ok: false });
        verifyResolverRef.current = null;
      }
    };
  }, []);

  // ------------------------------------------------------------
  // VALIDATION
  // ------------------------------------------------------------
  function validatePassword() {
    let ok = true;

    const ident = rpEmail.trim();
    if (!isValidEmail(ident) && !isValidUsername(normalizeUsername(ident))) {
      ok = false;
      setError("rp-email", "Enter your email or username.");
    } else {
      clearError("rp-email");
    }

    if (!rpHuman) {
      ok = false;
      setError("rp-human", "Please verify you’re human.");
    } else {
      clearError("rp-human");
    }

    return ok;
  }

  function validateEmail() {
    let ok = true;

    if (!isValidDomain(reDomain)) {
      ok = false;
      setError("re-domain", "Enter a valid domain (example: company.com).");
    } else {
      clearError("re-domain");
    }

    if (!reHuman) {
      ok = false;
      setError("re-human", "Please verify you’re human.");
    } else {
      clearError("re-human");
    }

    return ok;
  }

  const performVerifyAwareRequest = useCallback(
    async (args: { url: string; payload: Record<string, unknown>; identifierHint?: string }) => {
      let verificationGrantToken = "";
      let verificationSessionId = "";

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          accept: "application/json",
        };
        if (verificationGrantToken) headers[VERIFY_GRANT_HEADER] = verificationGrantToken;
        if (verificationSessionId) headers[VERIFY_SESSION_HEADER] = verificationSessionId;

        const res = await fetch(args.url, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers,
          body: JSON.stringify({
            ...args.payload,
            verificationSessionId: verificationSessionId || undefined,
          }),
        });

        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.ok) return data;

        const verifyStep = parseVerifyStepUp(data);
        if (verifyStep?.decision === "step_up_required") {
          const verification = await requestVerification({
            actionType: "reset",
            sessionId: verifyStep.sessionId || verificationSessionId,
            identifierHint: args.identifierHint,
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

        const message = String(data?.message || data?.error || "Request failed.");
        throw new Error(message);
      }

      throw new Error("Verification failed.");
    },
    [requestVerification],
  );

  // ------------------------------------------------------------
  // SUBMIT => Password reset (already wired)
  // ------------------------------------------------------------
  async function onSubmitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setStatus("");
    setStatusOn(false);
    clearAllErrors();

    if (!validatePassword()) return;

    setLoading(true);
    showStatus("CavBot scan initialized. Preparing reset route…");

    try {
      await performVerifyAwareRequest({
        url: "/api/auth/recovery/password",
        identifierHint: rpEmail.trim(),
        payload: { email: rpEmail },
      });

      showStatus("If an account exists for this email or username, a reset link has been sent.");
    } catch (error) {
      showStatus((error as Error)?.message || "Request failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ------------------------------------------------------------
  // SUBMIT => Recover email by domain (NOW WIRED ✅)
  // ------------------------------------------------------------
  async function onSubmitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setStatus("");
    setStatusOn(false);
    clearAllErrors();

    if (!validateEmail()) return;

    const domain = normalizeDomain(reDomain);

    setLoading(true);
    showStatus("CavBot scan initialized. Locating workspace members…");

    try {
      await performVerifyAwareRequest({
        url: "/api/auth/recovery/email/by-domain",
        payload: { domain },
      });

      showStatus("If a workspace exists for this domain, recovery emails have been sent.");
    } catch (error) {
      showStatus((error as Error)?.message || "Request failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const kickerText = isPassword ? "Reset route" : "Recover by domain";
  const titleText = isPassword ? "Forgot your password?" : "Forgot your email?";
  const blurbText = isPassword
    ? "You’re safe — CavBot remembers the route. Enter your email or username and CavBot will scan for your profile and start a reset."
    : "You’re safe — CavBot remembers the route. Enter your workspace domain and CavBot will scan for accounts tied to that domain.";

  return (
    <>
      <div className="auth-shell" data-cavbot-page="recovery">
        <main className="auth-main">
        <section className="auth-stage" aria-label="CavBot account recovery">
          <div className="auth-grid">
            <section className="auth-card" aria-label="Recovery panel">
              {/* TOP */}
              <div className="auth-card-top">
                <div className="auth-title-row">
                  <br />
                  <br />

                  {/* Badge (same snippet but now supports red-eye error flash) */}
                  <div
                    className={[
                      "auth-badge",
                      "cb-badge",
                      "cb-badge-inline",
                      eyeError ? "cavbot-auth-eye-error" : "",
                    ].join(" ")}
                    data-auth-badge
                    aria-hidden="false"
                  >
                    <div className="cavbot-badge-frame">
                      <CdnBadgeEyes />
                    </div>
                  </div>

                  <br />

                  <div>
                    <div className="auth-kicker" id="auth-kicker">
                      {kickerText}
                    </div>
                    <br />
                    <h2 className="auth-title" id="auth-title">
                      {titleText}
                    </h2>
                  </div>
                </div>

                <br />

                {/* Toggle (Password / Email) */}
                <div className="auth-toggle" role="tablist" aria-label="Toggle recovery modes">
                  <button
                    className={`auth-toggle-btn ${isPassword ? "is-active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={isPassword ? "true" : "false"}
                    aria-controls="panel-password-tabpanel"
                    id="tab-password"
                    onClick={() => handleModeChange("password")}
                    disabled={loading}
                  >
                    Password
                  </button>

                  <button
                    className={`auth-toggle-btn ${!isPassword ? "is-active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={!isPassword ? "true" : "false"}
                    aria-controls="panel-email-tabpanel"
                    id="tab-email"
                    onClick={() => handleModeChange("email")}
                    disabled={loading}
                  >
                    Email
                  </button>

                  <span
                    className="auth-toggle-indicator"
                    aria-hidden="true"
                    style={{
                      transform: isPassword ? "translateX(0)" : "translateX(100%)",
                    }}
                  />
                </div>
              </div>

              <br />

              <p className="recovery-blurb" id="recovery-blurb">
                {blurbText}
              </p>

              <div
                className={`recovery-status ${statusOn ? "is-on" : ""}`}
                id="recovery-status"
                role="status"
                aria-live="polite"
              >
                {status}
              </div>

              <br />

              <div className="auth-panels">
                {/* PANEL A => Password */}
                <div
                  id="panel-password-tabpanel"
                  role="tabpanel"
                  aria-labelledby="tab-password"
                  tabIndex={0}
                  hidden={!isPassword}
                >
                  <form
                    className="auth-panel"
                    id="panel-password"
                    aria-labelledby="tab-password"
                    noValidate
                    onSubmit={onSubmitPassword}
                  >
                    <div className="auth-field-row">
                      <label className="auth-label" htmlFor="rp-email"></label>
                      <input
                        className={`auth-input ${errors["rp-email"] ? "is-error" : ""}`}
                        id="rp-email"
                        name="email"
                        type="text"
                        autoComplete="username"
                        placeholder="Email or username"
                        value={rpEmail}
                        onChange={(e) => {
                          setRpEmail(e.target.value);
                          clearError("rp-email");
                        }}
                        disabled={loading}
                      />
                      <div className="auth-error" data-error-for="rp-email" aria-live="polite">
                        {errors["rp-email"] || ""}
                      </div>
                    </div>

                    <br />

                    <div className="auth-human">
                      <label className="auth-human-box">
                        <input
                          className="sr-only"
                          type="checkbox"
                          id="rp-human"
                          name="human"
                          checked={rpHuman}
                          onChange={(e) => {
                            setRpHuman(e.target.checked);
                            clearError("rp-human");
                          }}
                          disabled={loading}
                        />
                        <span className="auth-check" aria-hidden="true"></span>
                        <span className="auth-human-text">Verify you’re human</span>
                        <Image
                          className="auth-human-mark"
                          src="/logo/cavbot-logomark.svg"
                          alt=""
                          width={40}
                          height={40}
                          unoptimized
                          aria-hidden="true"
                        />
                      </label>
                      <div className="auth-error" data-error-for="rp-human" aria-live="polite">
                        {errors["rp-human"] || ""}
                      </div>
                    </div>

                    <br />

                    <button className="auth-primary" type="submit" id="rp-submit" disabled={loading}>
                      {loading ? "Sending…" : "Send reset link"}
                      <span className="auth-primary-glow" aria-hidden="true"></span>
                    </button>

                    <br />
                  </form>
                </div>

                {/* PANEL B => Email */}
                <div
                  id="panel-email-tabpanel"
                  role="tabpanel"
                  aria-labelledby="tab-email"
                  tabIndex={0}
                  hidden={isPassword}
                >
                  <form
                    className="auth-panel"
                    id="panel-email"
                    aria-labelledby="tab-email"
                    noValidate
                    onSubmit={onSubmitEmail}
                  >
                    <div className="auth-field-row">
                      <label className="auth-label" htmlFor="re-domain"></label>
                      <input
                        className={`auth-input ${errors["re-domain"] ? "is-error" : ""}`}
                        id="re-domain"
                        name="domain"
                        type="text"
                        inputMode="url"
                        autoComplete="off"
                        placeholder="Enter your domain"
                        value={reDomain}
                        onChange={(e) => {
                          setReDomain(e.target.value);
                          clearError("re-domain");
                        }}
                        disabled={loading}
                      />
                      <div className="auth-error" data-error-for="re-domain" aria-live="polite">
                        {errors["re-domain"] || ""}
                      </div>
                    </div>

                    <br />

                    <div className="auth-human">
                      <label className="auth-human-box">
                        <input
                          className="sr-only"
                          type="checkbox"
                          id="re-human"
                          name="human"
                          checked={reHuman}
                          onChange={(e) => {
                            setReHuman(e.target.checked);
                            clearError("re-human");
                          }}
                          disabled={loading}
                        />
                        <span className="auth-check" aria-hidden="true"></span>
                        <span className="auth-human-text">Verify you’re human</span>
                        <Image
                          className="auth-human-mark"
                          src="/logo/cavbot-logomark.svg"
                          alt=""
                          width={40}
                          height={40}
                          unoptimized
                          aria-hidden="true"
                        />
                      </label>
                      <div className="auth-error" data-error-for="re-human" aria-live="polite">
                        {errors["re-human"] || ""}
                      </div>
                    </div>

                    <br />

                    <button className="auth-primary" type="submit" id="re-submit" disabled={loading}>
                      {loading ? "Sending…" : "Send recovery email"}
                      <span className="auth-primary-glow" aria-hidden="true"></span>
                    </button>

                    <br />
                  </form>
                </div>
              </div>

              <br />

              {/* FOOTER MENU */}
              <div className="auth-bottom" role="contentinfo" aria-label="Footer">
                <details className="auth-footer-menu">
                  <summary aria-label="Open account help menu">
                    Account help
                    <span className="auth-footer-chevron" aria-hidden="true"></span>
                  </summary>

                  <br />

                  <div className="auth-footer-panel" role="group" aria-label="Account recovery links">
                    <div className="auth-footer-links">
                      <Link className="auth-link" href="/auth?mode=login">
                        Log In
                      </Link>

                      <Link className="auth-link" href="/auth?mode=signup">
                        Sign Up
                      </Link>
                    </div>
                  </div>
                </details>

                <br />

                <div className="auth-bottom-right">© 2026 CavBot · All rights reserved</div>
              </div>
            </section>
          </div>
        </section>
        </main>
      </div>
      {verifyRequest ? (
        <CavBotVerifyModal
          open={Boolean(verifyRequest)}
          actionType="reset"
          sessionId={verifyRequest.sessionId}
          identifierHint={verifyRequest.identifierHint}
          route="/users/recovery"
          onClose={closeVerifyModal}
          onVerified={completeVerifyModal}
        />
      ) : null}
    </>
  );
}
