"use client";

import Image from "next/image";
import Link from "next/link";
import type { MouseEventHandler } from "react";

import styles from "./CavGuardModal.module.css";

export type CavGuardCardAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

type CavGuardCardProps = {
  headline: string;
  request: string;
  reason: string;
  actions?: CavGuardCardAction[];
  variant?: "modal" | "surface";
  titleId?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
};

export function CavGuardCard({
  headline,
  request,
  reason,
  actions = [],
  variant = "modal",
  titleId,
  onClick,
}: CavGuardCardProps) {
  const cardClassName = variant === "surface" ? `${styles.card} ${styles.surfaceCard}` : styles.card;
  const footerClassName = variant === "surface" ? `${styles.footer} ${styles.surfaceFooter}` : styles.footer;

  return (
    <div className={cardClassName} data-variant={variant} onClick={onClick}>
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
            <h2 className={styles.title} id={titleId}>
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

      {actions.length ? (
        <div className={footerClassName}>
          {actions.map((action) => {
            const key = `${action.label}:${action.href || "button"}`;
            if (action.href) {
              return (
                <Link key={key} href={action.href} className={styles.actionBtn} onClick={action.onClick}>
                  {action.label}
                </Link>
              );
            }

            return (
              <button key={key} type="button" className={styles.actionBtn} onClick={action.onClick}>
                {action.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
