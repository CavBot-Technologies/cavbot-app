// app/auth/page.tsx
"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import CdnBadgeEyes from "@/components/CdnBadgeEyes";
import { isLoginUsername, isReservedUsername, isValidUsername, normalizeUsername } from "@/lib/username";
import { PasswordVisibilityIcon } from "@/components/icons/PasswordVisibilityIcon";
import { CavBotVerifyModal } from "@/components/CavBotVerifyModal";

type Mode = "signup" | "login";
type VerifyActionType = "signup" | "login";
type VerifyRequest = {
  actionType: VerifyActionType;
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

function normalizeMode(v: unknown): Mode | null {
  const s = String(v || "").toLowerCase().trim();
  if (s === "login") return "login";
  if (s === "signup") return "signup";
  return null;
}

function safeNextPath(raw: string | null): string {
  const s = String(raw || "").trim();
  if (!s) return "/";
  if (!s.startsWith("/")) return "/";
  if (s.startsWith("//")) return "/";
  if (s.includes("\\")) return "/";
  try {
    const u = new URL(s, "https://app.invalid");
    return `${u.pathname}${u.search}${u.hash}` || "/";
  } catch {
    return "/";
  }
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

export default function AuthPage() {
  return <AuthPageClientOnly />;
}

const AuthPageClientOnly = dynamic(() => Promise.resolve(AuthPageInner), {
  ssr: false,
  loading: () => null,
});

function AuthPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const badgeRef = useRef<HTMLDivElement | null>(null);

  // ------------------------------------------------------------
  // MODE (tabs)
  // ------------------------------------------------------------
  const [mode, setMode] = useState<Mode>("signup");

  // Keep a stable "setMode + sync URL" helper
  function setModeAndSync(next: Mode) {
    setMode(next);

    // Query-param is reliable (survives redirects). Preserve other params (like ?next=...)
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", next);

      // keep URL clean (no hash dependency)
      url.hash = "";

      history.replaceState(null, "", url.toString());
    }
  }

  // Read initial mode from query AFTER mount
  useEffect(() => {
    const qMode = normalizeMode(searchParams.get("mode"));
    if (qMode) {
      setMode(qMode);
      return;
    }

    // fallback: support legacy hash if it exists
    const h = String(window.location.hash || "").toLowerCase();
    if (h === "#login") setMode("login");
    if (h === "#signup") setMode("signup");
  }, [searchParams]);

  // ------------------------------------------------------------
  // Badge eye states (error + watch)
  // ------------------------------------------------------------
  const [eyeError, setEyeError] = useState(false);
  const [eyeWatch, setEyeWatch] = useState(false);
  const eyeErrTimer = useRef<number | null>(null);

const flashErrorEyes = useCallback(() => {
  setEyeError(true);
  if (eyeErrTimer.current) window.clearTimeout(eyeErrTimer.current);
  eyeErrTimer.current = window.setTimeout(() => setEyeError(false), 900);
}, []);

  // ------------------------------------------------------------
  // FORM STATE
  // ------------------------------------------------------------
  // Signup
  const [suName, setSuName] = useState("");
  const [suUsername, setSuUsername] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPass, setSuPass] = useState("");
  const [suConf, setSuConf] = useState("");
  const [suHuman, setSuHuman] = useState(false);
  const [suShowPass, setSuShowPass] = useState(false);

  // Login
  const [liEmail, setLiEmail] = useState("");
  const [liPass, setLiPass] = useState("");
  const [liHuman, setLiHuman] = useState(false);
  const [liShowPass, setLiShowPass] = useState(false);

  const [loading, setLoading] = useState(false);

  // field errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [verifyRequest, setVerifyRequest] = useState<VerifyRequest | null>(null);
  const verifyResolverRef = useRef<((value: VerifyResult) => void) | null>(null);

const clearAllErrors = useCallback(() => {
  setErrors({});
}, []);
const setError = useCallback(
  (fieldId: string, message: string) => {
    setErrors((prev) => ({ ...prev, [fieldId]: message }));
    if (message) flashErrorEyes();
  },
  [flashErrorEyes]
);
const clearError = useCallback((fieldId: string) => {
  setErrors((prev) => {
    const next = { ...prev };
    delete next[fieldId];
    return next;
  });
}, []);

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
    clearAllErrors();
  }, [clearAllErrors, mode]);

  useEffect(() => {
    return () => {
      if (verifyResolverRef.current) {
        verifyResolverRef.current({ ok: false });
        verifyResolverRef.current = null;
      }
    };
  }, []);

  // Watch eyes (password visible)
  useEffect(() => {
    setEyeWatch(Boolean(suShowPass || liShowPass));
  }, [suShowPass, liShowPass]);

  useEffect(() => {
    const root = badgeRef.current;
    if (!root) return;

    const pupils = Array.from(root.querySelectorAll<HTMLElement>(".cavbot-eye-pupil")).filter((pupil) =>
      Boolean(pupil.closest(".cavbot-eye-inner"))
    );
    if (!pupils.length) return;

    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const MAX_SHIFT_X = 2.15;
    const MAX_SHIFT_Y = 1.7;
    const EASE = 0.24;
    const IDLE_X = 0.45;
    const IDLE_Y = -0.12;

    let rafId = 0;
    let currentX = IDLE_X;
    let currentY = IDLE_Y;
    let targetX = IDLE_X;
    let targetY = IDLE_Y;

    const apply = () => {
      rafId = 0;
      currentX += (targetX - currentX) * EASE;
      currentY += (targetY - currentY) * EASE;

      const tx = currentX.toFixed(2);
      const ty = currentY.toFixed(2);
      for (const pupil of pupils) {
        pupil.style.opacity = "1";
        pupil.style.visibility = "visible";
        pupil.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      }

      const settling = Math.abs(targetX - currentX) > 0.01 || Math.abs(targetY - currentY) > 0.01;
      if (settling) rafId = window.requestAnimationFrame(apply);
    };

    const queue = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(apply);
    };

    const driveFromPoint = (clientX: number, clientY: number) => {
      const rect = root.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;
      const pull = clamp(dist / 160, 0, 1);
      targetX = clamp(nx * MAX_SHIFT_X * pull, -MAX_SHIFT_X, MAX_SHIFT_X);
      targetY = clamp(ny * MAX_SHIFT_Y * pull, -MAX_SHIFT_Y, MAX_SHIFT_Y);
      queue();
    };

    const onPointerMove = (event: PointerEvent | MouseEvent) => {
      driveFromPoint(event.clientX, event.clientY);
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      driveFromPoint(touch.clientX, touch.clientY);
    };

    const onPointerLeave = () => {
      targetX = IDLE_X;
      targetY = IDLE_Y;
      queue();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("mousemove", onPointerMove, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave, { passive: true });
    window.addEventListener("blur", onPointerLeave);
    queue();

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onPointerLeave);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [mode]);

  // ------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------
  function validateSignup() {
    let ok = true;

    if (suName.trim() && suName.trim().length < 2) {
      ok = false;
      setError("su-name", "Name looks too short.");
    } else {
      clearError("su-name");
    }

    const suUserTrim = suUsername.trim();
    if (!suUserTrim) {
      ok = false;
      setError("su-username", "Username is required.");
    } else if (suUserTrim !== normalizeUsername(suUserTrim)) {
      ok = false;
      setError("su-username", "Username must be lowercase.");
    } else if (!isValidUsername(suUserTrim)) {
      ok = false;
      setError("su-username", "Username must be 3–20 chars, start with a letter.");
    } else if (isReservedUsername(suUserTrim)) {
      ok = false;
      setError("su-username", "That username is reserved.");
    } else {
      clearError("su-username");
    }

    if (!isValidEmail(suEmail.trim())) {
      ok = false;
      setError("su-email", "Enter a valid email address.");
    } else {
      clearError("su-email");
    }

    if (suPass.length < 8) {
      ok = false;
      setError("su-password", "Password must be at least 8 characters.");
    } else {
      clearError("su-password");
    }

    if (suConf !== suPass) {
      ok = false;
      setError("su-confirm", "Passwords do not match.");
    } else {
      clearError("su-confirm");
    }

    if (!suHuman) {
      ok = false;
      setError("su-human", "Please verify you’re human.");
    } else {
      clearError("su-human");
    }

    return ok;
  }

  function validateLogin() {
    let ok = true;

    const liTrim = liEmail.trim();
    if (!isValidEmail(liTrim) && !isLoginUsername(liTrim)) {
      ok = false;
      setError("li-email", "Enter your email or username.");
    } else {
      clearError("li-email");
    }

    if (liPass.length < 1) {
      ok = false;
      setError("li-password", "Enter your password.");
    } else {
      clearError("li-password");
    }

    if (!liHuman) {
      ok = false;
      setError("li-human", "Please verify you’re human.");
    } else {
      clearError("li-human");
    }

    return ok;
  }

  // ------------------------------------------------------------
  // Submit wiring
  // ------------------------------------------------------------
  const performVerifyAwareRequest = useCallback(
    async (args: {
      url: string;
      actionType: VerifyActionType;
      identifierHint?: string;
      payload: Record<string, unknown>;
    }) => {
      let verificationGrantToken = "";
      let verificationSessionId = "";

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          accept: "application/json",
        };
        if (verificationGrantToken) headers[VERIFY_GRANT_HEADER] = verificationGrantToken;
        if (verificationSessionId) headers[VERIFY_SESSION_HEADER] = verificationSessionId;

        const res = await fetch(args.url, {
          method: "POST",
          credentials: "include",
          headers,
          cache: "no-store",
          body: JSON.stringify({
            ...args.payload,
            verificationSessionId: verificationSessionId || undefined,
          }),
        });

        const raw = await res.text();
        let data: Record<string, unknown> = {};
        try {
          data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          data = {};
        }

        if (res.ok) return data;

        const verifyStep = parseVerifyStepUp(data);
        if (verifyStep?.decision === "step_up_required") {
          const verification = await requestVerification({
            actionType: args.actionType,
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

        const code = String(data?.error || data?.message || raw || "request_failed");
        throw new Error(`${code} (${res.status})`);
      }

      throw new Error("Verification failed.");
    },
    [requestVerification],
  );

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    clearAllErrors();
    if (!validateLogin()) return;

    setLoading(true);
    try {
      const data = await performVerifyAwareRequest({
        url: "/api/auth/login",
        actionType: "login",
        identifierHint: liEmail.trim(),
        payload: {
          email: liEmail.trim().toLowerCase(),
          password: liPass,
        },
      });

      if (Boolean(data?.challengeRequired) && typeof data?.redirectTo === "string") {
        router.replace(String(data.redirectTo));
        return;
      }

      router.replace(nextPath);
    } catch (err: unknown) {
      flashErrorEyes();
      setError("li-password", (err as Error)?.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function submitSignup(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    clearAllErrors();
    if (!validateSignup()) return;

    setLoading(true);
    try {
      await performVerifyAwareRequest({
        url: "/api/auth/signup",
        actionType: "signup",
        identifierHint: suEmail.trim().toLowerCase(),
        payload: {
          name: suName.trim(),
          username: normalizeUsername(suUsername.trim()),
          email: suEmail.trim().toLowerCase(),
          password: suPass,
        },
      });

      router.replace(nextPath);
    } catch (err: unknown) {
      flashErrorEyes();
      setError("su-email", (err as Error)?.message || "Sign up failed.");
    } finally {
      setLoading(false);
    }
  }

  // ------------------------------------------------------------
  // SSO
  // ------------------------------------------------------------
  function sso(provider: "github" | "google") {
    const qs = nextPath && nextPath !== "/" ? `?next=${encodeURIComponent(nextPath)}` : "";
    if (provider === "github") {
      window.location.href = `/api/auth/oauth/github/start${qs}`;
      return;
    }
    window.location.href = `/api/auth/oauth/google/start${qs}`;
  }

  const isSignup = mode === "signup";

  return (
    <>
      <main className="auth-main">
      <section className="auth-stage auth-stage-auth" aria-label="CavBot sign up and login">
        <header className="auth-stage-head" aria-label="Authentication header">
          <a className="cb-wordmark auth-wordmark" aria-label="CavBot" href="https://www.cavbot.io">
            <Image
              className="cb-wordmark-img auth-wordmark-img"
              src="/logo/official-logotype-light.svg"
              alt="CavBot Logo"
              width={220}
              height={40}
              priority
              unoptimized
            />
          </a>

          <div className="auth-toggle auth-toggle-head" role="tablist" aria-label="Toggle sign up and log in">
            <button
              className={`auth-toggle-btn ${isSignup ? "is-active" : ""}`}
              type="button"
              role="tab"
              id="tab-signup"
              aria-selected={isSignup ? "true" : "false"}
              aria-controls="panel-signup"
              tabIndex={isSignup ? 0 : -1}
              onClick={() => setModeAndSync("signup")}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  setModeAndSync("login");
                }
              }}
            >
              Sign up
            </button>

            <button
              className={`auth-toggle-btn ${!isSignup ? "is-active" : ""}`}
              type="button"
              role="tab"
              id="tab-login"
              aria-selected={!isSignup ? "true" : "false"}
              aria-controls="panel-login"
              tabIndex={!isSignup ? 0 : -1}
              onClick={() => setModeAndSync("login")}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  setModeAndSync("signup");
                }
              }}
            >
              Log in
            </button>

            <span
              className="auth-toggle-indicator"
              aria-hidden="true"
              style={{
                transform: isSignup ? "translateX(0)" : "translateX(100%)",
              }}
            />
          </div>
        </header>

        <div className="auth-grid">
          <section className="auth-card" aria-label="Authentication panel">
            <div className="auth-card-top">
              <div className="auth-title-row">
                {/* CavBot badge snippet (UNCHANGED) */}
                <div
                  ref={badgeRef}
                  className={[
                    "auth-badge",
                    "cb-badge",
                    "cb-badge-inline",
                    eyeError ? "cavbot-auth-eye-error" : "",
                    eyeWatch ? "cavbot-auth-eye-watch" : "",
                  ].join(" ")}
                  data-auth-badge
                  aria-hidden="false"
                >
                  <div className="cavbot-badge-frame">
                    <CdnBadgeEyes trackingMode="eyeOnly" />
                  </div>
                </div>

                <div>
                  <br />
                  <div className="auth-kicker" id="auth-kicker">
                    {isSignup ? "Instrument. Recover. Optimize." : "Turn dead ends into signal"}
                  </div>
                  <br />
                  <h2 className="auth-title" id="auth-title">
                    {isSignup ? "Sign up" : "Log in"}
                  </h2>
                  <br />
                </div>
              </div>
            </div>

            <br />

            {/* SSO */}
            <div className="auth-sso" role="group" aria-label="Single sign-on options">
              <button
                type="button"
                className="auth-sso-btn"
                data-provider="github"
                aria-label="Continue with GitHub"
                onClick={() => sso("github")}
              >
                <span className="auth-sso-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" focusable="false" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 .5C5.73.5.75 5.63.75 12c0 5.1 3.29 9.42 7.86 10.95.57.11.78-.25.78-.56 0-.28-.01-1.02-.02-2-3.2.71-3.88-1.58-3.88-1.58-.52-1.36-1.28-1.72-1.28-1.72-1.05-.74.08-.73.08-.73 1.16.08 1.77 1.22 1.77 1.22 1.03 1.8 2.7 1.28 3.36.98.1-.77.4-1.28.72-1.58-2.55-.3-5.23-1.3-5.23-5.8 0-1.28.45-2.33 1.18-3.15-.12-.3-.51-1.53.11-3.18 0 0 .97-.32 3.18 1.2a10.7 10.7 0 0 1 2.9-.4c.98 0 1.97.14 2.9.4 2.21-1.52 3.18-1.2 3.18-1.2.62 1.65.23 2.88.11 3.18.74.82 1.18 1.87 1.18 3.15 0 4.51-2.69 5.5-5.25 5.79.41.36.78 1.08.78 2.18 0 1.58-.01 2.85-.01 3.23 0 .31.2.67.79.56A11.28 11.28 0 0 0 23.25 12C23.25 5.63 18.27.5 12 .5Z"
                    />
                  </svg>
                </span>
                <span className="auth-sso-text">Continue with GitHub</span>
              </button>

              <button
                type="button"
                className="auth-sso-btn"
                data-provider="google"
                aria-label="Continue with Google"
                onClick={() => sso("google")}
              >
                <span className="auth-sso-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" focusable="false" aria-hidden="true">
                    <path
                      fill="#EA4335"
                      d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1S8.7 5.7 12 5.7c1.9 0 3.2.8 3.9 1.6l2.6-2.5C16.9 3.3 14.7 2 12 2 6.9 2 2.8 6.1 2.8 11.8S6.9 21.6 12 21.6c6.9 0 8.6-4.9 8.6-7.4 0-.5-.1-1-.1-1.4H12Z"
                    />
                    <path
                      fill="#34A853"
                      d="M3.6 7.3l3.2 2.3C7.7 7.4 9.7 5.7 12 5.7c1.9 0 3.2.8 3.9 1.6l2.6-2.5C16.9 3.3 14.7 2 12 2 8.4 2 5.2 4 3.6 7.3Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M12 21.6c2.7 0 5-1 6.7-2.6l-3.1-2.4c-.8.6-2 1.3-3.6 1.3-2.3 0-4.3-1.5-5.1-3.7l-3.3 2.5c1.6 3 4.7 4.9 8.4 4.9Z"
                    />
                    <path
                      fill="#4285F4"
                      d="M20.5 11.8c0-.5-.1-1-.1-1.4H12v3.9h5.5c-.3 1.4-1.2 2.6-2.6 3.4l3.1 2.4c1.8-1.7 2.5-4.2 2.5-6.3Z"
                    />
                  </svg>
                </span>
                <span className="auth-sso-text">Continue with Google</span>
              </button>
            </div>

            <br />
            <br />

            <div className="auth-divider" role="separator" aria-label="Or continue with email">
              <span>or</span>
            </div>

            <br />

            {/* PANELS */}
            <div className="auth-panels">
              {/* SIGNUP */}
              <div
                className="auth-panel"
                id="panel-signup"
                role="tabpanel"
                aria-labelledby="tab-signup"
                tabIndex={0}
                hidden={!isSignup}
              >
                <form className="auth-form" id="form-signup" noValidate onSubmit={submitSignup}>
                  <div className="auth-field-row">
                    <label className="auth-label" htmlFor="su-name"></label>
                    <input
                      className={`auth-input ${errors["su-name"] ? "is-error" : ""}`}
                      id="su-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      placeholder="Name"
                      value={suName}
                      onChange={(e) => {
                        setSuName(e.target.value);
                        clearError("su-name");
                      }}
                    />
                    <div className="auth-error" data-error-for="su-name" aria-live="polite">
                      {errors["su-name"] || ""}
                    </div>
                  </div>

                  <div className="auth-field-row">
                    <label className="auth-label" htmlFor="su-username"></label>
                    <input
                      className={`auth-input ${errors["su-username"] ? "is-error" : ""}`}
                      id="su-username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      placeholder="Username"
                      value={suUsername}
                      onChange={(e) => {
                        setSuUsername(e.target.value.toLowerCase());
                        clearError("su-username");
                      }}
                    />
                    <div className="auth-error" data-error-for="su-username" aria-live="polite">
                      {errors["su-username"] || ""}
                    </div>
                  </div>

                  <div className="auth-field-row">
                    <label className="auth-label" htmlFor="su-email"></label>
                    <input
                      className={`auth-input ${errors["su-email"] ? "is-error" : ""}`}
                      id="su-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="Email"
                      value={suEmail}
                      onChange={(e) => {
                        setSuEmail(e.target.value);
                        clearError("su-email");
                      }}
                    />
                    <div className="auth-error" data-error-for="su-email" aria-live="polite">
                      {errors["su-email"] || ""}
                    </div>
                  </div>

                  <div className="auth-field-row">
                    <label className="auth-label" htmlFor="su-password"></label>
                    <div className="auth-password-wrap">
                      <input
                        className={`auth-input ${errors["su-password"] ? "is-error" : ""}`}
                        id="su-password"
                        name="password"
                        type={suShowPass ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="Password"
                        value={suPass}
                        onChange={(e) => {
                          setSuPass(e.target.value);
                          clearError("su-password");
                        }}
                      />
                      <button
                        className="auth-show"
                        type="button"
                        aria-label={suShowPass ? "Hide password" : "Show password"}
                        aria-pressed={suShowPass}
                        onClick={() => setSuShowPass((v) => !v)}
                      >
                        <PasswordVisibilityIcon shown={suShowPass} variant="auth" />
                      </button>
                    </div>
                    <div className="auth-error" data-error-for="su-password" aria-live="polite">
                      {errors["su-password"] || ""}
                    </div>
                  </div>

                  <div className="auth-field-row">
                    <label className="auth-label" htmlFor="su-confirm"></label>
                    <input
                      className={`auth-input ${errors["su-confirm"] ? "is-error" : ""}`}
                      id="su-confirm"
                      name="confirm"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Confirm your password"
                      value={suConf}
                      onChange={(e) => {
                        setSuConf(e.target.value);
                        clearError("su-confirm");
                      }}
                    />
                    <div className="auth-error" data-error-for="su-confirm" aria-live="polite">
                      {errors["su-confirm"] || ""}
                    </div>
                  </div>

                  <br />
                  <br />

                  <div className="auth-human">
                    <label className="auth-human-box">
                      <input
                        className="sr-only"
                        type="checkbox"
                        id="su-human"
                        name="human"
                        checked={suHuman}
                        onChange={(e) => {
                          setSuHuman(e.target.checked);
                          clearError("su-human");
                        }}
                      />
                      <span className="auth-check" aria-hidden="true"></span>
                      <span className="auth-human-text">Verify you’re human</span>
                      <Image
                        className="auth-human-mark"
                        src="/logo/cavbot-logomark.svg"
                        alt=""
                        aria-hidden="true"
                        width={32}
                        height={32}
                      />
                    </label>
                    <div className="auth-error" data-error-for="su-human" aria-live="polite">
                      {errors["su-human"] || ""}
                    </div>
                  </div>

                  <br />

                  <button className="auth-primary" type="submit" disabled={loading}>
                    {loading ? "Creating…" : "Create account"}
                    <span className="auth-primary-glow" aria-hidden="true"></span>
                  </button>

                  <p className="auth-legal">
                    <br />
                    By creating an account, you agree to our{" "}
                    <a href="https://www.cavbot.io/terms-of-use" className="auth-link">
                      Terms
                    </a>{" "}
                    and{" "}
                    <a href="https://www.cavbot.io/privacy-policy" className="auth-link">
                      Privacy Policy
                    </a>
                    .
                  </p>
                </form>
              </div>

              <br />

              {/* LOGIN */}
              <div
                className="auth-panel"
                id="panel-login"
                role="tabpanel"
                aria-labelledby="tab-login"
                tabIndex={0}
                hidden={isSignup}
              >
                <form className="auth-form" id="form-login" noValidate onSubmit={submitLogin}>
                  <div className="auth-field-row">
                    <label className="auth-label" htmlFor="li-email"></label>
                    <input
                      className={`auth-input ${errors["li-email"] ? "is-error" : ""}`}
                      id="li-email"
                      name="email"
                      type="text"
                      autoComplete="username"
                      placeholder="Email or username"
                      value={liEmail}
                      onChange={(e) => {
                        setLiEmail(e.target.value);
                        clearError("li-email");
                      }}
                    />
                    <div className="auth-error" data-error-for="li-email" aria-live="polite">
                      {errors["li-email"] || ""}
                    </div>
                  </div>

                  <div className="auth-field-row">
                    <label className="auth-label" htmlFor="li-password"></label>
                    <div className="auth-password-wrap">
                      <input
                        className={`auth-input ${errors["li-password"] ? "is-error" : ""}`}
                        id="li-password"
                        name="password"
                        type={liShowPass ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="Password"
                        value={liPass}
                        onChange={(e) => {
                          setLiPass(e.target.value);
                          clearError("li-password");
                        }}
                      />
                      <button
                        className="auth-show"
                        type="button"
                        aria-label={liShowPass ? "Hide password" : "Show password"}
                        aria-pressed={liShowPass}
                        onClick={() => setLiShowPass((v) => !v)}
                      >
                        <PasswordVisibilityIcon shown={liShowPass} variant="auth" />
                      </button>
                    </div>
                    <div className="auth-error" data-error-for="li-password" aria-live="polite">
                      {errors["li-password"] || ""}
                    </div>
                  </div>

                  <br />
                  <br />

                  <div className="auth-human">
                    <label className="auth-human-box">
                      <input
                        className="sr-only"
                        type="checkbox"
                        id="li-human"
                        name="human"
                        checked={liHuman}
                        onChange={(e) => {
                          setLiHuman(e.target.checked);
                          clearError("li-human");
                        }}
                      />
                      <span className="auth-check" aria-hidden="true"></span>
                      <span className="auth-human-text">Verify you’re human</span>
                      <Image
                        className="auth-human-mark"
                        src="/logo/cavbot-logomark.svg"
                        alt=""
                        aria-hidden="true"
                        width={32}
                        height={32}
                      />
                    </label>
                    <div className="auth-error" data-error-for="li-human" aria-live="polite">
                      {errors["li-human"] || ""}
                    </div>
                  </div>

                  <br />

                  <button className="auth-primary" type="submit" disabled={loading}>
                    {loading ? "Signing in…" : "Log in"}
                    <span className="auth-primary-glow" aria-hidden="true"></span>
                  </button>

                  <br />
                  <br />
                  <br />
                  <br />
                </form>
              </div>
            </div>

            <br />

            {/* Bottom */}
            <div className="auth-bottom" role="group" aria-label="Account help and copyright">
              <details className="auth-footer-menu">
                <summary aria-label="Open account help menu">
                  Account help
                  <span className="auth-footer-chevron" aria-hidden="true"></span>
                </summary>

                <br />

                <div className="auth-footer-panel" role="group" aria-label="Account recovery links">
                  <div className="auth-footer-links">
                    {/* Always opens the correct mode */}
                    <Link className="auth-link" href="/users/recovery?mode=password">
                      Forgot password?
                    </Link>

                    <Link className="auth-link" href="/users/recovery?mode=email">
                      Forgot email?
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
      {verifyRequest ? (
        <CavBotVerifyModal
          open={Boolean(verifyRequest)}
          actionType={verifyRequest.actionType}
          sessionId={verifyRequest.sessionId}
          identifierHint={verifyRequest.identifierHint}
          route="/auth"
          onClose={closeVerifyModal}
          onVerified={completeVerifyModal}
        />
      ) : null}
    </>
  );
}
