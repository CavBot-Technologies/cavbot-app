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

type WorkspaceSitesPayload = {
  ok?: boolean;
  sites?: Array<{
    id?: unknown;
    label?: unknown;
    origin?: unknown;
  }>;
  activeSiteId?: unknown;
  topSiteId?: unknown;
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
  const [runtimeSites, setRuntimeSites] = useState<DashboardToolsSite[]>([]);
  const [runtimeSelectedSiteId, setRuntimeSelectedSiteId] = useState("");

  const effectiveSites = sites.length ? sites : runtimeSites;
  const effectiveSelectedSiteId = selectedSiteId || runtimeSelectedSiteId || effectiveSites[0]?.id || "";

  useEffect(() => {
    setRangeValue(range);
  }, [range]);

  useEffect(() => {
    setPendingSiteId(effectiveSelectedSiteId || "");
  }, [effectiveSelectedSiteId, effectiveSites]);

  useEffect(() => {
    if (sites.length) return;
    let cancelled = false;
    async function loadWorkspaceSites() {
      try {
        const res = await fetch("/api/workspace", {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const payload = (await res.json().catch(() => null)) as WorkspaceSitesPayload | null;
        const rows = Array.isArray(payload?.sites) ? payload.sites : [];
        const nextSites = rows
          .map((row) => {
            const id = String(row.id || "").trim();
            const origin = String(row.origin || "").trim();
            if (!id || !origin) return null;
            return {
              id,
              origin,
              label: String(row.label || "").trim() || origin,
            };
          })
          .filter((site): site is DashboardToolsSite => Boolean(site));

        if (cancelled || !nextSites.length) return;
        const activeSiteId = String(payload?.activeSiteId || payload?.topSiteId || "").trim();
        setRuntimeSites(nextSites);
        setRuntimeSelectedSiteId(
          activeSiteId && nextSites.some((site) => site.id === activeSiteId)
            ? activeSiteId
            : nextSites[0]?.id || "",
        );
      } catch {
        // Keep the server-rendered empty state if workspace bootstrap is unavailable.
      }
    }

    void loadWorkspaceSites();
    return () => {
      cancelled = true;
    };
  }, [sites.length]);

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
      const currentSiteId = pendingSiteId || effectiveSelectedSiteId || "none";
      navigate(nextRange, currentSiteId);
    },
    [effectiveSelectedSiteId, navigate, pendingSiteId]
  );

  const handleApply = useCallback(() => {
    const nextSiteId = pendingSiteId || effectiveSelectedSiteId || "";
    if (!nextSiteId) {
      setOpen(false);
      return;
    }
    navigate(rangeValue, nextSiteId);
    onApplied?.(nextSiteId);
    setOpen(false);
  }, [effectiveSelectedSiteId, navigate, onApplied, pendingSiteId, rangeValue]);

  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);

  const icon = useMemo(
    () => (
      <Image
        src="/icons/tools-svgrepo-com.svg"
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
        sites={effectiveSites}
        selectedSiteId={pendingSiteId || effectiveSelectedSiteId}
        reportHref={reportHref}
        reportFileName={reportFileName}
        onClose={closeModal}
        onChangeSite={setPendingSiteId}
        onApply={handleApply}
      />
    </div>
  );
}
