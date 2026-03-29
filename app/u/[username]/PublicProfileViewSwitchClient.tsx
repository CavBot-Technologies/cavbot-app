"use client";

import * as React from "react";

import {
  PUBLIC_PROFILE_VIEW_EVENT,
  type PublicProfileView,
  normalizePublicProfileUsernameKey,
  normalizePublicProfileView,
  parsePublicProfileViewEvent,
  readPublicProfileViewFromWindow,
} from "./publicProfileViewState";

export function PublicProfileViewSwitchClient({
  username,
  initialView,
  membersNav,
  membersContent,
  children,
}: {
  username: string;
  initialView: PublicProfileView;
  membersNav: React.ReactNode;
  membersContent: React.ReactNode;
  children: React.ReactNode;
}) {
  const usernameKey = React.useMemo(() => normalizePublicProfileUsernameKey(username), [username]);
  const [activeView, setActiveView] = React.useState<PublicProfileView>(() => {
    return normalizePublicProfileView(initialView);
  });

  React.useEffect(() => {
    const syncFromLocation = () => {
      setActiveView(readPublicProfileViewFromWindow());
    };

    const onViewChange = (event: Event) => {
      const detail = parsePublicProfileViewEvent(event);
      if (!detail) return;
      if (detail.usernameKey !== usernameKey) return;
      setActiveView(detail.view);
    };

    syncFromLocation();
    window.addEventListener(PUBLIC_PROFILE_VIEW_EVENT, onViewChange as EventListener);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener(PUBLIC_PROFILE_VIEW_EVENT, onViewChange as EventListener);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, [usernameKey]);

  const membersActive = activeView === "members";
  return (
    <>
      {membersActive ? membersNav : null}
      {membersActive ? membersContent : children}
    </>
  );
}
