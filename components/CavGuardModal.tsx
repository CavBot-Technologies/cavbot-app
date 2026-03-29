"use client";

import Image from "next/image";
import Link from "next/link";

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
        className={styles.card}
        role="dialog"
        aria-modal={modalOpen ? "true" : undefined}
        aria-labelledby="cb-cavguard-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className={styles.glowTop} aria-hidden="true" />
        <span className={styles.glowBottom} aria-hidden="true" />

        <div className={styles.header}>
          <div className={styles.brand}>
            <div className={styles.emblem} aria-hidden="true">
              <Image
                src="/logo/cavbot-logomark.svg"
                alt=""
                width={38}
                height={38}
                className={styles.mark}
                priority
                unoptimized
              />
              <span className={styles.shield}>
                <span className={styles.shieldIcon} />
              </span>
            </div>

            <div className={styles.brandMeta}>
              <h2 className={styles.title} id="cb-cavguard-title">
                CavGuard
              </h2>
            </div>
          </div>
        </div>

        <div className={styles.brSpacer} aria-hidden="true" />

        <div className={styles.body}>
          <h3 className={styles.headline}>{headline}</h3>
          <div className={styles.copyBlock}>
            <p className={styles.copyLine}>{request}</p>
            <p className={styles.copyLine}>{reason}</p>
          </div>
        </div>

        <div className={styles.footer}>
          {cta ? (
            <Link href={cta.href} className={styles.actionBtn} onClick={onCtaClick}>
              {cta.label.toUpperCase()}
            </Link>
          ) : null}
          <button type="button" className={styles.actionBtn} onClick={onClose}>
            DISMISS
          </button>
        </div>
      </div>
    </div>
  );
}
