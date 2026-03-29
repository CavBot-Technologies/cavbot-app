"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type BrowserRouteSnapshot = {
  pathname: string;
  search: string;
  searchParamsValue: string;
};

export function useBrowserRouteSnapshot() {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const searchParamsValue = searchParams?.toString() || "";

  return useMemo<BrowserRouteSnapshot>(() => {
    const search = searchParamsValue ? `?${searchParamsValue}` : "";
    return {
      pathname,
      search,
      searchParamsValue,
    };
  }, [pathname, searchParamsValue]);
}
