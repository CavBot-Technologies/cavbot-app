"use client";

import * as React from "react";

import {
  normalizePublicProfileUsernameKey,
  setPublicProfileView,
} from "./publicProfileViewState";

const MEMBERS_SEARCH_EVENT = "cb:public-profile-members-search";

function normalizeUsernameKey(raw: string): string {
  return normalizePublicProfileUsernameKey(raw);
}

function membersSearchStorageKey(usernameKey: string): string {
  return `cb_public_profile_members_search_v1:${normalizeUsernameKey(usernameKey)}`;
}

function readMembersSearchSnapshot(usernameKey: string): string {
  const key = membersSearchStorageKey(usernameKey);
  if (!key) return "";
  try {
    return String(globalThis.__cbSessionStore.getItem(key) || "");
  } catch {
    return "";
  }
}

function writeMembersSearchSnapshot(usernameKey: string, query: string) {
  const key = membersSearchStorageKey(usernameKey);
  if (!key) return;
  try {
    globalThis.__cbSessionStore.setItem(key, String(query || ""));
  } catch {
    // ignore storage errors
  }
}

function emitMembersSearch(usernameKey: string, query: string) {
  try {
    window.dispatchEvent(
      new CustomEvent(MEMBERS_SEARCH_EVENT, {
        detail: {
          usernameKey: normalizeUsernameKey(usernameKey),
          query: String(query || ""),
        },
      })
    );
  } catch {
    // ignore dispatch failures
  }
}

export function PublicProfileMembersSearchNavClient({
  username,
}: {
  username: string;
}) {
  const usernameKey = React.useMemo(() => normalizeUsernameKey(username), [username]);
  const [query, setQuery] = React.useState(() => readMembersSearchSnapshot(usernameKey));

  React.useEffect(() => {
    setQuery(readMembersSearchSnapshot(usernameKey));
  }, [usernameKey]);

  const onSearchChange = React.useCallback(
    (value: string) => {
      setQuery(value);
      writeMembersSearchSnapshot(usernameKey, value);
      emitMembersSearch(usernameKey, value);
    },
    [usernameKey]
  );

  return (
    <nav className="pp-viewToggle" aria-label="Workspace members search">
      <button
        type="button"
        className="pp-viewToggleBtn pp-viewToggleBackBtn"
        aria-label="Back to profile"
        title="Back to profile"
        onClick={() => {
          setPublicProfileView(usernameKey, "overview");
        }}
      >
        <span className="pp-viewToggleBackIcon" aria-hidden="true" />
      </button>
      <label className="pp-viewToggleMembersSearch" aria-label="Search workspace members">
        <input
          className="pp-viewToggleMembersSearchInput"
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search members"
          value={query}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
        />
      </label>
    </nav>
  );
}
