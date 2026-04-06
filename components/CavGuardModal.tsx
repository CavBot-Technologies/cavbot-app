"use client";

import * as React from "react";

import { CavGuardCard } from "./CavGuardCard";
import styles from "./CavGuardModal.module.css";
import { emitAdminTelemetry } from "@/lib/admin/clientTelemetry";
import type { CavGuardDecision } from "@/src/lib/cavguard/cavGuard.types";

type CavGuardModalProps = {
  open: boolean;
  onClose: () => void;
  decision?: CavGuardDecision | null;
  onCtaClick?: () => void;
};

export function CavGuardModal(props: CavGuardModalProps) {
  const { open, onClose, decision, onCtaClick } = props;
  const modalOpen = Boolean(open);

  const headline = String(decision?.title || "Unauthorized action blocked.").trim();
  const request = String(decision?.request || "Access protected workspace action.").trim();
  const reason = String(decision?.reason || "This action is restricted by workspace access controls.").trim();
  const cta = decision?.cta || null;

  React.useEffect(() => {
    if (!modalOpen) return;
    emitAdminTelemetry({
      event: "cavguard_rendered",
      result: "visible",
      meta: {
        title: headline,
        hasCta: Boolean(cta),
      },
    });
    emitAdminTelemetry({
      event: "cavguard_blocked",
      result: "blocked",
      meta: {
        title: headline,
      },
    });
    emitAdminTelemetry({
      event: "cavguard_flagged",
      result: "flagged",
      meta: {
        title: headline,
      },
    });
  }, [cta, headline, modalOpen]);

  const handleDismiss = React.useCallback(() => {
    emitAdminTelemetry({
      event: "cavguard_blocked",
      result: "dismissed",
      meta: {
        title: headline,
      },
    });
    onClose();
  }, [headline, onClose]);

  const handleCtaClick = React.useCallback(() => {
    emitAdminTelemetry({
      event: "cavguard_overridden",
      result: "cta",
      meta: {
        title: headline,
        href: cta?.href || null,
      },
    });
    onCtaClick?.();
  }, [cta?.href, headline, onCtaClick]);

  return (
    <div
      className={styles.overlay}
      data-open={modalOpen ? "true" : "false"}
      role="presentation"
      aria-hidden={!modalOpen}
    >
      <div
        role="dialog"
        aria-modal={modalOpen ? "true" : undefined}
        aria-labelledby="cb-cavguard-title"
      >
        <CavGuardCard
          titleId="cb-cavguard-title"
          headline={headline}
          request={request}
          reason={reason}
          onClick={(event) => event.stopPropagation()}
          actions={[
            ...(cta ? [{ label: cta.label.toUpperCase(), href: cta.href, onClick: handleCtaClick }] : []),
            { label: "DISMISS", onClick: handleDismiss },
          ]}
        />
      </div>
    </div>
  );
}
