export type PublicProfileView = "overview" | "members";

export const PUBLIC_PROFILE_VIEW_EVENT = "cb:public-profile:view";

export type PublicProfileViewEventDetail = {
  usernameKey: string;
  view: PublicProfileView;
};

export function normalizePublicProfileUsernameKey(raw: unknown): string {
  return String(raw || "").trim().toLowerCase();
}

export function normalizePublicProfileView(raw: unknown): PublicProfileView {
  return String(raw || "").trim().toLowerCase() === "members" ? "members" : "overview";
}

export function readPublicProfileViewFromSearch(search: string): PublicProfileView {
  try {
    const params = new URLSearchParams(String(search || ""));
    return normalizePublicProfileView(params.get("view"));
  } catch {
    return "overview";
  }
}

export function readPublicProfileViewFromWindow(): PublicProfileView {
  if (typeof window === "undefined") return "overview";
  return readPublicProfileViewFromSearch(window.location.search);
}

function buildPublicProfileHrefForView(view: PublicProfileView): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  if (view === "members") {
    url.searchParams.set("view", "members");
  } else {
    url.searchParams.delete("view");
  }
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

function setPublicProfileViewInUrl(view: PublicProfileView, historyMode: "push" | "replace"): void {
  if (typeof window === "undefined") return;
  const nextHref = buildPublicProfileHrefForView(view);
  if (!nextHref) return;
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextHref === currentHref) return;
  if (historyMode === "replace") {
    window.history.replaceState(window.history.state, "", nextHref);
  } else {
    window.history.pushState(window.history.state, "", nextHref);
  }
}

export function emitPublicProfileViewChange(usernameKeyRaw: unknown, viewRaw: unknown): PublicProfileView {
  if (typeof window === "undefined") return normalizePublicProfileView(viewRaw);
  const detail: PublicProfileViewEventDetail = {
    usernameKey: normalizePublicProfileUsernameKey(usernameKeyRaw),
    view: normalizePublicProfileView(viewRaw),
  };
  try {
    window.dispatchEvent(new CustomEvent(PUBLIC_PROFILE_VIEW_EVENT, { detail }));
  } catch {
    // best effort only
  }
  return detail.view;
}

export function setPublicProfileView(
  usernameKeyRaw: unknown,
  viewRaw: unknown,
  historyMode: "push" | "replace" = "push"
): PublicProfileView {
  const view = normalizePublicProfileView(viewRaw);
  setPublicProfileViewInUrl(view, historyMode);
  return emitPublicProfileViewChange(usernameKeyRaw, view);
}

export function parsePublicProfileViewEvent(event: Event): PublicProfileViewEventDetail | null {
  const raw = (event as CustomEvent<PublicProfileViewEventDetail | null>)?.detail || null;
  if (!raw || typeof raw !== "object") return null;
  return {
    usernameKey: normalizePublicProfileUsernameKey((raw as { usernameKey?: unknown }).usernameKey),
    view: normalizePublicProfileView((raw as { view?: unknown }).view),
  };
}

