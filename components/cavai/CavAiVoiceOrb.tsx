"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import styles from "@/components/cavai/CavAiVoiceOrb.module.css";

export type CavAiVoiceOrbMode = "idle" | "listening" | "processing" | "speaking";

type CavAiVoiceOrbProps = {
  active: boolean;
  mode?: CavAiVoiceOrbMode;
  mediaStream?: MediaStream | null;
  placement?: "center" | "bottom";
  centerOffsetY?: number;
  bottomOffset?: number;
  label?: string;
};

type BrowserAudioContext = typeof AudioContext;
type VoiceOrbStyle = CSSProperties & Record<`--${string}`, string>;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function modeToStateValue(mode: CavAiVoiceOrbMode) {
  if (mode === "processing") return 1;
  if (mode === "speaking") return 0.85;
  if (mode === "listening") return 0.6;
  return 0.12;
}

function readRms(analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>) {
  analyser.getByteTimeDomainData(data);
  let total = 0;
  for (let index = 0; index < data.length; index += 1) {
    const centered = (data[index] - 128) / 128;
    total += centered * centered;
  }
  return Math.sqrt(total / data.length);
}

export default function CavAiVoiceOrb({
  active,
  mode = "idle",
  mediaStream = null,
  placement = "center",
  centerOffsetY = 0,
  bottomOffset = 24,
  label = "Voice activity sphere",
}: CavAiVoiceOrbProps) {
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const smoothedVolumeRef = useRef(0.12);
  const modeRef = useRef<CavAiVoiceOrbMode>(mode);
  const activeRef = useRef(active);
  const [visualVolume, setVisualVolume] = useState(0.12);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const wrapperStyle = useMemo(() => {
    const size = placement === "bottom" ? "clamp(72px, 7vw, 98px)" : "clamp(92px, 9vw, 124px)";
    return {
      position: "absolute",
      left: "50%",
      width: size,
      height: size,
      pointerEvents: "none",
      opacity: active ? 1 : 0,
      transition: "opacity 180ms ease",
      zIndex: 3,
      transform: placement === "bottom"
        ? "translateX(-50%)"
        : `translate(-50%, calc(-50% + ${centerOffsetY}px))`,
      bottom: placement === "bottom" ? `${bottomOffset}px` : undefined,
      top: placement === "center" ? "50%" : undefined,
    } satisfies CSSProperties;
  }, [active, bottomOffset, centerOffsetY, placement]);

  const sphereStyle = useMemo(() => {
    const stateValue = modeToStateValue(mode);
    const brightness = 0.98 + visualVolume * 0.46 + stateValue * 0.08;
    const saturate = 1.08 + visualVolume * 0.74 + stateValue * 0.14;
    const contrast = 1.06 + visualVolume * 0.32 + stateValue * 0.08;
    const scale = 1 + visualVolume * 0.065 + stateValue * 0.028;
    const blur = 0.6 + visualVolume * 2.2 + stateValue * 0.5;
    const overlayOpacity = clamp(0.3 + visualVolume * 0.26 + stateValue * 0.12, 0.22, 0.82);
    const detailOpacity = clamp(0.52 + visualVolume * 0.22 + stateValue * 0.1, 0.48, 0.9);
    const speed = mode === "speaking" ? 1.36 : mode === "processing" ? 1.18 : mode === "listening" ? 1 : 0.78;
    return {
      "--orb-scale": scale.toFixed(3),
      "--orb-blur": `${blur.toFixed(2)}px`,
      "--orb-brightness": brightness.toFixed(3),
      "--orb-saturate": saturate.toFixed(3),
      "--orb-contrast": contrast.toFixed(3),
      "--orb-overlay-opacity": overlayOpacity.toFixed(3),
      "--orb-detail-opacity": detailOpacity.toFixed(3),
      "--orb-speed-multiplier": speed.toFixed(3),
      "--orb-volume": visualVolume.toFixed(3),
    } satisfies VoiceOrbStyle;
  }, [mode, visualVolume]);

  useEffect(() => {
    if (!mediaStream || typeof window === "undefined") {
      analyserRef.current = null;
      analyserDataRef.current = null;
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
      return;
    }

    const browserWindow = window as Window & typeof globalThis & {
      webkitAudioContext?: BrowserAudioContext;
    };
    const AudioContextCtor = browserWindow.AudioContext || browserWindow.webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(mediaStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(analyser);

    analyserRef.current = analyser;
    analyserDataRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    audioContextRef.current = audioContext;

    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => {});
    }

    return () => {
      analyserRef.current = null;
      analyserDataRef.current = null;
      audioContextRef.current = null;
      void audioContext.close().catch(() => {});
    };
  }, [mediaStream]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let frameId = 0;
    const startedAt = window.performance.now();

    const animate = (frameNow: number) => {
      frameId = window.requestAnimationFrame(animate);

      const elapsed = Math.max(0, (frameNow - startedAt) / 1000);
      const analyser = analyserRef.current;
      const analyserData = analyserDataRef.current;
      const currentMode = modeRef.current;

      let targetVolume = activeRef.current ? 0.12 + Math.sin(elapsed * 1.05) * 0.02 : 0.02;

      if (analyser && analyserData && currentMode === "listening") {
        targetVolume = Math.min(1, readRms(analyser, analyserData) * 5.25);
      } else if (currentMode === "processing") {
        targetVolume = 0.24 + Math.sin(elapsed * 2.6) * 0.08 + Math.sin(elapsed * 5.1) * 0.04;
      } else if (currentMode === "speaking") {
        targetVolume = 0.3 + Math.sin(elapsed * 2.9) * 0.1 + Math.sin(elapsed * 6.4) * 0.05;
      } else if (activeRef.current) {
        targetVolume = 0.14 + Math.sin(elapsed * 1.6) * 0.03;
      }

      smoothedVolumeRef.current += (clamp(targetVolume, 0.02, 1) - smoothedVolumeRef.current) * 0.12;
      const nextVolume = Number(smoothedVolumeRef.current.toFixed(4));
      setVisualVolume((current) => (Math.abs(current - nextVolume) < 0.006 ? current : nextVolume));
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <div className={styles.wrapper} style={wrapperStyle} role="img" aria-label={label}>
      <div className={styles.sphere} style={sphereStyle as CSSProperties}>
        <div className={`${styles.layer} ${styles.layerBase}`} />
        <div className={`${styles.layer} ${styles.layerAccent}`} />
        <div className={`${styles.layer} ${styles.layerSweep}`} />
        <div className={`${styles.layer} ${styles.layerDetail}`} />
      </div>
    </div>
  );
}
