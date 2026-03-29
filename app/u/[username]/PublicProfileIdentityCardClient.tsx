"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { isArcadeStatusMode, publicStatusToneFromMode } from "@/lib/publicProfile/publicStatus";
import { PublicProfileStatusOwnerClient } from "./PublicProfileStatusOwnerClient";
import { PublicProfileTeamActionsClient } from "./PublicProfileTeamActionsClient";

type DetailKind = "cavbot" | "workspace" | "country" | "github" | "instagram" | "linkedin" | "link" | "location" | "email";

type IdentityDetail = {
  kind: DetailKind;
  label: string;
  value: string;
  href: string | null;
};

type OwnerStatusState = {
  showStatusOnPublicProfile: boolean;
  userStatus: string | null;
  note: string | null;
  updatedAtISO: string | null;
};

type TeamActionsInitialTeamState = React.ComponentProps<typeof PublicProfileTeamActionsClient>["initialTeamState"];
type TeamActionsInitialMembers = React.ComponentProps<typeof PublicProfileTeamActionsClient>["initialMembers"];

type AccountProfileDTO = {
  email: string;
  username: string | null;
  fullName: string | null;
  bio: string | null;
  country: string | null;
  region: string | null;
  timeZone: string | null;
  avatarTone: string | null;
  avatarImage: string | null;
  companyName: string | null;
  companyCategory: string | null;
  companySubcategory: string | null;
  githubUrl: string | null;
  instagramUrl: string | null;
  linkedinUrl: string | null;
  customLinkUrl?: string | null;
};

type AccountProfileResponse = {
  ok?: boolean;
  message?: string;
  profile?: AccountProfileDTO;
};

type EditableProfileState = {
  fullName: string;
  bio: string;
  companyName: string;
  region: string;
  country: string;
  instagramUrl: string;
  linkedinUrl: string;
  githubUrl: string;
  extraLinks: string[];
};

type CardProfileState = EditableProfileState & {
  username: string;
  email: string;
};

const MAX_CUSTOM_LINKS = 6;
const LS_USERNAME = "cb_profile_username_v1";
const LS_COMPANY_SUBCATEGORY = "cb_profile_company_subcategory_v1";
const LS_GITHUB_URL = "cb_profile_github_url_v1";
const LS_INSTAGRAM_URL = "cb_profile_instagram_url_v1";
const LS_LINKEDIN_URL = "cb_profile_linkedin_url_v1";
const LS_CUSTOM_LINK_URL = "cb_profile_custom_link_url_v1";
const LS_PROFILE_REV = "cb_profile_rev_v1";
const DEFAULT_FULL_NAME_FALLBACK = "CavBot Operator";

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function padExtraLinks(raw: string[]): string[] {
  const next = [...raw].slice(0, MAX_CUSTOM_LINKS);
  while (next.length < MAX_CUSTOM_LINKS) next.push("");
  return next;
}

function decodeCustomLinkUrls(raw: unknown): string[] {
  const input = s(raw);
  if (!input) return [];
  try {
    if (input.startsWith("[")) {
      const parsed = JSON.parse(input);
      if (!Array.isArray(parsed)) return [];
      return Array.from(new Set(parsed.map((v) => s(v)).filter(Boolean))).slice(0, MAX_CUSTOM_LINKS);
    }
  } catch {
    return [];
  }
  return [input];
}

function encodeCustomLinkUrls(values: string[]): string {
  const next = Array.from(new Set((values || []).map((v) => s(v)).filter(Boolean))).slice(0, MAX_CUSTOM_LINKS);
  if (!next.length) return "";
  if (next.length === 1) return next[0] || "";
  return JSON.stringify(next);
}

function toDisplayUrl(raw: string): string {
  return s(raw).replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}

function toHttpHref(raw: string): string {
  const input = s(raw);
  if (!input) return "";
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function firstDetailValue(details: IdentityDetail[], kind: DetailKind): string {
  const hit = details.find((row) => row.kind === kind);
  return hit ? s(hit.value) : "";
}

function detailValues(details: IdentityDetail[], kind: DetailKind): string[] {
  return details.filter((row) => row.kind === kind).map((row) => s(row.value)).filter(Boolean);
}

function firstLocationValue(details: IdentityDetail[]): string {
  const hit = details.find((row) => row.kind === "location");
  return hit ? s(hit.value) : "";
}

function buildCardProfileState(input: {
  username: string;
  displayName: string;
  bio: string | null;
  identityDetails: IdentityDetail[];
  accountProfile: AccountProfileDTO | null;
}): CardProfileState {
  const account = input.accountProfile;
  const fallbackLocation = firstLocationValue(input.identityDetails);
  const fallbackEmail = firstDetailValue(input.identityDetails, "email");
  const resolvedAccountName = s(account?.fullName);
  const resolvedAccountUsername = s(account?.username);
  const fallbackDisplayName = account ? DEFAULT_FULL_NAME_FALLBACK : (s(input.displayName) || DEFAULT_FULL_NAME_FALLBACK);

  const state: CardProfileState = {
    username: resolvedAccountUsername || s(input.username),
    email: s(account?.email) || fallbackEmail,
    fullName: resolvedAccountName || fallbackDisplayName,
    bio: s(account?.bio) || s(input.bio),
    companyName: s(account?.companyName),
    region: s(account?.region) || fallbackLocation,
    country: s(account?.country),
    instagramUrl: s(account?.instagramUrl) || firstDetailValue(input.identityDetails, "instagram"),
    linkedinUrl: s(account?.linkedinUrl) || firstDetailValue(input.identityDetails, "linkedin"),
    githubUrl: s(account?.githubUrl) || firstDetailValue(input.identityDetails, "github"),
    extraLinks: padExtraLinks(
      account ? decodeCustomLinkUrls(account.customLinkUrl) : detailValues(input.identityDetails, "link")
    ),
  };

  return state;
}

function buildIdentityDetailsFromState(input: {
  state: CardProfileState;
  showIdentityLinks: boolean;
  showIdentityLocation: boolean;
  showIdentityEmail: boolean;
}): IdentityDetail[] {
  const details: IdentityDetail[] = [];

  if (input.showIdentityLinks) {
    const username = s(input.state.username).toLowerCase();
    if (username) {
      details.push({
        kind: "cavbot",
        label: "CavBot",
        value: `app.cavbot.io/${username}`,
        href: `https://app.cavbot.io/${encodeURIComponent(username)}`,
      });
    }

    const githubHref = toHttpHref(input.state.githubUrl);
    if (githubHref) {
      details.push({
        kind: "github",
        label: "GitHub",
        value: toDisplayUrl(githubHref),
        href: githubHref,
      });
    }

    const instagramHref = toHttpHref(input.state.instagramUrl);
    if (instagramHref) {
      details.push({
        kind: "instagram",
        label: "Instagram",
        value: toDisplayUrl(instagramHref),
        href: instagramHref,
      });
    }

    const linkedInHref = toHttpHref(input.state.linkedinUrl);
    if (linkedInHref) {
      details.push({
        kind: "linkedin",
        label: "LinkedIn",
        value: toDisplayUrl(linkedInHref),
        href: linkedInHref,
      });
    }

    input.state.extraLinks.forEach((raw) => {
      const href = toHttpHref(raw);
      if (!href) return;
      details.push({
        kind: "link",
        label: "Website",
        value: toDisplayUrl(href),
        href,
      });
    });
  }

  if (input.showIdentityLocation) {
    const value = s(input.state.region) || s(input.state.country);
    if (value) {
      details.push({
        kind: "location",
        label: "Location",
        value,
        href: null,
      });
    }
  }

  if (input.showIdentityEmail) {
    const email = s(input.state.email);
    if (email) {
      details.push({
        kind: "email",
        label: "Email",
        value: email,
        href: `mailto:${email}`,
      });
    }
  }

  return details;
}

function DetailIcon({ kind }: { kind: DetailKind }) {
  if (kind === "cavbot") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="pp-detailIcon pp-detailIconImg" src="/logo/cavbot-logomark.svg" alt="" aria-hidden="true" />;
  }
  if (kind === "workspace") {
    return (
      <span
        className="pp-detailIcon pp-detailIconMask"
        style={{
          WebkitMaskImage: 'url("/icons/app/building-2-fill-svgrepo-com.svg")',
          maskImage: 'url("/icons/app/building-2-fill-svgrepo-com.svg")',
        }}
        aria-hidden="true"
      />
    );
  }
  if (kind === "country") {
    return (
      <span
        className="pp-detailIcon pp-detailIconMask"
        style={{
          WebkitMaskImage: 'url("/icons/app/globe-alt-svgrepo-com.svg")',
          maskImage: 'url("/icons/app/globe-alt-svgrepo-com.svg")',
        }}
        aria-hidden="true"
      />
    );
  }
  if (kind === "github") {
    return (
      <svg className="pp-detailIcon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 .5C5.73.5.75 5.63.75 12c0 5.1 3.29 9.42 7.86 10.95.57.11.78-.25.78-.56 0-.28-.01-1.02-.02-2-3.2.71-3.88-1.58-3.88-1.58-.52-1.36-1.28-1.72-1.28-1.72-1.05-.74.08-.73.08-.73 1.16.08 1.77 1.22 1.77 1.22 1.03 1.8 2.7 1.28 3.36.98.1-.77.4-1.28.72-1.58-2.55-.3-5.23-1.3-5.23-5.8 0-1.28.45-2.33 1.18-3.15-.12-.3-.51-1.53.11-3.18 0 0 .97-.32 3.18 1.2a10.7 10.7 0 0 1 2.9-.4c.98 0 1.97.14 2.9.4 2.21-1.52 3.18-1.2 3.18-1.2.62 1.65.23 2.88.11 3.18.74.82 1.18 1.87 1.18 3.15 0 4.51-2.69 5.5-5.25 5.79.41.36.78 1.08.78 2.18 0 1.58-.01 2.85-.01 3.23 0 .31.2.67.79.56A11.28 11.28 0 0 0 23.25 12C23.25 5.63 18.27.5 12 .5Z"
        />
      </svg>
    );
  }
  if (kind === "instagram") {
    return (
      <svg className="pp-detailIcon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M7.2 2.5h9.6A4.7 4.7 0 0 1 21.5 7.2v9.6a4.7 4.7 0 0 1-4.7 4.7H7.2a4.7 4.7 0 0 1-4.7-4.7V7.2A4.7 4.7 0 0 1 7.2 2.5Zm0 1.8A2.9 2.9 0 0 0 4.3 7.2v9.6a2.9 2.9 0 0 0 2.9 2.9h9.6a2.9 2.9 0 0 0 2.9-2.9V7.2a2.9 2.9 0 0 0-2.9-2.9H7.2Zm10.2 1.9a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM12 7.3a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Zm0 1.8a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8Z"
        />
      </svg>
    );
  }
  if (kind === "linkedin") {
    return (
      <svg className="pp-detailIcon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4.98 3.5C3.88 3.5 3 4.4 3 5.5s.88 2 1.98 2h.02C6.1 7.5 7 6.6 7 5.5S6.1 3.5 5 3.5h-.02ZM3.5 21h3V9H3.5v12Zm5.5-12h2.88v1.64h.04c.4-.77 1.38-1.58 2.84-1.58 3.04 0 3.6 2 3.6 4.6V21h-3v-6.12c0-1.46-.03-3.34-2.03-3.34-2.03 0-2.34 1.59-2.34 3.23V21h-3V9Z"
        />
      </svg>
    );
  }
  if (kind === "link") {
    return (
      <svg className="pp-detailIcon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M3 12h18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path
          d="M12 3c3.4 3.7 3.4 13.3 0 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M12 3c-3.4 3.7-3.4 13.3 0 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === "location") {
    return (
      <svg className="pp-detailIcon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 1.8c-4.2 0-7.6 3.3-7.6 7.4 0 5.1 6.8 12.5 7.1 12.8.3.3.8.3 1.1 0 .3-.3 7.1-7.7 7.1-12.8 0-4.1-3.4-7.4-7.7-7.4Zm0 10.3a2.9 2.9 0 1 1 0-5.8 2.9 2.9 0 0 1 0 5.8Z"
        />
      </svg>
    );
  }
  return (
    <svg className="pp-detailIcon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 3.2-8 5.3-8-5.3V6l8 5.3L20 6v1.2Z"
      />
    </svg>
  );
}

export function PublicProfileIdentityCardClient({
  username,
  displayName,
  isPremiumPlus,
  avatar,
  status,
  bio,
  identityDetails,
  isPrivateProfile,
  allContentSectionsHidden,
  isOwner,
  ownerStatus,
  editProfileHref,
  canonicalProfileUrl,
  showIdentityLinks,
  showIdentityLocation,
  showIdentityEmail,
  initialTeamState,
  initialMembers,
}: {
  username: string;
  displayName: string;
  isPremiumPlus: boolean;
  avatar: { tone: string | null; image: string | null; initials: string };
  status: { mode: string; note: string | null; updatedAtISO: string | null; updatedRelative: string } | null;
  bio: string | null;
  identityDetails: IdentityDetail[];
  isPrivateProfile: boolean;
  allContentSectionsHidden: boolean;
  isOwner: boolean;
  ownerStatus: OwnerStatusState | null;
  editProfileHref: string;
  canonicalProfileUrl: string;
  showIdentityLinks: boolean;
  showIdentityLocation: boolean;
  showIdentityEmail: boolean;
  initialTeamState: TeamActionsInitialTeamState;
  initialMembers: TeamActionsInitialMembers;
}) {
  const router = useRouter();
  const isPublicContentHidden = isPrivateProfile || allContentSectionsHidden;
  const [accountProfile, setAccountProfile] = React.useState<AccountProfileDTO | null>(null);
  const [cardState, setCardState] = React.useState<CardProfileState>(() =>
    buildCardProfileState({
      username,
      displayName,
      bio,
      identityDetails,
      accountProfile: null,
    })
  );
  const [formState, setFormState] = React.useState<EditableProfileState>(() => ({
    fullName: cardState.fullName,
    bio: cardState.bio,
    companyName: cardState.companyName,
    region: cardState.region,
    country: cardState.country,
    instagramUrl: cardState.instagramUrl,
    linkedinUrl: cardState.linkedinUrl,
    githubUrl: cardState.githubUrl,
    extraLinks: padExtraLinks(cardState.extraLinks),
  }));
  const [editing, setEditing] = React.useState(false);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState("");
  const [loadError, setLoadError] = React.useState("");

  const identitySignature = React.useMemo(
    () => identityDetails.map((detail) => `${detail.kind}:${detail.value}:${detail.href || ""}`).join("|"),
    [identityDetails]
  );

  const syncCardFromSource = React.useCallback(
    (profile: AccountProfileDTO | null) => {
      const next = buildCardProfileState({
        username,
        displayName,
        bio,
        identityDetails,
        accountProfile: profile,
      });
      setCardState(next);
      return next;
    },
    [bio, displayName, identityDetails, username]
  );

  const loadAccountProfile = React.useCallback(async () => {
    const res = await fetch("/api/settings/account", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });
    const payload = (await res.json().catch(() => ({}))) as AccountProfileResponse;
    if (!res.ok || payload.ok !== true || !payload.profile) {
      throw new Error(s(payload.message) || "Failed to load profile.");
    }
    const normalized = payload.profile;
    setAccountProfile(normalized);
    return normalized;
  }, []);

  React.useEffect(() => {
    if (!isOwner) return;
    void loadAccountProfile()
      .then((profile) => {
        if (!editing) {
          syncCardFromSource(profile);
        }
      })
      .catch(() => {
        // Background hydration best-effort only.
      });
  }, [editing, isOwner, loadAccountProfile, syncCardFromSource]);

  React.useEffect(() => {
    if (editing) return;
    syncCardFromSource(accountProfile);
  }, [accountProfile, editing, identitySignature, syncCardFromSource]);

  const startEditing = React.useCallback(async () => {
    if (!isOwner || saveBusy) return;
    setSaveError("");
    setLoadError("");

    let profile = accountProfile;
    if (!profile) {
      try {
        profile = await loadAccountProfile();
      } catch (error) {
        setLoadError(s(error instanceof Error ? error.message : "Failed to load profile."));
        return;
      }
    }

    const source = buildCardProfileState({
      username,
      displayName,
      bio,
      identityDetails,
      accountProfile: profile,
    });
    setFormState({
      fullName: source.fullName,
      bio: source.bio,
      companyName: source.companyName,
      region: source.region,
      country: source.country,
      instagramUrl: source.instagramUrl,
      linkedinUrl: source.linkedinUrl,
      githubUrl: source.githubUrl,
      extraLinks: padExtraLinks(source.extraLinks),
    });
    setEditing(true);
  }, [
    accountProfile,
    bio,
    displayName,
    identityDetails,
    isOwner,
    loadAccountProfile,
    saveBusy,
    username,
  ]);

  const cancelEditing = React.useCallback(() => {
    if (saveBusy) return;
    setEditing(false);
    setSaveError("");
    setLoadError("");
    setFormState({
      fullName: cardState.fullName,
      bio: cardState.bio,
      companyName: cardState.companyName,
      region: cardState.region,
      country: cardState.country,
      instagramUrl: cardState.instagramUrl,
      linkedinUrl: cardState.linkedinUrl,
      githubUrl: cardState.githubUrl,
      extraLinks: padExtraLinks(cardState.extraLinks),
    });
  }, [cardState, saveBusy]);

  const toggleEditFromOwnerAction = React.useCallback(() => {
    if (editing) {
      cancelEditing();
      return;
    }
    void startEditing();
  }, [cancelEditing, editing, startEditing]);

  const updateExtraLinkAt = React.useCallback((index: number, value: string) => {
    setFormState((current) => {
      const next = padExtraLinks(current.extraLinks);
      next[index] = value;
      return { ...current, extraLinks: next };
    });
  }, []);

  const saveInlineProfile = React.useCallback(async () => {
    if (!isOwner || saveBusy) return;
    setSaveError("");
    setLoadError("");

    let baseline = accountProfile;
    if (!baseline) {
      try {
        baseline = await loadAccountProfile();
      } catch (error) {
        setSaveError(s(error instanceof Error ? error.message : "Failed to load profile."));
        return;
      }
    }

    setSaveBusy(true);
    try {
      const customLinkUrl = encodeCustomLinkUrls(formState.extraLinks);
      const payload = {
        fullName: formState.fullName,
        bio: formState.bio,
        country: formState.country,
        region: formState.region,
        timeZone: s(baseline.timeZone) || "America/Los_Angeles",
        avatarTone: s(baseline.avatarTone) || "lime",
        avatarImage: s(baseline.avatarImage) || null,
        companyName: formState.companyName || null,
        companyCategory: s(baseline.companyCategory) || null,
        companySubcategory: s(baseline.companySubcategory) || null,
        githubUrl: formState.githubUrl || null,
        instagramUrl: formState.instagramUrl || null,
        linkedinUrl: formState.linkedinUrl || null,
        customLinkUrl: customLinkUrl || null,
      };

      const res = await fetch("/api/settings/account", {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as AccountProfileResponse;
      if (!res.ok || body.ok !== true || !body.profile) {
        throw new Error(s(body.message) || "Save failed.");
      }

      const nextProfile = body.profile;
      setAccountProfile(nextProfile);

      const nextCard = buildCardProfileState({
        username,
        displayName,
        bio,
        identityDetails,
        accountProfile: nextProfile,
      });
      setCardState(nextCard);
      setFormState({
        fullName: nextCard.fullName,
        bio: nextCard.bio,
        companyName: nextCard.companyName,
        region: nextCard.region,
        country: nextCard.country,
        instagramUrl: nextCard.instagramUrl,
        linkedinUrl: nextCard.linkedinUrl,
        githubUrl: nextCard.githubUrl,
        extraLinks: padExtraLinks(nextCard.extraLinks),
      });

      try {
        const nextUsername = s(nextProfile.username).toLowerCase();
        if (nextUsername) globalThis.__cbLocalStore.setItem(LS_USERNAME, nextUsername);
        globalThis.__cbLocalStore.setItem(LS_COMPANY_SUBCATEGORY, s(nextProfile.companySubcategory));
        globalThis.__cbLocalStore.setItem(LS_GITHUB_URL, s(nextProfile.githubUrl));
        globalThis.__cbLocalStore.setItem(LS_INSTAGRAM_URL, s(nextProfile.instagramUrl));
        globalThis.__cbLocalStore.setItem(LS_LINKEDIN_URL, s(nextProfile.linkedinUrl));
        globalThis.__cbLocalStore.setItem(LS_CUSTOM_LINK_URL, s(nextProfile.customLinkUrl));
        globalThis.__cbLocalStore.setItem(LS_PROFILE_REV, String(Date.now()));
      } catch {
        // Best effort only.
      }

      try {
        window.dispatchEvent(
          new CustomEvent("cb:profile", {
            detail: {
              fullName: s(nextProfile.fullName),
              email: s(nextProfile.email),
              username: s(nextProfile.username),
              bio: s(nextProfile.bio),
              companyName: s(nextProfile.companyName),
              companySubcategory: s(nextProfile.companySubcategory),
              githubUrl: s(nextProfile.githubUrl),
              instagramUrl: s(nextProfile.instagramUrl),
              linkedinUrl: s(nextProfile.linkedinUrl),
              customLinkUrl: s(nextProfile.customLinkUrl),
            },
          })
        );
      } catch {
        // Best effort only.
      }

      setEditing(false);
      router.refresh();
    } catch (error) {
      setSaveError(s(error instanceof Error ? error.message : "Save failed."));
    } finally {
      setSaveBusy(false);
    }
  }, [
    accountProfile,
    bio,
    displayName,
    formState,
    identityDetails,
    isOwner,
    loadAccountProfile,
    router,
    saveBusy,
    username,
  ]);

  const viewDetails = React.useMemo(
    () =>
      buildIdentityDetailsFromState({
        state: cardState,
        showIdentityLinks,
        showIdentityLocation,
        showIdentityEmail,
      }),
    [cardState, showIdentityEmail, showIdentityLinks, showIdentityLocation]
  );

  return (
    <div className="pp-profileCard">
      <div className="pp-profileCardHead" aria-label="Profile">
        <div className="pp-profileCardTitle">Profile</div>
        <div className="pp-profileHeadRight" aria-label="Account status">
          {!isPublicContentHidden ? (
            isOwner && ownerStatus ? (
              <PublicProfileStatusOwnerClient username={username} initial={ownerStatus} variant="header" />
            ) : status ? (
              <div
                className="pp-status pp-statusHeader"
                aria-label="Account status"
                data-tone={publicStatusToneFromMode(status.mode)}
                data-mode={status.mode === "Arcade" ? "Arcade" : ""}
              >
                <div className="pp-statusRow">
                  <div className="pp-statusLeft">
                    <span className="pp-statusIconStatic" aria-hidden="true">
                      <svg
                        className={`pp-statusSmiley cb-userStatusIcon${isArcadeStatusMode(status.mode) ? " is-arcade" : ""}`}
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <rect
                          x="3"
                          y="3"
                          width="18"
                          height="18"
                          rx="4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        />
                        <rect x="8" y="10" width="2.4" height="2.4" rx="0.8" fill="currentColor" />
                        <rect x="13.6" y="10" width="2.4" height="2.4" rx="0.8" fill="currentColor" />
                        {status.mode !== "Not set" && status.mode !== "Offline" ? (
                          <path
                            d="M8 15.2c1 1.1 2.4 1.7 4 1.7s3-.6 4-1.7"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        ) : (
                          <path d="M8 16h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        )}
                      </svg>
                    </span>
                    <div className="pp-statusTextWrap">
                      <div className="pp-statusPrimary">
                        {status.note ? `${status.mode} · ${status.note}` : status.mode}
                      </div>
                      {status.updatedAtISO ? <div className="pp-statusSecondary">Updated {status.updatedRelative}</div> : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null
          ) : null}
        </div>
      </div>
      <div className="pp-divider" aria-hidden="true" />

      <div className="pp-avatarCenter">
        <div className="pp-avatarLg" data-tone={avatar.tone || "lime"} aria-hidden="true">
          {avatar.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="pp-avatarImg" src={avatar.image} alt="" decoding="async" loading="lazy" />
          ) : (
            <div className="pp-avatarInitialsLg">{avatar.initials}</div>
          )}
        </div>
      </div>

      <div className="pp-profileMeta">
        <div className="pp-profileNameRow">
          <div className="pp-profileNameWrap" style={{ minWidth: 0, flex: 1 }}>
            {editing ? (
              <input
                className="pp-field"
                value={formState.fullName}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFormState((current) => ({ ...current, fullName: value }));
                }}
                aria-label="Display name"
                placeholder="Display name"
                disabled={saveBusy}
              />
            ) : (
              <>
                <div className="pp-profileName">{cardState.fullName}</div>
                {isPremiumPlus ? (
                  <span
                    className="pp-profileVerifiedBadge"
                    role="img"
                    aria-label="Premium plus verified account"
                    title="Premium+ verified"
                  >
                    <svg
                      className="pp-profileVerifiedIcon"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="M4 8.35 6.5 10.8 12.05 5.2" />
                    </svg>
                  </span>
                ) : null}
              </>
            )}
          </div>
        </div>

        {!editing ? <div className="pp-profileHandle">@{cardState.username}</div> : null}

        {!isPublicContentHidden ? (
          editing ? (
            <div className="pp-profileBio">
              <div className="pp-profileBioLabel">Bio</div>
              <textarea
                className="pp-profileBioText pp-profileBioTextInput"
                value={formState.bio}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFormState((current) => ({ ...current, bio: value }));
                }}
                placeholder="Share what CavBot should know about you."
                aria-label="Bio"
                rows={4}
                disabled={saveBusy}
              />
            </div>
          ) : cardState.bio ? (
            <div className="pp-profileBio">
              <div className="pp-profileBioLabel">Bio</div>
              <div className="pp-profileBioText">{cardState.bio}</div>
            </div>
          ) : null
        ) : null}

        {!isPublicContentHidden ? (
          editing ? (
            <div className="pp-profileBio">
              <div className="pp-detail" role="note" aria-label="Workspace">
                <DetailIcon kind="workspace" />
                <input
                  className="pp-field"
                  value={formState.companyName}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setFormState((current) => ({ ...current, companyName: value }));
                  }}
                  placeholder="Workspace / Company"
                  aria-label="Workspace / Company"
                  disabled={saveBusy}
                />
              </div>
            </div>
          ) : cardState.companyName ? (
            <div className="pp-profileBio">
              <div className="pp-detail" role="note" aria-label="Workspace">
                <DetailIcon kind="workspace" />
                <div className="pp-profileBioText pp-profileBioTextInline">{cardState.companyName}</div>
              </div>
            </div>
          ) : null
        ) : null}
      </div>

      {!isPublicContentHidden ? (
        editing ? (
          <div className="pp-details" role="list" aria-label="Editable details">
            <div className="pp-detail" role="listitem">
              <DetailIcon kind="location" />
              <input
                className="pp-field"
                value={formState.region}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFormState((current) => ({ ...current, region: value }));
                }}
                placeholder="Region (City/State)"
                aria-label="Region"
                disabled={saveBusy}
              />
            </div>

            <div className="pp-detail" role="listitem">
              <DetailIcon kind="country" />
              <input
                className="pp-field"
                value={formState.country}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFormState((current) => ({ ...current, country: value }));
                }}
                placeholder="Country"
                aria-label="Country"
                disabled={saveBusy}
              />
            </div>

            <div className="pp-detail" role="listitem">
              <DetailIcon kind="email" />
              <input
                className="pp-field"
                value={cardState.email}
                placeholder="Email"
                disabled
                readOnly
                aria-label="Email"
              />
            </div>

            <div className="pp-detail" role="listitem">
              <DetailIcon kind="cavbot" />
              <input
                className="pp-field"
                value={canonicalProfileUrl || `https://app.cavbot.io/${encodeURIComponent(cardState.username)}`}
                disabled
                readOnly
                aria-label="CavBot profile"
              />
            </div>

            <div className="pp-detail" role="listitem">
              <DetailIcon kind="github" />
              <input
                className="pp-field"
                value={formState.githubUrl}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFormState((current) => ({ ...current, githubUrl: value }));
                }}
                placeholder="github.com/you"
                aria-label="GitHub"
                disabled={saveBusy}
              />
            </div>

            <div className="pp-detail" role="listitem">
              <DetailIcon kind="instagram" />
              <input
                className="pp-field"
                value={formState.instagramUrl}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFormState((current) => ({ ...current, instagramUrl: value }));
                }}
                placeholder="instagram.com/you"
                aria-label="Instagram"
                disabled={saveBusy}
              />
            </div>

            <div className="pp-detail" role="listitem">
              <DetailIcon kind="linkedin" />
              <input
                className="pp-field"
                value={formState.linkedinUrl}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFormState((current) => ({ ...current, linkedinUrl: value }));
                }}
                placeholder="linkedin.com/in/you"
                aria-label="LinkedIn"
                disabled={saveBusy}
              />
            </div>

            {formState.extraLinks.map((linkValue, index) => (
              <div className="pp-detail" role="listitem" key={`extra-link-${index}`}>
                <DetailIcon kind="link" />
                <input
                  className="pp-field"
                  value={linkValue}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    updateExtraLinkAt(index, value);
                  }}
                  placeholder={`Website ${index + 1}`}
                  aria-label={`Website ${index + 1}`}
                  disabled={saveBusy}
                />
              </div>
            ))}
          </div>
        ) : viewDetails.length ? (
          <div className="pp-details" role="list" aria-label="Details">
            {viewDetails.map((detail, index) => {
              const key = `${detail.kind}:${detail.value}:${index}`;
              const href = s(detail.href);
              const isExternal = /^https?:\/\//i.test(href);
              const inner = (
                <>
                  <DetailIcon kind={detail.kind} />
                  <span className="pp-detailText">{detail.value}</span>
                </>
              );
              return href ? (
                <a
                  key={key}
                  className="pp-detail pp-detailLink"
                  href={href}
                  role="listitem"
                  target={isExternal ? "_blank" : undefined}
                  rel={isExternal ? "noopener noreferrer" : undefined}
                >
                  {inner}
                </a>
              ) : (
                <div key={key} className="pp-detail" role="listitem">
                  {inner}
                </div>
              );
            })}
          </div>
        ) : null
      ) : null}

      {!isPrivateProfile ? (
        <PublicProfileTeamActionsClient
          username={username}
          displayName={displayName}
          isOwner={isOwner}
          showActionBar={!editing}
          editProfileHref={editProfileHref}
          canonicalProfileUrl={canonicalProfileUrl}
          initialTeamState={initialTeamState}
          initialMembers={initialMembers}
          onOwnerEditProfileToggle={isOwner ? toggleEditFromOwnerAction : undefined}
        />
      ) : null}

      {editing ? (
        <div className="pp-profileTeamActions pp-profileTeamActionsPage pp-profileEditActions" aria-label="Profile edit actions" data-has-emoji="0">
          <button type="button" className="pp-profileTeamBtn" onClick={cancelEditing} disabled={saveBusy}>
            Cancel
          </button>
          <button
            type="button"
            className="pp-profileTeamBtn pp-profileTeamBtnPrimary"
            onClick={() => void saveInlineProfile()}
            disabled={saveBusy}
          >
            Save
          </button>
        </div>
      ) : null}

      {loadError ? <div className="pp-modalError">{loadError}</div> : null}
      {saveError ? <div className="pp-modalError">{saveError}</div> : null}
    </div>
  );
}
