"use client";

import { useMemo, useState } from "react";

import { INTEGRATIONS } from "./integration-registry";

const PLATFORM_ORDER = [
  "custom-html",
  "webflow",
  "wix",
  "shopify",
  "wordpress",
  "squarespace",
  "framer",
] as const;

export const CATEGORY_ITEMS = [
  { id: "all", label: "All integrations", status: "available" },
  { id: "cavbot", label: "CavBot", status: "available" },
  { id: "platforms", label: "Website platforms", status: "available" },
] as const;

type CategoryId = (typeof CATEGORY_ITEMS)[number]["id"];

const CATEGORY_FILTERS: Record<
  CategoryId,
  (items: typeof INTEGRATIONS) => typeof INTEGRATIONS
> = {
  all: (items) => items,
  cavbot: (items) => items.filter((item) => item.id === "cavbot"),
  platforms: (items) =>
    PLATFORM_ORDER.map((platformId) => items.find((item) => item.id === platformId))
      .filter((item): item is typeof INTEGRATIONS[number] => Boolean(item)),
};

export function useIntegrationFilter() {
  const [selected, setSelected] = useState<CategoryId>("all");

  const filteredIntegrations = useMemo(() => {
    return CATEGORY_FILTERS[selected](INTEGRATIONS);
  }, [selected]);

  return {
    selected,
    setSelected,
    filteredIntegrations,
  };
}
