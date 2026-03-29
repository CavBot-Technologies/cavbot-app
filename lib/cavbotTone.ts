type CavbotTone = "cavbot-chime" | "cavbot-ping" | "cavbot-vibrate-calm" | "cavbot-vibrate-urgent";

export const CAVBOT_TONES: CavbotTone[] = [
  "cavbot-chime",
  "cavbot-ping",
  "cavbot-vibrate-calm",
  "cavbot-vibrate-urgent",
];

const TONE_PATHS: Record<CavbotTone, string> = {
  "cavbot-chime": "/sounds/cavbot-chime.mp3",
  "cavbot-ping": "/sounds/cavbot-ping.mp3",
  "cavbot-vibrate-calm": "/sounds/cavbot-vibrate-calm.mp3",
  "cavbot-vibrate-urgent": "/sounds/cavbot-vibrate-urgent.mp3",
};

const TONE_VOLUME: Record<CavbotTone, number> = {
  "cavbot-chime": 0.45,
  "cavbot-ping": 0.45,
  "cavbot-vibrate-calm": 0.35,
  "cavbot-vibrate-urgent": 0.4,
};

const toneCache: Partial<Record<CavbotTone, HTMLAudioElement>> = {};

// This creates a master audio element to clone from. The master is not played directly because clones
// ensure simultaneous playback or play-through even if a tone is still running.
function ensureAudio(tone: CavbotTone) {
  if (typeof window === "undefined") return null;
  if (!toneCache[tone]) {
    const audio = new Audio(TONE_PATHS[tone]);
    audio.preload = "auto";
    audio.volume = TONE_VOLUME[tone];
    toneCache[tone] = audio;
  }
  return toneCache[tone]!;
}

export function playCavbotTone(tone: CavbotTone) {
  if (typeof window === "undefined") return;
  try {
    const master = ensureAudio(tone);
    if (!master) return;
    const player = master.cloneNode(true) as HTMLAudioElement;
    player.volume = master.volume;
    player.play().catch(() => {});
  } catch {}
}

export function preloadCavbotTone(tone: CavbotTone) {
  if (typeof window === "undefined") return;
  try {
    ensureAudio(tone);
  } catch {}
}

export function isVibrationTone(tone: CavbotTone) {
  return tone.startsWith("cavbot-vibrate");
}

export function normalizeTone(value: unknown): CavbotTone {
  if (typeof value === "string" && (CAVBOT_TONES as string[]).includes(value)) {
    return value as CavbotTone;
  }
  return "cavbot-chime";
}

export type { CavbotTone };
