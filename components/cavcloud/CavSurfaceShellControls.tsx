"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

import CavAiCenterLauncher, { type AiCenterSurface } from "@/components/cavai/CavAiCenterLauncher";

type SurfacePlanTier = "FREE" | "PREMIUM" | "PREMIUM_PLUS";

type CavSurfaceSidebarBrandMenuProps = {
  surfaceTitle: string;
};

type CavSurfaceHeaderGreetingProps = {
  accountName: string;
  showVerified?: boolean;
};

type CavSurfaceQuickToolsProps = {
  surface: "cavcloud" | "cavsafe";
  galleryActive?: boolean;
  onOpenGallery: () => void;
  onOpenCompanion: () => void;
  companionLabel: string;
  companionIconSrc: string;
  companionIconAlt: string;
  companionIconClassName?: string;
  companionIconWidth?: number;
  companionIconHeight?: number;
  cavAiSurface: AiCenterSurface;
  cavAiContextLabel: string;
};

type CavSurfaceSidebarFooterProps = CavSurfaceQuickToolsProps & {
  accountName: string;
  profileMenuLabel: string;
  planTier: SurfacePlanTier;
  trialActive: boolean;
  trialDaysLeft: number;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onOpenPlans: () => void;
  onLogout: () => void | Promise<void>;
};

type SurfaceProfileSnapshot = {
  fullName: string;
  username: string;
  avatar: string;
  tone: string;
  storedInitials: string;
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function firstInitialChar(input: string): string {
  const hit = String(input || "").match(/[A-Za-z0-9]/);
  return hit?.[0]?.toUpperCase() || "";
}

function normalizeInitialUsernameSource(rawUsername: string): string {
  const trimmed = String(rawUsername || "").trim().replace(/^@+/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const pathname = new URL(trimmed).pathname;
    const parts = pathname.split("/").filter(Boolean);
    const tail = parts[parts.length - 1] || "";
    return tail.replace(/^@+/, "");
  } catch {
    return trimmed;
  }
}

function deriveAccountInitials(fullName?: string | null, username?: string | null, fallback?: string | null): string {
  const name = s(fullName);
  if (name) {
    const parts = name.split(/\s+/g).filter(Boolean);
    if (parts.length >= 2) {
      const duo = `${firstInitialChar(parts[0] || "")}${firstInitialChar(parts[1] || "")}`.trim();
      if (duo) return duo;
    }
    const single = firstInitialChar(parts[0] || "");
    if (single) return single;
  }

  const userInitial = firstInitialChar(normalizeInitialUsernameSource(s(username)));
  if (userInitial) return userInitial;

  const fallbackInitial = firstInitialChar(s(fallback));
  if (fallbackInitial) return fallbackInitial;
  return "C";
}

function readStoredInitials(): string {
  try {
    return s(globalThis.__cbLocalStore.getItem("cb_account_initials")).slice(0, 3).toUpperCase();
  } catch {
    return "";
  }
}

function persistStoredInitials(value: string): void {
  try {
    if (value) {
      globalThis.__cbLocalStore.setItem("cb_account_initials", value);
    } else {
      globalThis.__cbLocalStore.removeItem("cb_account_initials");
    }
  } catch {}
}

function readSurfaceProfileSnapshot(): SurfaceProfileSnapshot {
  try {
    return {
      fullName: s(globalThis.__cbLocalStore.getItem("cb_profile_fullName_v1")),
      username: s(globalThis.__cbLocalStore.getItem("cb_profile_username_v1")).replace(/^@+/, "").toLowerCase(),
      avatar: s(globalThis.__cbLocalStore.getItem("cb_settings_avatar_image_v2")),
      tone: s(globalThis.__cbLocalStore.getItem("cb_settings_avatar_tone_v2")) || "lime",
      storedInitials: readStoredInitials(),
    };
  } catch {
    return {
      fullName: "",
      username: "",
      avatar: "",
      tone: "lime",
      storedInitials: "",
    };
  }
}

function useSurfaceProfileIdentity(fallbackAccountName: string) {
  const [snapshot, setSnapshot] = useState<SurfaceProfileSnapshot>(() => readSurfaceProfileSnapshot());

  useEffect(() => {
    const sync = () => {
      setSnapshot(readSurfaceProfileSnapshot());
    };

    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("cb:profile", sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("cb:profile", sync as EventListener);
    };
  }, []);

  const displayName = useMemo(() => {
    const full = s(snapshot.fullName);
    if (full) return full;
    const fallback = s(fallbackAccountName);
    if (fallback) return fallback;
    const handle = s(snapshot.username);
    if (handle) return `@${handle}`;
    return "CavBot Account";
  }, [fallbackAccountName, snapshot.fullName, snapshot.username]);

  const greetingName = useMemo(() => {
    const full = s(snapshot.fullName);
    if (full) return full;
    const fallback = s(fallbackAccountName);
    if (fallback) return fallback;
    return "there";
  }, [fallbackAccountName, snapshot.fullName]);

  const initials = useMemo(() => {
    const resolved = deriveAccountInitials(snapshot.fullName, snapshot.username, snapshot.storedInitials);
    persistStoredInitials(resolved);
    return resolved;
  }, [snapshot.fullName, snapshot.storedInitials, snapshot.username]);

  return {
    ...snapshot,
    displayName,
    greetingName,
    initials,
  };
}

function avatarChipStyle(profileTone: string, profileAvatar: string) {
  return {
    background: profileAvatar
      ? "transparent"
      : profileTone === "transparent"
        ? "transparent"
        : profileTone === "violet"
          ? "rgba(139,92,255,0.22)"
          : profileTone === "blue"
            ? "rgba(78,168,255,0.22)"
            : profileTone === "white"
              ? "rgba(255,255,255,0.92)"
              : profileTone === "navy"
                ? "rgba(1,3,15,0.78)"
                : "rgba(185,200,90,0.92)",
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
  } as const;
}

function VerifiedBadge() {
  return (
    <span
      className="cavcloud-verifiedBadge"
      role="img"
      aria-label="Premium plus verified account"
      title="Premium+ verified"
    >
      <svg className="cavcloud-verifiedIcon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M4 8.35 6.5 10.8 12.05 5.2" />
      </svg>
    </span>
  );
}

function usePopoverDismiss(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
  wrapRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen, wrapRef]);
}

function resolvePlanStatusLabel(planTier: SurfacePlanTier, trialActive: boolean, trialDaysLeft: number) {
  if (trialActive && trialDaysLeft > 0) return "FREE TRIAL";
  if (planTier === "PREMIUM_PLUS") return "PREMIUM+";
  if (planTier === "PREMIUM") return "PREMIUM PLAN";
  return "FREE TIER";
}

function resolvePlanActionLabel(planTier: SurfacePlanTier) {
  return planTier === "PREMIUM_PLUS" ? "See Plans" : "Upgrade Plan";
}

function IconGear() {
  return (
    <Image
      src="/icons/app/settings-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      className="cb-settings-icon cavcloud-surfaceQuickToolIcon cavcloud-surfaceQuickToolIconSettings"
      aria-hidden="true"
      priority
      unoptimized
    />
  );
}

function IconGallerySquares() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="cavcloud-surfaceQuickToolGrid" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="2" className="is-lime" />
      <rect x="11" y="1" width="6" height="6" rx="2" className="is-coral" />
      <rect x="1" y="11" width="6" height="6" rx="2" className="is-blue" />
      <rect x="11" y="11" width="6" height="6" rx="2" className="is-violet" />
    </svg>
  );
}

function IconGalleryPalette() {
  return (
    <Image
      src="/icons/color-palette.png"
      alt=""
      width={18}
      height={18}
      className="cavcloud-surfaceQuickToolIcon cavcloud-surfaceQuickToolIconGallery"
      aria-hidden="true"
      unoptimized
    />
  );
}

function IconPremiumPlusStar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" className="cb-upgrade-badgeStar" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.4l2.9 5.87 6.48.94-4.69 4.57 1.11 6.45L12 17.2 6.2 20.23l1.11-6.45L2.62 9.21l6.48-.94L12 2.4z"
      />
    </svg>
  );
}
export function CavSurfaceSidebarBrandMenu(props: CavSurfaceSidebarBrandMenuProps) {
  return (
    <div className="cavcloud-brandMenuWrap">
      <div className="cavcloud-brandMenuTrigger cavcloud-brandMenuTriggerStatic">
        <span className="cavcloud-brandMenuSurface">
          <Image
            src="/logo/cavbot-logomark.svg"
            alt=""
            width={16}
            height={16}
            className="cavcloud-brandMenuMark"
            priority
            unoptimized
          />
          <span>{props.surfaceTitle}</span>
        </span>
      </div>
    </div>
  );
}

export function CavSurfaceHeaderGreeting(props: CavSurfaceHeaderGreetingProps) {
  const profile = useSurfaceProfileIdentity(props.accountName);

  return (
    <div className="cavcloud-headerGreeting" aria-label={`Hi, ${profile.greetingName}`}>
      <span className="cavcloud-headerGreetingPrefix">Hi, </span>
      <span className="cavcloud-headerGreetingNameWrap">
        <span className="cavcloud-headerGreetingName">{profile.greetingName}</span>
        {props.showVerified ? <VerifiedBadge /> : null}
      </span>
    </div>
  );
}

export function CavSurfaceSidebarFooter(props: CavSurfaceSidebarFooterProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const accountWrapRef = useRef<HTMLDivElement | null>(null);
  const toolsWrapRef = useRef<HTMLDivElement | null>(null);
  const profile = useSurfaceProfileIdentity(props.accountName);
  const planStatusLabel = useMemo(
    () => resolvePlanStatusLabel(props.planTier, props.trialActive, props.trialDaysLeft),
    [props.planTier, props.trialActive, props.trialDaysLeft],
  );
  const planActionLabel = useMemo(() => resolvePlanActionLabel(props.planTier), [props.planTier]);

  usePopoverDismiss(accountOpen, setAccountOpen, accountWrapRef);
  usePopoverDismiss(toolsOpen, setToolsOpen, toolsWrapRef);

  return (
    <div className="cb-side-bottom cavcloud-sideFoot cavcloud-surfaceFooter" aria-label="Sidebar footer">
      <div className="cb-side-icons cavcloud-surfaceFooterIcons" aria-label="Quick tools">
        <div className="cavcloud-surfaceQuickToolLauncher" ref={toolsWrapRef}>
          <button
            type="button"
            className={`cb-icon-btn cavcloud-surfaceQuickTool cavcloud-surfaceQuickToolLauncherBtn ${toolsOpen ? "is-active" : ""}`}
            aria-label="Open surface tools"
            title="Open surface tools"
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen((prev) => !prev)}
          >
            <IconGallerySquares />
          </button>

          {toolsOpen ? (
            <div className="cavcloud-surfaceQuickToolRail" role="group" aria-label="Surface tools">
              <button
                type="button"
                className="cb-icon-btn cavcloud-surfaceQuickTool"
                aria-label={props.companionLabel}
                title={props.companionLabel}
                onClick={() => {
                  setToolsOpen(false);
                  props.onOpenCompanion();
                }}
              >
                <Image
                  src={props.companionIconSrc}
                  alt={props.companionIconAlt}
                  width={props.companionIconWidth || 18}
                  height={props.companionIconHeight || 18}
                  className={["cavcloud-surfaceQuickToolIcon", props.companionIconClassName || ""].filter(Boolean).join(" ")}
                  aria-hidden="true"
                  unoptimized
                />
              </button>

              <button
                type="button"
                className={`cb-icon-btn cavcloud-surfaceQuickTool ${props.galleryActive ? "is-active" : ""}`}
                aria-label="Open gallery"
                title="Open gallery"
                aria-pressed={props.galleryActive ? true : undefined}
                onClick={() => {
                  setToolsOpen(false);
                  props.onOpenGallery();
                }}
              >
                <IconGalleryPalette />
              </button>

              <CavAiCenterLauncher
                surface={props.cavAiSurface}
                contextLabel={props.cavAiContextLabel}
                triggerClassName="cb-icon-btn cavcloud-surfaceQuickTool cavcloud-surfaceQuickToolCavAi"
                triggerAriaLabel={`Open CavAi for ${props.cavAiContextLabel}`}
                iconOnly
                iconSizePx={18}
              />

              <button
                type="button"
                className="cb-icon-btn cavcloud-surfaceQuickTool"
                aria-label={`Open ${props.surface === "cavcloud" ? "CavCloud" : "CavSafe"} settings`}
                title="Open settings"
                onClick={() => {
                  setToolsOpen(false);
                  props.onOpenSettings();
                }}
              >
                <IconGear />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="cb-side-plan cavcloud-surfaceFooterPlan" aria-label="Account">
        <div className="cb-account-wrap cb-side-account-wrap cavcloud-surfaceAccountWrap" ref={accountWrapRef}>
          <button
            className="cb-side-account cavcloud-surfaceAccount"
            type="button"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            aria-label="Open account menu"
            onClick={() => setAccountOpen((prev) => !prev)}
          >
            <span
              className="cb-account-chip cb-side-account-chip"
              data-tone={profile.tone || "lime"}
              aria-hidden="true"
              style={avatarChipStyle(profile.tone || "lime", profile.avatar)}
            >
              {profile.avatar ? (
                <Image
                  src={profile.avatar}
                  alt=""
                  width={96}
                  height={96}
                  quality={60}
                  unoptimized
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                <span className="cb-account-initials">{profile.initials}</span>
              )}
            </span>

            <span className="cb-side-account-meta">
              <span className="cb-side-account-name">{profile.displayName}</span>
              <span className="cb-side-account-plan">{planStatusLabel}</span>
            </span>

            <span className="cb-side-account-spark" aria-hidden="true">
              {props.planTier === "PREMIUM_PLUS" ? (
                <IconPremiumPlusStar />
              ) : (
                <Image
                  src="/icons/app/spark-svgrepo-com.svg"
                  alt=""
                  width={18}
                  height={18}
                  className="cb-upgrade-badgeIcon"
                  unoptimized
                />
              )}
            </span>
          </button>

          {accountOpen ? (
            <div className="cb-menu cb-menu-right cb-account-menu cavcloud-surfaceAccountMenu" role="menu" aria-label="Account">
              <button
                className="cb-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountOpen(false);
                  props.onOpenProfile();
                }}
              >
                {props.profileMenuLabel}
              </button>

              <button
                className="cb-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountOpen(false);
                  props.onOpenPlans();
                }}
              >
                {planActionLabel}
              </button>

              <button
                className="cb-menu-item danger"
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountOpen(false);
                  void props.onLogout();
                }}
              >
                Log out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
