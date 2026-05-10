"use client";

import Image from "next/image";
import React from "react";
import { COUNTRY_NAME_BY_CODE } from "@/geo/countries";
import { CheckIcon, CopyIcon } from "@/components/CopyIcons";
import { LinkedInSquareIcon } from "@/components/icons/LinkedInSquareIcon";

const COUNTRY_TERRITORY_ISO = Array.from(COUNTRY_NAME_BY_CODE.entries())
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

type ToneKey = "lime" | "violet" | "blue" | "white" | "navy" | "transparent";

const LS_TONE = "cb_settings_avatar_tone_v2";
const LS_IMAGE = "cb_settings_avatar_image_v2";
const LS_FULL_NAME = "cb_profile_fullName_v1";
const LS_EMAIL = "cb_profile_email_v1";
const LS_USERNAME = "cb_profile_username_v1";
const LS_BIO = "cb_profile_bio_v1";
const LS_COUNTRY = "cb_profile_country_v1";
const LS_REGION = "cb_profile_region_v1";
const LS_TIME_ZONE = "cb_profile_time_zone_v1";
const LS_COMPANY_NAME = "cb_profile_company_name_v1";
const LS_COMPANY_CATEGORY = "cb_profile_company_category_v1";
const LS_COMPANY_SUBCATEGORY = "cb_profile_company_subcategory_v1";
const LS_GITHUB_URL = "cb_profile_github_url_v1";
const LS_INSTAGRAM_URL = "cb_profile_instagram_url_v1";
const LS_LINKEDIN_URL = "cb_profile_linkedin_url_v1";
const LS_CUSTOM_LINK_URL = "cb_profile_custom_link_url_v1";
const LS_PROFILE_REV = "cb_profile_rev_v1";
const LS_PROFILE_PUBLIC_ENABLED = "cb_profile_public_enabled_v1";
const LS_INITIALS = "cb_account_initials";

function persistProfileInitials(value: string) {
  try {
    if (value) {
      globalThis.__cbLocalStore.setItem(LS_INITIALS, value);
    } else {
      globalThis.__cbLocalStore.removeItem(LS_INITIALS);
    }
  } catch {}
}

function writeProfileCache(profile: Record<string, unknown>) {
  const set = (key: string, value: unknown) => {
    globalThis.__cbLocalStore.setItem(key, String(value ?? ""));
  };
  try {
    set(LS_FULL_NAME, profile.fullName);
    set(LS_EMAIL, profile.email);
    set(LS_USERNAME, String(profile.username || "").trim().toLowerCase());
    set(LS_BIO, profile.bio);
    set(LS_COUNTRY, profile.country);
    set(LS_REGION, profile.region);
    set(LS_TIME_ZONE, profile.timeZone);
    set(LS_COMPANY_NAME, profile.companyName);
    set(LS_COMPANY_CATEGORY, profile.companyCategory);
    set(LS_COMPANY_SUBCATEGORY, profile.companySubcategory);
    set(LS_GITHUB_URL, profile.githubUrl);
    set(LS_INSTAGRAM_URL, profile.instagramUrl);
    set(LS_LINKEDIN_URL, profile.linkedinUrl);
    set(LS_CUSTOM_LINK_URL, profile.customLinkUrl);
    set(
      LS_PROFILE_PUBLIC_ENABLED,
      typeof profile.publicProfileEnabled === "boolean" && profile.publicProfileEnabled ? "1" : "0"
    );
    set(LS_TONE, profile.avatarTone || "lime");
    const avatar = String(profile.avatarImage || "");
    if (avatar) globalThis.__cbLocalStore.setItem(LS_IMAGE, avatar);
    else globalThis.__cbLocalStore.removeItem(LS_IMAGE);
    set(LS_PROFILE_REV, Date.now());
  } catch {}
}

function broadcastProfileSync() {
  try {
    window.dispatchEvent(new CustomEvent("cb:profile-sync"));
  } catch {}
}

const CATEGORY_ACCENTS: Record<string, string> = {
  product_tech: "var(--sx-tone-blue)",
  creative: "var(--sx-tone-violet)",
  finance_investment: "var(--sx-tone-lime)",
  consumer: "rgba(255,255,255,0.78)",
  services: "rgba(234,240,255,0.78)",
  health_science: "var(--sx-tone-lime)",
  education: "rgba(255,255,255,0.78)",
  impact: "rgba(255,255,255,0.78)",
  operations: "rgba(255,255,255,0.78)",
  personal: "var(--sx-tone-blue)",
  manufacturing: "rgba(255,255,255,0.78)",
  media_entertainment: "var(--sx-tone-violet)",
  government: "var(--sx-tone-blue)",
  events: "rgba(255,255,255,0.78)",
  sports: "var(--sx-tone-lime)",
  agriculture: "rgba(255,255,255,0.78)",
  transport: "rgba(255,255,255,0.78)",
  analytics: "var(--sx-tone-blue)",
  security: "var(--sx-tone-violet)",
};

const WORKSPACE_CATEGORIES = [
  {
    value: "product_tech",
    label: "Product & Tech",
    subcategories: [
      "Software company",
      "SaaS platform",
      "Developer tooling",
      "Engineering studio",
      "AI research lab",
      "Hardware lab",
      "Security & observability",
      "Mobility & transportation",
      "Electric mobility",
      "Cloud infrastructure",
      "Marketplace engine",
      "Web architecture",
      "Platform engineering",
      "Software engineer",
      "Software developer",
      "Web developer",
      "Systems engineering",
      "Edge computing",
      "Augmented intelligence",
      "Digital twins",
      "DevOps enablement",
      "API platform",
      "Quantum computing",
    ],
  },
  {
    value: "creative",
    label: "Creative Studio",
    subcategories: [
      "Design atelier",
      "Brand strategy",
      "Digital artist",
      "Content studio",
      "Music & audio",
      "Motion / film",
      "Immersive XR",
      "Spatial experience",
      "Creative production",
      "Editorial design",
      "Experiential design",
      "Creative direction",
      "Typography lab",
      "Portfolio artist",
      "Graphic designer",
      "Creative strategist",
      "Photography collective",
      "Videographer",
      "Interface design",
      "Motion artist",
    ],
  },
  {
    value: "finance_investment",
    label: "Finance & Investment",
    subcategories: [
      "Venture capital",
      "Private equity",
      "Angel investing",
      "Investment firm",
      "Fintech innovation",
      "Treasury / risk",
      "Crypto or web3 fund",
      "Banking operations",
      "Impact investment",
      "Family office",
      "Investor relations",
      "Corporate finance",
      "Financial analytics",
    ],
  },
  {
    value: "consumer",
    label: "Retail & Hospitality",
    subcategories: [
      "Clothing brand",
      "Footwear label",
      "Luxury goods",
      "Food & beverage",
      "Wellness studio",
      "Bakery / café",
      "Hospitality group",
      "Travel experience",
      "Home goods",
      "Luxury hospitality",
      "Bespoke retail",
      "Pop-up retail",
      "Direct-to-consumer",
      "Experiential dining",
      "Cannabis retail",
      "Cannabis wellness",
    ],
  },
  {
    value: "services",
    label: "Services & Consulting",
    subcategories: [
      "CX & operations",
      "Business consultancy",
      "Legal counsel",
      "Accounting",
      "Recruiting",
      "Training & enablement",
      "Creative coaching",
      "People productivity",
      "Freight & logistics advice",
      "Innovation workshops",
      "Strategy practice",
      "Digital transformation",
      "Analytics consulting",
      "SEO specialist",
      "CRM strategy",
    ],
  },
  {
    value: "health_science",
    label: "Health & Science",
    subcategories: [
      "Biotech lab",
      "Medical device",
      "Health platform",
      "Clinical research",
      "Wellness science",
      "Therapy studio",
      "Precision health",
      "Medtech innovation",
      "Health data science",
      "Clinical AI",
      "Health analytics",
      "Behavioral health",
    ],
  },
  {
    value: "education",
    label: "Education & Learning",
    subcategories: [
      "eLearning platform",
      "Edtech product",
      "Research lab",
      "Professional bootcamp",
      "University program",
      "Tutoring collective",
      "Learning research",
      "Executive education",
      "Learning ops",
      "Education strategist",
      "Research partnerships",
    ],
  },
  {
    value: "impact",
    label: "Social Impact",
    subcategories: [
      "Non-profit lab",
      "Public policy",
      "Community venture",
      "Sustainability practice",
      "Global development",
      "Climate tech",
      "Civic tech",
      "Cultural programs",
      "Policy lab",
      "Non-profit venture studio",
      "Impact measurement",
      "Community engagement",
    ],
  },
  {
    value: "operations",
    label: "Operations & Infrastructure",
    subcategories: [
      "Managed services",
      "Platform ops",
      "Logistics",
      "Facilities & real estate",
      "Security ops",
      "Field operations",
      "Supply chain",
      "Smart cities",
      "Utilities operations",
      "Facilities innovation",
      "Analytics operations",
      "Security consulting",
      "Compliance programs",
    ],
  },
  {
    value: "personal",
    label: "Personal Studio",
    subcategories: [
      "Freelance web developer",
      "Author / writer",
      "Artist",
      "Podcast host",
      "Content creator",
      "Athlete / coach",
      "Creative founder",
      "Solopreneur",
      "Digital nomad",
      "Personal brand",
      "Executive coach",
      "Life architect",
      "Influencer",
      "Digital strategist",
      "Analytics specialist",
      "Portfolio curator",
      "SEO specialist",
    ],
  },
  {
    value: "manufacturing",
    label: "Production & Manufacturing",
    subcategories: [
      "Advanced fabrication",
      "Robotics lab",
      "Materials science",
      "Consumer hardware",
      "Industrial design",
      "Sustainable manufacturing",
      "Production automation",
      "Supply chain R&D",
      "Rapid prototyping",
    ],
  },
  {
    value: "media_entertainment",
    label: "Media & Entertainment",
    subcategories: [
      "Broadcast studio",
      "Gaming lab",
      "Animation studio",
      "Film production",
      "Magazine / editorial",
      "Live events",
      "Influencer collective",
      "Streaming network",
      "Podcast network",
      "Documentary house",
    ],
  },
  {
    value: "government",
    label: "Government & Civic",
    subcategories: [
      "Defensive workshops",
      "Municipal services",
      "Civic innovation",
      "Urban planning",
      "Policy operations",
      "Public data",
      "Regulatory operations",
      "Public infrastructure",
    ],
  },
  {
    value: "events",
    label: "Events & Experiential",
    subcategories: [
      "Conference production",
      "Festival design",
      "Trade events",
      "Live experience",
      "Hybrid broadcast",
      "Activations agency",
      "Immersive events",
      "Public showrooms",
    ],
  },
  {
    value: "sports",
    label: "Sports & Esports",
    subcategories: [
      "Athlete management",
      "Sports tech",
      "Training facility",
      "Collective performance",
      "Esports team",
      "Wellness coaching",
      "Youth development",
      "High performance lab",
    ],
  },
  {
    value: "agriculture",
    label: "Agriculture & Food Science",
    subcategories: [
      "Agri-tech",
      "Precision farming",
      "Food science lab",
      "Vertical farming",
      "Supply innovation",
      "Sustainable food",
      "Plant genetics",
      "Farm-to-table",
    ],
  },
  {
    value: "transport",
    label: "Transport & Mobility",
    subcategories: [
      "Smart mobility",
      "Logistics tech",
      "Transit lab",
      "Aerospace R&D",
      "Marine mobility",
      "Delivery robotics",
      "Autonomous vehicles",
      "Fleet analytics",
    ],
  },
  {
    value: "analytics",
    label: "Analytics & Research",
    subcategories: [
      "Product analytics",
      "Data science lab",
      "Observability research",
      "Insights studio",
      "Quantitative psychology",
      "Behavioral analytics",
      "Market intelligence",
    ],
  },
  {
    value: "security",
    label: "Security & Trust",
    subcategories: [
      "Security firm",
      "Cyber threat lab",
      "Intelligence analytics",
      "Risk advisory",
      "Compliance studio",
      "Public safety tech",
      "Forensic engineering",
      "Physical security",
    ],
  },
];

function UploadImageIcon() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 24,
        height: 24,
        backgroundColor: "currentColor",
        WebkitMaskImage: 'url("/icons/app/image-upload-svgrepo-com.svg")',
        maskImage: 'url("/icons/app/image-upload-svgrepo-com.svg")',
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}

const COMPANY_SUBCATEGORIES_BY_CATEGORY = Object.fromEntries(
  WORKSPACE_CATEGORIES.map(({ value, subcategories }) => [value, subcategories])
);

const MAX_AVATAR_IMAGE_BYTES = 2 * 1024 * 1024;
const AVATAR_CANVAS_MAX_PX = 512;

function dataUrlByteLength(dataUrl: string) {
  const marker = "base64,";
  const idx = dataUrl.indexOf(marker);
  if (idx === -1) return dataUrl.length;
  const payload = dataUrl.slice(idx + marker.length);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.ceil((payload.length * 3) / 4) - padding;
}

function readFileAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("read_failed"));
    r.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = dataUrl;
  });
}

async function prepareAvatarDataUrl(file: File) {
  if (!file.type || !file.type.startsWith("image/")) {
    throw new Error("invalid_type");
  }

  const original = await readFileAsDataURL(file);
  if (dataUrlByteLength(original) <= MAX_AVATAR_IMAGE_BYTES) return original;

  const image = await loadImageElement(original);
  const largestSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height, 1);
  const scale = Math.min(1, AVATAR_CANVAS_MAX_PX / largestSide);
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54]) {
    const compressed = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlByteLength(compressed) <= MAX_AVATAR_IMAGE_BYTES) return compressed;
  }

  throw new Error("too_large");
}

function toneToCss(t: ToneKey) {
  if (t === "violet") {
    return "linear-gradient(145deg, rgba(186,154,255,0.36), rgba(143,103,236,0.30) 56%, rgba(121,86,220,0.24))";
  }
  if (t === "blue") {
    return "linear-gradient(145deg, rgba(140,206,255,0.36), rgba(96,167,243,0.30) 56%, rgba(74,142,232,0.24))";
  }
  if (t === "white") {
    return "linear-gradient(145deg, rgba(255,255,255,0.94), rgba(236,243,255,0.88) 58%, rgba(208,222,244,0.74))";
  }
  if (t === "navy") {
    return "linear-gradient(145deg, rgba(44,67,118,0.68), rgba(28,49,93,0.62) 56%, rgba(21,37,76,0.58))";
  }
  if (t === "transparent") return "transparent";
  return "linear-gradient(145deg, rgba(232,252,150,0.56), rgba(203,238,99,0.48) 56%, rgba(182,222,78,0.42))";
}

function firstInitialChar(input: string) {
  const hit = String(input || "").match(/[A-Za-z0-9]/);
  return hit?.[0]?.toUpperCase() || "";
}

function computeInitials(fullName: string, username: string) {
  const n = String(fullName || "").trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const a = firstInitialChar(parts[0] || "");
      const b = firstInitialChar(parts[1] || "");
      const duo = `${a}${b}`.trim();
      if (duo) return duo;
    }
    const single = firstInitialChar(parts[0] || "");
    if (single) return single;
  }

  const u = String(username || "").trim().replace(/^@+/, "");
  const userInitial = firstInitialChar(u);
  if (userInitial) return userInitial;
  return "C";
}

type ProfileDTO = {
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

  // Public profile (privacy-first)
  publicProfileEnabled?: boolean | null;
  publicShowReadme?: boolean | null;
  publicShowWorkspaceSnapshot?: boolean | null;
  publicShowHealthOverview?: boolean | null;
  publicShowCapabilities?: boolean | null;
  publicShowArtifacts?: boolean | null;
  publicShowPlanTier?: boolean | null;
  publicShowBio?: boolean | null;
  publicShowIdentityLinks?: boolean | null;
  publicShowIdentityLocation?: boolean | null;
  publicShowIdentityEmail?: boolean | null;
  publicWorkspaceId?: string | null;
};

type AccountResponse = {
  ok?: boolean;
  message?: string;
  profile?: ProfileDTO;
};

export default function AccountOverviewClient() {
  const MAX_CUSTOM_LINKS = 6;
  const [tone, setTone] = React.useState<ToneKey>("lime");
  const [avatarImage, setAvatarImage] = React.useState<string>("");
  const [dragOn, setDragOn] = React.useState(false);

  const [bio, setBio] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [region, setRegion] = React.useState("");
  const [timeZone, setTimeZone] = React.useState("America/Los_Angeles");
  const [companyName, setCompanyName] = React.useState("");
  const [companyCategory, setCompanyCategory] = React.useState("");
  const [companySubcategory, setCompanySubcategory] = React.useState("");
  const [githubUrl, setGithubUrl] = React.useState("");
  const [instagramUrl, setInstagramUrl] = React.useState("");
  const [linkedinUrl, setLinkedinUrl] = React.useState("");
  const [customLinkUrls, setCustomLinkUrls] = React.useState<string[]>([]);
  const [publicProfileEnabled, setPublicProfileEnabled] = React.useState(true);
  const [publicShowReadme, setPublicShowReadme] = React.useState(true);
  const [publicShowWorkspaceSnapshot, setPublicShowWorkspaceSnapshot] = React.useState(true);
  const [publicShowHealthOverview, setPublicShowHealthOverview] = React.useState(true);
  const [publicShowCapabilities, setPublicShowCapabilities] = React.useState(true);
  const [publicShowArtifacts, setPublicShowArtifacts] = React.useState(true);
  const [publicShowPlanTier, setPublicShowPlanTier] = React.useState(true);
  const [publicShowBio, setPublicShowBio] = React.useState(true);
  const [publicShowIdentityLinks, setPublicShowIdentityLinks] = React.useState(true);
  const [publicShowIdentityLocation, setPublicShowIdentityLocation] = React.useState(true);
  const [publicShowIdentityEmail, setPublicShowIdentityEmail] = React.useState(false);
  const [publicProfileConfigOpen, setPublicProfileConfigOpen] = React.useState(false);
  const [cavbotCopied, setCavbotCopied] = React.useState(false);
  const cavbotCopyTimer = React.useRef<number | null>(null);

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string>("");
  const [saved, setSaved] = React.useState(false);

  const [snapshot, setSnapshot] = React.useState<ProfileDTO | null>(null);

  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const [addWebsiteOpen, setAddWebsiteOpen] = React.useState(false);
  const [addWebsiteValue, setAddWebsiteValue] = React.useState("");
  const [addWebsiteErr, setAddWebsiteErr] = React.useState("");
  const addWebsiteInputRef = React.useRef<HTMLInputElement | null>(null);

  const coerceLinkFromServer = (p: ProfileDTO): string | undefined => {
    // If the API/DB doesn't have the column yet, don't overwrite the user's input.
    if (!("customLinkUrl" in (p as unknown as Record<string, unknown>))) return undefined;
    const raw = (p as { customLinkUrl?: unknown }).customLinkUrl;
    if (raw === null) return "";
    if (typeof raw === "string") return raw;
    return "";
  };

  const decodeCustomLinkUrls = React.useCallback(
    (raw: unknown): string[] => {
      const s = String(raw ?? "").trim();
      if (!s) return [];
      try {
        if (s.startsWith("[")) {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) {
            const out = parsed
              .map((x) => String(x ?? "").trim())
              .filter(Boolean);
            return Array.from(new Set(out)).slice(0, MAX_CUSTOM_LINKS);
          }
        }
      } catch {}
      return [s];
    },
    [MAX_CUSTOM_LINKS]
  );

  const encodeCustomLinkUrls = React.useCallback((list: string[]): string => {
    const out = Array.from(new Set((list || []).map((x) => String(x || "").trim()).filter(Boolean))).slice(
      0,
      MAX_CUSTOM_LINKS
    );
    if (!out.length) return "";
    if (out.length === 1) return out[0]!;
    return JSON.stringify(out);
  }, [MAX_CUSTOM_LINKS]);

  const customLinksEncoded = React.useMemo(() => encodeCustomLinkUrls(customLinkUrls), [customLinkUrls, encodeCustomLinkUrls]);
  const customLinksKey = React.useMemo(() => customLinkUrls.join("\n"), [customLinkUrls]);

  const removeWebsiteAt = (idx: number) => {
    setCustomLinkUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const openAddWebsite = React.useCallback(() => {
    setAddWebsiteErr("");
    setAddWebsiteValue("");
    setAddWebsiteOpen(true);
  }, []);

  const closeAddWebsite = React.useCallback(() => {
    setAddWebsiteOpen(false);
    setAddWebsiteErr("");
    setAddWebsiteValue("");
  }, []);

  const confirmAddWebsite = React.useCallback(() => {
    const raw = String(addWebsiteValue || "").trim();
    if (!raw) {
      setAddWebsiteErr("Enter a valid URL.");
      return;
    }
    if (customLinkUrls.length >= MAX_CUSTOM_LINKS) {
      setAddWebsiteErr(`Limit reached (${MAX_CUSTOM_LINKS}).`);
      return;
    }
    setCustomLinkUrls((prev) => {
      const next = Array.from(new Set([...prev, raw].map((x) => String(x || "").trim()).filter(Boolean))).slice(
        0,
        MAX_CUSTOM_LINKS
      );
      return next;
    });
    closeAddWebsite();
  }, [MAX_CUSTOM_LINKS, addWebsiteValue, closeAddWebsite, customLinkUrls.length]);

  React.useEffect(() => {
    if (!addWebsiteOpen) return;
    const t = window.setTimeout(() => {
      try {
        addWebsiteInputRef.current?.focus();
      } catch {}
    }, 0);

    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeAddWebsite();
      }
      if (ev.key === "Enter") {
        // Avoid accidental submits if the user is not focused inside the modal input.
        const el = document.activeElement;
        if (el && addWebsiteInputRef.current && el === addWebsiteInputRef.current) {
          ev.preventDefault();
          confirmAddWebsite();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(t);
    };
  }, [addWebsiteOpen, closeAddWebsite, confirmAddWebsite]);

		  // Load from server (source of truth)
		  React.useEffect(() => {
	    let alive = true;
	    const ctrl = new AbortController();

	    // Fast paint from globalThis.__cbLocalStore (server will override when available).
        try {
          const v = (globalThis.__cbLocalStore.getItem(LS_FULL_NAME) || "").trim();
          if (v) setFullName(v);
        } catch {}
        try {
          const v = (globalThis.__cbLocalStore.getItem(LS_EMAIL) || "").trim();
          if (v) setEmail(v);
        } catch {}
		    try {
		      const u = (globalThis.__cbLocalStore.getItem(LS_USERNAME) || "").trim().toLowerCase();
		      if (u) setUsername(u);
		    } catch {}
        try {
          const v = (globalThis.__cbLocalStore.getItem(LS_BIO) || "").trim();
          if (v) setBio(v);
        } catch {}
        try {
          const v = (globalThis.__cbLocalStore.getItem(LS_COUNTRY) || "").trim();
          if (v) setCountry(v);
        } catch {}
        try {
          const v = (globalThis.__cbLocalStore.getItem(LS_REGION) || "").trim();
          if (v) setRegion(v);
        } catch {}
        try {
          const v = (globalThis.__cbLocalStore.getItem(LS_TIME_ZONE) || "").trim();
          if (v) setTimeZone(v);
        } catch {}
        try {
          const v = (globalThis.__cbLocalStore.getItem(LS_COMPANY_NAME) || "").trim();
          if (v) setCompanyName(v);
        } catch {}
        try {
          const v = (globalThis.__cbLocalStore.getItem(LS_COMPANY_CATEGORY) || "").trim();
          if (v) setCompanyCategory(v);
        } catch {}
        try {
          const v = (globalThis.__cbLocalStore.getItem(LS_COMPANY_SUBCATEGORY) || "").trim();
          if (v) setCompanySubcategory(v);
        } catch {}
	    try {
	      const cachedTone = (globalThis.__cbLocalStore.getItem(LS_TONE) || "").trim() as ToneKey;
	      if (cachedTone) setTone(cachedTone);
	    } catch {}
	    try {
	      const cachedAvatar = (globalThis.__cbLocalStore.getItem(LS_IMAGE) || "").trim();
	      if (cachedAvatar) setAvatarImage(cachedAvatar);
	    } catch {}
	    try {
	      const v = (globalThis.__cbLocalStore.getItem(LS_CUSTOM_LINK_URL) || "").trim();
	      if (v) setCustomLinkUrls(decodeCustomLinkUrls(v));
	    } catch {}

	    (async () => {
	      try {
        setErr("");

        const res = await fetch("/api/settings/account", {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
          credentials: "include",
        });

        const json = (await res.json().catch(() => null)) as AccountResponse | null;
        if (!alive) return;

        const data = json ?? ({} as AccountResponse);

        if (!res.ok || !data?.ok) {
          setErr(data?.message || "Failed to load profile.");

          const baseline: ProfileDTO = {
            email: "",
            username: "",
            fullName: "",
            bio: "",
            country: "",
            region: "",
            timeZone: "America/Los_Angeles",
            avatarTone: "lime",
            avatarImage: "",
            companyName: "",
            companyCategory: "",
            companySubcategory: "",
            githubUrl: "",
            instagramUrl: "",
            linkedinUrl: "",
            customLinkUrl: "",
            publicProfileEnabled: true,
            publicShowReadme: true,
            publicShowWorkspaceSnapshot: true,
            publicShowHealthOverview: true,
            publicShowCapabilities: true,
            publicShowArtifacts: true,
            publicShowPlanTier: true,
            publicShowBio: true,
            publicShowIdentityLinks: true,
            publicShowIdentityLocation: true,
            publicShowIdentityEmail: false,
            publicWorkspaceId: null,
          };

          setSnapshot(baseline);
          setLoading(false);
          return;
        }

        const p: ProfileDTO =
          data.profile || {
            email: "",
            username: "",
            fullName: "",
            bio: "",
            country: "",
            region: "",
            timeZone: "America/Los_Angeles",
            avatarTone: "lime",
            avatarImage: "",
            companyName: "",
            companyCategory: "",
            companySubcategory: "",
            githubUrl: "",
            instagramUrl: "",
            linkedinUrl: "",
            customLinkUrl: "",
            publicProfileEnabled: true,
            publicShowReadme: true,
            publicShowWorkspaceSnapshot: true,
            publicShowHealthOverview: true,
            publicShowCapabilities: true,
            publicShowArtifacts: true,
            publicShowPlanTier: true,
            publicShowBio: true,
            publicShowIdentityLinks: true,
            publicShowIdentityLocation: true,
            publicShowIdentityEmail: false,
            publicWorkspaceId: null,
          };

        // Apply server -> UI
        setFullName(String(p.fullName || ""));
        setEmail(String(p.email || ""));
        const serverUsername = String(p.username || "").trim().toLowerCase();
        if (serverUsername) {
          setUsername(serverUsername);
        } else {
          // Recovery path: if server username is missing, keep any cached username so the user can re-save it.
          try {
            const cached = (globalThis.__cbLocalStore.getItem(LS_USERNAME) || "").trim().toLowerCase();
            if (cached) setUsername(cached);
          } catch {}
        }
        setBio(String(p.bio || ""));
        setCountry(String(p.country || ""));
        setRegion(String(p.region || ""));
        setTimeZone(String(p.timeZone || "America/Los_Angeles"));
        setCompanyName(String(p.companyName || ""));
        setCompanyCategory(String(p.companyCategory || ""));
        setCompanySubcategory(String(p.companySubcategory || ""));
        setGithubUrl(String(p.githubUrl || ""));
        setInstagramUrl(String(p.instagramUrl || ""));
        setLinkedinUrl(String(p.linkedinUrl || ""));
        {
          const v = coerceLinkFromServer(p);
          if (typeof v === "string") setCustomLinkUrls(decodeCustomLinkUrls(v));
        }
        if (typeof p.publicProfileEnabled === "boolean") setPublicProfileEnabled(p.publicProfileEnabled);
        if (typeof p.publicShowReadme === "boolean") setPublicShowReadme(p.publicShowReadme);
        if (typeof p.publicShowWorkspaceSnapshot === "boolean") setPublicShowWorkspaceSnapshot(p.publicShowWorkspaceSnapshot);
        if (typeof p.publicShowHealthOverview === "boolean") setPublicShowHealthOverview(p.publicShowHealthOverview);
        if (typeof p.publicShowCapabilities === "boolean") setPublicShowCapabilities(p.publicShowCapabilities);
        if (typeof p.publicShowArtifacts === "boolean") setPublicShowArtifacts(p.publicShowArtifacts);
        if (typeof p.publicShowPlanTier === "boolean") setPublicShowPlanTier(p.publicShowPlanTier);
        if (typeof p.publicShowBio === "boolean") setPublicShowBio(p.publicShowBio);
        if (typeof p.publicShowIdentityLinks === "boolean") setPublicShowIdentityLinks(p.publicShowIdentityLinks);
        if (typeof p.publicShowIdentityLocation === "boolean") setPublicShowIdentityLocation(p.publicShowIdentityLocation);
        if (typeof p.publicShowIdentityEmail === "boolean") setPublicShowIdentityEmail(p.publicShowIdentityEmail);

        const serverTone = (String(p.avatarTone || "").trim() as ToneKey) || "lime";
        const serverImg = String(p.avatarImage || "");

        // prefer server for real launch behavior
        setTone(serverTone);
        setAvatarImage(serverImg);

        // snapshot for Reset
		        setSnapshot({
		          email: String(p.email || ""),
		          username: String(p.username || ""),
		          fullName: p.fullName || "",
	          bio: p.bio || "",
	          country: p.country || "",
	          region: p.region || "",
	          timeZone: p.timeZone || "America/Los_Angeles",
	          avatarTone: String(p.avatarTone || "lime"),
	          avatarImage: String(p.avatarImage || ""),
	          companyName: p.companyName || "",
	          companyCategory: p.companyCategory || "",
		          companySubcategory: p.companySubcategory || "",
		          githubUrl: p.githubUrl || "",
		          instagramUrl: p.instagramUrl || "",
		          linkedinUrl: p.linkedinUrl || "",
		              customLinkUrl: (() => {
                  const v = coerceLinkFromServer(p);
                  return typeof v === "string" ? v : "";
                })(),
		          publicProfileEnabled: typeof p.publicProfileEnabled === "boolean" ? p.publicProfileEnabled : true,
              publicShowReadme: typeof p.publicShowReadme === "boolean" ? p.publicShowReadme : true,
		          publicShowWorkspaceSnapshot:
                typeof p.publicShowWorkspaceSnapshot === "boolean" ? p.publicShowWorkspaceSnapshot : true,
		          publicShowHealthOverview:
                typeof p.publicShowHealthOverview === "boolean" ? p.publicShowHealthOverview : true,
	          publicShowCapabilities:
                typeof p.publicShowCapabilities === "boolean" ? p.publicShowCapabilities : true,
          publicShowArtifacts:
                typeof p.publicShowArtifacts === "boolean" ? p.publicShowArtifacts : true,
          publicShowPlanTier:
                typeof p.publicShowPlanTier === "boolean" ? p.publicShowPlanTier : true,
          publicShowBio: typeof p.publicShowBio === "boolean" ? p.publicShowBio : true,
          publicShowIdentityLinks:
                typeof p.publicShowIdentityLinks === "boolean" ? p.publicShowIdentityLinks : true,
          publicShowIdentityLocation:
                typeof p.publicShowIdentityLocation === "boolean" ? p.publicShowIdentityLocation : true,
          publicShowIdentityEmail:
                typeof p.publicShowIdentityEmail === "boolean" ? p.publicShowIdentityEmail : false,
          publicWorkspaceId: p.publicWorkspaceId ? String(p.publicWorkspaceId) : null,
        });

        // Keep local storage in sync (fast paint on other pages)
        try {
          writeProfileCache({
            ...p,
            avatarTone: serverTone,
            avatarImage: serverImg,
            customLinkUrl: coerceLinkFromServer(p) ?? "",
          });
          globalThis.__cbLocalStore.setItem(LS_TONE, serverTone);
          if (serverUsername) globalThis.__cbLocalStore.setItem(LS_USERNAME, serverUsername);
		          globalThis.__cbLocalStore.setItem(LS_COMPANY_SUBCATEGORY, String(p.companySubcategory || ""));
		          globalThis.__cbLocalStore.setItem(LS_GITHUB_URL, String(p.githubUrl || ""));
          globalThis.__cbLocalStore.setItem(LS_INSTAGRAM_URL, String(p.instagramUrl || ""));
          globalThis.__cbLocalStore.setItem(LS_LINKEDIN_URL, String(p.linkedinUrl || ""));
          globalThis.__cbLocalStore.setItem(
            LS_PROFILE_PUBLIC_ENABLED,
            typeof p.publicProfileEnabled === "boolean" && p.publicProfileEnabled ? "1" : "0"
          );
              {
                  const v = coerceLinkFromServer(p);
                  if (typeof v === "string") globalThis.__cbLocalStore.setItem(LS_CUSTOM_LINK_URL, v);
                }
		          if (serverImg) globalThis.__cbLocalStore.setItem(LS_IMAGE, serverImg);
          else globalThis.__cbLocalStore.removeItem(LS_IMAGE);
		        } catch {}

        // Publish to AppShell instantly
        const nextInitials = computeInitials(String(p.fullName || ""), String(p.username || ""));
        persistProfileInitials(nextInitials);

        window.dispatchEvent(
          new CustomEvent("cb:profile", {
	            detail: {
	              tone: serverTone,
              avatarImage: serverImg || null,
              initials: nextInitials,
              fullName: String(p.fullName || ""),
              email: String(p.email || ""),
              username: String(p.username || "").trim(),
              bio: String(p.bio || ""),
              country: String(p.country || ""),
              region: String(p.region || ""),
              timeZone: String(p.timeZone || ""),
              companyName: String(p.companyName || ""),
              companyCategory: String(p.companyCategory || ""),
              companySubcategory: String(p.companySubcategory || ""),
              githubUrl: String(p.githubUrl || ""),
              instagramUrl: String(p.instagramUrl || ""),
              linkedinUrl: String(p.linkedinUrl || ""),
              customLinkUrl: coerceLinkFromServer(p) ?? "",
              publicProfileEnabled: typeof p.publicProfileEnabled === "boolean" ? p.publicProfileEnabled : true,
            },
          })
        );
        broadcastProfileSync();

        setLoading(false);
      } catch {
        if (!alive) return;
        setErr("Failed to load profile.");
        setLoading(false);
      }
    })();

	    return () => {
	      alive = false;
	      try {
	        ctrl.abort();
	      } catch {}
	    };
	  }, [decodeCustomLinkUrls]);

  const onUpload = async (file?: File | null) => {
  if (!file) return;

  try {
    const data = await prepareAvatarDataUrl(file);

    // Preview ONLY (do NOT write LS yet)
    setAvatarImage(data);
  } catch {
    alert("Upload failed. Please try a PNG/JPG/WEBP/AVIF image.");
  }
};


 const removePhoto = () => {
  // Preview ONLY (do NOT remove LS yet)
  setAvatarImage("");
};


  const openPicker = () => {
    fileRef.current?.click();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOn(false);
    const f = e.dataTransfer.files?.[0];
    onUpload(f);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragOn) setDragOn(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOn(false);
  };

const handleCategoryChange = (value: string) => {
  setCompanyCategory(value);
  if (!value) {
    setCompanySubcategory("");
    return;
  }
  setCompanySubcategory("");
};

  const activeCss = toneToCss(tone);
  const bioCount = Math.min(300, (bio || "").length);
  const previewInitials = computeInitials(fullName, username);
  const previewInitialsText = previewInitials ? previewInitials.trim() : "";
  const selectedCategory = React.useMemo(
    () => WORKSPACE_CATEGORIES.find((cat) => cat.value === companyCategory),
    [companyCategory]
  );
  const categoryAccent = companyCategory ? CATEGORY_ACCENTS[companyCategory] ?? "rgba(255,255,255,0.72)" : "";
  const availableSubcategories = companyCategory
    ? COMPANY_SUBCATEGORIES_BY_CATEGORY[companyCategory] ?? []
    : [];
  const categoryLabel =
    WORKSPACE_CATEGORIES.find((cat) => cat.value === companyCategory)?.label || "";

  const cavbotProfileUrl = React.useMemo(() => {
    const u = String(username || "").trim().toLowerCase();
    return u ? `app.cavbot.io/${u}` : "app.cavbot.io/<username>";
  }, [username]);

  const cavbotProfileUrlForCopy = React.useMemo(() => {
    const u = String(username || "").trim().toLowerCase();
    return u ? `https://app.cavbot.io/${u}` : "";
  }, [username]);

  const copyCavbotProfileUrl = React.useCallback(async () => {
    const value = cavbotProfileUrlForCopy;
    if (!value) return;

    const markCopied = () => {
      setCavbotCopied(true);
      if (cavbotCopyTimer.current) window.clearTimeout(cavbotCopyTimer.current);
      cavbotCopyTimer.current = window.setTimeout(() => {
        setCavbotCopied(false);
        cavbotCopyTimer.current = null;
      }, 1600);
    };

    try {
      await navigator.clipboard.writeText(value);
      markCopied();
      return;
    } catch {}

    // Fallback for older/locked-down clipboard environments.
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) markCopied();
    } catch {}
  }, [cavbotProfileUrlForCopy]);

  React.useEffect(() => {
    return () => {
      if (cavbotCopyTimer.current) window.clearTimeout(cavbotCopyTimer.current);
    };
  }, []);

  const hasChanges = React.useMemo(() => {
    if (!snapshot) return false;
    return (
      (snapshot.fullName || "") !== fullName ||
      (snapshot.email || "") !== email ||
      (snapshot.username || "") !== username ||
      (snapshot.bio || "") !== bio ||
      (snapshot.country || "") !== country ||
      (snapshot.region || "") !== region ||
      (snapshot.timeZone || "") !== timeZone ||
      (snapshot.avatarTone || "lime") !== tone ||
      (snapshot.avatarImage || "") !== avatarImage ||
	      (snapshot.companyName || "") !== companyName ||
	      (snapshot.companyCategory || "") !== companyCategory ||
	      (snapshot.companySubcategory || "") !== companySubcategory ||
		      (snapshot.githubUrl || "") !== githubUrl ||
		      (snapshot.instagramUrl || "") !== instagramUrl ||
		      (snapshot.linkedinUrl || "") !== linkedinUrl ||
          decodeCustomLinkUrls(snapshot.customLinkUrl).join("\n") !== customLinksKey ||
		      (typeof snapshot.publicProfileEnabled === "boolean" ? snapshot.publicProfileEnabled : true) !== publicProfileEnabled ||
          (typeof snapshot.publicShowReadme === "boolean" ? snapshot.publicShowReadme : true) !== publicShowReadme ||
		      (typeof snapshot.publicShowWorkspaceSnapshot === "boolean" ? snapshot.publicShowWorkspaceSnapshot : true) !== publicShowWorkspaceSnapshot ||
		      (typeof snapshot.publicShowHealthOverview === "boolean" ? snapshot.publicShowHealthOverview : true) !== publicShowHealthOverview ||
      (typeof snapshot.publicShowCapabilities === "boolean" ? snapshot.publicShowCapabilities : true) !== publicShowCapabilities ||
      (typeof snapshot.publicShowArtifacts === "boolean" ? snapshot.publicShowArtifacts : true) !== publicShowArtifacts ||
      (typeof snapshot.publicShowPlanTier === "boolean" ? snapshot.publicShowPlanTier : true) !== publicShowPlanTier ||
      (typeof snapshot.publicShowBio === "boolean" ? snapshot.publicShowBio : true) !== publicShowBio ||
      (typeof snapshot.publicShowIdentityLinks === "boolean" ? snapshot.publicShowIdentityLinks : true) !== publicShowIdentityLinks ||
      (typeof snapshot.publicShowIdentityLocation === "boolean" ? snapshot.publicShowIdentityLocation : true) !== publicShowIdentityLocation ||
      (typeof snapshot.publicShowIdentityEmail === "boolean" ? snapshot.publicShowIdentityEmail : false) !== publicShowIdentityEmail
    );
	  }, [
	    snapshot,
      decodeCustomLinkUrls,
	    fullName,
	    email,
	    username,
	    bio,
	    country,
    region,
    timeZone,
    tone,
    avatarImage,
    companyName,
    companyCategory,
	    companySubcategory,
	    githubUrl,
		    instagramUrl,
			    linkedinUrl,
        customLinksKey,
			    publicProfileEnabled,
          publicShowReadme,
		    publicShowWorkspaceSnapshot,
		    publicShowHealthOverview,
    publicShowCapabilities,
    publicShowArtifacts,
    publicShowPlanTier,
    publicShowBio,
    publicShowIdentityLinks,
    publicShowIdentityLocation,
    publicShowIdentityEmail,
  ]);

  const privateMode = !publicProfileEnabled;

  const successTimer = React.useRef<number | null>(null);

  const clearSuccessTimer = () => {
    if (successTimer.current) {
      window.clearTimeout(successTimer.current);
      successTimer.current = null;
    }
  };

  const doReset = () => {
    clearSuccessTimer();
    setSaved(false);
    if (!snapshot) return;

    setFullName(String(snapshot.fullName || ""));
    setEmail(String(snapshot.email || ""));
    setUsername(String(snapshot.username || ""));
    setBio(String(snapshot.bio || ""));
    setCountry(String(snapshot.country || ""));
    setRegion(String(snapshot.region || ""));
    setTimeZone(String(snapshot.timeZone || "America/Los_Angeles"));
    setCompanyName(String(snapshot.companyName || ""));
    setCompanyCategory(String(snapshot.companyCategory || ""));
	    setCompanySubcategory(String(snapshot.companySubcategory || ""));
	    setGithubUrl(String(snapshot.githubUrl || ""));
	    setInstagramUrl(String(snapshot.instagramUrl || ""));
      setLinkedinUrl(String(snapshot.linkedinUrl || ""));
      setCustomLinkUrls(decodeCustomLinkUrls(String(snapshot.customLinkUrl || "")));
	    setPublicProfileEnabled(typeof snapshot.publicProfileEnabled === "boolean" ? snapshot.publicProfileEnabled : true);
      setPublicShowReadme(typeof snapshot.publicShowReadme === "boolean" ? snapshot.publicShowReadme : true);
    setPublicShowWorkspaceSnapshot(
      typeof snapshot.publicShowWorkspaceSnapshot === "boolean" ? snapshot.publicShowWorkspaceSnapshot : true
    );
    setPublicShowHealthOverview(
      typeof snapshot.publicShowHealthOverview === "boolean" ? snapshot.publicShowHealthOverview : true
    );
    setPublicShowCapabilities(
      typeof snapshot.publicShowCapabilities === "boolean" ? snapshot.publicShowCapabilities : true
    );
    setPublicShowArtifacts(
      typeof snapshot.publicShowArtifacts === "boolean" ? snapshot.publicShowArtifacts : true
    );
    setPublicShowPlanTier(
      typeof snapshot.publicShowPlanTier === "boolean" ? snapshot.publicShowPlanTier : true
    );
    setPublicShowBio(typeof snapshot.publicShowBio === "boolean" ? snapshot.publicShowBio : true);
    setPublicShowIdentityLinks(
      typeof snapshot.publicShowIdentityLinks === "boolean" ? snapshot.publicShowIdentityLinks : true
    );
    setPublicShowIdentityLocation(
      typeof snapshot.publicShowIdentityLocation === "boolean" ? snapshot.publicShowIdentityLocation : true
    );
    setPublicShowIdentityEmail(
      typeof snapshot.publicShowIdentityEmail === "boolean" ? snapshot.publicShowIdentityEmail : false
    );
    const st = (String(snapshot.avatarTone || "lime") as ToneKey) || "lime";
    const si = String(snapshot.avatarImage || "");

    setTone(st);
    setAvatarImage(si);

    setErr("");

    const resetUsername = String(snapshot.username || "").trim().toLowerCase();

    // sync LS + broadcast
    try {
      writeProfileCache(snapshot as unknown as Record<string, unknown>);
      globalThis.__cbLocalStore.setItem(LS_TONE, st);
      if (resetUsername) globalThis.__cbLocalStore.setItem(LS_USERNAME, resetUsername);
	      globalThis.__cbLocalStore.setItem(LS_COMPANY_SUBCATEGORY, String(snapshot.companySubcategory || ""));
	      globalThis.__cbLocalStore.setItem(LS_GITHUB_URL, String(snapshot.githubUrl || ""));
      globalThis.__cbLocalStore.setItem(LS_INSTAGRAM_URL, String(snapshot.instagramUrl || ""));
      globalThis.__cbLocalStore.setItem(LS_LINKEDIN_URL, String(snapshot.linkedinUrl || ""));
      globalThis.__cbLocalStore.setItem(
        LS_PROFILE_PUBLIC_ENABLED,
        typeof snapshot.publicProfileEnabled === "boolean" && snapshot.publicProfileEnabled ? "1" : "0"
      );
        globalThis.__cbLocalStore.setItem(LS_CUSTOM_LINK_URL, String(snapshot.customLinkUrl || ""));
      if (si) globalThis.__cbLocalStore.setItem(LS_IMAGE, si);
      else globalThis.__cbLocalStore.removeItem(LS_IMAGE);
	    } catch {}

    const nextInitials = computeInitials(String(snapshot.fullName || ""), String(snapshot.username || ""));
    persistProfileInitials(nextInitials);

    window.dispatchEvent(
      new CustomEvent("cb:profile", {
	        detail: {
	          tone: st,
          avatarImage: si || null,
          initials: nextInitials,
          username: resetUsername,
          publicProfileEnabled: typeof snapshot.publicProfileEnabled === "boolean" ? snapshot.publicProfileEnabled : true,
        },
      })
    );
    broadcastProfileSync();
	  };

  const doSave = async () => {
    clearSuccessTimer();
    setSaved(false);
    try {
      setSaving(true);
      setErr("");

        const res = await fetch("/api/settings/account", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          credentials: "include",
          body: JSON.stringify({
          fullName,
          email,
          username,
          bio,
          country,
          region,
          timeZone,
          avatarTone: tone,
          avatarImage: avatarImage || null,
          companyName: companyName || null,
          companyCategory: companyCategory || null,
		          companySubcategory: companySubcategory || null,
		          githubUrl: githubUrl || null,
		          instagramUrl: instagramUrl || null,
		          linkedinUrl: linkedinUrl || null,
            customLinkUrl: customLinksEncoded || null,
		          publicProfileEnabled,
              publicShowReadme,
		          publicShowWorkspaceSnapshot,
		          publicShowHealthOverview,
	          publicShowCapabilities,
          publicShowArtifacts,
          publicShowPlanTier,
          publicShowBio,
          publicShowIdentityLinks,
          publicShowIdentityLocation,
          publicShowIdentityEmail,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as AccountResponse;

      if (!res.ok || !data?.ok) {
        setErr(data?.message || "Save failed.");
        setSaving(false);
        return;
      }

	      const p = data.profile as ProfileDTO;
      const savedTone = (String(p.avatarTone || "lime") as ToneKey) || "lime";
      if (typeof p.publicProfileEnabled === "boolean") setPublicProfileEnabled(p.publicProfileEnabled);
      if (typeof p.publicShowReadme === "boolean") setPublicShowReadme(p.publicShowReadme);
      if (typeof p.publicShowWorkspaceSnapshot === "boolean") setPublicShowWorkspaceSnapshot(p.publicShowWorkspaceSnapshot);
      if (typeof p.publicShowHealthOverview === "boolean") setPublicShowHealthOverview(p.publicShowHealthOverview);
      if (typeof p.publicShowCapabilities === "boolean") setPublicShowCapabilities(p.publicShowCapabilities);
      if (typeof p.publicShowArtifacts === "boolean") setPublicShowArtifacts(p.publicShowArtifacts);
      if (typeof p.publicShowPlanTier === "boolean") setPublicShowPlanTier(p.publicShowPlanTier);
      if (typeof p.publicShowBio === "boolean") setPublicShowBio(p.publicShowBio);
	      if (typeof p.publicShowIdentityLinks === "boolean") setPublicShowIdentityLinks(p.publicShowIdentityLinks);
	      if (typeof p.publicShowIdentityLocation === "boolean") setPublicShowIdentityLocation(p.publicShowIdentityLocation);
	      if (typeof p.publicShowIdentityEmail === "boolean") setPublicShowIdentityEmail(p.publicShowIdentityEmail);
		      const serverCustomLink = (() => {
          const v = coerceLinkFromServer(p);
          if (typeof v === "string") return v;
          return customLinksEncoded;
        })();
        setCustomLinkUrls(decodeCustomLinkUrls(serverCustomLink));

	      // Update snapshot (real persistence confirmed)
	      setSnapshot({
        email: String(p.email || ""),
        username: String(p.username || ""),
        fullName: p.fullName || "",
        bio: p.bio || "",
        country: p.country || "",
        region: p.region || "",
        timeZone: p.timeZone || "America/Los_Angeles",
        avatarTone: savedTone,
        avatarImage: String(p.avatarImage || ""),
        companyName: p.companyName || "",
        companyCategory: p.companyCategory || "",
        companySubcategory: p.companySubcategory || "",
        githubUrl: p.githubUrl || "",
		        instagramUrl: p.instagramUrl || "",
		        linkedinUrl: p.linkedinUrl || "",
		        customLinkUrl: serverCustomLink,
		        publicProfileEnabled: typeof p.publicProfileEnabled === "boolean" ? p.publicProfileEnabled : true,
            publicShowReadme: typeof p.publicShowReadme === "boolean" ? p.publicShowReadme : true,
        publicShowWorkspaceSnapshot:
              typeof p.publicShowWorkspaceSnapshot === "boolean" ? p.publicShowWorkspaceSnapshot : true,
        publicShowHealthOverview:
              typeof p.publicShowHealthOverview === "boolean" ? p.publicShowHealthOverview : true,
        publicShowCapabilities:
              typeof p.publicShowCapabilities === "boolean" ? p.publicShowCapabilities : true,
        publicShowArtifacts:
              typeof p.publicShowArtifacts === "boolean" ? p.publicShowArtifacts : true,
        publicShowPlanTier:
              typeof p.publicShowPlanTier === "boolean" ? p.publicShowPlanTier : true,
        publicShowBio: typeof p.publicShowBio === "boolean" ? p.publicShowBio : true,
        publicShowIdentityLinks:
              typeof p.publicShowIdentityLinks === "boolean" ? p.publicShowIdentityLinks : true,
        publicShowIdentityLocation:
              typeof p.publicShowIdentityLocation === "boolean" ? p.publicShowIdentityLocation : true,
        publicShowIdentityEmail:
              typeof p.publicShowIdentityEmail === "boolean" ? p.publicShowIdentityEmail : false,
        publicWorkspaceId: p.publicWorkspaceId ? String(p.publicWorkspaceId) : null,
      });

      // Ensure AppShell updates instantly
      const nextInitials = computeInitials(String(p.fullName || ""), String(p.username || ""));
      window.dispatchEvent(
        new CustomEvent("cb:profile", {
          detail: {
            tone: savedTone,
            avatarImage: String(p.avatarImage || "") || null,
            initials: nextInitials,
            fullName: String(p.fullName || ""),
            email: String(p.email || ""),
            username: String(p.username || ""),
            bio: String(p.bio || ""),
            companyName: String(p.companyName || ""),
            companyCategory: String(p.companyCategory || ""),
            companySubcategory: String(p.companySubcategory || ""),
	            githubUrl: String(p.githubUrl || ""),
		            instagramUrl: String(p.instagramUrl || ""),
		            linkedinUrl: String(p.linkedinUrl || ""),
		            customLinkUrl: serverCustomLink,
              publicProfileEnabled: typeof p.publicProfileEnabled === "boolean" ? p.publicProfileEnabled : true,
		          },
		        })
		      );
      broadcastProfileSync();

      // COMMIT ONLY AFTER SAVE (Header-safe)
        try {
          writeProfileCache({
            ...p,
            avatarTone: savedTone,
            avatarImage: String(p.avatarImage || ""),
            customLinkUrl: serverCustomLink,
          });
          globalThis.__cbLocalStore.setItem(LS_TONE, savedTone);
          const savedUsername = String(p.username || "").trim().toLowerCase();
          if (savedUsername) globalThis.__cbLocalStore.setItem(LS_USERNAME, savedUsername);
          globalThis.__cbLocalStore.setItem(LS_COMPANY_SUBCATEGORY, String(p.companySubcategory || ""));
		          globalThis.__cbLocalStore.setItem(LS_GITHUB_URL, String(p.githubUrl || ""));
          globalThis.__cbLocalStore.setItem(LS_INSTAGRAM_URL, String(p.instagramUrl || ""));
          globalThis.__cbLocalStore.setItem(LS_LINKEDIN_URL, String(p.linkedinUrl || ""));
          globalThis.__cbLocalStore.setItem(
            LS_PROFILE_PUBLIC_ENABLED,
            typeof p.publicProfileEnabled === "boolean" && p.publicProfileEnabled ? "1" : "0"
          );
            globalThis.__cbLocalStore.setItem(LS_CUSTOM_LINK_URL, serverCustomLink);
          if (p.avatarImage) globalThis.__cbLocalStore.setItem(LS_IMAGE, String(p.avatarImage));
	          else globalThis.__cbLocalStore.removeItem(LS_IMAGE);

          globalThis.__cbLocalStore.setItem(LS_PROFILE_REV, String(Date.now()));
          persistProfileInitials(nextInitials);
        } catch {}

      setSaving(false);
      setSaved(true);
      successTimer.current = window.setTimeout(() => {
        setSaved(false);
        successTimer.current = null;
      }, 2700);
    } catch {
      setErr("Save failed.");
      setSaving(false);
    }
  };

  React.useEffect(() => {
    return () => {
      clearSuccessTimer();
    };
  }, []);

  return (
    <section className="sx-panel" aria-label="Account settings">
      <header className="sx-panelHead">
        <div>
          <h2 className="sx-h2">Account</h2>
          <p className="sx-sub">Operator identity, presence, and workspace display surfaces.</p>
        </div>
      </header>
      <div className="sx-body">
        <div className="sx-accountHero">
          <article className="sx-card sx-heroCard">
            <div className="sx-cardTop">
              <div>
                <div className="sx-kicker">Avatar</div>
                <div className="sx-cardSub">Click or drop an image to update your avatar.</div>
              </div>
            </div>
            <div className="sx-avatarHero">
              <div className="sx-avatarFrame">
                <input
                  ref={fileRef}
	                  className="sx-avatarFile"
	                  type="file"
	                  accept="image/png,image/jpeg,image/webp,image/avif"
	                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpload(e.target.files?.[0])}
	                />
                <button
                  type="button"
                  data-tone={tone}
                  className={`sx-avatarBtn ${dragOn ? "is-drag" : ""}`}
                  onClick={openPicker}
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  aria-label="Upload or change avatar"
                  style={{
                    background: avatarImage
                      ? "rgba(0,0,0,0.22)"
                      : tone === "transparent"
                      ? "transparent"
                      : activeCss,
                    boxShadow: avatarImage
                      ? "0 0 0 1px rgba(255,255,255,0.10) inset"
                      : "0 0 0 1px rgba(255,255,255,0.08) inset",
                  }}
                >
                {avatarImage ? (
                  <Image
                    className="sx-avatarImg"
                    alt="Avatar"
                    src={avatarImage}
                    width={96}
                    height={96}
                    unoptimized
                  />
                ) : (
                  <span className="sx-avatarInitials">
                    {previewInitialsText ? previewInitialsText : <UploadImageIcon />}
                  </span>
                )}

                </button>
                {avatarImage ? (
                  <button
                    type="button"
                    className="sx-avatarTrash"
                    onClick={removePhoto}
                    aria-label="Remove avatar"
                    title="Remove avatar"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                      <path d="M20.5 6H3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      <path d="M18.8332 8.5L18.3732 15.3991C18.1962 18.054 18.1077 19.3815 17.2427 20.1907C16.3777 21 15.0473 21 12.3865 21H11.6132C8.95235 21 7.62195 21 6.75694 20.1907C5.89194 19.3815 5.80344 18.054 5.62644 15.3991L5.1665 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      <path d="M6.5 6C6.55588 6 6.58382 6 6.60915 5.99936C7.43259 5.97849 8.15902 5.45491 8.43922 4.68032C8.44784 4.65649 8.45667 4.62999 8.47434 4.57697L8.57143 4.28571C8.65431 4.03708 8.69575 3.91276 8.75071 3.8072C8.97001 3.38607 9.37574 3.09364 9.84461 3.01877C9.96213 3 10.0932 3 10.3553 3H13.6447C13.9068 3 14.0379 3 14.1554 3.01877C14.6243 3.09364 15.03 3.38607 15.2493 3.8072C15.3043 3.91276 15.3457 4.03708 15.4286 4.28571L15.5257 4.57697C15.5433 4.62992 15.5522 4.65651 15.5608 4.68032C15.841 5.45491 16.5674 5.97849 17.3909 5.99936C17.4162 6 17.4441 6 17.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="sx-bioTag">
              <div className="sx-bioTop">
                <div className="sx-bioLabel">Bio</div>
                <div className="sx-bioCount" aria-hidden="true">
                  {bioCount}/300
                </div>
              </div>
              <textarea
                className="sx-textarea sx-bioBox"
	                maxLength={300}
	                placeholder="Share what CavBot should know about you."
	                value={bio}
	                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBio(e.target.value)}
	                disabled={loading}
	              />
            </div>
            {(selectedCategory?.label || companySubcategory) && (
              <div className="sx-profileMeta">
                {selectedCategory?.label ? (
                  <span
                    className="sx-categoryBadge"
                    style={{ borderColor: categoryAccent, color: categoryAccent }}
                  >
                    {selectedCategory.label}
                  </span>
                ) : null}
                {companySubcategory ? (
                  <span className="sx-categoryDescriptor">{companySubcategory}</span>
                ) : null}
              </div>
            )}
            {err ? (
              <div className="sx-hint" style={{ color: "rgba(255,255,255,0.72)" }}>
                {err}
              </div>
              ) : null}
            {saved ? <div className="sx-success">Profile saved.</div> : null}
          </article>

          <article id="sx-theme-switcher" className="sx-card sx-tonePanel">
            <div className="sx-toneHeader">
              <div>
                <div className="sx-kicker">Appearance</div>
                <div className="sx-cardSub">Personalize your operator badge across CavBot.</div><br />
              </div>
            </div>
            <div className="sx-toneGrid" role="radiogroup" aria-label="Initials tone swatches">
              {(
                [
                  ["lime", "Lime"],
                  ["violet", "Violet"],
                  ["blue", "Blue"],
                  ["white", "White"],
                  ["navy", "Navy"],
                  ["transparent", "Clear"],
                ] as Array<[ToneKey, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={tone === key}
                  aria-label={label}
                  className={`sx-toneSwatch ${tone === key ? "is-on" : ""}`}
                  onClick={() => setTone(key)}
                  disabled={loading}
                >
                  <span className={`sx-toneDot sw-${key}`} aria-hidden="true" />
                  <div>
                    <div className="sx-swatchName">{label}</div>
                    <div className="sx-toneHint">
                      {key === "lime"
                        ? "Dark initials"
                        : key === "white"
                        ? "Dark initials"
                        : key === "navy"
                        ? "Light initials"
                        : key === "transparent"
                        ? "Bright initials"
                        : "Light initials"}
                    </div>
                  </div>
                  <span className="sx-swatchCheck" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path
                        d="M20 7 10.2 16.8 4 10.6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.95"
                      />
                    </svg>
                  </span>
                </button>
              ))}
            </div>
          </article>
        </div>

        <div className="sx-accountDetailsStack">
          <div className="sx-profileCard sx-card">
          <div className="sx-kickerRow">
            <div className="sx-kicker">Profile</div>
            {username ? <span className="sx-usernameTag">@{username}</span> : null}
          </div>
          <div className="sx-cardSub">
            Used across CavBot for your profile, team presence, and workspace identity.
          </div>

          <div className="sx-divider" aria-hidden="true" />

            <div className="sx-form sx-profileForm">
	            <div className="sx-formRow" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="sx-field">
	                <div className="sx-label">Full name</div>
	                <input
		                  className="sx-input"
		                  placeholder="Your full name"
		                  value={fullName}
		                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)}
		                  disabled={loading}
		                />
	              </div>
	            </div>

	            <div className="sx-formRow" style={{ gridTemplateColumns: "1fr" }}>
	              <div className="sx-field">
	                <div className="sx-label">Email</div>
	                <input
	                  className="sx-input"
	                  placeholder="name@company.com"
	                  value={email}
	                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
	                  disabled={loading}
	                />
              </div>
            </div>

	            <div className="sx-formRow">
	              <div className="sx-field">
  <div className="sx-label">Country</div>
	  <select
	    className="sx-select"
	    value={country}
	    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCountry(e.target.value)}
	    disabled={loading}
	  >
    <option value="">Select a country</option>
    {COUNTRY_TERRITORY_ISO.map((c) => (
      <option key={c.code} value={c.name}>
        {c.name}
      </option>
    ))}
  </select>
</div>


	              <div className="sx-field">
	                <div className="sx-label">Region (City/State)</div>
	                <input
		                  className="sx-input"
		                  placeholder="San Francisco, California"
		                  value={region}
		                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRegion(e.target.value)}
		                  disabled={loading}
		                />
	              </div>
            </div>

	            <div className="sx-field">
	              <div className="sx-label">Time zone</div>
	              <select
	                className="sx-select"
	                value={timeZone}
	                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTimeZone(e.target.value)}
	                disabled={loading}
	              >
                <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
                <option value="America/New_York">America/New_York (ET)</option>
                <option value="America/Chicago">America/Chicago (CT)</option>
                <option value="America/Denver">America/Denver (MT)</option>

                <option value="America/Phoenix">America/Phoenix</option>
                <option value="America/Anchorage">America/Anchorage</option>
                <option value="Pacific/Honolulu">Pacific/Honolulu</option>

                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Paris">Europe/Paris</option>
                <option value="Europe/Rome">Europe/Rome</option>

                <option value="Africa/Cairo">Africa/Cairo</option>
                <option value="Asia/Dubai">Asia/Dubai</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
                <option value="Asia/Seoul">Asia/Seoul</option>
                <option value="Asia/Singapore">Asia/Singapore</option>

                <option value="Australia/Sydney">Australia/Sydney</option>
                <option value="UTC">UTC</option>
              </select>
              <div className="sx-hint">
                Applies to activity timelines, reports, and dashboard timestamps.
              </div>
            </div>

	          </div>
	        </div>
        </div>
        <div className="sx-accountWorkspaceSection">
          <article className="sx-card sx-companyCard">
          <div className="sx-cardTop">
            <div>
              <div className="sx-kicker">Workspace details</div>
              <div className="sx-cardSub">
                Optional company, brand, or personal information to keep your profile personal.
              </div>
            </div>
          </div>
          <div className="sx-divider" aria-hidden="true" />
          <div className="sx-form sx-workspaceForm">
            <div className="sx-formRow">
              <div className="sx-field">
                <div className="sx-label">Company</div>
                <input
	                  className="sx-input"
	                  placeholder="Example: Acme Inc."
	                  value={companyName}
	                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompanyName(e.target.value)}
	                  disabled={loading}
	                />
              </div>
              <div className="sx-field">
                <div className="sx-label">Category</div>
                <select
	                  className="sx-select"
	                  value={companyCategory}
	                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleCategoryChange(e.target.value)}
	                  disabled={loading}
	                >
                  <option value="">Select a category</option>
                  {WORKSPACE_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
	                  ))}
	                </select>
	              </div>
	            </div>

	            <div className="sx-formRow sx-workspaceDescriptorRow">
	              <div className="sx-field">
	                <div className="sx-label">
	                  {companyCategory ? `${categoryLabel} descriptor` : "Descriptor"}
	                </div>
                  <select
	                  className="sx-select"
	                  value={companySubcategory}
	                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCompanySubcategory(e.target.value)}
	                  disabled={!availableSubcategories.length || loading}
	                >
                    <option value="">
                      {companyCategory ? "Choose a descriptor" : "Select a category first"}
                    </option>
                    {availableSubcategories.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  {companyCategory ? (
                    <div className="sx-hint">
                      These descriptors help teammates understand how you show up across CavBot.
                    </div>
                  ) : null}
	              </div>
	            </div>

	            <div className="sx-formRow sx-formRowLinkGroup sx-workspaceLinks">
	              <div className="sx-field">
	                <div className="sx-label">Cavbot</div>
	                <div className="sx-linkField">
	                  <span className="sx-linkFieldIcon cavbot" aria-hidden="true">
	                    <Image
                      className="sx-linkFieldMark"
                      src="/logo/cavbot-logomark.svg"
                      alt=""
                      width={20}
                      height={20}
                      priority
                      unoptimized
                    />
                  </span>
                  <input
                    className="sx-linkFieldInput"
                    value={cavbotProfileUrl}
                    readOnly
                    aria-label="Cavbot profile link"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={copyCavbotProfileUrl}
                    disabled={!cavbotProfileUrlForCopy}
                    aria-label="Copy Cavbot profile URL"
                    title="Copy"
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: 0,
                      margin: 0,
                      width: 18,
                      height: 18,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "rgba(234,240,255,0.55)",
                      cursor: cavbotProfileUrlForCopy ? "pointer" : "not-allowed",
                      flex: "0 0 auto",
                    }}
                  >
                    {cavbotCopied ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
                <div className="sx-hint sx-linkHint">Your Cavbot public profile URL.</div>
              </div>

              <div className="sx-field">
                <div className="sx-label">GitHub</div>
                <div className="sx-linkField">
                  <span className="sx-linkFieldIcon github" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <path
                        d="M12 .5C5.73.5.75 5.63.75 12c0 5.1 3.29 9.42 7.86 10.95.57.11.78-.25.78-.56 0-.28-.01-1.02-.02-2-3.2.71-3.88-1.58-3.88-1.58-.52-1.36-1.28-1.72-1.28-1.72-1.05-.74.08-.73.08-.73 1.16.08 1.77 1.22 1.77 1.22 1.03 1.8 2.7 1.28 3.36.98.1-.77.4-1.28.72-1.58-2.55-.3-5.23-1.3-5.23-5.8 0-1.28.45-2.33 1.18-3.15-.12-.3-.51-1.53.11-3.18 0 0 .97-.32 3.18 1.2a10.7 10.7 0 0 1 2.9-.4c.98 0 1.97.14 2.9.4 2.21-1.52 3.18-1.2 3.18-1.2.62 1.65.23 2.88.11 3.18.74.82 1.18 1.87 1.18 3.15 0 4.51-2.69 5.5-5.25 5.79.41.36.78 1.08.78 2.18 0 1.58-.01 2.85-.01 3.23 0 .31.2.67.79.56A11.28 11.28 0 0 0 23.25 12C23.25 5.63 18.27.5 12 .5Z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <input
	                    className="sx-linkFieldInput"
	                    placeholder="github.com/you"
	                    value={githubUrl}
	                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGithubUrl(e.target.value)}
	                    disabled={loading}
	                  />
                </div>
                <div className="sx-hint sx-linkHint">
                  Public GitHub adds a trustworthy presence for your workspace.
                </div>
              </div>
              <div className="sx-field">
                <div className="sx-label">Instagram</div>
                <div className="sx-linkField">
                  <span className="sx-linkFieldIcon instagram" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <defs>
                        <linearGradient id="instagramGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#feda75" />
                          <stop offset="25%" stopColor="#fa7e1e" />
                          <stop offset="50%" stopColor="#d62976" />
                          <stop offset="75%" stopColor="#962fbf" />
                          <stop offset="100%" stopColor="#4f5bd5" />
                        </linearGradient>
                      </defs>
                      <rect x="2" y="2" width="20" height="20" rx="5.5" fill="url(#instagramGradient)" />
                      <rect
                        x="6.5"
                        y="6.5"
                        width="11"
                        height="11"
                        rx="3.2"
                        fill="none"
                        stroke="rgba(255,255,255,0.75)"
                        strokeWidth="1.2"
                      />
                      <circle cx="12" cy="12" r="3.5" fill="rgba(255,255,255,0.85)" />
                      <circle cx="17.7" cy="6.3" r="1.1" fill="rgba(255,255,255,0.9)" />
                    </svg>
                  </span>
                  <input
	                    className="sx-linkFieldInput"
	                    placeholder="instagram.com/you"
	                    value={instagramUrl}
	                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInstagramUrl(e.target.value)}
	                    disabled={loading}
	                  />
                </div>
                <div className="sx-hint sx-linkHint">Link your creative studio, portfolio, or brand account.</div>
              </div>

                <div className="sx-field">
                  <div className="sx-label">LinkedIn</div>
                  <div className="sx-linkField">
                    <span className="sx-linkFieldIcon linkedin" aria-hidden="true">
                      <LinkedInSquareIcon size={20} />
                    </span>
                    <input
	                      className="sx-linkFieldInput"
	                      placeholder="linkedin.com/in/you"
	                      value={linkedinUrl}
	                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLinkedinUrl(e.target.value)}
	                    disabled={loading}
	                  />
	                </div>
	                  <div className="sx-hint sx-linkHint">Professional identity and company presence.</div>
	                </div>

	            </div>

	            <div className="sx-formRow sx-workspaceWebsiteRow">
	                  <div className="sx-field sx-workspaceWebsitesField">
	                    <div
	                      className="sx-label"
	                      style={{
	                        display: "flex",
	                        alignItems: "center",
	                        justifyContent: "space-between",
	                        gap: 10,
	                      }}
	                    >
		                      <span>Links</span>
	                      <button
	                        className="sx-btn sx-btnGhost sx-btnSerious sx-websitesAddBtn"
	                        type="button"
	                        onClick={openAddWebsite}
	                        disabled={loading || customLinkUrls.length >= MAX_CUSTOM_LINKS}
	                          aria-label="Add link"
		                      >
	                          <span className="sx-websitesAddBtnLabel">Add link</span>
                          <Image
                            className="sx-websitesAddBtnIcon"
                            src="/icons/app/plus-svgrepo-com.svg"
                            alt=""
                            width={14}
                            height={14}
                            aria-hidden="true"
                          />
	                      </button>
	                    </div>

	                    {customLinkUrls.length ? (
	                      <div style={{ display: "grid", gap: 8 }}>
	                        {customLinkUrls.map((url, idx) => (
	                          <div key={`${idx}:${url}`} className="sx-linkField">
	                            <span className="sx-linkFieldIcon link" aria-hidden="true">
	                              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
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
	                            </span>
	                            <input
	                              className="sx-linkFieldInput"
	                              value={url}
	                              readOnly
		                              aria-label={`Link ${idx + 1}`}
	                              disabled={loading}
	                            />
	                            <button
	                              type="button"
	                              onClick={() => removeWebsiteAt(idx)}
		                              aria-label={`Remove link ${idx + 1}`}
	                              title="Remove"
	                              style={{
	                                border: "none",
	                                background: "transparent",
	                                padding: 0,
	                                margin: 0,
	                                width: 18,
	                                height: 18,
	                                display: "inline-flex",
	                                alignItems: "center",
	                                justifyContent: "center",
	                                color: "rgba(234,240,255,0.55)",
	                                cursor: "pointer",
	                                flex: "0 0 auto",
	                              }}
		                            >
		                              <span className="cb-closeIcon" aria-hidden="true" style={{ width: 10, height: 10 }} />
		                            </button>
	                          </div>
	                        ))}
	                      </div>
	                    ) : (
		                      <div className="sx-hint sx-linkHint">No links added yet.</div>
	                    )}

	                    <div className="sx-hint sx-linkHint">
		                      Add up to {MAX_CUSTOM_LINKS} URLs. You can remove them anytime, then save changes.
	                    </div>
	                  </div>
	            </div>

            <div className="sx-divider" aria-hidden="true" />

	            <div className="sx-field">
	              <div className="sx-label">Public Profile</div>
	              <div className="sx-hint sx-linkHint">Enable Private mode to hide your profile.</div>
	
	              <div className="sx-publicProfileToggles">
	                <label className="sx-secToggle">
	                  <div className="sx-secToggleLeft">
	                    <div className="sx-secToggleTitle">Private mode</div>
	                    <div className="sx-secToggleSub">When enabled, your public profile is hidden.</div>
	                  </div>
	
		                  <input
		                    type="checkbox"
		                    checked={privateMode}
		                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
		                      const nextPrivate = e.target.checked;
		                      const nextPublic = !nextPrivate;
		                      setPublicProfileEnabled(nextPublic);
	
	                      if (nextPrivate) {
	                        setPublicShowReadme(false);
	                        setPublicShowWorkspaceSnapshot(false);
	                        setPublicShowHealthOverview(false);
	                        setPublicShowCapabilities(false);
	                        setPublicShowArtifacts(false);
	                        setPublicShowPlanTier(false);
	                        setPublicShowBio(false);
                          setPublicShowIdentityLinks(false);
                          setPublicShowIdentityLocation(false);
                          setPublicShowIdentityEmail(false);
	                      } else {
	                        setPublicShowReadme(true);
	                        setPublicShowWorkspaceSnapshot(true);
	                        setPublicShowHealthOverview(true);
	                        setPublicShowCapabilities(true);
	                        setPublicShowArtifacts(true);
	                        setPublicShowPlanTier(true);
	                        setPublicShowBio(true);
	
	                        // GitHub-style identity details: safe by default (links + location), email remains opt-in.
	                        if (publicShowIdentityLinks !== true) setPublicShowIdentityLinks(true);
	                        if (publicShowIdentityLocation !== true) setPublicShowIdentityLocation(true);
	                      }
	                    }}
	                    disabled={loading}
	                  />
	
			                  <span className="sx-secSwitch" aria-hidden="true" />
			                </label>

		                  <div className="sx-publicProfileConfigRow">
		                    <button
		                      type="button"
		                      className={`sx-publicProfileConfigBtn ${publicProfileConfigOpen ? "is-open" : ""}`}
	                      onClick={() => setPublicProfileConfigOpen((v) => !v)}
                      aria-expanded={publicProfileConfigOpen}
                      disabled={loading}
                    >
                      Configuration
                      <svg className="sx-publicProfileChevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <path
                          d="M8 10l4 4 4-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity="0.86"
                        />
                      </svg>
                    </button>
                  </div>

                  {publicProfileConfigOpen ? (
                    <div className="sx-publicProfileConfigGrid" aria-label="Public profile configuration">
                      <label className={`sx-secToggle ${privateMode ? "is-locked" : ""}`}>
                        <div className="sx-secToggleLeft">
                          <div className="sx-secToggleTitle">README</div>
                          <div className="sx-secToggleSub">Top panel</div>
                        </div>

                        <input
	                          type="checkbox"
	                          checked={publicShowReadme}
	                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPublicShowReadme(e.target.checked)}
	                          disabled={loading || privateMode}
	                        />

                        <span className="sx-secSwitch" aria-hidden="true" />
                      </label>

                      <label className={`sx-secToggle ${privateMode ? "is-locked" : ""}`}>
                        <div className="sx-secToggleLeft">
                          <div className="sx-secToggleTitle">Workspace snapshot</div>
                          <div className="sx-secToggleSub">Counts only. No site origins.</div>
                        </div>

                        <input
	                          type="checkbox"
	                          checked={publicShowWorkspaceSnapshot}
	                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
	                            const next = e.target.checked;
	                            setPublicShowWorkspaceSnapshot(next);
	                            if (!next) setPublicShowPlanTier(false);
	                          }}
                          disabled={loading || privateMode}
                        />

                        <span className="sx-secSwitch" aria-hidden="true" />
                      </label>

                      <label className={`sx-secToggle ${privateMode ? "is-locked" : ""}`}>
                        <div className="sx-secToggleLeft">
                          <div className="sx-secToggleTitle">Health overview</div>
                          <div className="sx-secToggleSub">Posture only. No raw events.</div>
                        </div>

                        <input
	                          type="checkbox"
	                          checked={publicShowHealthOverview}
	                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPublicShowHealthOverview(e.target.checked)}
	                          disabled={loading || privateMode}
	                        />

                        <span className="sx-secSwitch" aria-hidden="true" />
                      </label>

                      <label className={`sx-secToggle ${privateMode ? "is-locked" : ""}`}>
                        <div className="sx-secToggleLeft">
                          <div className="sx-secToggleTitle">Capabilities</div>
                          <div className="sx-secToggleSub">Shows verified module chips.</div>
                        </div>

                        <input
	                          type="checkbox"
	                          checked={publicShowCapabilities}
	                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPublicShowCapabilities(e.target.checked)}
	                          disabled={loading || privateMode}
	                        />

                        <span className="sx-secSwitch" aria-hidden="true" />
                      </label>

                      <label className={`sx-secToggle ${privateMode ? "is-locked" : ""}`}>
                        <div className="sx-secToggleLeft">
                          <div className="sx-secToggleTitle">Public artifacts</div>
                          <div className="sx-secToggleSub">Only explicitly published items.</div>
                        </div>

                        <input
	                          type="checkbox"
	                          checked={publicShowArtifacts}
	                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPublicShowArtifacts(e.target.checked)}
	                          disabled={loading || privateMode}
	                        />

                        <span className="sx-secSwitch" aria-hidden="true" />
                      </label>

                      <label className={`sx-secToggle ${privateMode ? "is-locked" : ""}`}>
                        <div className="sx-secToggleLeft">
                          <div className="sx-secToggleTitle">Plan tier</div>
                          <div className="sx-secToggleSub">Optional label in the snapshot.</div>
                        </div>

                        <input
	                          type="checkbox"
	                          checked={publicShowPlanTier}
	                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPublicShowPlanTier(e.target.checked)}
	                          disabled={loading || privateMode || !publicShowWorkspaceSnapshot}
	                        />

                        <span className="sx-secSwitch" aria-hidden="true" />
                      </label>

                      <label className={`sx-secToggle ${privateMode ? "is-locked" : ""}`}>
                        <div className="sx-secToggleLeft">
                          <div className="sx-secToggleTitle">Bio</div>
                          <div className="sx-secToggleSub">Display your short bio in the header.</div>
                        </div>

                        <input
	                          type="checkbox"
	                          checked={publicShowBio}
	                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPublicShowBio(e.target.checked)}
	                          disabled={loading || privateMode}
	                        />

                        <span className="sx-secSwitch" aria-hidden="true" />
                      </label>

                      <label className={`sx-secToggle ${privateMode ? "is-locked" : ""}`}>
                        <div className="sx-secToggleLeft">
                          <div className="sx-secToggleTitle">Profile links</div>
                          <div className="sx-secToggleSub">CavBot, GitHub, Instagram, LinkedIn, and links</div>
                        </div>

                        <input
	                          type="checkbox"
	                          checked={publicShowIdentityLinks}
	                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPublicShowIdentityLinks(e.target.checked)}
	                          disabled={loading || privateMode}
	                        />

                        <span className="sx-secSwitch" aria-hidden="true" />
                      </label>

                      <label className={`sx-secToggle ${privateMode ? "is-locked" : ""}`}>
                        <div className="sx-secToggleLeft">
                          <div className="sx-secToggleTitle">Location</div>
                          <div className="sx-secToggleSub">Country and region</div>
                        </div>

                        <input
	                          type="checkbox"
	                          checked={publicShowIdentityLocation}
	                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPublicShowIdentityLocation(e.target.checked)}
	                          disabled={loading || privateMode}
	                        />

                        <span className="sx-secSwitch" aria-hidden="true" />
                      </label>

                      <label className={`sx-secToggle ${privateMode ? "is-locked" : ""}`}>
                        <div className="sx-secToggleLeft">
                          <div className="sx-secToggleTitle">Email</div>
                          <div className="sx-secToggleSub">Optional contact address</div>
                        </div>

                        <input
	                          type="checkbox"
	                          checked={publicShowIdentityEmail}
	                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPublicShowIdentityEmail(e.target.checked)}
	                          disabled={loading || privateMode}
	                        />

                        <span className="sx-secSwitch" aria-hidden="true" />
                      </label>
                    </div>
                  ) : null}
		              </div>
	            </div>

	            <div className="sx-companyActions sx-workspaceActions">
	              <button className="sx-btn sx-btnGhost sx-btnSerious" type="button" onClick={doReset} disabled={!snapshot || saving}>
	                Reset
	              </button>
              <button
                className={`sx-btn sx-btnPrimary sx-btnToneLinked sx-btnSerious ${saving || !hasChanges ? "is-disabled" : ""}`}
                type="button"
                onClick={doSave}
                disabled={saving || !hasChanges}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
            {saved ? (
              <div className="sx-toastSuccess" role="status">
                Profile saved across CavBot.
              </div>
	            ) : null}

	          </div>
          </article>
        </div>
      </div>

      {addWebsiteOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add link"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2147483647,
            padding: 18,
          }}
        >
          <div
            aria-hidden="true"
            onClick={closeAddWebsite}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(3,5,16,0.65)",
            }}
          />

	          <div
	            style={{
	              position: "relative",
	              width: "min(520px, 92vw)",
	              borderRadius: 18,
	              border: "1px solid rgba(255,255,255,0.18)",
	              background: "rgba(8,12,28,0.92)",
	              boxShadow: "0 25px 45px rgba(0,0,0,0.35)",
	              padding: "22px 22px",
	            }}
	          >
	            <button
	              type="button"
	              onClick={closeAddWebsite}
	              aria-label="Close"
	              title="Close"
	              style={{
	                position: "absolute",
	                top: 12,
	                right: 12,
	                border: "1px solid rgba(255,255,255,0.10)",
	                background: "rgba(255,255,255,0.04)",
	                color: "rgba(247,251,255,0.9)",
	                width: 34,
	                height: 34,
	                borderRadius: 12,
	                display: "inline-flex",
	                alignItems: "center",
	                justifyContent: "center",
	                cursor: "pointer",
	              }}
		            >
		              <span className="cb-closeIcon" aria-hidden="true" />
		            </button>

		            <p style={{ margin: "14px 0 0", fontSize: 12, color: "rgba(197,206,231,0.78)", lineHeight: 1.45 }}>
		              Paste a URL.
		            </p>

            <div style={{ marginTop: 14 }}>
              <input
                ref={addWebsiteInputRef}
	                className="sx-input"
	                value={addWebsiteValue}
	                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
	                  setAddWebsiteValue(e.target.value);
	                  if (addWebsiteErr) setAddWebsiteErr("");
	                }}
	                placeholder="https://example.com"
                aria-label="URL"
                disabled={loading}
              />
              {addWebsiteErr ? (
                <div style={{ marginTop: 8, color: "rgba(255,77,77,0.92)", fontSize: 12 }}>{addWebsiteErr}</div>
              ) : null}
            </div>

            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="sx-btn sx-btnGhost sx-btnSerious" type="button" onClick={closeAddWebsite}>
                Cancel
              </button>
              <button className="sx-btn sx-btnPrimary sx-btnSerious" type="button" onClick={confirmAddWebsite}>
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
