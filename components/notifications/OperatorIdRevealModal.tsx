"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { CheckIcon, CopyIcon } from "@/components/CopyIcons";
import { copyTextToClipboard } from "@/lib/clipboard";

import styles from "./OperatorIdRevealModal.module.css";

type OperatorIdCard = {
  name: string;
  department: string;
  positionTitle: string;
  staffCode: string;
};

type OperatorIdRevealResponse = {
  ok?: boolean;
  error?: string;
  card?: Partial<OperatorIdCard> | null;
};

export function OperatorIdRevealModal(props: {
  open: boolean;
  notificationId: string | null;
  onClose: () => void;
}) {
  const { notificationId, onClose, open } = props;
  const [card, setCard] = useState<OperatorIdCard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !notificationId) return;

    const controller = new AbortController();
    setLoading(true);
    setError("");
    setCard(null);

    const load = async () => {
      try {
        const response = await fetch(
          `/api/notifications/operator-id?notificationId=${encodeURIComponent(notificationId || "")}`,
          {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          },
        );
        const payload = (await response.json().catch(() => null)) as OperatorIdRevealResponse | null;
        if (!response.ok || payload?.ok === false || !payload?.card?.staffCode) {
          throw new Error(payload?.error || "Unable to load your staff ID.");
        }
        if (controller.signal.aborted) return;
        setCard({
          name: String(payload.card.name || "CavBot staff"),
          department: String(payload.card.department || "Command"),
          positionTitle: String(payload.card.positionTitle || "Staff"),
          staffCode: String(payload.card.staffCode || ""),
        });
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Unable to load your staff ID.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [notificationId, open]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!open) return null;

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cb-operator-id-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close staff ID card">
          <span aria-hidden="true">×</span>
        </button>

        <div className={styles.markWrap} aria-hidden="true">
          <Image src="/logo/cavbot-logomark.svg" alt="" width={34} height={34} className={styles.mark} />
        </div>
        <div className={styles.eyebrow}>CavBot HQ</div>
        <h2 className={styles.title} id="cb-operator-id-title">
          Staff ID ready
        </h2>
        <p className={styles.sub}>Your operator identity is secured and ready inside CavBot.</p>

        {loading ? <div className={styles.state}>Loading your staff ID…</div> : null}
        {!loading && error ? <div className={styles.error}>{error}</div> : null}

        {!loading && !error && card ? (
          <div className={styles.card}>
            <div className={styles.name}>{card.name}</div>

            <div className={styles.metaGrid}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Department</span>
                <strong className={styles.metaValue}>{card.department}</strong>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Position</span>
                <strong className={styles.metaValue}>{card.positionTitle}</strong>
              </div>
            </div>

            <div className={styles.staffIdBlock}>
              <div className={styles.staffIdLabel}>Staff ID</div>
              <div className={styles.staffIdRow}>
                <code className={styles.staffIdValue}>{card.staffCode}</code>
                <button
                  type="button"
                  className={styles.copyButton}
                  aria-label={copied ? "Staff ID copied" : "Copy staff ID"}
                  onClick={async () => {
                    const success = await copyTextToClipboard(card.staffCode);
                    setCopied(success);
                  }}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
