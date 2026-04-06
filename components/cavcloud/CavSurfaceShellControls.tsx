"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import CavAiCenterLauncher, { type AiCenterSurface } from "@/components/cavai/CavAiCenterLauncher";

type SurfacePlanTier = "FREE" | "PREMIUM" | "PREMIUM_PLUS";

type CavSurfaceSidebarBrandMenuProps = {
  surfaceTitle: string;
  accountName: string;
  showVerified?: boolean;
  profileMenuLabel: string;
  onOpenProfile: () => void;
  onLogout: () => void | Promise<void>;
};

type CavSurfacePlanButtonProps = {
  planTier: SurfacePlanTier;
  trialActive: boolean;
  trialDaysLeft: number;
  onOpenPlans: () => void;
};

type CavSurfaceLauncherMenuProps = {
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

function usePopoverState() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

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
  }, [open]);

  return { open, setOpen, wrapRef };
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

export function CavSurfaceSidebarBrandMenu(props: CavSurfaceSidebarBrandMenuProps) {
  const { open, setOpen, wrapRef } = usePopoverState();

  return (
    <div className="cavcloud-brandMenuWrap" ref={wrapRef}>
      <button
        type="button"
        className="cavcloud-brandMenuTrigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${props.surfaceTitle}. Account: ${props.accountName}`}
        onClick={() => setOpen((prev) => !prev)}
      >
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

        <span className="cavcloud-brandTitle">
          <span className="cavcloud-brandTitlePrefix">Hi, </span>
          <span className="cavcloud-brandTitleNameWrap">
            <span className="cavcloud-brandTitleAccent">{props.accountName}</span>
            {props.showVerified ? <VerifiedBadge /> : null}
          </span>
        </span>
      </button>

      {open ? (
        <div className="cb-menu cavcloud-brandMenuMenu" role="menu" aria-label="Account">
          <button
            className="cb-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              props.onOpenProfile();
            }}
          >
            {props.profileMenuLabel}
          </button>
          <button
            className="cb-menu-item danger"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void props.onLogout();
            }}
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CavSurfacePlanButton(props: CavSurfacePlanButtonProps) {
  const planStatusLabel = useMemo(
    () => resolvePlanStatusLabel(props.planTier, props.trialActive, props.trialDaysLeft),
    [props.planTier, props.trialActive, props.trialDaysLeft],
  );
  const planActionLabel = useMemo(() => resolvePlanActionLabel(props.planTier), [props.planTier]);

  return (
    <button
      type="button"
      className="cavcloud-headerPlanButton"
      aria-label={`${planStatusLabel}. ${planActionLabel}.`}
      onClick={props.onOpenPlans}
    >
      <span className="cavcloud-headerPlanChip" aria-hidden="true">
        <Image
          src="/icons/app/spark-svgrepo-com.svg"
          alt=""
          width={18}
          height={18}
          className="cavcloud-headerPlanChipIcon"
          unoptimized
        />
      </span>
      <span className="cavcloud-headerPlanMeta">
        <span className="cavcloud-headerPlanName">{planStatusLabel}</span>
        <span className="cavcloud-headerPlanAction">{planActionLabel}</span>
      </span>
      <span className="cavcloud-headerPlanSpark" aria-hidden="true">
        <Image
          src="/icons/app/spark-svgrepo-com.svg"
          alt=""
          width={18}
          height={18}
          className="cb-upgrade-badgeIcon"
          unoptimized
        />
      </span>
    </button>
  );
}

function LauncherGridIcon() {
  return (
    <svg className="cavcloud-surfaceLauncherTriggerIcon" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2" y="2" width="6" height="6" rx="1.8" fill="#b9c85a" />
      <rect x="12" y="2" width="6" height="6" rx="1.8" fill="#4da3ff" />
      <rect x="2" y="12" width="6" height="6" rx="1.8" fill="#fb923c" />
      <rect x="12" y="12" width="6" height="6" rx="1.8" fill="#8b5cff" />
    </svg>
  );
}

export function CavSurfaceLauncherMenu(props: CavSurfaceLauncherMenuProps) {
  const { open, setOpen, wrapRef } = usePopoverState();

  return (
    <div className="cavcloud-surfaceLauncherWrap" ref={wrapRef}>
      <button
        type="button"
        className={`cavcloud-surfaceLauncherTrigger ${open ? "is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Open ${props.surface === "cavcloud" ? "CavCloud" : "CavSafe"} quick launcher`}
        title="Open quick launcher"
        onClick={() => setOpen((prev) => !prev)}
      >
        <LauncherGridIcon />
      </button>

      {open ? (
        <div className="cavcloud-surfaceLauncherMenu" role="menu" aria-label="Quick launcher">
          <button
            type="button"
            role="menuitem"
            className="cavcloud-surfaceLauncherAction"
            aria-label={props.companionLabel}
            title={props.companionLabel}
            onClick={() => {
              setOpen(false);
              props.onOpenCompanion();
            }}
          >
            <Image
              src={props.companionIconSrc}
              alt={props.companionIconAlt}
              width={props.companionIconWidth || 18}
              height={props.companionIconHeight || 18}
              className={[
                "cavcloud-surfaceLauncherActionIcon",
                props.companionIconClassName || "",
              ]
                .filter(Boolean)
                .join(" ")}
              loading="eager"
              unoptimized
            />
          </button>

          <button
            type="button"
            role="menuitem"
            className={`cavcloud-surfaceLauncherAction ${props.galleryActive ? "is-active" : ""}`}
            aria-label="Open gallery"
            title="Open gallery"
            onClick={() => {
              setOpen(false);
              props.onOpenGallery();
            }}
          >
            <Image
              src="/icons/color-palette.png"
              alt="Gallery icon"
              width={22}
              height={22}
              className="cavcloud-surfaceLauncherActionIcon"
              unoptimized
            />
          </button>

          <div
            className="cavcloud-surfaceLauncherActionWrap"
            onClickCapture={() => {
              setOpen(false);
            }}
          >
            <CavAiCenterLauncher
              surface={props.cavAiSurface}
              contextLabel={props.cavAiContextLabel}
              triggerClassName="cavcloud-surfaceLauncherAction cavcloud-surfaceLauncherActionCavAi"
              triggerAriaLabel={`Open CavAi for ${props.cavAiContextLabel}`}
              iconClassName="cavcloud-surfaceLauncherActionIcon"
              iconSizePx={22}
              iconOnly
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
