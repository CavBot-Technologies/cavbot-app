"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import * as THREE from "three";

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

const vertexShader = `
uniform float uTime;
uniform float uVolume;
uniform float uState;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vNoise;
varying float vPulse;

vec4 permute(vec4 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod(i, 289.0);
  vec4 p = permute(
    permute(
      permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y
      + vec4(0.0, i1.y, i2.y, 1.0)
    )
    + i.x
    + vec4(0.0, i1.x, i2.x, 1.0)
  );

  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amplitude = 0.55;
  float frequency = 1.0;
  for (int i = 0; i < 4; i += 1) {
    sum += amplitude * snoise(p * frequency);
    frequency *= 2.02;
    amplitude *= 0.5;
  }
  return sum;
}

void main() {
  float volume = clamp(uVolume, 0.0, 1.0);
  float stateIntensity = mix(0.0, 0.26, clamp(uState, 0.0, 1.0));
  float timeA = uTime * (0.18 + volume * 0.12 + stateIntensity * 0.08);
  float timeB = uTime * (0.11 + volume * 0.18 + stateIntensity * 0.1);
  float baseFrequency = mix(1.2, 2.8, volume) + stateIntensity * 0.85;
  float baseAmplitude = 0.055 + volume * 0.12 + stateIntensity * 0.07;
  float pulse = 0.5 + 0.5 * sin(uTime * (1.1 + volume * 1.8 + stateIntensity * 2.0));

  vec3 flowPos = position * baseFrequency;
  float liquid = fbm(flowPos + vec3(0.0, timeA, -timeB));
  float detail = snoise((position + normal * 0.18) * (baseFrequency * 2.2) + vec3(timeB, -timeA, timeA));
  float plasma = mix(liquid, sign(detail) * pow(abs(detail), 1.8), smoothstep(0.52, 1.0, volume));
  float displacement = (liquid * 0.6 + plasma * 0.4) * baseAmplitude * mix(0.85, 1.35, pulse);

  vec3 displaced = position + normal * displacement;
  vec4 world = modelMatrix * vec4(displaced, 1.0);

  vWorldPosition = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vNoise = plasma;
  vPulse = pulse;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = `
uniform float uTime;
uniform float uVolume;
uniform vec3 uColorIce;
uniform vec3 uColorSky;
uniform vec3 uColorLime;
uniform vec3 uColorViolet;
uniform vec3 uCoreColor;
uniform vec3 uLightPosition;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vNoise;
varying float vPulse;

void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  vec3 lightDir = normalize(uLightPosition - vWorldPosition);

  float light = pow(max(dot(normal, lightDir), 0.0), 1.15);
  float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.35);
  float swirl = 0.5 + 0.5 * sin(vNoise * 3.8 + uTime * 0.45 + vWorldPosition.y * 1.6);
  float sweep = 0.5 + 0.5 * sin(uTime * 0.22 + vWorldPosition.x * 1.4 - vWorldPosition.z * 1.1);

  vec3 gradient = mix(uColorIce, uColorSky, smoothstep(0.08, 0.88, swirl));
  gradient = mix(gradient, uColorLime, smoothstep(0.18, 0.95, sweep) * 0.18);
  gradient = mix(gradient, uColorViolet, smoothstep(0.55, 1.0, abs(vNoise)) * 0.28);

  float glass = 0.42 + rim * 0.36 + light * 0.24;
  float voiceTint = smoothstep(0.18, 1.0, uVolume);
  vec3 internal = mix(uCoreColor * 0.3, uCoreColor, light * (0.55 + voiceTint * 0.45));
  vec3 color = gradient * glass + internal * 0.22;

  float alpha = 0.76 + rim * 0.14 + voiceTint * 0.04 + vPulse * 0.03;
  gl_FragColor = vec4(color, alpha);
}
`;

function modeToStateValue(mode: CavAiVoiceOrbMode) {
  if (mode === "processing") return 1;
  if (mode === "speaking") return 0.85;
  if (mode === "listening") return 0.6;
  return 0;
}

function readRms(analyser: AnalyserNode, data: Uint8Array) {
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
  const mountRef = useRef<HTMLDivElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserDataRef = useRef<Uint8Array | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const orbMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const coreMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const orbGroupRef = useRef<THREE.Group | null>(null);
  const pointLightRef = useRef<THREE.PointLight | null>(null);
  const smoothedVolumeRef = useRef(0.08);
  const modeRef = useRef<CavAiVoiceOrbMode>(mode);
  const activeRef = useRef(active);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const wrapperStyle = useMemo(() => {
    const size = placement === "bottom" ? "clamp(84px, 8vw, 112px)" : "clamp(104px, 11vw, 136px)";
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

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, 3.2);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    mountNode.appendChild(renderer.domElement);

    const uniforms = {
      uTime: { value: 0 },
      uVolume: { value: 0.08 },
      uState: { value: 0 },
      uColorIce: { value: new THREE.Color("#eef8ff") },
      uColorSky: { value: new THREE.Color("#4ea8ff") },
      uColorLime: { value: new THREE.Color("#b9c85a") },
      uColorViolet: { value: new THREE.Color("#8b5cff") },
      uCoreColor: { value: new THREE.Color("#b9c85a") },
      uLightPosition: { value: new THREE.Vector3(0, 0, 0.45) },
    };

    const orbGeometry = new THREE.IcosahedronGeometry(1, 64);
    const orbMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    orbMaterialRef.current = orbMaterial;

    const orbMesh = new THREE.Mesh(orbGeometry, orbMaterial);

    const coreGeometry = new THREE.SphereGeometry(0.34, 40, 40);
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#d9f2ff"),
      emissive: new THREE.Color("#b9c85a"),
      emissiveIntensity: 0.2,
      metalness: 0.08,
      roughness: 0.22,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    coreMaterialRef.current = coreMaterial;
    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);

    const pointLight = new THREE.PointLight("#b9c85a", 1.1, 6.5, 1.9);
    pointLight.position.set(0, 0, 0.45);
    pointLightRef.current = pointLight;

    const ambientLight = new THREE.AmbientLight("#dff2ff", 0.28);
    scene.add(ambientLight);

    const group = new THREE.Group();
    group.add(orbMesh);
    group.add(coreMesh);
    group.add(pointLight);
    scene.add(group);
    orbGroupRef.current = group;

    const resize = () => {
      const width = mountNode.clientWidth || 1;
      const height = mountNode.clientHeight || width;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mountNode);

    let frameId = 0;
    const clock = new THREE.Clock();

    const renderFrame = () => {
      frameId = window.requestAnimationFrame(renderFrame);

      const elapsed = clock.getElapsedTime();
      const analyser = analyserRef.current;
      const analyserData = analyserDataRef.current;
      const currentMode = modeRef.current;
      let targetVolume = 0.1 + Math.sin(elapsed * 0.8) * 0.01;

      if (analyser && analyserData && currentMode === "listening") {
        targetVolume = Math.min(1, readRms(analyser, analyserData) * 5.4);
      } else if (currentMode === "processing") {
        targetVolume = 0.22 + Math.sin(elapsed * 2.3) * 0.08 + Math.sin(elapsed * 4.7) * 0.04;
      } else if (currentMode === "speaking") {
        targetVolume = 0.28 + Math.sin(elapsed * 2.9) * 0.12 + Math.sin(elapsed * 6.2) * 0.05;
      } else if (activeRef.current) {
        targetVolume = 0.14 + Math.sin(elapsed * 1.9) * 0.04;
      }

      smoothedVolumeRef.current = THREE.MathUtils.lerp(
        smoothedVolumeRef.current,
        Math.min(1, Math.max(0.02, targetVolume)),
        0.12,
      );

      orbMaterial.uniforms.uTime.value = elapsed;
      orbMaterial.uniforms.uVolume.value = smoothedVolumeRef.current;
      orbMaterial.uniforms.uState.value = modeToStateValue(currentMode);

      const pulse = 1 + smoothedVolumeRef.current * 0.06 + (currentMode === "processing" ? Math.sin(elapsed * 2.2) * 0.012 : 0);
      group.rotation.y = elapsed * (0.18 + smoothedVolumeRef.current * 0.16);
      group.rotation.x = Math.sin(elapsed * 0.45) * 0.12;
      group.scale.setScalar(pulse);
      coreMesh.scale.setScalar(0.72 + smoothedVolumeRef.current * 0.24);
      coreMaterial.emissiveIntensity = 0.18 + smoothedVolumeRef.current * 0.9;
      pointLight.intensity = 0.9 + smoothedVolumeRef.current * 2.4;

      renderer.render(scene, camera);
    };

    renderFrame();

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      orbGeometry.dispose();
      coreGeometry.dispose();
      orbMaterial.dispose();
      coreMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      rendererRef.current = null;
      orbMaterialRef.current = null;
      coreMaterialRef.current = null;
      orbGroupRef.current = null;
      pointLightRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const cleanup = () => {
      analyserRef.current = null;
      analyserDataRef.current = null;
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context) {
        void context.close().catch(() => {});
      }
    };

    if (!mediaStream || !active || mode !== "listening" || typeof window === "undefined") {
      cleanup();
      return undefined;
    }

    const AudioContextCtor = window.AudioContext || (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;

    if (!AudioContextCtor) {
      cleanup();
      return undefined;
    }

    const audioContext = new AudioContextCtor();
    audioContextRef.current = audioContext;

    const start = async () => {
      try {
        await audioContext.resume();
        if (cancelled) return;
        const source = audioContext.createMediaStreamSource(mediaStream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.78;
        source.connect(analyser);
        analyserRef.current = analyser;
        analyserDataRef.current = new Uint8Array(analyser.fftSize);
      } catch {
        cleanup();
      }
    };

    void start();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [active, mediaStream, mode]);

  if (!active) return null;

  return (
    <div style={wrapperStyle} aria-hidden="true">
      <div
        ref={mountRef}
        role="presentation"
        aria-label={label}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />
    </div>
  );
}
