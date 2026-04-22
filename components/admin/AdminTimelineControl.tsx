"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { startTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { AdminMonthKey, AdminRangeKey } from "@/lib/admin/server";

const RANGE_OPTIONS: Array<{ value: AdminRangeKey; label: string }> = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

function buildMonthOptions(count = 18) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(currentYear, currentMonth - index, 1));
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const value = `${year}-${month}` as AdminMonthKey;
    const label = new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
    return { value, label };
  });
}

export function AdminTimelineControl(props: { value: AdminRangeKey; month?: AdminMonthKey | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const monthPickerRef = useRef<HTMLDivElement | null>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const monthLabel = monthOptions.find((option) => option.value === props.month)?.label || "";

  useEffect(() => {
    if (!monthPickerOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!monthPickerRef.current?.contains(event.target as Node)) {
        setMonthPickerOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMonthPickerOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [monthPickerOpen]);

  function replaceParam(name: string, nextValue: string) {
    const params = new URLSearchParams(searchParams?.toString() || "");
    if (nextValue) {
      params.set(name, nextValue);
    } else {
      params.delete(name);
    }
    params.delete("days");
    params.delete("page");
    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname);
    });
  }

  return (
    <div className="hq-range">
      <span className="hq-rangeLabel">Timeline</span>
      <div className="hq-rangeCluster">
        <div className="hq-rangeMonthPicker" ref={monthPickerRef}>
          <button
            type="button"
            className="hq-rangeCalendarButton"
            aria-label={props.month ? `Filter month: ${monthLabel}` : "Filter by month"}
            aria-expanded={monthPickerOpen}
            aria-haspopup="dialog"
            title={props.month ? `Month filter: ${monthLabel}` : "Filter by month"}
            data-active={props.month ? "true" : "false"}
            onClick={() => setMonthPickerOpen((current) => !current)}
          >
            <span className="hq-rangeIcon" aria-hidden="true" />
          </button>

          {monthPickerOpen ? (
            <div className="hq-rangePopover" role="dialog" aria-label="Browse metrics by month">
              <div className="hq-rangePopoverHeader">
                <div>
                  <div className="hq-rangePopoverTitle">Browse by Month</div>
                  <div className="hq-rangePopoverSub">Switch the HQ dataset to a calendar month.</div>
                </div>
                {props.month ? (
                  <button
                    type="button"
                    className="hq-rangeResetButton"
                    onClick={() => {
                      setMonthPickerOpen(false);
                      replaceParam("month", "");
                    }}
                  >
                    Use rolling window
                  </button>
                ) : null}
              </div>
              <div className="hq-rangeMonthList">
                {monthOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="hq-rangeMonthButton"
                    data-active={option.value === props.month ? "true" : "false"}
                    onClick={() => {
                      setMonthPickerOpen(false);
                      replaceParam("month", option.value);
                    }}
                  >
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <label className="hq-rangeField hq-rangeFieldWindow">
          <select
            className="hq-rangeSelect"
            aria-label="Timeline"
            value={props.value}
            onChange={(event) => replaceParam("range", event.target.value)}
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="hq-rangeChevron" aria-hidden="true" />
        </label>
      </div>
    </div>
  );
}
