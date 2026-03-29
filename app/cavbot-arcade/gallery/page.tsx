"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import CavBotLoadingScreen from "@/components/CavBotLoadingScreen";
import "@/components/CavBotLoadingScreen.css";
import "./gallery.css";
import { DefaultAccountAvatarIcon } from "@/components/AppShell";
import EntertainmentOverlay from "../EntertainmentOverlay";

const GREETINGS = [
  "Have fun!!!",
  "Amusez-vous!!!",
  "Distractie placuta!!!",
  "¡Diviértete!!!",
  "Divertiti!!!",
  "Divirta-se!!!",
  "استمتع!!!",
  "Веселитесь!!!",
  "मज़ा करो!!!",
  "楽しんで!!!",
  "즐거운 시간 되세요!!!",
  "玩得开心!!!",
  "Ha kul!!!",
  "Καλή διασκέδαση!!!",
];

const HERO_VIDEO_SRC = "";
const HERO_BG_DESKTOP_SRC = "/cavbot-arcade/cavbot-arcade-logo-bg.png";
const HERO_BG_TABLET_SRC = "/cavbot-arcade/cavbot-arcade-logo-bg.png";

const CATEGORY_DEFINITIONS = [
  {
    slug: "action",
    label: "Action",
    description: "Fast reactions, movement, timing.",
    keys: ["catch-cavbot", "futbol-cavbot", "tennis-cavbot"],
  },
  {
    slug: "signals",
    label: "Signals",
    description: "Detection, tracking, system cleanup.",
    keys: ["signal-chase", "cache-sweep"],
  },
  {
    slug: "puzzles",
    label: "Puzzles",
    description: "Single-decision logic, pattern recognition.",
    keys: ["pick-the-imposter"],
  },
];

type CategorySlug = (typeof CATEGORY_DEFINITIONS)[number]["slug"];

type FilterSlug = CategorySlug | "all";

const GAMES = [
  {
    key: "catch-cavbot",
    slug: "catch-cavbot",
    title: "Catch CavBot",
    accent: "lime",
    thumbnail: "/cavbot-arcade/demo/thumbnails/catch-cavbot-thumbnail.png",
    video: "/cavbot-arcade/entertainment/catch-cavbot/v1/files/assets/preview.mp4",
    description: "React, align, and catch CavBot without breaking the signal.",
  },
  {
    key: "futbol-cavbot",
    slug: "futbol-cavbot",
    title: "Fútbol CavBot",
    accent: "lime",
    thumbnail: "/cavbot-arcade/demo/thumbnails/cavbot-fc-thumbnail.png",
    video: "/cavbot-arcade/entertainment/futbol-cavbot/v1/files/assets/preview.mp4",
    description: "Precision futbol that turns a broken path into clean recovery signal.",
  },
  {
    key: "pick-the-imposter",
    slug: "cavbot-imposter",
    title: "Pick The Imposter",
    accent: "violet",
    thumbnail: "/cavbot-arcade/demo/thumbnails/cavbot-imposter-thumbnail.png",
    video: "/cavbot-arcade/entertainment/cavbot-imposter/v1/files/assets/preview.mp4",
    description: "Scan the grid, pick the fake thread, and restore calm.",
  },
  {
    key: "signal-chase",
    slug: "cavbot-signal-chase",
    title: "Signal Chase",
    accent: "ice",
    thumbnail: "/cavbot-arcade/demo/thumbnails/cavbot-signal-chase-thumbnail.png",
    video: "/cavbot-arcade/entertainment/cavbot-signal-chase/v1/files/assets/preview.mp4",
    description: "Sweep the field, clear beacons, and keep everything in tune.",
  },
  {
    key: "tennis-cavbot",
    slug: "tennis-cavbot",
    title: "Tennis CavBot",
    accent: "violet",
    thumbnail: "/cavbot-arcade/demo/thumbnails/cavbot-tennis-thumbnail.png",
    video: "/cavbot-arcade/entertainment/tennis-cavbot/v1/files/assets/preview.mp4",
    description: "Calm duels, soft rallies, first-to-five.",
  },
  {
    key: "cache-sweep",
    slug: "cavbot-cache-sweep",
    title: "Cache Sweep",
    accent: "ice",
    thumbnail: "/cavbot-arcade/demo/thumbnails/cavbot-cache-sweep-thumbnail.png",
    video: "/cavbot-arcade/entertainment/cavbot-cache-sweep/v1/files/assets/preview.mp4",
    description: "Coming soon: hit stale blobs, protect fresh cache, stay composed.",
  },
];

const getBadgeToneClass = (tone?: string) => {
  if (tone === "lime") return "cavbot-auth-eye-watch";
  if (tone === "red") return "cavbot-auth-eye-error";
  return "";
};

type ProfileEventDetail = {
  initials?: string | null;
  tone?: string | null;
  avatarTone?: string | null;
  avatarImage?: string | null;
  username?: string | null;
  publicProfileEnabled?: boolean | null;
};

type TutorialChapter = {
  id: string;
  label: string;
  content: JSX.Element;
};

type TutorialDefinition = {
  title: string;
  pill: string;
  chapters: TutorialChapter[];
};

const createPassportMeta = (gameId: string, tutorialName: string, mode = "Quick Round") => [
  { label: "ID", value: gameId },
  { label: "How to Play", value: tutorialName },
  { label: "Version", value: "v2.0.0" },
  { label: "Mode", value: mode },
  { label: "Powered by", value: "CavAi" },
  { label: "Company", value: "CavBot" },
];

const PassportCard = ({
  entries,
}: {
  entries: { label: string; value: string }[];
}) => (
  <div className="passport-card">
    <div className="passport-head">
      <strong>Game Book</strong>
      <span className="secure-badge">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2l7 4v6c0 5-3 9-7 10-4-1-7-5-7-10V6l7-4z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </span>
    </div>
    <div className="passport-grid">
      {entries.map((entry) => (
        <div className="passport-item" key={entry.label}>
          <span className="meta-chip">{entry.label}</span>
          <span className="meta-value">{entry.value}</span>
        </div>
      ))}
    </div>
  </div>
);

const tutorialDefinitions: Record<string, TutorialDefinition> = {
  "futbol-cavbot": {
    title: "Fútbol CavBot",
    pill: "Fútbol CavBot",
    chapters: [
      {
        id: "passport",
        label: "Game Book",
        content: (
          <>
            <PassportCard entries={createPassportMeta("futbol-cavbot", "FC Recovery")} />
          </>
        ),
      },
      {
        id: "overview",
        label: "Overview",
        content: (
          <>
            <p>
              Precision futbol that turns a broken path into clean recovery signal.
            </p>
            <br />
            <div className="callout">
              <strong>Session feel</strong>
              <p>Quick rounds · Calm UI · Clear hits · Optional sound · Structured telemetry</p>
            </div>
          </>
        ),
      },
      {
        id: "controls",
        label: "Controls",
        content: (
          <>
            <p>Let the pitch breathe. Smooth, balanced corrections yield better positioning than frantic swings.</p>
            <div className="callout">
              <strong>Desktop</strong>
              <p>
                <kbd>Hover</kbd> to steer · <kbd>Click</kbd> to confirm a pass or kick.
              </p>
            </div>
            <div className="callout">
              <strong>Touch</strong>
              <p>
                <kbd>Tap</kbd>/<kbd>Drag</kbd> to steer—keep movements small for stability.
              </p>
            </div>
            <ul>
              <li>Small corrections beat big swings.</li>
              <li>Let the ball come to you—don’t chase corners.</li>
              <li>When unsure, center and reset the rhythm.</li>
            </ul>
          </>
        ),
      },
      {
        id: "objective",
        label: "Objective",
        content: (
          <>
            <p>
              Score cleanly and repeatedly—each goal is a “route restored” indicator that the surface is healthy.
            </p>
            <p>Loop: aim, commit, confirm, reset.</p>
          </>
        ),
      },
      {
        id: "scoring",
        label: "Scoring",
        content: (
          <>
            <p>Precision and timing outrank reckless repetition.</p>
            <ul>
              <li>Goal scored → subtle confirmation pulse.</li>
              <li>Ball resets for the next play.</li>
              <li>Streaks track when enabled.</li>
            </ul>
          </>
        ),
      },
      {
        id: "sound",
        label: "Sound",
        content: (
          <>
            <p>Sound is optional—silence keeps the signal intact.</p>
            <ul>
              <li>Mobile browsers may require a first tap to unlock audio.</li>
              <li>Leaving sound off keeps the experience mechanically identical.</li>
            </ul>
          </>
        ),
      },
      {
        id: "telemetry",
        label: "Telemetry",
        content: (
          <>
            <p>Every round can emit lightweight events—structured enough for CavAi, calm enough to ignore.</p>
            <div className="callout">
              <strong>Example events</strong>
              <p>
                <kbd>goal_scored</kbd> · <kbd>round_start</kbd> · <kbd>route_restored</kbd>
              </p>
            </div>
          </>
        ),
      },
      {
        id: "tips",
        label: "Tips",
        content: (
          <>
            <div className="callout">
              <strong>Rhythm</strong>
              <p>Use small adjustments. Calm beats speed.</p>
            </div>
            <div className="callout">
              <strong>Control</strong>
              <p>Precision beats panic. Stay centered.</p>
            </div>
          </>
        ),
      },
      {
        id: "version",
        label: "Version",
        content: (
          <p>
            <kbd>Build</kbd> v2.0.0 · Powered by CavAi
          </p>
        ),
      },
    ],
  },
  "pick-the-imposter": {
    title: "Pick The Imposter",
    pill: "Imposter",
    chapters: [
      {
        id: "passport",
        label: "Game Book",
        content: (
          <>
            <PassportCard entries={createPassportMeta("pick-the-imposter", "Signal Verification")} />
            
          </>
        ),
      },
      {
        id: "overview",
        label: "Overview",
        content: (
          <p>
            Multiple units appear. Only one is the imposter. Spot the false signal, tap it, and restore the route with confidence.
          </p>
        ),
      },
      {
        id: "how",
        label: "How to win",
        content: (
          <ul>
            <li>Tap/click the unit that looks “off.”</li>
            <li>Correct → route restored pulse.</li>
            <li>Wrong → brief destabilize, then reset.</li>
          </ul>
        ),
      },
      {
        id: "reads",
        label: "Reading the grid",
        content: (
          <>
            <p>The imposter is subtle—slightly misaligned, tinted, or rhythm-breaking.</p>
            <div className="callout">
              <strong>Focus</strong>
              <p>Scan once, then commit. Second guesses invite doubt.</p>
            </div>
          </>
        ),
      },
      {
        id: "sound",
        label: "Sound",
        content: (
          <p>Optional sound stays minimal: confirm tones, soft error taps, clean resets.</p>
        ),
      },
      {
        id: "telemetry",
        label: "Telemetry",
        content: (
          <>
            <p>Events are structured around choices—perfect for clean recovery hooks.</p>
            <div className="callout">
              <strong>Example events</strong>
              <p>
                <kbd>imposter_picked</kbd> · <kbd>pick_correct</kbd> · <kbd>pick_wrong</kbd> · <kbd>route_restored</kbd>
              </p>
            </div>
          </>
        ),
      },
      {
        id: "tips",
        label: "Tips",
        content: (
          <div className="callout">
            <strong>First instinct</strong>
            <p>Trust your first read—overthinking creates noise.</p>
          </div>
        ),
      },
      {
        id: "version",
        label: "Version",
        content: (
          <p>
            <kbd>Build</kbd> v2.0.0 · Powered by CavAi
          </p>
        ),
      },
    ],
  },
  "signal-chase": {
    title: "Signal Chase",
    pill: "Signal Chase",
    chapters: [
      {
        id: "passport",
        label: "Game Book",
        content: (
          <>
            <PassportCard entries={createPassportMeta("signal-chase", "Beacon Recovery")} />
            
          </>
        ),
      },
      {
        id: "overview",
        label: "Overview",
        content: (
          <p>Sweep a dark field, stabilize beacons, and reveal the correct journey back.</p>
        ),
      },
      {
        id: "collect",
        label: "Collect",
        content: (
          <>
            <div className="callout">
              <strong>Desktop</strong>
              <p>Move into beacon zones and click to confirm when needed.</p>
            </div>
            <div className="callout">
              <strong>Touch</strong>
              <p>Tap targets directly or drag toward them depending on the build.</p>
            </div>
          </>
        ),
      },
      {
        id: "sequence",
        label: "Sequence",
        content: (
          <>
            <p>Beacons may appear in groups. Sweep left-to-right then reset—consistency beats chaos.</p>
            <p>The goal is simple: recover enough signal to unlock the path.</p>
          </>
        ),
      },
      {
        id: "sound",
        label: "Sound",
        content: <p>Sound is optional. When enabled, it provides soft confirmation tones.</p>,
      },
      {
        id: "telemetry",
        label: "Telemetry",
        content: (
          <div className="callout">
            <strong>Example events</strong>
            <p>
              <kbd>beacon_cleared</kbd> · <kbd>beacon_missed</kbd> · <kbd>sequence_complete</kbd> · <kbd>route_restored</kbd>
            </p>
          </div>
        ),
      },
      {
        id: "tips",
        label: "Tips",
        content: (
          <div className="callout">
            <strong>Pathing</strong>
            <p>Use a steady sweep: left-to-right, reset, repeat.</p>
          </div>
        ),
      },
      {
        id: "version",
        label: "Version",
        content: (
          <p>
            <kbd>Build</kbd> v2.0.0 · Powered by CavAi
          </p>
        ),
      },
    ],
  },
  "tennis-cavbot": {
    title: "Tennis CavBot",
    pill: "Tennis",
    chapters: [
      {
        id: "passport",
        label: "Game Book",
        content: (
          <>
            <PassportCard entries={createPassportMeta("tennis-cavbot", "Control-Room Rally", "First to 5")} />
          
          </>
        ),
      },
      {
        id: "overview",
        label: "Overview",
        content: <p>Tennis CavBot feels like a calm duel rather than a frantic scramble.</p>,
      },
      {
        id: "serve",
        label: "Serve",
        content: (
          <>
            <div className="callout">
              <strong>Desktop</strong>
              <p>
                <kbd>Hover</kbd> to aim · <kbd>Click</kbd> to release.
              </p>
            </div>
            <div className="callout">
              <strong>Mobile</strong>
              <p>
                <kbd>Touch + hold</kbd> to aim, release to serve.
              </p>
            </div>
          </>
        ),
      },
      {
        id: "rally",
        label: "Rally",
        content: (
          <>
            <p>Once the rally begins, consistency matters. Read the bounce, reposition early, return with calm intent.</p>
          </>
        ),
      },
      {
        id: "scoring",
        label: "Scoring",
        content: (
          <>
            <p>Scoring stays simple: win a rally = +1 point. First to 5 wins.</p>
            <ul>
              <li>Rallies reward clean returns.</li>
              <li>Streaks are tracked for insight.</li>
            </ul>
          </>
        ),
      },
      {
        id: "sound",
        label: "Sound",
        content: <p>Sound is optional—soft hits, light confirmations, no loops.</p>,
      },
      {
        id: "telemetry",
        label: "Telemetry",
        content: (
          <div className="callout">
            <strong>Example events</strong>
            <p>
              <kbd>serve_start</kbd> · <kbd>rally_hit</kbd> · <kbd>rally_max</kbd> · <kbd>match_win</kbd>
            </p>
          </div>
        ),
      },
      {
        id: "tips",
        label: "Tips",
        content: (
          <div className="callout">
            <strong>Stay centered</strong>
            <p>Points are lost by drifting too far left or right.</p>
          </div>
        ),
      },
      {
        id: "version",
        label: "Version",
        content: (
          <p>
            <kbd>Build</kbd> v2.0.0 · Powered by CavAi
          </p>
        ),
      },
    ],
  },
  "catch-cavbot": {
    title: "Catch CavBot",
    pill: "Catch",
    chapters: [
      {
        id: "passport",
        label: "Game Book",
        content: (
          <>
            <PassportCard entries={createPassportMeta("catch-cavbot", "Reaction Recovery")} />
            
          </>
        ),
      },
      {
        id: "overview",
        label: "Overview",
        content: <p>CavBot moves inside the grid. Your job is to catch him cleanly.</p>,
      },
      {
        id: "catch",
        label: "How to catch",
        content: (
          <>
            <div className="callout">
              <strong>Action</strong>
              <p>Tap/click directly on CavBot. The hit area is tuned to feel fair.</p>
            </div>
            <ul>
              <li>Tap where CavBot will be—not where he was.</li>
              <li>Don’t spam taps; accuracy beats frantic inputs.</li>
              <li>On mobile, stick to a single thumb lane.</li>
            </ul>
          </>
        ),
      },
      {
        id: "timing",
        label: "Timing",
        content: (
          <div className="callout">
            <strong>Timing rule</strong>
            <p>Aim for the landing spot. Let CavBot come to your tap.</p>
          </div>
        ),
      },
      {
        id: "sound",
        label: "Sound",
        content: <p>Sound is optional. Catches confirm with a soft ping.</p>,
      },
      {
        id: "telemetry",
        label: "Telemetry",
        content: (
          <div className="callout">
            <strong>Example events</strong>
            <p>
              <kbd>catch_hit</kbd> · <kbd>catch_miss</kbd> · <kbd>streak_max</kbd> · <kbd>round_reset</kbd>
            </p>
          </div>
        ),
      },
      {
        id: "tips",
        label: "Tips",
        content: (
          <div className="callout">
            <strong>Accuracy</strong>
            <p>One clean tap beats five panicked taps.</p>
          </div>
        ),
      },
      {
        id: "version",
        label: "Version",
        content: (
          <p>
            <kbd>Build</kbd> v2.0.0 · Powered by CavAi
          </p>
        ),
      },
    ],
  },
  "cache-sweep": {
    title: "Cache Sweep",
    pill: "Cache Sweep",
    chapters: [
      {
        id: "passport",
        label: "Game Book",
        content: (
          <>
            <PassportCard entries={createPassportMeta("cache-sweep", "Cache Recovery")} />
            
          </>
        ),
      },
      {
        id: "overview",
        label: "Overview",
        content: <p>Hit stale blobs, protect fresh cache, stay composed.</p>,
      },
      {
        id: "mechanics",
        label: "Mechanics",
        content: (
          <ul>
            <li>Hit orange = correct.</li>
            <li>Hit blue = wrong.</li>
            <li>Wrong hits may cause a brief visual destabilize.</li>
            <li>Rounds reset quickly so the player stays calm.</li>
          </ul>
        ),
      },
      {
        id: "sound",
        label: "Sound",
        content: <p>Sound is optional—stale hits confirm softly, wrong hits stay subtle.</p>,
      },
      {
        id: "telemetry",
        label: "Telemetry",
        content: (
          <ul>
            <li><kbd>cache_hit_correct</kbd> — correct hit</li>
            <li><kbd>cache_hit_wrong</kbd> — wrong hit</li>
            <li><kbd>streak_max</kbd> — best streak</li>
            <li><kbd>round_reset</kbd> — loop reset</li>
          </ul>
        ),
      },
      {
        id: "notes",
        label: "Notes",
        content: <p>When the game ships, this section expands with final tuning notes.</p>,
      },
      {
        id: "version",
        label: "Version",
        content: (
          <p>
            <kbd>Build</kbd> v2.0.0 · Powered by CavAi
          </p>
        ),
      },
    ],
  },
};

const shouldSuggestRotate = () => {
  if (typeof window === "undefined") return false;
  const small = window.matchMedia("(max-width: 720px)").matches;
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  return small && portrait;
};

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [query]);
  return matches;
};


const GamePreview = ({
  gameKey,
  thumbnail,
  videoSrc,
  label,
  prefersReduced,
  isCoarse,
}: {
  gameKey: string;
  thumbnail: string;
  videoSrc: string;
  label: string;
  prefersReduced: boolean;
  isCoarse: boolean;
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [armed, setArmed] = useState(false);

  const disarmVideo = useCallback(() => {
    if (!armed) return;
    setArmed(false);
  }, [armed]);

  const armVideo = () => {
    if (prefersReduced || isCoarse) return;
    if (armed) return;
    setArmed(true);
  };

  useEffect(() => {
    if ((prefersReduced || isCoarse) && armed) {
      const timer = window.setTimeout(() => disarmVideo(), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [prefersReduced, isCoarse, armed, disarmVideo]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      setVideoReady(false);
      return undefined;
    }
    setVideoReady(false);
    video.preload = "auto";
    const handleCanPlay = () => setVideoReady(true);
    video.addEventListener("canplay", handleCanPlay, { once: true });
    video.src = videoSrc;
    video.load();
    return () => {
      video.removeEventListener("canplay", handleCanPlay);
    };
  }, [videoSrc]);

  useEffect(() => {
    if (!armed) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    video.currentTime = 0;
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(() => {});
    }
    return () => {
      video.pause();
      video.currentTime = 0;
    };
  }, [armed, videoSrc]);

  const shouldShowVideo = videoReady && armed;

  return (
    <div className="preview-tablet">
      <div className="preview-tablet-header" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <figure
        className={`preview ${shouldShowVideo ? "is-video-ready" : ""}`}
        data-preview-game={gameKey}
        onMouseEnter={armVideo}
        onMouseLeave={disarmVideo}
        onPointerEnter={armVideo}
        onPointerLeave={disarmVideo}
        onTouchStart={armVideo}
        onFocus={armVideo}
        onBlur={disarmVideo}
        tabIndex={0}
        aria-label={`${label} preview`}
      >
        <div
          className="preview-frame"
          style={
            {
              "--preview-bg": `url("${thumbnail}")`,
            } as React.CSSProperties
          }
        >
          <Image
            src={thumbnail}
            alt={`${label} thumbnail`}
            width={360}
            height={220}
            className="preview-img"
            priority={false}
          />
          <video ref={videoRef} muted playsInline loop preload="none" />
        </div>
      </figure>
    </div>
  );
};

const escapeId = (id: string) => {
  if (typeof CSS !== "undefined" && CSS.escape) {
    return CSS.escape(id);
  }
  return id.replace(/([^\w-])/g, "\\$1");
};

const computeScrollProgress = (body: HTMLDivElement | null) => {
  if (!body) return 0;
  const max = body.scrollHeight - body.clientHeight;
  if (max <= 0) return 100;
  return (body.scrollTop / max) * 100;
};

const ArcadePage = () => {
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const isCoarsePointer = useMediaQuery("(hover: none), (pointer: coarse)");
  const isTabletScreen = useMediaQuery("(min-width: 721px) and (max-width: 1024px)");
  const [loaderVisible, setLoaderVisible] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeGame, setActiveGame] = useState<string | null>(null);
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [tutorialProgress, setTutorialProgress] = useState(0);
  const [heroReady, setHeroReady] = useState(false);
  const [heroTriggered, setHeroTriggered] = useState(false);
  const [rotateHintVisible, setRotateHintVisible] = useState(false);
  const [rotateDismissed, setRotateDismissed] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<FilterSlug>("all");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [profileInitials, setProfileInitials] = useState("");
  const [profileTone, setProfileTone] = useState("lime");
  const [profileUsername, setProfileUsername] = useState("");
  const [profilePublicEnabled, setProfilePublicEnabled] = useState<boolean | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const readerBodyRef = useRef<HTMLDivElement | null>(null);
  const readerContentRef = useRef<HTMLDivElement | null>(null);
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  const initialHashRef = useRef<string | null>(null);
  const rotateTimerRef = useRef<number | null>(null);
  const chapterObserverRef = useRef<IntersectionObserver | null>(null);
  const [entGame, setEntGame] = useState<(typeof GAMES)[number] | null>(null);
  const heroArmed = heroTriggered && !prefersReducedMotion && !isCoarsePointer;
  const gallerySectionRef = useRef<HTMLElement | null>(null);
  const heroBackgroundSrc = isTabletScreen ? HERO_BG_TABLET_SRC : HERO_BG_DESKTOP_SRC;

  const openEntGame = (game: (typeof GAMES)[number]) => {
    setEntGame(game);
    try {
      // Use history state so Back closes the overlay, but refresh doesn't auto-open.
      window.history.pushState({ ...(window.history.state || {}), cavbotEntGame: game.key }, "");
    } catch {}
  };

  const closeEntGame = () => {
    // Prefer Back to close (pops the pushed state). Fallback to direct close.
    try {
      if (window.history.state && window.history.state.cavbotEntGame) {
        window.history.back();
        return;
      }
    } catch {}
    setEntGame(null);
  };

  useEffect(() => {
    // Kill any stale deep-linking behavior from old builds.
    try {
      const sp = new URLSearchParams(window.location.search);
      if (!sp.has("play")) return;
      sp.delete("play");
      const next = `${window.location.pathname}${sp.toString() ? `?${sp.toString()}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, "", next);
    } catch {}
  }, []);

  useEffect(() => {
    const greetingInterval = prefersReducedMotion ? 200 : 260;
    const duration = greetingInterval * GREETINGS.length + 120;
    const timer = window.setTimeout(() => {
      setLoaderVisible(false);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const initials = (globalThis.__cbLocalStore.getItem("cb_account_initials") || "").trim().slice(0, 3).toUpperCase();
      const avatar = (globalThis.__cbLocalStore.getItem("cb_settings_avatar_image_v2") || "").trim();
      const tone = (globalThis.__cbLocalStore.getItem("cb_settings_avatar_tone_v2") || "lime").trim();
      const username = (globalThis.__cbLocalStore.getItem("cb_profile_username_v1") || "").trim().toLowerCase();
      const rawPublic = (globalThis.__cbLocalStore.getItem("cb_profile_public_enabled_v1") || "").trim().toLowerCase();
      const publicEnabled =
        rawPublic === "1" || rawPublic === "true" || rawPublic === "public"
          ? true
          : rawPublic === "0" || rawPublic === "false" || rawPublic === "private"
            ? false
            : null;
      setProfileInitials(initials);
      setProfileAvatar(avatar);
      setProfileTone(tone || "lime");
      setProfileUsername(username);
      if (publicEnabled !== null) setProfilePublicEnabled(publicEnabled);
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleProfileUpdate = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as ProfileEventDetail | undefined;
      if (!detail) return;
      if (typeof detail.initials === "string") {
        setProfileInitials(detail.initials.trim().slice(0, 3).toUpperCase());
      }
      if (typeof detail.tone === "string") {
        setProfileTone(detail.tone);
      } else if (typeof detail.avatarTone === "string") {
        setProfileTone(detail.avatarTone);
      }
      if (typeof detail.avatarImage === "string") {
        setProfileAvatar(detail.avatarImage);
      } else if (detail.avatarImage === null) {
        setProfileAvatar("");
      }
      if (typeof detail.username === "string") {
        setProfileUsername(detail.username.trim().toLowerCase());
      }
      if (typeof detail.publicProfileEnabled === "boolean") {
        setProfilePublicEnabled(detail.publicProfileEnabled);
      }
    };
    window.addEventListener("cb:profile", handleProfileUpdate);
    return () => window.removeEventListener("cb:profile", handleProfileUpdate);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        profileMenuOpen &&
        !profileMenuRef.current?.contains(event.target as Node) &&
        !profileButtonRef.current?.contains(event.target as Node)
      ) {
        setProfileMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (profileMenuOpen && event.key === "Escape") {
        setProfileMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let alive = true;
    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!alive || !res.ok || !data?.ok) return;
        const user = data.user || {};
        if (typeof user?.initials === "string") {
          const nextInitials = user.initials.trim().slice(0, 3).toUpperCase();
          setProfileInitials(nextInitials);
        }
        if (typeof user?.avatarTone === "string") {
          setProfileTone(user.avatarTone);
        } else if (typeof user?.tone === "string") {
          setProfileTone(user.tone);
        }
        if (typeof user?.avatarImage === "string") {
          setProfileAvatar(user.avatarImage);
        } else if (user.avatarImage === null) {
          setProfileAvatar("");
        }
        if (typeof user?.username === "string") {
          setProfileUsername(user.username.trim().toLowerCase());
        }
        if (typeof user?.publicProfileEnabled === "boolean") {
          setProfilePublicEnabled(user.publicProfileEnabled);
        }
      } catch {}
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, []);

  useEffect(() => {
    if (modalOpen) {
      document.documentElement.classList.add("modal-lock");
      document.body.classList.add("modal-lock");
    } else {
      document.documentElement.classList.remove("modal-lock");
      document.body.classList.remove("modal-lock");
    }
  }, [modalOpen]);
  const publicProfileHref = useMemo(() => {
    const handle = String(profileUsername || "").trim().toLowerCase().replace(/^@+/, "");
    if (!handle) return "";
    return `/u/${encodeURIComponent(handle)}`;
  }, [profileUsername]);
  const profileMenuLabel = useMemo(() => {
    if (profilePublicEnabled === null) return "Profile";
    return profilePublicEnabled ? "Public Profile" : "Private Profile";
  }, [profilePublicEnabled]);

  const openTutorial = useCallback((gameKey: string, opener?: HTMLElement | null) => {
    lastTriggerRef.current = opener ?? null;
    setActiveGame(gameKey);
    setActiveChapterIndex(0);
    setTutorialProgress(0);
    setModalOpen(true);
    readerBodyRef.current?.scrollTo({ top: 0 });
    setHeroReady(false);
    if (typeof window !== "undefined") {
      initialHashRef.current = window.location.hash || null;
      const base = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", `${base}#tutorial=${encodeURIComponent(gameKey)}`);
      setTimeout(() => {
        readerBodyRef.current?.focus({ preventScroll: true });
      }, 30);
    }
  }, []);

  const closeTutorial = useCallback(() => {
    setModalOpen(false);
    setActiveGame(null);
    setActiveChapterIndex(0);
    setTutorialProgress(0);
    if (typeof window !== "undefined") {
      const base = window.location.pathname + window.location.search;
      const hash = initialHashRef.current ?? "";
      window.history.replaceState(null, "", `${base}${hash}`);
    }
    if (lastTriggerRef.current) {
      lastTriggerRef.current.focus();
    }
    initialHashRef.current = null;
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && modalOpen) {
        event.preventDefault();
        closeTutorial();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [modalOpen, closeTutorial]);

  useEffect(() => {
    if (!modalOpen) return;
    const body = readerBodyRef.current;
    if (!body) return;
    const onScroll = () => setTutorialProgress(computeScrollProgress(body));
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => body.removeEventListener("scroll", onScroll);
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen || !activeGame) return;
    const body = readerBodyRef.current;
    const content = readerContentRef.current;
    if (!body || !content) return;
    if (chapterObserverRef.current) {
      chapterObserverRef.current.disconnect();
    }
    const tutorial = tutorialDefinitions[activeGame];
    const nodes: HTMLElement[] = [];
    tutorial.chapters.forEach((chapter, index) => {
      const selector = `[data-chapter-id="${escapeId(chapter.id)}"]`;
      const node = content.querySelector<HTMLElement>(selector);
      if (node) {
        node.dataset.chapterIndex = index.toString();
        nodes.push(node);
      }
    });
    if (!nodes.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (!visible.length) return;
        visible.sort(
          (a, b) =>
            Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top)
        );
        const { target } = visible[0];
        if (!(target instanceof HTMLElement)) return;
        const index = Number(target.dataset.chapterIndex);
        if (!Number.isNaN(index)) {
          setActiveChapterIndex(index);
        }
      },
      { root: body, threshold: [0.35, 0.55], rootMargin: "-12% 0px -70% 0px" }
    );
    nodes.forEach((node) => observer.observe(node));
    chapterObserverRef.current = observer;
    return () => {
      observer.disconnect();
      chapterObserverRef.current = null;
    };
  }, [modalOpen, activeGame]);

  useEffect(() => {
    if (!heroArmed || prefersReducedMotion || isCoarsePointer) {
      return undefined;
    }
    const video = heroVideoRef.current;
    if (!video) return undefined;
    video.src = HERO_VIDEO_SRC;
    const canPlay = () => {
      setHeroReady(true);
      try {
        video.currentTime = 0;
        video.play();
      } catch {}
    };
    const handleError = () => setHeroReady(false);
    video.addEventListener("canplay", canPlay, { once: true });
    video.addEventListener("error", handleError, { once: true });
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      setHeroReady(false);
    };
  }, [heroArmed, prefersReducedMotion, isCoarsePointer]);

  useEffect(() => {
    if (prefersReducedMotion || isCoarsePointer) return undefined;
    const arm = () => setHeroTriggered(true);
    window.addEventListener("pointerdown", arm, { once: true, passive: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [prefersReducedMotion, isCoarsePointer]);

  const showRotateHint = useCallback(() => {
    if (rotateDismissed || !shouldSuggestRotate()) return;
    setRotateHintVisible(true);
    if (rotateTimerRef.current) {
      window.clearTimeout(rotateTimerRef.current);
    }
    rotateTimerRef.current = window.setTimeout(() => {
      setRotateHintVisible(false);
      rotateTimerRef.current = null;
    }, 4200);
  }, [rotateDismissed]);

  useEffect(() => {
    if (!shouldSuggestRotate()) return undefined;
    const timer = window.setTimeout(() => showRotateHint(), 0);
    return () => {
      window.clearTimeout(timer);
      if (rotateTimerRef.current) {
        window.clearTimeout(rotateTimerRef.current);
        rotateTimerRef.current = null;
      }
    };
  }, [showRotateHint]);

  const handleRotateDismiss = () => {
    setRotateHintVisible(false);
    setRotateDismissed(true);
    if (rotateTimerRef.current) {
      window.clearTimeout(rotateTimerRef.current);
      rotateTimerRef.current = null;
    }
  };

  const currentTutorial = activeGame ? tutorialDefinitions[activeGame] : null;
  const chapterList = useMemo(() => currentTutorial?.chapters ?? [], [currentTutorial]);
  const filteredGames = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return GAMES;
    return GAMES.filter((game) => {
      return (
        game.title.toLowerCase().includes(query) ||
        game.description.toLowerCase().includes(query)
      );
    });
  }, [searchTerm]);
  const visibleGames = useMemo(() => {
    const base = filteredGames;
    if (activeCategoryFilter === "all") return base;
    const category = CATEGORY_DEFINITIONS.find((definition) => definition.slug === activeCategoryFilter);
    if (!category) return base;
    return base.filter((game) => category.keys.includes(game.key));
  }, [filteredGames, activeCategoryFilter]);

  const scrollToCategory = (slug: FilterSlug) => {
    setActiveCategoryFilter(slug);
    gallerySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const goToChapter = useCallback(
    (index: number) => {
      const chapter = chapterList[index];
      if (!chapter) return;
      const selector = `[data-chapter-id="${escapeId(chapter.id)}"]`;
      const target = readerContentRef.current?.querySelector<HTMLElement>(selector);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [chapterList]
  );

  const handlePlayClick = (game: (typeof GAMES)[number]) => {
    showRotateHint();
    openEntGame(game);
  };

  useEffect(() => {
    // Reopen after auth redirect (one-shot).
    try {
      const raw = globalThis.__cbSessionStore.getItem("cb_ent_launch_v1");
      if (!raw) return;
      globalThis.__cbSessionStore.removeItem("cb_ent_launch_v1");
      const parsed = JSON.parse(raw) as { slug?: string; title?: string; ts?: number };
      const slug = String(parsed?.slug || "").trim();
      if (!slug) return;
      const game = GAMES.find((g) => g.slug === slug || g.key === slug) || null;
      if (!game) return;
      window.setTimeout(() => openEntGame(game), 0);
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const k = String((window.history.state && window.history.state.cavbotEntGame) || "").trim();
      if (!k) {
        setEntGame(null);
        return;
      }
      const game = GAMES.find((g) => g.key === k) || null;
      setEntGame(game);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!modalOpen || typeof document === "undefined") return;
    const button = document.querySelector<HTMLButtonElement>(
      `.chapter-btn[data-chapter-index="${activeChapterIndex}"]`
    );
    button?.scrollIntoView({ block: "nearest" });
  }, [activeChapterIndex, modalOpen]);

  return (
    <>
      <EntertainmentOverlay
        game={entGame ? { slug: entGame.slug, title: entGame.title } : null}
        onClose={closeEntGame}
      />
      {loaderVisible && (
        <CavBotLoadingScreen
          title="CavBot Arcade"
          className="arcade-greeting-loading"
          greetingPhrases={GREETINGS}
          greetingIntervalMs={prefersReducedMotion ? 200 : 260}
        />
      )}
      <div className={`arcade-shell ${loaderVisible ? "is-hidden" : ""}`} aria-hidden={loaderVisible}>

        <main className="arcade-main">
          <header className="arcade-header arcade-header--avatar">
            <div className="arcade-header-badge">
              <div
                className={`cb-badge cb-badge-inline ${getBadgeToneClass(profileTone)}`}
                aria-hidden="true"
              >
                <div className="cavbot-dm-avatar">
                  <div className="cavbot-dm-avatar-core">
                    <div className="cavbot-dm-face">
                      <div className="cavbot-eyes-row">
                        <div className="cavbot-eye">
                          <div className="cavbot-eye-inner">
                            <div className="cavbot-eye-track">
                              <div className="cavbot-eye-pupil"></div>
                            </div>
                          </div>
                          <div className="cavbot-eye-glow"></div>
                          <div className="cavbot-blink"></div>
                        </div>
                        <div className="cavbot-eye">
                          <div className="cavbot-eye-inner">
                            <div className="cavbot-eye-track">
                              <div className="cavbot-eye-pupil"></div>
                            </div>
                          </div>
                          <div className="cavbot-eye-glow"></div>
                          <div className="cavbot-blink"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <button
              ref={profileButtonRef}
              className="arcade-avatar-button"
              type="button"
              aria-label="Account"
              aria-expanded={profileMenuOpen}
              aria-controls="arcade-profile-menu"
              onClick={() => setProfileMenuOpen((v) => !v)}
            >
              <span
                className="cb-account-chip cb-avatar-plain"
                data-tone={profileTone || "lime"}
              >
                {profileAvatar ? (
                  <Image
                    className="arcade-avatar-img"
                    src={profileAvatar}
                    alt="Account avatar"
                    width={32}
                    height={32}
                    sizes="32px"
                    unoptimized={true}
                  />
                ) : profileInitials ? (
                  <span className="cb-account-initials">{profileInitials}</span>
                ) : (
                  <DefaultAccountAvatarIcon />
                )}
              </span>
            </button>
            <div
              id="arcade-profile-menu"
              ref={profileMenuRef}
              className={`arcade-profile-menu${profileMenuOpen ? " is-open" : ""}`}
              role="menu"
              aria-label="Account menu"
            >
              <button
                type="button"
                className="arcade-profile-item"
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false);
                  window.location.href = publicProfileHref || "/settings?tab=account";
                }}
              >
                {profileMenuLabel}
              </button>
              <button
                type="button"
                className="arcade-profile-item"
                role="menuitem"
                onClick={async () => {
                  setProfileMenuOpen(false);
                  try {
                    await fetch("/api/auth/logout", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      cache: "no-store",
                      credentials: "include",
                    });
                  } catch {}
                  window.location.replace("/auth?mode=login");
                }}
              >
                Log out
              </button>
            </div>
          </header>
          <div className="ambient">
            {[
              { color: "violet", left: "8%", top: "150px" },
              { color: "lime", left: "86%", top: "220px" },
              { color: "ice", left: "88%", top: "520px" },
              { color: "violet", left: "18%", top: "780px" },
              { color: "lime", left: "50%", top: "420px" },
              { color: "violet", left: "60%", top: "900px" },
              { color: "ice", left: "30%", top: "1020px" },
              { color: "lime", left: "72%", top: "620px" },
              { color: "ice", left: "12%", top: "580px" },
            ].map((beacon) => (
              <span key={`${beacon.color}-${beacon.left}-${beacon.top}`} className={`beacon ${beacon.color}`} style={{ left: beacon.left, top: beacon.top }} />
            ))}
          </div>
<br /><br /><br /><br />
          <div className="hero-card">
            <div className="hero-card-shell">
              <div className="hero-card-top">
                <span />
                <span />
                <span />
              </div>
              <div className={`hero-card-screen ${heroReady ? "is-video-ready" : ""}`}>
                <Image
                  src={heroBackgroundSrc}
                  alt="CavBot Arcade logo background"
                  width={980}
                  height={560}
                  className="hero-card-image"
                  priority
                />
                <video
                  ref={heroVideoRef}
                  muted
                  playsInline
                  loop
                  preload="none"
                  onCanPlay={() => setHeroReady(true)}
                />
                <Image
                  src="/logo/cavbot-arcade-logo-type.png"
                  alt="CavBot Arcade type logo"
                  width={420}
                  height={240}
                  className="hero-card-overlay-logo"
                  priority
                />
              </div>
            </div>
          </div>

          <br /><br /><br /><br />
          <section className="gallery" ref={gallerySectionRef}>
            <header>
              <div className="gallery-title-block">
                <h2 className="arcade-title gallery-arcade-title">
                  LIB<span className="gallery-title-highlighted-r">R</span>ARY
                </h2>
              </div>
              <br /><br /><br /><br />
            </header>
            <div className="gallery-controls">
              <div className="gallery-filter">
                <button
                  type="button"
                  className={`gallery-filter-button ${activeCategoryFilter === "all" ? "is-active" : ""}`}
                  onClick={() => scrollToCategory("all")}
                >
                  All
                </button>
                {CATEGORY_DEFINITIONS.map((category) => (
                  <button
                    key={category.slug}
                    type="button"
                    className={`gallery-filter-button ${activeCategoryFilter === category.slug ? "is-active" : ""}`}
                    onClick={() => scrollToCategory(category.slug)}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
              <form
                className="gallery-search gallery-search-condensed"
                onSubmit={(event) => event.preventDefault()}
                role="search"
              >
                <label className="sr-only" htmlFor="arcade-gallery-search">
                  Search Arcade games
                </label>
                <input
                  id="arcade-gallery-search"
                  className="gallery-search-input"
                  type="search"
                  placeholder="Search games..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" className="gallery-search-button" aria-label="Filter games">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M10 3a7 7 0 0 1 5.93 10.98l4.54 4.54-1.41 1.41-4.54-4.54A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />
                  </svg>
                </button>
              </form>
            </div>
            <br /><br />
            <div className="gallery-grid">
              {visibleGames.length === 0 ? (
                <div className="gallery-empty">
                  <p>No games match that search—try another signal.</p>
                </div>
              ) : (
                visibleGames.map((game) => (
                  <article className={`game-card accent-${game.accent}`} key={game.key}>
                    <div className="game-top" aria-hidden="true" />
                    <GamePreview
                      gameKey={game.key}
                      thumbnail={game.thumbnail}
                      videoSrc={game.video}
                      label={game.title}
                      prefersReduced={prefersReducedMotion}
                      isCoarse={isCoarsePointer}
                    />
                    <div className="game-body">
                      <div className="game-actions">
                        <br />
                        <button type="button" className="btn btn-primary" onClick={() => handlePlayClick(game)}>
                        Play Now
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={(event) => openTutorial(game.key, event.currentTarget)}
                        >
                          How to Play
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
<br /><br /><br /><br />
      </main>
      <footer className="powered" aria-label="Footer">
        <Link
          className="gallery-footer-return"
          href="/cavbot-arcade"
          aria-label="Return to CavBot Arcade"
        >
          <div className="gallery-footer-icon">
            <span className="gallery-footer-icon-art" aria-hidden="true" />
          </div>
        </Link>
        <div className="powered-branding">
          <span className="powered-phrase" aria-label="Powered by CavAi">
            <span className="powered-label">POWERED BY</span>
            <span className="powered-mark">CAVAI</span>
          </span>
          <a className="powered-logotype" aria-label="Visit CavBot" href="https://www.cavbot.io" target="_blank" rel="noreferrer noopener">
		            <svg viewBox="0 0 1001 501" role="img" aria-hidden="false" focusable="false">
		              <rect x=".5" y=".5" width="1000" height="500" fill="none" stroke="#000" strokeMiterlimit="10" />
		              <rect x=".5" y=".5" width="1000" height="500" fill="none"/>
		          <g>
            <path fill="#fff" d="M335.59,176.87c17.38-10.31,38.4-13.52,58.28-10.74,10.78,1.67,21.55,4.83,30.87,10.61,1.04,4.01.65,8.38,1,12.53.4,5.97.86,11.96,1,17.97-19.75-19.14-52.35-23.76-76.31-9.97-13.79,7.9-23.57,22.17-26.28,37.81-2.25,13.35-.57,27.63,6.18,39.53,7.06,13.08,19.7,22.94,34.08,26.61,21.98,5.4,46.62.83,64.33-13.55-.73,8.62-1.64,17.19-2.55,25.79-.29,1.23,0,3.09-1.51,3.62-15.07,7.77-32.24,11.45-49.17,10.45-16.31-.59-32.56-5.88-45.71-15.59-15.1-10.94-26.2-27.28-30.77-45.36-4.49-17.58-3.2-36.76,4.4-53.32,6.61-15.05,17.93-28.05,32.16-36.35h0v-.03h0Z"/>
            <path fill="#fff" d="M678.99,168.82c20.86,0,41.76.03,62.64.11,13.65.11,28.27,3.36,38.4,13.08,9.57,9.32,12.26,23.81,9.86,36.57-1.77,10.61-8.63,20.18-18.13,25.24,7.17,3.41,13.97,8.22,18.05,15.21,5.37,9.22,5.91,20.39,4.73,30.76-1.27,11.32-7.95,22.01-17.89,27.71-8.82,5.46-19.27,7.44-29.53,7.63-22.63,0-45.3-.14-67.95-.29-.33-50.65-.22-101.28-.43-151.93.13-1.34-.4-2.87.25-4.08h-.02v-.02ZM705.29,191.29c0,14.3.11,28.62,0,42.91,12.42,0,24.86.03,37.29-.08,8.82-.16,18-5.27,20.94-13.94,2.45-7.6,1.59-17.01-4.38-22.81-4.62-4.57-11.39-5.61-17.6-5.94-12.09-.11-24.18-.06-36.27-.16h.02v.02ZM705.43,256.7c.43,15.12.32,30.25.4,45.38,13.12-.18,26.28,0,39.39-.19,5.7.05,11.53-1.54,16.05-5.1,8.54-6.42,9.83-19.18,5.4-28.37-4.06-7.68-13-11.74-21.44-11.64-13.28-.19-26.55.06-39.82-.08h.02Z"/>
            <path fill="#fff" d="M944.26,182.56c8.86.05,17.68.05,26.54.03v27.75c9.91-.03,19.81,0,29.7,0-.56,7.14-.3,14.3-.92,21.44l-.48.25c-9.44-.05-18.87.08-28.3-.08.05,19.56-.1,39.12,0,58.68.05,5.37,2.8,11.21,8.08,13.22,6.71,2.45,14.05.73,20.53-1.61-.62,7.66-.19,15.35.11,23.02-9.37,1.85-19.08,2.85-28.56,1.31-9.44-1.56-18.24-7.44-22.51-16.13-4.16-7.74-4.33-16.71-4.11-25.28v-53.10c-5.16.06-10.32.03-15.47.11-.05-7.28-.19-14.56-.41-21.82h15.9c-.03-9.25.05-18.51-.05-27.78h-.05,0Z"/>
            <path fill="#fff" d="M456.13,218.95c9.4-6.28,20.39-9.94,31.6-11.12,15.66-1.16,33.16.08,45.52,10.94,8.95,7.44,12.44,19.38,12.63,30.64.43,25.13-.08,50.27.32,75.4-8.95.02-17.92-.05-26.89,0,.08-3.25.13-6.48.16-9.73-5.77,5.06-12.5,9.19-20.05,10.99-10.74,2.63-22.16,2.33-32.81-.56-8.57-2.31-16.56-7.65-21.01-15.45-5.51-9.92-5.96-22.73-.49-32.78,3.79-7.29,10.72-12.47,18.13-15.75,8.23-3.82,17.38-4.95,26.36-5.06,9.97-.05,19.93,0,29.88-.05-.38-6.21-.19-12.95-3.81-18.35-4.4-6.85-12.84-9.83-20.66-10.02-14.7-.3-28.51,6.63-39.69,15.7.7-8.27.24-16.56.78-24.85h-.02l.05.03h0ZM474.21,279c-6.53,5.3-7.23,16.07-1.74,22.35,2.72,3.15,6.75,4.92,10.78,5.7,7.15,1,14.75.73,21.37-2.37,6.61-3.11,11.8-9.06,14.13-15.96,1.07-5.03.53-10.26.86-15.37-9.41,0-18.83-.05-28.24,0-6.04.35-12.39,1.72-17.17,5.64h0v.02Z"/>
            <path fill="#fff" d="M854.48,208.38c15.05-2.41,31.25-.24,44.26,8.06,10.61,6.56,18.3,17.14,22.55,28.75,5.3,14.64,4.94,31.17-.53,45.71-4.89,12.98-14.59,24.15-27.03,30.37-11.18,5.72-24.11,7.57-36.52,6.02-14.22-1.43-27.78-8.55-36.87-19.62-18.71-22.39-18.7-58.18.38-80.35,8.41-10.19,20.74-16.87,33.73-18.94h.02ZM860.83,231.03c-12.28,1.24-22.9,10.51-26.28,22.33-3.07,9.59-2.74,20.2.64,29.67,2.74,7.69,8.19,14.61,15.62,18.19,10.3,4.92,23.25,4.56,32.86-1.85,11.93-7.87,16.36-23.29,15.15-36.92-.73-9.32-4.71-18.67-11.96-24.72-7.1-5.97-16.95-8.17-26.01-6.69h-.02v-.02Z"/>
            <path fill="#fff" d="M548.46,210.32c9.54-.06,19.08.19,28.62.25,10.08,26.42,19.89,52.97,30.05,79.38.78,1.88,1.13,3.98,2.48,5.57,10.19-28.35,20.29-56.77,31.01-84.94,9.49-.38,19-.19,28.49-.33-15.12,37.51-30.07,75.1-44.92,112.7-.25.48-.8,1.43-1.07,1.91-9.46.13-18.94.11-28.41-.29-15.48-38.07-30.74-76.23-46.29-114.28h.02v.02Z"/>
          </g>
          <g>
            <path fill="#fff" d="M173.88,325.38c-8.39,5.62-17.6,10.07-27.35,12.76-8.17,2.23-16.63,3.3-25.09,3.52-15.85-.06-31.74-4.32-45.3-12.58-8.9-5.21-17.07-11.72-23.76-19.61-5.61-6.48-10.18-13.81-13.92-21.5-6.58-14.35-9.41-30.42-8.06-46.16,1.43-17.04,8.31-33.37,18.6-46.95,9.48-12.61,22.43-22.43,36.84-28.73,9.33-3.89,19.34-6.1,29.42-6.85,3.79-.06,7.58-.06,11.37,0,9.86.8,19.65,2.84,28.88,6.45,7.25,2.79,13.98,6.8,20.28,11.32,6.83,4.92,12.82,10.91,18.33,17.27,1.58-.91,2.93-2.15,4.4-3.22,6.75-5.06,13.49-10.16,20.07-15.43-13.52-15.66-30.26-28.8-49.47-36.71-17.27-7.15-36.16-10.19-54.79-9.27-20.08,1.23-39.96,7.17-57.12,17.73-18.22,11.21-33.26,27.46-43.23,46.36C5.77,209.41.94,226.93.56,244.63c-.24,10.27.14,20.64,2.39,30.71,7.1,34.98,31.06,65.84,62.64,82.22,15.34,7.95,32.43,12.65,49.71,13.04,16.05.75,32.38-1.13,47.48-6.79,14.75-5.61,28.78-13.49,40.44-24.19,5.56-4.81,10.43-10.34,14.92-16.15-7.55-5.92-15.19-11.72-22.76-17.62-6.21,7.47-13.36,14.21-21.52,19.51h0l.02.02Z"/>
            <path fill="#b9c85a" d="M116.94,200.19c-5.19.41-10.31,1.62-15.1,3.68-19.34,8.31-32.13,29.8-30.2,50.76,1.93,20.96,18.43,39.75,38.94,44.41.89.21,1.78.38,2.69.53,6.67,1.1,13.55.7,20.1-.96,6.56-1.66,12.82-4.57,18.28-8.57,5.43-3.97,10.1-8.98,13.46-14.81,3.47-6.02,5.54-12.79,6.23-19.7.68-6.91,0-13.97-2.02-20.63-2.01-6.61-5.34-12.82-9.89-18.01-10.43-11.9-26.81-17.97-42.51-16.71h0l.02.02ZM143.16,250.3c.11,5.34-2.18,10.61-5.86,14.43-4.4,4.62-10.91,7.06-17.23,6.61-5.48-.4-10.81-2.95-14.43-7.1-4.28-4.87-6.29-11.79-4.94-18.17,1.54-8.65,8.9-15.94,17.63-17.19,5.89-1.04,12.18.62,16.84,4.38,5.06,4.06,8.23,10.51,8,17.04h0Z"/>
          </g>
        </svg>
      </a>
        </div>
      </footer>

        <div className={`rotate-hint ${rotateHintVisible ? "is-on" : ""}`}>
          <div className="rotate-body">
            <div className="rotate-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M8 7h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"></path>
                <path d="M12 3v2"></path>
                <path d="M16 3l-2 2"></path>
                <path d="M8 3l2 2"></path>
              </svg>
            </div>
            <div className="rotate-copy">
              <strong>Rotate for best control</strong>
              <span>On mobile, landscape improves gameplay precision.</span>
            </div>
          </div>
          <button type="button" className="btn btn-soft" onClick={handleRotateDismiss}>
            Dismiss
          </button>
        </div>

        {modalOpen && currentTutorial && (
          <div className="modal-overlay" role="presentation">
            <div className="modal-backdrop" onClick={closeTutorial} />
            <div className="reader" role="dialog" aria-modal="true" aria-labelledby="readerTitle">
              <div className="reader-head">
                  <div className="reader-top">
                    <h3 id="readerTitle">{currentTutorial.title}</h3>
                  <button className="icon-btn icon-close" onClick={closeTutorial} aria-label="Close How to Play">
                    <span className="cb-closeIcon" aria-hidden="true" />
                  </button>
                  </div>
                <div className="reader-progress-bar" aria-hidden="true">
                  <div className="reader-progress-fill" style={{ width: `${tutorialProgress}%` }} />
                </div>
                <div className="reader-footline">
                  <span className="pill is-ice">{currentTutorial.pill}</span>
                  <span>{Math.round(tutorialProgress)}%</span>
                </div>
              </div>
              <div className="reader-shell">
                <aside className="chapters">
                  <ul className="chapter-list">
                    {chapterList.map((chapter, index) => (
                      <li key={chapter.id}>
                        <button
                          type="button"
                          className={`chapter-btn ${index === activeChapterIndex ? "is-active" : ""}`}
                          data-chapter-index={index}
                          onClick={() => goToChapter(index)}
                        >
                          {chapter.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </aside>
                <div className="reader-body" ref={readerBodyRef} tabIndex={0} role="document">
                  <div className="reader-content" ref={readerContentRef}>
                    {chapterList.map((chapter) => (
                      <section key={chapter.id} data-chapter-id={chapter.id} className="tutorial-chapter">
                        {chapter.id !== "passport" && <h3>{chapter.label}</h3>}
                        {chapter.content}
                      </section>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default ArcadePage;
