"use client";

import { CavGuardCard } from "./CavGuardCard";
import styles from "./CavGuardModal.module.css";
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
            ...(cta ? [{ label: cta.label.toUpperCase(), href: cta.href, onClick: onCtaClick }] : []),
            { label: "DISMISS", onClick: onClose },
          ]}
        />
      </div>
    </div>
  );
}
