"use client";

import * as React from "react";
import Image from "next/image";
import { createPortal } from "react-dom";

import styles from "./CavBotVerifyModal.module.css";

type VerifyActionType = "signup" | "login" | "reset" | "invite";
type GlyphFillRule = "evenodd" | "nonzero";

type SvgShape = {
  svgPath: string;
  svgViewBox: string;
  svgFill?: string;
  svgFillRule?: GlyphFillRule;
  svgClipRule?: GlyphFillRule;
};

type ChallengeTile = SvgShape & {
  tileId: string;
  jitterY: number;
  rotationDeg: number;
};

type ChallengeWordmarkGlyph = SvgShape & {
  shapeId: string;
};

type ChallengeSlot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ChallengeRender = {
  viewBox: string;
  wordmarkGlyphs: ChallengeWordmarkGlyph[];
  slot: ChallengeSlot;
  slotGlyph: SvgShape;
};

type ChallengePayload = {
  challengeId: string;
  challengeToken: string;
  nonce: string;
  sessionId: string;
  expiresAt: string;
  prompt: string;
  render: ChallengeRender;
  tiles: ChallengeTile[];
};

const DEFAULT_WORDMARK_VIEWBOX = "0 0 1000 500";
const DEFAULT_SLOT_BOX: ChallengeSlot = { x: 714, y: 186, width: 185, height: 183 };

const DEFAULT_SLOT_GLYPH: SvgShape = {
  svgPath: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2.7 7.6h8.6v2.8H7.7Z",
  svgViewBox: "0 0 24 24",
};

type VerifyModalSuccess = {
  verificationGrantToken: string;
  sessionId: string;
};

type CavBotVerifyModalProps = {
  open: boolean;
  actionType: VerifyActionType;
  route: string;
  sessionId?: string;
  identifierHint?: string;
  brandTitle?: string;
  brandSubtitle?: string;
  onClose: () => void;
  onVerified: (value: VerifyModalSuccess) => void;
};

type VerifySubmitFailure = {
  ok: false;
  error?: string;
  message?: string;
  attemptsRemaining?: number;
  fallbackAllowed?: boolean;
  sessionId?: string;
};

function s(value: unknown) {
  return String(value ?? "").trim();
}

function parseFillRule(value: unknown): GlyphFillRule | undefined {
  const rule = s(value).toLowerCase();
  if (rule === "evenodd" || rule === "nonzero") return rule;
  return undefined;
}

function parseNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseShape(raw: unknown, fallback: SvgShape): SvgShape {
  const shape = (raw || {}) as Record<string, unknown>;
  return {
    svgPath: s(shape.svgPath || shape.glyphPath) || fallback.svgPath,
    svgViewBox: s(shape.svgViewBox || shape.glyphViewBox) || fallback.svgViewBox,
    svgFill: s(shape.svgFill) || undefined,
    svgFillRule: parseFillRule(shape.svgFillRule || shape.glyphFillRule || fallback.svgFillRule),
    svgClipRule: parseFillRule(shape.svgClipRule || shape.glyphClipRule || fallback.svgClipRule),
  };
}

function parseChallengeTile(raw: unknown, index: number): ChallengeTile {
  const tile = (raw || {}) as Record<string, unknown>;
  const shape = parseShape(tile, DEFAULT_SLOT_GLYPH);
  return {
    tileId: s(tile.tileId || tile.id) || `tile_${index}`,
    ...shape,
    jitterY: parseNumber(tile.jitterY),
    rotationDeg: parseNumber(tile.rotationDeg),
  };
}

function parseChallengeWordmarkGlyph(raw: unknown, index: number): ChallengeWordmarkGlyph {
  const glyph = (raw || {}) as Record<string, unknown>;
  const shape = parseShape(glyph, {
    svgPath: "",
    svgViewBox: DEFAULT_WORDMARK_VIEWBOX,
    svgFill: "#fff",
  });
  return {
    shapeId: s(glyph.shapeId) || `shape_${index}`,
    ...shape,
  };
}

function parseChallengeSlot(raw: unknown): ChallengeSlot {
  const slot = (raw || {}) as Record<string, unknown>;
  return {
    x: parseNumber(slot.x, DEFAULT_SLOT_BOX.x),
    y: parseNumber(slot.y, DEFAULT_SLOT_BOX.y),
    width: Math.max(1, parseNumber(slot.width, DEFAULT_SLOT_BOX.width)),
    height: Math.max(1, parseNumber(slot.height, DEFAULT_SLOT_BOX.height)),
  };
}

function parseChallengeRender(raw: unknown): ChallengeRender {
  const render = (raw || {}) as Record<string, unknown>;
  const slotGlyph = parseShape(render.slotGlyph, DEFAULT_SLOT_GLYPH);
  return {
    viewBox: s(render.viewBox) || DEFAULT_WORDMARK_VIEWBOX,
    wordmarkGlyphs: Array.isArray(render.wordmarkGlyphs)
      ? (render.wordmarkGlyphs as unknown[]).map((glyph, index) => parseChallengeWordmarkGlyph(glyph, index))
      : [],
    slot: parseChallengeSlot(render.slot),
    slotGlyph,
  };
}

function parseViewBoxMetrics(viewBox: string) {
  const parts = s(viewBox)
    .split(/\s+/)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
  if (parts.length !== 4) {
    return { minX: 0, minY: 0, width: 1000, height: 500 };
  }
  const [, , width, height] = parts;
  return {
    minX: parts[0],
    minY: parts[1],
    width: width > 0 ? width : 1000,
    height: height > 0 ? height : 500,
  };
}

function shouldPreferOtpMode() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  const checks = ["(prefers-reduced-motion: reduce)", "(forced-colors: active)", "(prefers-contrast: more)"];
  return checks.some((query) => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });
}

function VerifyGlyph(props: { glyph: SvgShape; className: string }) {
  const { glyph, className } = props;
  return (
    <svg className={className} viewBox={glyph.svgViewBox} aria-hidden="true" focusable="false">
      <path
        d={glyph.svgPath}
        fill={glyph.svgFill || "currentColor"}
        fillRule={glyph.svgFillRule}
        clipRule={glyph.svgClipRule}
      />
    </svg>
  );
}

async function postJson<T>(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { res, data };
}

export function CavBotVerifyModal(props: CavBotVerifyModalProps) {
  const { open, actionType, route, onClose, onVerified } = props;
  const [portalReady, setPortalReady] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [mode, setMode] = React.useState<"challenge" | "otp">("challenge");
  const [error, setError] = React.useState("");
  const [challenge, setChallenge] = React.useState<ChallengePayload | null>(null);
  const [sessionId, setSessionId] = React.useState(s(props.sessionId));
  const [failedAttempts, setFailedAttempts] = React.useState(0);

  const [otpIdentifier, setOtpIdentifier] = React.useState(s(props.identifierHint));
  const [otpChallengeId, setOtpChallengeId] = React.useState("");
  const [otpCode, setOtpCode] = React.useState("");
  const [otpBusy, setOtpBusy] = React.useState(false);
  const [otpStarted, setOtpStarted] = React.useState(false);

  const [draggingTileId, setDraggingTileId] = React.useState<string | null>(null);
  const [tileOffsets, setTileOffsets] = React.useState<Record<string, { x: number; y: number }>>({});
  const slotRef = React.useRef<HTMLDivElement | null>(null);

  const dragStateRef = React.useRef<{
    tileId: string;
    pointerType: string;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moves: number;
    distance: number;
    startTs: number;
  } | null>(null);

  const loadChallenge = React.useCallback(
    async (sessionHint?: string) => {
      setLoading(true);
      setError("");
      setChallenge(null);
      try {
        const { res, data } = await postJson<ChallengePayload & { ok?: boolean; error?: string; message?: string }>(
          "/api/verify/challenge",
          {
            actionType,
            route,
            sessionId: sessionHint || sessionId || undefined,
          },
        );

        if (!res.ok || !data?.challengeId) {
          setError(s(data?.message || data?.error || "Unable to load verification challenge."));
          return;
        }

        setChallenge({
          challengeId: s(data.challengeId),
          challengeToken: s((data as { challengeToken?: unknown }).challengeToken),
          nonce: s(data.nonce),
          sessionId: s(data.sessionId),
          expiresAt: s(data.expiresAt),
          prompt: s(data.prompt),
          render: parseChallengeRender((data as { render?: unknown })?.render),
          tiles: Array.isArray((data as { tiles?: unknown[] }).tiles)
            ? (data as { tiles: unknown[] }).tiles.map((tile, index) => parseChallengeTile(tile, index))
            : [],
        });
        setSessionId(s(data.sessionId) || sessionHint || "");
      } catch {
        setError("Unable to load verification challenge.");
      } finally {
        setLoading(false);
      }
    },
    [actionType, route, sessionId],
  );

  React.useEffect(() => {
    setPortalReady(true);
    return () => {
      setPortalReady(false);
    };
  }, []);

  React.useEffect(() => {
    if (!portalReady || !open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open, portalReady]);

  React.useEffect(() => {
    if (!open) return;
    const initialSession = s(props.sessionId);
    setSessionId(initialSession);
    setOtpIdentifier(s(props.identifierHint));
    setMode(shouldPreferOtpMode() ? "otp" : "challenge");
    setFailedAttempts(0);
    setOtpChallengeId("");
    setOtpCode("");
    setOtpStarted(false);
    void loadChallenge(initialSession);
  }, [open, props.identifierHint, props.sessionId, loadChallenge]);

  const resetDragState = React.useCallback((tileId?: string) => {
    if (tileId) {
      setTileOffsets((prev) => ({ ...prev, [tileId]: { x: 0, y: 0 } }));
    }
    dragStateRef.current = null;
    setDraggingTileId(null);
  }, []);

  const submitChallenge = React.useCallback(
    async (tile: ChallengeTile, gestureSummary: Record<string, unknown>) => {
      if (!challenge || submitting) return;
      setSubmitting(true);
      setError("");
      try {
        const { res, data } = await postJson<
          | { ok: true; verificationGrantToken: string; sessionId?: string }
          | VerifySubmitFailure
        >("/api/verify/submit", {
          challengeId: challenge.challengeId,
          challengeToken: challenge.challengeToken,
          nonce: challenge.nonce,
          chosenTileId: tile.tileId,
          gestureSummary,
          sessionId: sessionId || challenge.sessionId,
        });

        if (res.ok && data && "ok" in data && data.ok === true) {
          onVerified({
            verificationGrantToken: s(data.verificationGrantToken),
            sessionId: s(data.sessionId) || sessionId || challenge.sessionId,
          });
          return;
        }

        const fail = data as VerifySubmitFailure;
        const message = s(fail?.message || fail?.error || "Verification failed.");
        setError(message);
        const remaining = Number(fail?.attemptsRemaining ?? 0);
        const usedAttempts = Math.max(0, 3 - remaining);
        const nextFailedAttempts = Math.max(failedAttempts + 1, usedAttempts);
        setFailedAttempts(nextFailedAttempts);
        if (nextFailedAttempts >= 2) {
          setMode("otp");
        }
        if (s(fail?.sessionId)) setSessionId(s(fail?.sessionId));
      } catch {
        setError("Verification failed.");
      } finally {
        setSubmitting(false);
      }
    },
    [challenge, failedAttempts, onVerified, sessionId, submitting],
  );

  const tileMap = React.useMemo(() => {
    const map = new Map<string, ChallengeTile>();
    for (const tile of challenge?.tiles || []) map.set(tile.tileId, tile);
    return map;
  }, [challenge?.tiles]);

  const onTilePointerDown = React.useCallback(
    (tileId: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!open || mode !== "challenge" || submitting) return;
      event.preventDefault();
      const startTs = typeof performance !== "undefined" ? performance.now() : Date.now();
      dragStateRef.current = {
        tileId,
        pointerType: s(event.pointerType || "mouse").toLowerCase() || "mouse",
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moves: 0,
        distance: 0,
        startTs,
      };
      setDraggingTileId(tileId);
      setTileOffsets((prev) => ({ ...prev, [tileId]: { x: 0, y: 0 } }));
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
    },
    [mode, open, submitting],
  );

  const onTilePointerMove = React.useCallback(
    (tileId: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragStateRef.current;
      if (!drag || drag.tileId !== tileId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const stepDistance = Math.hypot(event.clientX - drag.lastX, event.clientY - drag.lastY);
      drag.moves += 1;
      drag.distance += stepDistance;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      dragStateRef.current = drag;
      setTileOffsets((prev) => ({ ...prev, [tileId]: { x: dx, y: dy } }));
    },
    [],
  );

  const finishPointerDrag = React.useCallback(
    (tileId: string, event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragStateRef.current;
      if (!drag || drag.tileId !== tileId) return;
      const tile = tileMap.get(tileId);
      const slotRect = slotRef.current?.getBoundingClientRect();
      const droppedInSlot = Boolean(
        slotRect &&
          event.clientX >= slotRect.left &&
          event.clientX <= slotRect.right &&
          event.clientY >= slotRect.top &&
          event.clientY <= slotRect.bottom,
      );
      const endTs = typeof performance !== "undefined" ? performance.now() : Date.now();
      const gestureSummary = {
        pointerDown: true,
        pointerType: drag.pointerType,
        moveEventsCount: drag.moves,
        pointerMoves: drag.moves,
        distancePx: Number(drag.distance.toFixed(2)),
        durationMs: Math.max(0, Math.round(endTs - drag.startTs)),
        droppedInSlot,
      };
      resetDragState(tileId);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {}

      if (droppedInSlot && tile) {
        void submitChallenge(tile, gestureSummary);
      }
    },
    [resetDragState, submitChallenge, tileMap],
  );

  const onTilePointerUp = React.useCallback(
    (tileId: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
      finishPointerDrag(tileId, event);
    },
    [finishPointerDrag],
  );

  const onTilePointerCancel = React.useCallback(
    (tileId: string) => () => {
      resetDragState(tileId);
    },
    [resetDragState],
  );

  const startOtp = React.useCallback(async () => {
    setOtpBusy(true);
    setError("");
    try {
      const { res, data } = await postJson<
        { ok: true; otpChallengeId: string; sessionId?: string } | { ok: false; error?: string; message?: string; sessionId?: string }
      >("/api/verify/otp/start", {
        actionType,
        challengeId: challenge?.challengeId || undefined,
        challengeToken: challenge?.challengeToken || undefined,
        sessionId: sessionId || challenge?.sessionId || undefined,
        identifier: otpIdentifier || undefined,
        email: otpIdentifier.includes("@") ? otpIdentifier : undefined,
      });

      if (!res.ok || !data || !("ok" in data) || data.ok !== true) {
        const msg = s((data as { message?: string; error?: string })?.message || (data as { error?: string })?.error || "Could not send code.");
        setError(msg);
        if (s((data as { sessionId?: string })?.sessionId)) setSessionId(s((data as { sessionId?: string }).sessionId));
        return;
      }

      setOtpChallengeId(s(data.otpChallengeId));
      setOtpStarted(true);
      setSessionId(s(data.sessionId) || sessionId || challenge?.sessionId || "");
      setError("");
    } catch {
      setError("Could not send code.");
    } finally {
      setOtpBusy(false);
    }
  }, [actionType, challenge?.challengeId, challenge?.challengeToken, challenge?.sessionId, otpIdentifier, sessionId]);

  const confirmOtp = React.useCallback(async () => {
    if (!otpChallengeId) {
      setError("Send a code first.");
      return;
    }
    setOtpBusy(true);
    setError("");
    try {
      const { res, data } = await postJson<
        | { ok: true; verificationGrantToken: string; sessionId?: string }
        | { ok: false; message?: string; error?: string; attemptsRemaining?: number; sessionId?: string }
      >("/api/verify/otp/confirm", {
        otpChallengeId,
        code: otpCode,
        actionType,
        sessionId: sessionId || challenge?.sessionId || undefined,
      });

      if (!res.ok || !data || !("ok" in data) || data.ok !== true) {
        const fail = data as { message?: string; error?: string; sessionId?: string };
        setError(s(fail?.message || fail?.error || "Invalid code."));
        if (s(fail?.sessionId)) setSessionId(s(fail?.sessionId));
        return;
      }

      onVerified({
        verificationGrantToken: s(data.verificationGrantToken),
        sessionId: s(data.sessionId) || sessionId || challenge?.sessionId || "",
      });
    } catch {
      setError("Code verification failed.");
    } finally {
      setOtpBusy(false);
    }
  }, [actionType, challenge?.sessionId, onVerified, otpChallengeId, otpCode, sessionId]);

  if (!open || !portalReady) return null;

  const challengePrompt = s(challenge?.prompt);
  const showChallengePrompt = challengePrompt && challengePrompt !== "Quick check to protect CavBot.";
  const brandTitle = s(props.brandTitle) || "Caverify";
  const brandSubtitle = s(props.brandSubtitle) || "Drag the correct tile to complete the CavBot wordmark.";
  const render = challenge?.render;
  const wordmarkViewBox = render?.viewBox || DEFAULT_WORDMARK_VIEWBOX;
  const slotGlyph = render?.slotGlyph || DEFAULT_SLOT_GLYPH;
  const slot = render?.slot || DEFAULT_SLOT_BOX;
  const viewBoxMetrics = parseViewBoxMetrics(wordmarkViewBox);
  const slotStyle: React.CSSProperties = {
    left: `${(((slot.x + slot.width / 2) - viewBoxMetrics.minX) / viewBoxMetrics.width) * 100}%`,
    top: `${(((slot.y + slot.height / 2) - viewBoxMetrics.minY) / viewBoxMetrics.height) * 100}%`,
    width: `${Math.max(8, (slot.width / viewBoxMetrics.width) * 100)}%`,
    height: `${Math.max(8, (slot.height / viewBoxMetrics.height) * 100)}%`,
  };

  const modalNode = (
    <div className={styles.overlay}>
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="cbv-title">
        <div className={styles.top}>
          <div className={styles.verifyBrand}>
            <div className={styles.verifyEmblem} aria-hidden="true">
              <Image src="/logo/cavbot-logomark.svg" alt="" width={38} height={38} className={styles.verifyMark} />
              <span className={styles.verifyShield}>
                <span className={styles.verifyShieldIcon} />
              </span>
            </div>
            <div className={styles.verifyMeta}>
              <h2 className={styles.title} id="cbv-title">
                {brandTitle}
              </h2>
              <p className={styles.sub}>{brandSubtitle}</p>
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} disabled={submitting || otpBusy}>
            Cancel
          </button>
        </div>

        <div className={styles.divider} />

        {loading ? (
          <div className={styles.loading}>Loading challenge…</div>
        ) : mode === "challenge" ? (
          <div className={styles.challengeWrap}>
            {showChallengePrompt ? <p className={styles.sub}>{challengePrompt}</p> : null}
            <div className={styles.wordmark} aria-label="CavBot wordmark challenge">
              <svg className={styles.wordmarkImage} viewBox={wordmarkViewBox} aria-hidden="true" focusable="false">
                {(render?.wordmarkGlyphs || []).map((glyph) => (
                  <path
                    key={glyph.shapeId}
                    d={glyph.svgPath}
                    fill={glyph.svgFill || "#fff"}
                    fillRule={glyph.svgFillRule}
                    clipRule={glyph.svgClipRule}
                  />
                ))}
              </svg>
              <div ref={slotRef} className={styles.slot} style={slotStyle} aria-hidden="true">
                <VerifyGlyph glyph={slotGlyph} className={styles.slotGlyph} />
              </div>
            </div>

            <div className={styles.tiles}>
              {(challenge?.tiles || []).map((tile, index) => {
                const offset = tileOffsets[tile.tileId] || { x: 0, y: 0 };
                const transform = `translate(${offset.x}px, ${tile.jitterY + offset.y}px) rotate(${tile.rotationDeg}deg)`;
                return (
                  <button
                    key={tile.tileId}
                    type="button"
                    className={`${styles.tile} ${draggingTileId === tile.tileId ? styles.tileDragging : ""}`}
                    style={{ transform }}
                    onPointerDown={onTilePointerDown(tile.tileId)}
                    onPointerMove={onTilePointerMove(tile.tileId)}
                    onPointerUp={onTilePointerUp(tile.tileId)}
                    onPointerCancel={onTilePointerCancel(tile.tileId)}
                    disabled={submitting}
                    aria-label={`Drag tile ${index + 1}`}
                  >
                    <VerifyGlyph glyph={tile} className={styles.tileGlyph} />
                  </button>
                );
              })}
            </div>

            <div className={styles.hintRow}>
              <button type="button" className={styles.linkBtn} onClick={() => setMode("otp")} disabled={submitting}>
                Use email code instead
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.otpWrap}>
            <p className={styles.sub}>Use a one-time email code instead.</p>
            <input
              className={styles.otpInput}
              type="text"
              value={otpIdentifier}
              onChange={(event) => setOtpIdentifier(event.target.value)}
              placeholder="Email or username"
              autoComplete="username"
              disabled={otpBusy}
            />
            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.actionPrimary}`}
                onClick={() => void startOtp()}
                disabled={otpBusy}
              >
                {otpBusy ? "Sending…" : "Send code"}
              </button>
              <button type="button" className={styles.actionBtn} onClick={() => setMode("challenge")} disabled={otpBusy}>
                Return to challenge
              </button>
            </div>
            {otpStarted ? (
              <>
                <input
                  className={`${styles.otpInput} ${styles.otpCode}`}
                  type="text"
                  inputMode="numeric"
                  value={otpCode}
                  maxLength={6}
                  onChange={(event) => setOtpCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  placeholder="••••••"
                  autoComplete="one-time-code"
                  disabled={otpBusy}
                />
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionPrimary}`}
                  onClick={() => void confirmOtp()}
                  disabled={otpBusy || otpCode.length !== 6}
                >
                  {otpBusy ? "Verifying…" : "Verify code"}
                </button>
              </>
            ) : null}
          </div>
        )}

        <div className={styles.error} aria-live="polite">
          {error}
        </div>
      </div>
    </div>
  );

  return createPortal(modalNode, document.body);
}
