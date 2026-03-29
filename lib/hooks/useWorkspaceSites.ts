import useSWR from "swr";

type SitesResponse = {
  topSiteId: string | null;
  sites: { id: string; label: string; origin: string; createdAt: string }[];
};

const fetcher = async (url: string): Promise<SitesResponse> => {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { "Cache-Control": "no-store" },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data as SitesResponse;
};

export function useWorkspaceSites(projectId: number | null) {
  const key = projectId ? `/api/workspaces/${projectId}/sites` : null;

  const swr = useSWR<SitesResponse>(key, fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 0,
    revalidateIfStale: true,
  });

  return {
    ...swr,
    key, // expose key so Command Deck can mutate it
    sites: swr.data?.sites ?? [],
    topSiteId: swr.data?.topSiteId ?? null,
  };
}