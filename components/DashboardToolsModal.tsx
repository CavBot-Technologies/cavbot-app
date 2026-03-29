import { useEffect, useMemo, useRef } from "react";

import "@/components/DashboardToolsModal.css";

export type DashboardToolsSite = {
  id: string;
  label: string;
  origin: string;
};

export type DashboardToolsModalProps = {
  open: boolean;
  sites: DashboardToolsSite[];
  selectedSiteId: string;
  reportHref: string;
  reportFileName?: string;
  onClose: () => void;
  onApply: (siteId: string) => void;
  onChangeSite: (siteId: string) => void;
};

export default function DashboardToolsModal({
  open,
  sites,
  selectedSiteId,
  reportHref,
  reportFileName,
  onClose,
  onApply,
  onChangeSite,
}: DashboardToolsModalProps) {
  const selectRef = useRef<HTMLSelectElement | null>(null);

  const resolvedSiteId = useMemo(() => {
    if (selectedSiteId) return selectedSiteId;
    return sites[0]?.id || "";
  }, [selectedSiteId, sites]);

  useEffect(() => {
    if (!open) return;
    selectRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    const body = document.body;
    body.classList.toggle("cb-modals-lock", open);
    body.classList.toggle("cb-modal-open", open);
    return () => body.classList.remove("cb-modals-lock", "cb-modal-open");
  }, [open]);

  if (!open) return null;

  return (
    <div className="cb-modal cb-dashboard-tools-modal" role="dialog" aria-modal="true" aria-label="Dashboard tools">
      <div className="cb-modal-backdrop" onClick={onClose} />
      <div className="cb-modal-card" role="document">
        <div className="cb-modal-top">
          <div className="cb-modal-title">Dashboard Tools</div>
          <button
            className="cb-iconbtn"
            type="button"
            aria-label="Close"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <span className="cb-closeIcon" aria-hidden="true" />
          </button>
        </div>

        <div className="cb-modal-body">
          <div className="cb-field">
            <div className="cb-field-label">Target</div>
            <select
              className="cb-select"
              value={resolvedSiteId}
              onChange={(event) => onChangeSite(event.target.value)}
              ref={selectRef}
            >
              {sites.length ? (
                sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.label}
                  </option>
                ))
              ) : (
                <option value="">No sites</option>
              )}
            </select>
            <div className="cb-field-hint">Select which site to analyze.</div>
          </div>

          <div className="cb-modal-actions">
            <a className="cb-btn cb-btn-ghost" href={reportHref} download={reportFileName}>
              Download report
            </a>
            <button
              className="cb-btn"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (resolvedSiteId) onApply(resolvedSiteId);
              }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
