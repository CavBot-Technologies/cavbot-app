"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";

import DashboardToolsModal, { DashboardToolsSite } from "@/components/DashboardToolsModal";

type RangeKey = "24h" | "7d" | "14d" | "30d";

type DashboardToolsControlsProps = {
  containerClassName: string;
  rangeLabelClassName: string;
  rangeLabelTextClassName: string;
  rangeSelectClassName: string;
  buttonClassName?: string;
  buttonLabel?: string;
  buttonTitle?: string;
  range: RangeKey;
  path?: string;
  sites: DashboardToolsSite[];
  selectedSiteId: string;
  reportHref: string;
  reportFileName?: string;
  onApplied?: (siteId: string) => void;
};

const defaultRangeOptions: { value: RangeKey; label: string }[] = [
  { value: "24h", label: "24 Hours" },
  { value: "7d", label: "7 Days" },
  { value: "14d", label: "14 Days" },
  { value: "30d", label: "30 Days" },
];

export default function DashboardToolsControls({
  containerClassName,
  rangeLabelClassName,
  rangeLabelTextClassName,
  rangeSelectClassName,
  buttonClassName = "cb-tool-pill",
  buttonLabel = "Dashboard tools",
  buttonTitle = "Dashboard tools",
  range,
  path,
  sites,
  selectedSiteId,
  reportHref,
  reportFileName,
  onApplied,
}: DashboardToolsControlsProps) {
  const router = useRouter();
  const pathname = usePathname() || "/";

  const [open, setOpen] = useState(false);
  const [rangeValue, setRangeValue] = useState(range);
  const [pendingSiteId, setPendingSiteId] = useState(selectedSiteId || "");

  useEffect(() => {
    setRangeValue(range);
  }, [range]);

  useEffect(() => {
    setPendingSiteId(selectedSiteId || "");
  }, [selectedSiteId, sites]);

  const buildHref = useCallback(
    (nextRange: RangeKey, nextSiteId: string) => {
      const params = new URLSearchParams();
      params.set("range", nextRange);
      params.set("site", nextSiteId || "none");
      if (path) {
        params.set("path", path);
      }
      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, path]
  );

  const navigate = useCallback(
    (nextRange: RangeKey, nextSiteId: string) => {
      router.replace(buildHref(nextRange, nextSiteId));
    },
    [buildHref, router]
  );

  const handleRangeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextRange = event.target.value as RangeKey;
      setRangeValue(nextRange);
      const currentSiteId = pendingSiteId || selectedSiteId || "none";
      navigate(nextRange, currentSiteId);
    },
    [navigate, pendingSiteId, selectedSiteId]
  );

  const handleApply = useCallback(() => {
    const nextSiteId = pendingSiteId || selectedSiteId || "";
    if (!nextSiteId) {
      setOpen(false);
      return;
    }
    navigate(rangeValue, nextSiteId);
    onApplied?.(nextSiteId);
    setOpen(false);
  }, [navigate, onApplied, pendingSiteId, rangeValue, selectedSiteId]);

  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);

  const icon = useMemo(
    () => (
      <Image
        src="/icons/app/tools-svgrepo-com.svg"
        alt=""
        width={16}
        height={16}
        className="cb-tool-ico cb-tools-icon"
        aria-hidden="true"
        unoptimized
      />
    ),
    []
  );

  return (
    <div className={containerClassName}>
      <label className={rangeLabelClassName}>
        <span className={rangeLabelTextClassName}>Timeline</span>
        <select className={rangeSelectClassName} value={rangeValue} onChange={handleRangeChange}>
          {defaultRangeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={buttonClassName}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={buttonLabel || buttonTitle || "Dashboard tools"}
        title={buttonTitle}
        onClick={openModal}
      >
        {icon}
      </button>
      <DashboardToolsModal
        open={open}
        sites={sites}
        selectedSiteId={pendingSiteId || selectedSiteId}
        reportHref={reportHref}
        reportFileName={reportFileName}
        onClose={closeModal}
        onChangeSite={setPendingSiteId}
        onApply={handleApply}
      />
    </div>
  );
}
