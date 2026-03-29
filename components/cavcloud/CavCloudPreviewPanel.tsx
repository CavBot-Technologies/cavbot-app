"use client";

import Image from "next/image";
import React from "react";

import { CavCloudTextPanel } from "@/components/cavcloud/CavCloudTextPanel";
import type { CavCloudPreviewItem } from "@/components/cavcloud/preview.types";

import "./cavcloud-preview.css";

type CavCloudPreviewPanelProps = {
  item: CavCloudPreviewItem;
  mode?: "panel" | "page";
  onClose: () => void;
  onOpen: () => void;
  onCopyLink: () => void | Promise<void>;
  onShare: () => void;
  canCopyLink?: boolean;
  canShare?: boolean;
  imagePager?: {
    index: number;
    total: number;
    canPrev: boolean;
    canNext: boolean;
    onPrev: () => void;
    onNext: () => void;
  } | null;
  autoEdit?: boolean;
  autoEditTool?: "adjust" | "crop" | null;
  onOpenInCavCode?: () => void;
  onMountInCavCodeViewer?: () => void;
  mountInCavCodeViewerLocked?: boolean;
  onMountInCavCodeViewerLocked?: () => void;
  mountInCavCodeViewerLockedMessage?: string;
  allowEditing?: boolean;
  openInCavCodeLabel?: string;
};

const IMAGE_ZOOMS = [12, 25, 50, 100, 125, 150, 200] as const;
const UI_ROOT_PATH_LABEL = "/cavcloud";

type FitMode = "none" | "width" | "screen";
type EditTool = "adjust" | "crop";
type CropFormat = "custom" | "ratios" | "facebook" | "instagram" | "linkedin";
type CropHandle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type EditDraft = {
  brightness: number;
  contrast: number;
  highlight: number;
  shadow: number;
  exposure: number;
  saturation: number;
  temperature: number;
  rotationDeg: number;
  flipX: boolean;
  flipY: boolean;
  cropRect: CropRect;
};

type EditTimeline = {
  states: EditDraft[];
  index: number;
};

type EditScalarKey = "brightness" | "contrast" | "highlight" | "shadow" | "exposure" | "saturation" | "temperature";

const EDIT_RANGE_MIN = -100;
const EDIT_RANGE_MAX = 100;
const CROP_MIN_FRACTION = 0.04;
const CROP_MIN_PIXELS = 24;

type CropPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
  format: Exclude<CropFormat, "custom">;
};

const CROP_PRESETS: ReadonlyArray<CropPreset> = [
  { id: "ratio-square", label: "Square 1:1", width: 1, height: 1, format: "ratios" },
  { id: "ratio-portrait", label: "Portrait 3:4", width: 3, height: 4, format: "ratios" },
  { id: "ratio-landscape", label: "Landscape 4:3", width: 4, height: 3, format: "ratios" },
  { id: "ratio-wide", label: "Widescreen 16:9", width: 16, height: 9, format: "ratios" },
  { id: "facebook-profile", label: "Profile picture 170 x 170px", width: 170, height: 170, format: "facebook" },
  { id: "facebook-story", label: "Story 1080 x 1920px", width: 1080, height: 1920, format: "facebook" },
  { id: "facebook-timeline", label: "Timeline post 1200 x 630px", width: 1200, height: 630, format: "facebook" },
  { id: "facebook-cover", label: "Profile cover 820 x 312px", width: 820, height: 312, format: "facebook" },
  { id: "facebook-event", label: "Event cover 1200 x 628px", width: 1200, height: 628, format: "facebook" },
  { id: "instagram-profile", label: "Profile picture 320 x 320px", width: 320, height: 320, format: "instagram" },
  { id: "instagram-story", label: "Story 1080 x 1920px", width: 1080, height: 1920, format: "instagram" },
  { id: "instagram-feed-square", label: "Feed photo square 1080 x 1080px", width: 1080, height: 1080, format: "instagram" },
  { id: "instagram-feed-portrait", label: "Feed photo portrait 1080 x 1350px", width: 1080, height: 1350, format: "instagram" },
  { id: "instagram-feed-landscape", label: "Feed photo landscape 1080 x 566px", width: 1080, height: 566, format: "instagram" },
  { id: "linkedin-profile", label: "Profile photo 400 x 400px", width: 400, height: 400, format: "linkedin" },
  { id: "linkedin-banner", label: "Personal banner 1584 x 396px", width: 1584, height: 396, format: "linkedin" },
  { id: "linkedin-company-cover", label: "Company cover 1128 x 191px", width: 1128, height: 191, format: "linkedin" },
  { id: "linkedin-shared", label: "Shared post 1200 x 627px", width: 1200, height: 627, format: "linkedin" },
  { id: "linkedin-square-post", label: "Square post 1080 x 1080px", width: 1080, height: 1080, format: "linkedin" },
] as const;

const EDIT_DEFAULT_DRAFT: EditDraft = {
  brightness: 0,
  contrast: 0,
  highlight: 0,
  shadow: 0,
  exposure: 0,
  saturation: 0,
  temperature: 0,
  rotationDeg: 0,
  flipX: false,
  flipY: false,
  cropRect: {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  },
};

function clampInt(value: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(min, Math.min(max, n));
}

function normalizedQuarterRotation(deg: number): number {
  const quarter = Math.round(deg / 90);
  const normalizedQuarter = ((quarter % 4) + 4) % 4;
  return normalizedQuarter * 90;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function cropRectEquals(a: CropRect, b: CropRect): boolean {
  return (
    Math.abs(a.x - b.x) < 1e-6
    && Math.abs(a.y - b.y) < 1e-6
    && Math.abs(a.width - b.width) < 1e-6
    && Math.abs(a.height - b.height) < 1e-6
  );
}

function clampCropRect(rect: CropRect, minWidth: number, minHeight: number): CropRect {
  const width = clampNumber(rect.width, minWidth, 1);
  const height = clampNumber(rect.height, minHeight, 1);
  const maxX = Math.max(0, 1 - width);
  const maxY = Math.max(0, 1 - height);
  const x = clampNumber(rect.x, 0, maxX);
  const y = clampNumber(rect.y, 0, maxY);
  return { x, y, width, height };
}

function displayToLogicalPoint(
  point: { x: number; y: number },
  rotationDeg: number,
  flipX: boolean,
  flipY: boolean
): { x: number; y: number } {
  const dx = point.x - 0.5;
  const dy = point.y - 0.5;
  const rad = (-rotationDeg * Math.PI) / 180;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  const lx = flipX ? -rx : rx;
  const ly = flipY ? -ry : ry;
  return {
    x: lx + 0.5,
    y: ly + 0.5,
  };
}

function cropRectForTargetRatio(imageWidth: number, imageHeight: number, targetRatio: number): CropRect {
  if (!Number.isFinite(targetRatio) || targetRatio <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const imageRatio = imageWidth / imageHeight;
  let width = 1;
  let height = 1;
  if (imageRatio > targetRatio) {
    width = clampNumber(targetRatio / imageRatio, CROP_MIN_FRACTION, 1);
    height = 1;
  } else {
    width = 1;
    height = clampNumber(imageRatio / targetRatio, CROP_MIN_FRACTION, 1);
  }
  return {
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
  };
}

function editDraftEquals(a: EditDraft, b: EditDraft): boolean {
  return (
    a.brightness === b.brightness
    && a.contrast === b.contrast
    && a.highlight === b.highlight
    && a.shadow === b.shadow
    && a.exposure === b.exposure
    && a.saturation === b.saturation
    && a.temperature === b.temperature
    && a.rotationDeg === b.rotationDeg
    && a.flipX === b.flipX
    && a.flipY === b.flipY
    && cropRectEquals(a.cropRect, b.cropRect)
  );
}

function composeEditFilter(draft: EditDraft): string {
  const brightness = clampInt(
    100
      + draft.brightness
      + Math.round(draft.exposure * 0.85)
      + Math.round(draft.highlight * 0.22)
      - Math.round(draft.shadow * 0.18),
    10,
    240
  );
  const contrast = clampInt(
    100 + draft.contrast + Math.round(draft.highlight * 0.15) + Math.round(draft.shadow * 0.12),
    10,
    240
  );
  const saturation = clampInt(100 + draft.saturation, 0, 250);
  const sepia = draft.temperature > 0 ? clampInt(Math.round(draft.temperature * 0.35), 0, 90) : 0;
  const hueRotate = draft.temperature >= 0
    ? -(draft.temperature * 0.14)
    : Math.abs(draft.temperature) * 0.18;

  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) sepia(${sepia}%) hue-rotate(${hueRotate.toFixed(2)}deg)`;
}

function editableOutputMimeType(mimeType: string): "image/png" | "image/jpeg" | "image/webp" {
  const direct = String(mimeType || "").trim().toLowerCase();
  if (direct === "image/jpeg" || direct === "image/jpg") return "image/jpeg";
  if (direct === "image/webp") return "image/webp";
  return "image/png";
}

function withVersionParam(url: string, version: number): string {
  if (!version) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}editv=${encodeURIComponent(String(version))}`;
}

function bytesLabel(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "Size pending";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  const rounded = value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${units[unitIdx]}`;
}

function normalizeBytesValue(value: unknown): number | null {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.trunc(raw);
}

function bytesFromResponseHeaders(headers: Headers, statusCode?: number): number | null {
  const contentRange = String(headers.get("content-range") || "").trim();
  if (contentRange) {
    const match = /\/(\d+)\s*$/i.exec(contentRange);
    if (match) {
      const total = normalizeBytesValue(match[1]);
      if (total != null) return total;
    }
  }

  // For partial-content responses, ignore content-length unless total is known via content-range.
  if (statusCode === 206) return null;

  const contentLength = normalizeBytesValue(headers.get("content-length"));
  if (contentLength != null) return contentLength;
  return null;
}

function extensionUpper(name: string): string {
  const raw = String(name || "").trim().toLowerCase();
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return "FILE";
  return raw.slice(idx + 1).toUpperCase() || "FILE";
}

function dateLabel(value?: string | null): string {
  const v = String(value || "").trim();
  if (!v) return "-";
  const ts = Date.parse(v);
  if (!Number.isFinite(ts)) return "-";
  return new Date(ts).toLocaleString();
}

type PreviewCollabAccessRow = {
  id: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  permission: "VIEW" | "EDIT";
  expiresAtISO: string | null;
};

type PreviewCollabAccessResponse = {
  ok?: boolean;
  accessList?: PreviewCollabAccessRow[];
};

function expiryLabel(value: string | null): string {
  if (!value) return "Never";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "Never";
  const days = Math.ceil((ts - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Expired";
  if (days === 1) return "Expires in 1 day";
  return `Expires in ${days} days`;
}

function accessUserLabel(row: { displayName: string | null; username: string | null; email: string | null; userId: string }): string {
  const displayName = String(row.displayName || "").trim();
  if (displayName) return displayName;
  const username = String(row.username || "").trim();
  if (username) return `@${username}`;
  const email = String(row.email || "").trim();
  if (email) return email;
  return String(row.userId || "").trim() || "-";
}

function parentPath(path: string): string {
  const raw = String(path || "").trim();
  if (!raw || raw === "/") return UI_ROOT_PATH_LABEL;
  const parts = raw.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : UI_ROOT_PATH_LABEL;
}

function normalizeTypeLabel(item: CavCloudPreviewItem): string {
  const mime = String(item.mimeType || "").trim();
  if (mime) {
    const top = mime.split("/")[1] || mime;
    return top.toUpperCase();
  }
  return extensionUpper(item.name);
}

function isSvgPreviewItem(item: CavCloudPreviewItem): boolean {
  const mime = String(item.mimeType || "").trim().toLowerCase();
  if (mime === "image/svg+xml") return true;
  return extensionUpper(item.name) === "SVG";
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CavCloudPreviewPanel(props: CavCloudPreviewPanelProps) {
  // Root-cause guard: some SVG uploads may arrive with fallback metadata; force image preview path for SVG.
  const forceSvgImage = isSvgPreviewItem(props.item);
  const item = forceSvgImage
    ? { ...props.item, previewKind: "image" as const, mediaKind: "image" as const }
    : props.item;
  const previewKind = item.previewKind || item.mediaKind;
  if (previewKind !== "image" && previewKind !== "video") {
    return (
      <CavCloudTextPanel
        item={item}
        mode={props.mode}
        onClose={props.onClose}
        onOpen={props.onOpen}
        onCopyLink={props.onCopyLink}
        onShare={props.onShare}
        canCopyLink={props.canCopyLink}
        canShare={props.canShare}
        onOpenInCavCode={props.onOpenInCavCode}
        openInCavCodeLabel={props.openInCavCodeLabel}
        onMountInCavCodeViewer={props.onMountInCavCodeViewer}
        mountInCavCodeViewerLocked={props.mountInCavCodeViewerLocked}
        onMountInCavCodeViewerLocked={props.onMountInCavCodeViewerLocked}
        mountInCavCodeViewerLockedMessage={props.mountInCavCodeViewerLockedMessage}
        allowEditing={props.allowEditing}
      />
    );
  }

  return <CavCloudImageVideoPreviewPanel {...props} item={item} />;
}

function CavCloudImageVideoPreviewPanel(props: CavCloudPreviewPanelProps) {
  const { item, onClose, onOpen, onCopyLink, onShare } = props;
  const mode = props.mode || "panel";
  const canCopyLink = props.canCopyLink !== false;
  const canShare = props.canShare !== false;
  const allowEditing = props.allowEditing !== false;
  const isSvgPreview = item.mediaKind === "image" && isSvgPreviewItem(item);
  const canEditImage = allowEditing && !isSvgPreview;
  const imagePager = props.imagePager || null;
  const autoEdit = canEditImage && props.autoEdit === true;
  const autoEditTool = props.autoEditTool === "crop" || props.autoEditTool === "adjust" ? props.autoEditTool : null;

  const [toolbarHidden, setToolbarHidden] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>("");
  const [copying, setCopying] = React.useState<boolean>(false);
  const [copied, setCopied] = React.useState<boolean>(false);
  const [shareBusy, setShareBusy] = React.useState<boolean>(false);
  const [infoOpen, setInfoOpen] = React.useState<boolean>(false);
  const [discardModalOpen, setDiscardModalOpen] = React.useState<boolean>(false);
  const [collabAccessBusy, setCollabAccessBusy] = React.useState<boolean>(false);
  const [collabAccessError, setCollabAccessError] = React.useState<string>("");
  const [collabAccessList, setCollabAccessList] = React.useState<PreviewCollabAccessRow[]>([]);
  const [mediaReady, setMediaReady] = React.useState<boolean>(false);
  const [resolvedBytes, setResolvedBytes] = React.useState<number | null>(() => normalizeBytesValue(item.bytes));
  const [rawSrcVersion, setRawSrcVersion] = React.useState<number>(0);
  const [editing, setEditing] = React.useState<boolean>(false);
  const [saveBusy, setSaveBusy] = React.useState<boolean>(false);
  const [autoEditApplied, setAutoEditApplied] = React.useState<boolean>(false);
  const [editTool, setEditTool] = React.useState<EditTool>("adjust");
  const [editLightOpen, setEditLightOpen] = React.useState<boolean>(true);
  const [editColorOpen, setEditColorOpen] = React.useState<boolean>(true);
  const [cropFormat, setCropFormat] = React.useState<CropFormat>("custom");
  const [cropLockAspect, setCropLockAspect] = React.useState<boolean>(false);
  const [cropPresetId, setCropPresetId] = React.useState<string>("");
  const [cropWidthInput, setCropWidthInput] = React.useState<string>("");
  const [cropHeightInput, setCropHeightInput] = React.useState<string>("");
  const [editTimeline, setEditTimeline] = React.useState<EditTimeline>({
    states: [EDIT_DEFAULT_DRAFT],
    index: 0,
  });

  const [zoomPct, setZoomPct] = React.useState<number>(100);
  const [fitMode, setFitMode] = React.useState<FitMode>("screen");
  const [rotationDeg, setRotationDeg] = React.useState<number>(0);
  const [flipX, setFlipX] = React.useState<boolean>(false);
  const [flipY, setFlipY] = React.useState<boolean>(false);
  const [nextFlipAxis, setNextFlipAxis] = React.useState<"vertical" | "horizontal">("vertical");

  const [dimensions, setDimensions] = React.useState<{ width: number; height: number } | null>(null);

  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  const copyFeedbackTimerRef = React.useRef<number | null>(null);
  const discardActionRef = React.useRef<(() => void) | null>(null);
  const imageStageRef = React.useRef<HTMLDivElement | null>(null);
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const cropAspectRatioRef = React.useRef<number | null>(null);
  const cropDragRef = React.useRef<{
    pointerId: number;
    handle: CropHandle;
    startRect: CropRect;
    startPoint: { x: number; y: number };
  } | null>(null);
  const [playing, setPlaying] = React.useState<boolean>(false);
  const [durationSec, setDurationSec] = React.useState<number>(0);
  const [currentSec, setCurrentSec] = React.useState<number>(0);
  const [volume, setVolume] = React.useState<number>(1);
  const [speed, setSpeed] = React.useState<number>(1);

  const editState = editTimeline.states[editTimeline.index] || EDIT_DEFAULT_DRAFT;
  const editBaseline = editTimeline.states[0] || EDIT_DEFAULT_DRAFT;
  const editDirty = !editDraftEquals(editState, editBaseline);
  const canUndoEdit = editTimeline.index > 0;
  const canRedoEdit = editTimeline.index < editTimeline.states.length - 1;
  const collabTargetFileId = React.useMemo(() => {
    if (item.source === "file") return String(item.resourceId || "").trim();
    if (item.shareFileId) return String(item.shareFileId || "").trim();
    return "";
  }, [item.resourceId, item.shareFileId, item.source]);
  const activeRawSrc = React.useMemo(() => withVersionParam(item.rawSrc, rawSrcVersion), [item.rawSrc, rawSrcVersion]);
  const cropMinWidth = React.useMemo(() => {
    if (!dimensions?.width) return CROP_MIN_FRACTION;
    return clampNumber(CROP_MIN_PIXELS / dimensions.width, CROP_MIN_FRACTION, 0.6);
  }, [dimensions?.width]);
  const cropMinHeight = React.useMemo(() => {
    if (!dimensions?.height) return CROP_MIN_FRACTION;
    return clampNumber(CROP_MIN_PIXELS / dimensions.height, CROP_MIN_FRACTION, 0.6);
  }, [dimensions?.height]);
  const cropOptions = React.useMemo(
    () => CROP_PRESETS.filter((preset) => preset.format === cropFormat),
    [cropFormat]
  );
  const cropWidthPx = React.useMemo(() => {
    if (!dimensions?.width) return 0;
    return Math.max(1, Math.round(editState.cropRect.width * dimensions.width));
  }, [dimensions?.width, editState.cropRect.width]);
  const cropHeightPx = React.useMemo(() => {
    if (!dimensions?.height) return 0;
    return Math.max(1, Math.round(editState.cropRect.height * dimensions.height));
  }, [dimensions?.height, editState.cropRect.height]);

  React.useEffect(() => {
    setToolbarHidden(false);
    setError("");
    setCopied(false);
    setCollabAccessBusy(false);
    setCollabAccessError("");
    setCollabAccessList([]);
    setRawSrcVersion(0);
    setEditing(false);
    setSaveBusy(false);
    setEditTool("adjust");
    setEditLightOpen(true);
    setEditColorOpen(true);
    setCropFormat("custom");
    setCropLockAspect(false);
    setCropPresetId("");
    setCropWidthInput("");
    setCropHeightInput("");
    cropAspectRatioRef.current = null;
    cropDragRef.current = null;
    setEditTimeline({
      states: [EDIT_DEFAULT_DRAFT],
      index: 0,
    });
    setZoomPct(100);
    setFitMode("screen");
    setRotationDeg(0);
    setFlipX(false);
    setFlipY(false);
    setNextFlipAxis("vertical");
    setDimensions(null);
    setPlaying(false);
    setDurationSec(0);
    setCurrentSec(0);
    setSpeed(1);
    setInfoOpen(false);
    setDiscardModalOpen(false);
    setMediaReady(false);
    discardActionRef.current = null;
    if (copyFeedbackTimerRef.current != null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
  }, [item.id, item.rawSrc]);

  React.useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current != null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
        copyFeedbackTimerRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    setResolvedBytes(normalizeBytesValue(item.bytes));
  }, [item.bytes, item.id, item.path, item.rawSrc, item.resourceId, item.source]);

  React.useEffect(() => {
    if (resolvedBytes != null && resolvedBytes > 0) return;

    let active = true;
    const ctrl = new AbortController();

    const applyResolvedBytes = (value: unknown): boolean => {
      const next = normalizeBytesValue(value);
      if (!active || next == null) return false;
      setResolvedBytes(next);
      return true;
    };

    const resolveFromFileById = async (): Promise<boolean> => {
      const fileId = String(item.resourceId || "").trim();
      if (!fileId || item.source !== "file") return false;
      const res = await fetch(`/api/cavcloud/files/${encodeURIComponent(fileId)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => null) as { ok?: boolean; file?: { bytes?: number | null } } | null;
      if (!res.ok || !json?.ok) return false;
      return applyResolvedBytes(json.file?.bytes);
    };

    const resolveFromPath = async (): Promise<boolean> => {
      if (item.source !== "by_path") return false;
      const normalizedPath = String(item.path || "").trim();
      if (!normalizedPath) return false;
      const res = await fetch(`/api/cavcloud/files/by-path?path=${encodeURIComponent(normalizedPath)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => null) as { ok?: boolean; file?: { bytes?: number | null } } | null;
      if (!res.ok || !json?.ok) return false;
      return applyResolvedBytes(json.file?.bytes);
    };

    const resolveFromTrash = async (): Promise<boolean> => {
      const trashId = String(item.resourceId || "").trim();
      if (!trashId || item.source !== "trash") return false;
      const res = await fetch(`/api/cavcloud/trash/${encodeURIComponent(trashId)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => null) as { ok?: boolean; file?: { bytes?: number | null } } | null;
      if (!res.ok || !json?.ok) return false;
      return applyResolvedBytes(json.file?.bytes);
    };

    const resolveFromArtifact = async (): Promise<boolean> => {
      const artifactId = String(item.resourceId || "").trim();
      if (!artifactId || item.source !== "artifact") return false;
      const res = await fetch(`/api/cavcloud/artifacts/${encodeURIComponent(artifactId)}/preview`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => null) as { ok?: boolean; artifact?: { sizeBytes?: number | null } } | null;
      if (!res.ok || !json?.ok) return false;
      return applyResolvedBytes(json.artifact?.sizeBytes);
    };

    const resolveFromRawStream = async (): Promise<boolean> => {
      const src = String(item.rawSrc || "").trim();
      if (!src) return false;

      const res = await fetch(src, {
        method: "GET",
        headers: {
          Range: "bytes=0-0",
        },
        cache: "no-store",
        credentials: "include",
        signal: ctrl.signal,
      });

      const resolved = applyResolvedBytes(bytesFromResponseHeaders(res.headers, res.status));
      if (res.body) {
        try {
          await res.body.cancel();
        } catch {
          // No-op: body cancel is best effort only.
        }
      }
      return resolved;
    };

    (async () => {
      try {
        if (await resolveFromFileById()) return;
      } catch {
        // best effort only
      }
      try {
        if (await resolveFromPath()) return;
      } catch {
        // best effort only
      }
      try {
        if (await resolveFromTrash()) return;
      } catch {
        // best effort only
      }
      try {
        if (await resolveFromArtifact()) return;
      } catch {
        // best effort only
      }
      try {
        await resolveFromRawStream();
      } catch {
        // best effort only
      }
    })();

    return () => {
      active = false;
      ctrl.abort();
    };
  }, [item.path, item.rawSrc, item.resourceId, item.source, resolvedBytes]);

  React.useEffect(() => {
    if (!autoEdit) {
      setAutoEditApplied(false);
    }
  }, [autoEdit]);

  React.useEffect(() => {
    if (!infoOpen) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setInfoOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [infoOpen]);

  React.useEffect(() => {
    if (!infoOpen) return;
    if (!collabTargetFileId) {
      setCollabAccessList([]);
      setCollabAccessError("");
      setCollabAccessBusy(false);
      return;
    }

    let active = true;
    setCollabAccessBusy(true);
    setCollabAccessError("");
    const params = new URLSearchParams({
      targetType: "file",
      targetId: collabTargetFileId,
    });

    void fetch(`/api/cavcloud/shares/user?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as PreviewCollabAccessResponse | null;
        if (!active) return;
        if (!res.ok || body?.ok === false) {
          throw new Error("Failed to load collaboration access.");
        }
        setCollabAccessList(Array.isArray(body?.accessList) ? body.accessList : []);
      })
      .catch((err) => {
        if (!active) return;
        setCollabAccessError(err instanceof Error ? err.message : "Failed to load collaboration access.");
      })
      .finally(() => {
        if (!active) return;
        setCollabAccessBusy(false);
      });

    return () => {
      active = false;
    };
  }, [collabTargetFileId, infoOpen]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || item.mediaKind !== "video") return;

    const sync = () => {
      setCurrentSec(Number.isFinite(video.currentTime) ? video.currentTime : 0);
      setDurationSec(Number.isFinite(video.duration) ? video.duration : 0);
      setPlaying(!video.paused && !video.ended);
      setVolume(Number.isFinite(video.volume) ? video.volume : 1);
      setMediaReady(true);
      if (video.videoWidth && video.videoHeight) {
        setDimensions({ width: video.videoWidth, height: video.videoHeight });
      }
    };
    const onError = () => {
      setError("Preview unavailable. Use Open.");
    };

    video.addEventListener("timeupdate", sync);
    video.addEventListener("durationchange", sync);
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("canplay", sync);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("durationchange", sync);
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("canplay", sync);
      video.removeEventListener("error", onError);
    };
  }, [item.mediaKind]);

  React.useEffect(() => {
    if (item.mediaKind !== "image") return;
    const node = imageRef.current;
    if (!node) return;
    if (!node.complete) return;

    if (node.naturalWidth && node.naturalHeight) {
      setDimensions({ width: node.naturalWidth, height: node.naturalHeight });
    }
    setMediaReady(true);
    setError("");
  }, [activeRawSrc, item.mediaKind]);

  React.useEffect(() => {
    if (!editing || editTool !== "crop") return;
    if (!cropWidthPx || !cropHeightPx) return;
    setCropWidthInput(String(cropWidthPx));
    setCropHeightInput(String(cropHeightPx));
  }, [cropHeightPx, cropWidthPx, editTool, editing]);

  React.useEffect(() => {
    if (!cropLockAspect) return;
    if (!cropWidthPx || !cropHeightPx) return;
    cropAspectRatioRef.current = cropWidthPx / cropHeightPx;
  }, [cropHeightPx, cropLockAspect, cropWidthPx]);

  const isAlphaCanvas = item.mediaKind === "image" && ["WEBP", "SVG", "AVIF", "GIF"].includes(extensionUpper(item.name));
  const effectiveRotationDeg = editing ? editState.rotationDeg : rotationDeg;
  const effectiveFlipX = editing ? editState.flipX : flipX;
  const effectiveFlipY = editing ? editState.flipY : flipY;
  const editFilter = React.useMemo(() => composeEditFilter(editState), [editState]);

  const imageTransform = React.useMemo(() => {
    const sx = effectiveFlipX ? -1 : 1;
    const sy = effectiveFlipY ? -1 : 1;
    return `rotate(${effectiveRotationDeg}deg) scale(${sx}, ${sy})`;
  }, [effectiveFlipX, effectiveFlipY, effectiveRotationDeg]);

  const imageStageStyle = React.useMemo<React.CSSProperties>(() => ({
    transform: imageTransform,
    transition: "transform .16s ease, opacity .18s ease",
    opacity: mediaReady ? 1 : 0.98,
  }), [imageTransform, mediaReady]);

  const imageStyle = React.useMemo<React.CSSProperties>(() => {
    const style: React.CSSProperties = {
      transition: "filter .14s ease",
    };
    if (editing && item.mediaKind === "image") {
      style.filter = editFilter;
    }
    if (fitMode === "width") {
      style.width = "100%";
      style.height = "auto";
      style.maxWidth = "100%";
      style.maxHeight = "none";
      return style;
    }
    if (fitMode === "screen") {
      style.width = "auto";
      style.height = "auto";
      style.maxWidth = "100%";
      style.maxHeight = "100%";
      return style;
    }
    style.width = `${zoomPct}%`;
    style.height = "auto";
    style.maxWidth = "none";
    style.maxHeight = "none";
    return style;
  }, [editFilter, editing, fitMode, item.mediaKind, zoomPct]);
  const imageRenderStyle = React.useMemo<React.CSSProperties>(() => {
    if (!isSvgPreview) return imageStyle;
    return {
      ...imageStyle,
      width: "min(100%, 920px)",
      maxWidth: "100%",
      minHeight: "220px",
      maxHeight: "78vh",
      height: "auto",
      objectFit: "contain",
    };
  }, [imageStyle, isSvgPreview]);

  const headerMeta = `${normalizeTypeLabel(item)} \u00b7 ${bytesLabel(resolvedBytes)}`;

  const runCopyLink = React.useCallback(async () => {
    if (copying || !canCopyLink) return;
    setCopied(false);
    setCopying(true);
    try {
      await onCopyLink();
      setCopied(true);
      if (copyFeedbackTimerRef.current != null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyFeedbackTimerRef.current = null;
      }, 1400);
    } catch {
      // Parent handles copy-link failures.
      setCopied(false);
    } finally {
      setCopying(false);
    }
  }, [canCopyLink, copying, onCopyLink]);

  const runShare = React.useCallback(async () => {
    if (shareBusy || !canShare) return;
    setShareBusy(true);
    try {
      await onShare();
    } catch {
      // Parent handles share errors.
    } finally {
      setShareBusy(false);
    }
  }, [canShare, onShare, shareBusy]);

  const runDownload = React.useCallback(() => {
    const href = String(item.downloadSrc || "").trim();
    if (!href) return;
    const link = document.createElement("a");
    link.href = href;
    link.rel = "noreferrer";
    link.style.position = "fixed";
    link.style.left = "-9999px";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [item.downloadSrc]);

  const centerPreviewCanvas = React.useCallback(() => {
    const root = surfaceRef.current;
    if (!root) return;
    const canvas = root.querySelector<HTMLDivElement>(".cc-previewCanvas");
    if (!canvas) return;
    const maxX = Math.max(0, canvas.scrollWidth - canvas.clientWidth);
    const maxY = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
    canvas.scrollTo({
      left: maxX / 2,
      top: maxY / 2,
      behavior: "auto",
    });
  }, []);

  const toggleFullscreen = React.useCallback(async () => {
    const el = surfaceRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
        return;
      }
      await el.requestFullscreen();
      window.requestAnimationFrame(() => {
        centerPreviewCanvas();
      });
    } catch {
      // Ignore fullscreen API errors.
    }
  }, [centerPreviewCanvas]);

  React.useEffect(() => {
    const onFullscreenChange = () => {
      if (document.fullscreenElement !== surfaceRef.current) return;
      window.requestAnimationFrame(() => {
        centerPreviewCanvas();
      });
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [centerPreviewCanvas]);

  React.useEffect(() => {
    if (item.mediaKind !== "image") return;
    if (document.fullscreenElement !== surfaceRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      centerPreviewCanvas();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeRawSrc,
    centerPreviewCanvas,
    dimensions?.height,
    dimensions?.width,
    effectiveFlipX,
    effectiveFlipY,
    effectiveRotationDeg,
    fitMode,
    item.mediaKind,
    mediaReady,
    zoomPct,
  ]);

  const togglePlay = React.useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, []);

  const updateCurrentTime = React.useCallback((next: number) => {
    const video = videoRef.current;
    if (!video) return;
    const bounded = Math.max(0, Math.min(Number.isFinite(durationSec) ? durationSec : next, next));
    video.currentTime = bounded;
    setCurrentSec(bounded);
  }, [durationSec]);

  const updateVolume = React.useCallback((next: number) => {
    const video = videoRef.current;
    if (!video) return;
    const bounded = Math.max(0, Math.min(1, next));
    video.volume = bounded;
    setVolume(bounded);
  }, []);

  const updateSpeed = React.useCallback((next: number) => {
    const video = videoRef.current;
    if (!video) return;
    const bounded = Math.max(0.25, Math.min(2, next));
    video.playbackRate = bounded;
    setSpeed(bounded);
  }, []);

  const runFlip = React.useCallback(() => {
    if (nextFlipAxis === "vertical") {
      setFlipY((prev) => !prev);
      setNextFlipAxis("horizontal");
      return;
    }
    setFlipX((prev) => !prev);
    setNextFlipAxis("vertical");
  }, [nextFlipAxis]);

  const flipIconSrc = nextFlipAxis === "vertical"
    ? "/icons/flip-vertical-svgrepo-com.svg"
    : "/icons/flip-horizontal-svgrepo-com.svg";
  const flipAriaLabel = nextFlipAxis === "vertical" ? "Flip vertical" : "Flip horizontal";
  const minZoom = IMAGE_ZOOMS[0];
  const maxZoom = IMAGE_ZOOMS[IMAGE_ZOOMS.length - 1];
  const canZoomOut = zoomPct > minZoom;
  const canZoomIn = zoomPct < maxZoom;

  const stepZoom = React.useCallback((direction: -1 | 1) => {
    setFitMode("none");
    setZoomPct((prev) => {
      if (direction < 0) {
        for (let idx = IMAGE_ZOOMS.length - 1; idx >= 0; idx -= 1) {
          if (IMAGE_ZOOMS[idx] < prev) return IMAGE_ZOOMS[idx];
        }
        return minZoom;
      }
      for (let idx = 0; idx < IMAGE_ZOOMS.length; idx += 1) {
        if (IMAGE_ZOOMS[idx] > prev) return IMAGE_ZOOMS[idx];
      }
      return maxZoom;
    });
  }, [maxZoom, minZoom]);

  const pushEditState = React.useCallback((updater: (prev: EditDraft) => EditDraft) => {
    setEditTimeline((prev) => {
      const current = prev.states[prev.index] || EDIT_DEFAULT_DRAFT;
      const next = updater(current);
      if (editDraftEquals(current, next)) return prev;

      const clipped = prev.states.slice(0, prev.index + 1);
      clipped.push(next);
      return {
        states: clipped,
        index: clipped.length - 1,
      };
    });
  }, []);

  const runEditFlip = React.useCallback(() => {
    if (nextFlipAxis === "vertical") {
      pushEditState((prev) => ({ ...prev, flipY: !prev.flipY }));
      setNextFlipAxis("horizontal");
      return;
    }
    pushEditState((prev) => ({ ...prev, flipX: !prev.flipX }));
    setNextFlipAxis("vertical");
  }, [nextFlipAxis, pushEditState]);

  const setEditScalar = React.useCallback((key: EditScalarKey, value: number) => {
    pushEditState((prev) => ({
      ...prev,
      [key]: clampInt(value, EDIT_RANGE_MIN, EDIT_RANGE_MAX),
    }));
  }, [pushEditState]);

  const setCropRectWithMode = React.useCallback((nextRect: CropRect, mode: "push" | "replace" = "push") => {
    const clampedRect = clampCropRect(nextRect, cropMinWidth, cropMinHeight);
    if (mode === "replace") {
      setEditTimeline((prev) => {
        const current = prev.states[prev.index] || EDIT_DEFAULT_DRAFT;
        if (cropRectEquals(current.cropRect, clampedRect)) return prev;
        const states = prev.states.slice();
        states[prev.index] = {
          ...current,
          cropRect: clampedRect,
        };
        return { states, index: prev.index };
      });
      return;
    }
    pushEditState((prev) => {
      if (cropRectEquals(prev.cropRect, clampedRect)) return prev;
      return {
        ...prev,
        cropRect: clampedRect,
      };
    });
  }, [cropMinHeight, cropMinWidth, pushEditState]);

  const applyCropPixelSize = React.useCallback((nextWidthPx: number, nextHeightPx: number, mode: "push" | "replace" = "push") => {
    if (!dimensions?.width || !dimensions.height) return;
    const normalizedWidth = clampNumber(nextWidthPx / dimensions.width, cropMinWidth, 1);
    const normalizedHeight = clampNumber(nextHeightPx / dimensions.height, cropMinHeight, 1);
    const centerX = editState.cropRect.x + (editState.cropRect.width / 2);
    const centerY = editState.cropRect.y + (editState.cropRect.height / 2);
    const nextRect = clampCropRect({
      x: centerX - (normalizedWidth / 2),
      y: centerY - (normalizedHeight / 2),
      width: normalizedWidth,
      height: normalizedHeight,
    }, cropMinWidth, cropMinHeight);
    setCropRectWithMode(nextRect, mode);
  }, [cropMinHeight, cropMinWidth, dimensions?.height, dimensions?.width, editState.cropRect.height, editState.cropRect.width, editState.cropRect.x, editState.cropRect.y, setCropRectWithMode]);

  const applyCropPreset = React.useCallback((preset: CropPreset) => {
    const aspectRatio = preset.width / preset.height;
    setCropFormat(preset.format);
    setCropPresetId(preset.id);
    setCropLockAspect(true);
    cropAspectRatioRef.current = aspectRatio;
    if (!dimensions?.width || !dimensions.height) return;
    const nextRect = cropRectForTargetRatio(dimensions.width, dimensions.height, aspectRatio);
    setCropRectWithMode(nextRect, "push");
  }, [dimensions?.height, dimensions?.width, setCropRectWithMode]);

  const commitCropInputs = React.useCallback((source: "width" | "height") => {
    if (!dimensions?.width || !dimensions.height) return;

    let nextWidth = Number.parseInt(cropWidthInput, 10);
    let nextHeight = Number.parseInt(cropHeightInput, 10);
    const fallbackWidth = Math.max(1, cropWidthPx || dimensions.width);
    const fallbackHeight = Math.max(1, cropHeightPx || dimensions.height);

    if (!Number.isFinite(nextWidth) || nextWidth <= 0) nextWidth = fallbackWidth;
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) nextHeight = fallbackHeight;

    const activeRatio = cropAspectRatioRef.current || (fallbackWidth / Math.max(1, fallbackHeight));
    if (cropLockAspect && Number.isFinite(activeRatio) && activeRatio > 0) {
      if (source === "width") {
        nextHeight = Math.max(1, Math.round(nextWidth / activeRatio));
      } else {
        nextWidth = Math.max(1, Math.round(nextHeight * activeRatio));
      }
    }

    setCropFormat("custom");
    setCropPresetId("");
    setCropWidthInput(String(nextWidth));
    setCropHeightInput(String(nextHeight));
    applyCropPixelSize(nextWidth, nextHeight, "push");
  }, [applyCropPixelSize, cropHeightInput, cropHeightPx, cropLockAspect, cropWidthInput, cropWidthPx, dimensions?.height, dimensions?.width]);

  const getCropPointFromPointer = React.useCallback((clientX: number, clientY: number) => {
    const stage = imageStageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const displayPoint = {
      x: clampNumber((clientX - rect.left) / rect.width, 0, 1),
      y: clampNumber((clientY - rect.top) / rect.height, 0, 1),
    };

    const logicalPoint = displayToLogicalPoint(
      displayPoint,
      normalizedQuarterRotation(editState.rotationDeg),
      editState.flipX,
      editState.flipY
    );
    return {
      x: clampNumber(logicalPoint.x, 0, 1),
      y: clampNumber(logicalPoint.y, 0, 1),
    };
  }, [editState.flipX, editState.flipY, editState.rotationDeg]);

  const calculateDraggedCropRect = React.useCallback((
    handle: CropHandle,
    startRect: CropRect,
    startPoint: { x: number; y: number },
    nextPoint: { x: number; y: number }
  ): CropRect => {
    const deltaX = nextPoint.x - startPoint.x;
    const deltaY = nextPoint.y - startPoint.y;
    const startLeft = startRect.x;
    const startTop = startRect.y;
    const startRight = startRect.x + startRect.width;
    const startBottom = startRect.y + startRect.height;

    if (handle === "move") {
      return clampCropRect({
        x: startLeft + deltaX,
        y: startTop + deltaY,
        width: startRect.width,
        height: startRect.height,
      }, cropMinWidth, cropMinHeight);
    }

    let left = startLeft;
    let top = startTop;
    let right = startRight;
    let bottom = startBottom;

    if (handle.includes("w")) left = startLeft + deltaX;
    if (handle.includes("e")) right = startRight + deltaX;
    if (handle.includes("n")) top = startTop + deltaY;
    if (handle.includes("s")) bottom = startBottom + deltaY;

    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (right > 1) right = 1;
    if (bottom > 1) bottom = 1;

    if (right - left < cropMinWidth) {
      if (handle.includes("w")) {
        left = right - cropMinWidth;
      } else {
        right = left + cropMinWidth;
      }
    }
    if (bottom - top < cropMinHeight) {
      if (handle.includes("n")) {
        top = bottom - cropMinHeight;
      } else {
        bottom = top + cropMinHeight;
      }
    }

    left = clampNumber(left, 0, 1 - cropMinWidth);
    top = clampNumber(top, 0, 1 - cropMinHeight);
    right = clampNumber(right, cropMinWidth, 1);
    bottom = clampNumber(bottom, cropMinHeight, 1);

    return clampCropRect({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    }, cropMinWidth, cropMinHeight);
  }, [cropMinHeight, cropMinWidth]);

  const onCropPointerMove = React.useCallback((ev: PointerEvent) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    const nextPoint = getCropPointFromPointer(ev.clientX, ev.clientY);
    if (!nextPoint) return;
    const nextRect = calculateDraggedCropRect(drag.handle, drag.startRect, drag.startPoint, nextPoint);
    setCropRectWithMode(nextRect, "replace");
    ev.preventDefault();
  }, [calculateDraggedCropRect, getCropPointFromPointer, setCropRectWithMode]);

  const onCropPointerUp = React.useCallback((ev: PointerEvent) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    cropDragRef.current = null;
    window.removeEventListener("pointermove", onCropPointerMove);
    window.removeEventListener("pointerup", onCropPointerUp);
    window.removeEventListener("pointercancel", onCropPointerUp);
  }, [onCropPointerMove]);

  const startCropDrag = React.useCallback((ev: React.PointerEvent<HTMLElement>, handle: CropHandle) => {
    if (!editing || editTool !== "crop" || item.mediaKind !== "image") return;
    const point = getCropPointFromPointer(ev.clientX, ev.clientY);
    if (!point) return;
    setCropPresetId("");

    setEditTimeline((prev) => {
      const current = prev.states[prev.index] || EDIT_DEFAULT_DRAFT;
      const clipped = prev.states.slice(0, prev.index + 1);
      clipped.push({
        ...current,
        cropRect: { ...current.cropRect },
      });
      return {
        states: clipped,
        index: clipped.length - 1,
      };
    });

    cropDragRef.current = {
      pointerId: ev.pointerId,
      handle,
      startRect: { ...editState.cropRect },
      startPoint: point,
    };

    window.removeEventListener("pointermove", onCropPointerMove);
    window.removeEventListener("pointerup", onCropPointerUp);
    window.removeEventListener("pointercancel", onCropPointerUp);
    window.addEventListener("pointermove", onCropPointerMove, { passive: false });
    window.addEventListener("pointerup", onCropPointerUp);
    window.addEventListener("pointercancel", onCropPointerUp);
    ev.preventDefault();
    ev.stopPropagation();
  }, [editState.cropRect, editTool, editing, getCropPointFromPointer, item.mediaKind, onCropPointerMove, onCropPointerUp]);

  React.useEffect(() => () => {
    cropDragRef.current = null;
    window.removeEventListener("pointermove", onCropPointerMove);
    window.removeEventListener("pointerup", onCropPointerUp);
    window.removeEventListener("pointercancel", onCropPointerUp);
  }, [onCropPointerMove, onCropPointerUp]);

  const startAdjustMode = React.useCallback((tool: EditTool = "adjust") => {
    if (item.mediaKind !== "image") return;
    const initial: EditDraft = {
      ...EDIT_DEFAULT_DRAFT,
      rotationDeg,
      flipX,
      flipY,
    };
    setEditTimeline({ states: [initial], index: 0 });
    setEditTool(tool);
    setEditLightOpen(true);
    setEditColorOpen(true);
    setCropFormat("custom");
    setCropPresetId("");
    setCropLockAspect(false);
    cropAspectRatioRef.current = null;
    if (dimensions?.width && dimensions?.height) {
      setCropWidthInput(String(dimensions.width));
      setCropHeightInput(String(dimensions.height));
    } else {
      setCropWidthInput("");
      setCropHeightInput("");
    }
    setToolbarHidden(false);
    setNextFlipAxis("vertical");
    setEditing(true);
    setError("");
  }, [dimensions?.height, dimensions?.width, flipX, flipY, item.mediaKind, rotationDeg]);

  React.useEffect(() => {
    if (mode !== "page") return;
    if (autoEditApplied) return;
    if (item.mediaKind !== "image") return;
    let initialTool: EditTool = autoEditTool || "adjust";
    let hasToolRequest = Boolean(autoEditTool);
    if (typeof window !== "undefined") {
      const currentUrl = new URL(window.location.href);
      const requestedTools = currentUrl.searchParams
        .getAll("tool")
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value): value is EditTool => value === "adjust" || value === "crop");
      if (requestedTools.length > 0) hasToolRequest = true;
      if (requestedTools.includes("crop")) {
        initialTool = "crop";
      } else if (requestedTools.includes("adjust")) {
        initialTool = "adjust";
      }
    }
    if (!autoEdit && !hasToolRequest) return;
    startAdjustMode(initialTool);
    setAutoEditApplied(true);
  }, [autoEdit, autoEditApplied, autoEditTool, item.mediaKind, mode, startAdjustMode]);

  const cancelAdjustMode = React.useCallback(() => {
    setEditing(false);
    setSaveBusy(false);
    setEditTool("adjust");
    setEditTimeline({ states: [EDIT_DEFAULT_DRAFT], index: 0 });
    setError("");
  }, []);

  const dismissDiscardModal = React.useCallback(() => {
    discardActionRef.current = null;
    setDiscardModalOpen(false);
  }, []);

  const confirmDiscardChanges = React.useCallback(() => {
    const nextAction = discardActionRef.current;
    discardActionRef.current = null;
    setDiscardModalOpen(false);
    nextAction?.();
  }, []);

  const requestDiscardConfirm = React.useCallback((onDiscard: () => void): boolean => {
    if (!(editing && item.mediaKind === "image" && editDirty)) {
      onDiscard();
      return true;
    }
    discardActionRef.current = onDiscard;
    setDiscardModalOpen(true);
    return false;
  }, [editDirty, editing, item.mediaKind]);

  const handleCancelAdjustMode = React.useCallback(() => {
    requestDiscardConfirm(() => {
      cancelAdjustMode();
    });
  }, [cancelAdjustMode, requestDiscardConfirm]);

  const closePreview = React.useCallback(() => {
    requestDiscardConfirm(() => {
      onClose();
    });
  }, [onClose, requestDiscardConfirm]);

  React.useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (discardModalOpen) {
        ev.preventDefault();
        dismissDiscardModal();
        return;
      }
      if (infoOpen) return;
      if (editing && item.mediaKind === "image") {
        ev.preventDefault();
        handleCancelAdjustMode();
        return;
      }
      ev.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [discardModalOpen, dismissDiscardModal, editing, handleCancelAdjustMode, infoOpen, item.mediaKind, onClose]);

  const undoAdjust = React.useCallback(() => {
    setEditTimeline((prev) => {
      if (prev.index <= 0) return prev;
      return { states: prev.states, index: prev.index - 1 };
    });
  }, []);

  const redoAdjust = React.useCallback(() => {
    setEditTimeline((prev) => {
      if (prev.index >= prev.states.length - 1) return prev;
      return { states: prev.states, index: prev.index + 1 };
    });
  }, []);

  const renderEditedImageBlob = React.useCallback(async (sourceUrl: string, draft: EditDraft, mimeType: string) => {
    const imageEl = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
      img.src = sourceUrl;
    });

    const baseCropRect = clampCropRect(
      draft.cropRect,
      Math.max(CROP_MIN_FRACTION, CROP_MIN_PIXELS / Math.max(1, imageEl.naturalWidth)),
      Math.max(CROP_MIN_FRACTION, CROP_MIN_PIXELS / Math.max(1, imageEl.naturalHeight))
    );
    const cropX = clampInt(Math.round(baseCropRect.x * imageEl.naturalWidth), 0, Math.max(0, imageEl.naturalWidth - 1));
    const cropY = clampInt(Math.round(baseCropRect.y * imageEl.naturalHeight), 0, Math.max(0, imageEl.naturalHeight - 1));
    const cropWidth = clampInt(
      Math.round(baseCropRect.width * imageEl.naturalWidth),
      1,
      Math.max(1, imageEl.naturalWidth - cropX)
    );
    const cropHeight = clampInt(
      Math.round(baseCropRect.height * imageEl.naturalHeight),
      1,
      Math.max(1, imageEl.naturalHeight - cropY)
    );

    const rotation = normalizedQuarterRotation(draft.rotationDeg);
    const swapAxes = rotation === 90 || rotation === 270;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, swapAxes ? cropHeight : cropWidth);
    canvas.height = Math.max(1, swapAxes ? cropWidth : cropHeight);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CANVAS_CONTEXT_UNAVAILABLE");

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(draft.flipX ? -1 : 1, draft.flipY ? -1 : 1);
    ctx.filter = composeEditFilter(draft);
    ctx.drawImage(
      imageEl,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      -cropWidth / 2,
      -cropHeight / 2,
      cropWidth,
      cropHeight
    );
    ctx.restore();

    const outputMimeType = editableOutputMimeType(mimeType);
    const quality = outputMimeType === "image/jpeg" || outputMimeType === "image/webp" ? 0.92 : undefined;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputMimeType, quality));
    if (!blob) throw new Error("CANVAS_EXPORT_FAILED");

    return { blob, outputMimeType };
  }, []);

  const saveAdjustments = React.useCallback(async () => {
    if (saveBusy || !editing || item.mediaKind !== "image") return;
    if (item.source !== "file") {
      setError("Saving edits is only available for CavCloud files.");
      return;
    }

    setSaveBusy(true);
    try {
      const { blob, outputMimeType } = await renderEditedImageBlob(activeRawSrc, editState, item.mimeType);
      const res = await fetch(`/api/cavcloud/files/${encodeURIComponent(item.resourceId)}`, {
        method: "PUT",
        headers: { "Content-Type": outputMimeType },
        body: blob,
      });
      const json = await res.json().catch(() => null) as { ok?: boolean } | null;
      if (!res.ok || !json?.ok) {
        throw new Error("SAVE_FAILED");
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("cavcloud:file-updated", {
          detail: {
            fileId: item.resourceId,
            path: item.path,
            updatedAtISO: new Date().toISOString(),
            bytes: blob.size,
          },
        }));
      }
      setResolvedBytes(blob.size);

      setRotationDeg(0);
      setFlipX(false);
      setFlipY(false);
      setNextFlipAxis("vertical");
      setFitMode("screen");
      setZoomPct(100);
      setEditing(false);
      setEditTool("adjust");
      setEditTimeline({ states: [EDIT_DEFAULT_DRAFT], index: 0 });
      setRawSrcVersion(Date.now());
      setMediaReady(false);
      setError("");
    } catch {
      setError("Failed to save image edits. Try again.");
    } finally {
      setSaveBusy(false);
    }
  }, [activeRawSrc, editState, editing, item.mediaKind, item.mimeType, item.path, item.resourceId, item.source, renderEditedImageBlob, saveBusy]);

  const handleAdjustClick = React.useCallback(() => {
    if (!canEditImage) return;
    // Root-cause fix (A1/A2): keep edit workflow inside the side panel.
    startAdjustMode("adjust");
  }, [canEditImage, startAdjustMode]);

  const handleCropClick = React.useCallback(() => {
    if (!canEditImage) return;
    // Root-cause fix (A1/A2): avoid full-document navigation while preview is open.
    startAdjustMode("crop");
  }, [canEditImage, startAdjustMode]);

  const orientation = React.useMemo(() => {
    const explicit = String(item.orientation || "").trim();
    if (explicit) return explicit;
    if (!dimensions) return "-";
    if (dimensions.width === dimensions.height) return "Square";
    return dimensions.width > dimensions.height ? "Landscape" : "Portrait";
  }, [dimensions, item.orientation]);

  const detailsRows: Array<{ label: string; value: string }> = [
    { label: "Name", value: item.name || "-" },
    { label: "Saved in", value: parentPath(item.path) },
    { label: "Size", value: bytesLabel(resolvedBytes) },
    { label: "Modified", value: dateLabel(item.modifiedAtISO) },
    { label: "Type", value: normalizeTypeLabel(item) },
    { label: "Uploaded by", value: String(item.uploadedBy || "").trim() || "CavCloud user" },
    { label: "Date uploaded", value: dateLabel(item.uploadedAtISO) },
    { label: "Date created", value: dateLabel(item.createdAtISO) },
    {
      label: "Dimensions",
      value: dimensions ? `${dimensions.width} \u00d7 ${dimensions.height}` : "-",
    },
    { label: "Orientation", value: orientation },
  ];
  const sharedUsersCount = React.useMemo(() => {
    const fromItem = Number(item.sharedUserCount || 0);
    if (Number.isFinite(fromItem) && fromItem > 0) return Math.max(0, Math.trunc(fromItem));
    return collabAccessList.length;
  }, [collabAccessList.length, item.sharedUserCount]);
  const collaborationEnabled = React.useMemo(() => {
    if (item.collaborationEnabled) return true;
    return collabAccessList.some((row) => row.permission === "EDIT");
  }, [collabAccessList, item.collaborationEnabled]);
  const cropLeftPct = editState.cropRect.x * 100;
  const cropTopPct = editState.cropRect.y * 100;
  const cropWidthPct = editState.cropRect.width * 100;
  const cropHeightPct = editState.cropRect.height * 100;
  const cropRightPct = Math.max(0, 100 - (cropLeftPct + cropWidthPct));
  const cropBottomPct = Math.max(0, 100 - (cropTopPct + cropHeightPct));

  return (
    <section className={`cc-previewPanel ${mode === "page" ? "is-page" : ""}`} aria-label="CavCloud preview panel">
      <header className="cc-previewHeader">
        <div className="cc-previewHeadLeft">
          <h2 className="cc-previewName" title={item.name}>{item.name}</h2>
          <div className="cc-previewMetaLine">{headerMeta}</div>
          <button
            className="cc-previewInfoBtn"
            type="button"
            onClick={() => setInfoOpen(true)}
          >
            File info
          </button>
        </div>
        <div className="cc-previewHeadRight">
          {editing && item.mediaKind === "image" ? (
            <>
              <div className="cc-previewEditStatus">{editDirty ? "Unsaved changes" : "No changes made"}</div>
              <button
                className="cc-previewIconBtn"
                type="button"
                onClick={undoAdjust}
                disabled={!canUndoEdit}
                aria-label="Undo"
                title="Undo"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M9 7 5 11l4 4M6 11h7a5 5 0 0 1 0 10h-2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                className="cc-previewIconBtn"
                type="button"
                onClick={redoAdjust}
                disabled={!canRedoEdit}
                aria-label="Redo"
                title="Redo"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M15 7 19 11l-4 4M18 11h-7a5 5 0 0 0 0 10h2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                className="cc-previewActionBtn"
                type="button"
                onClick={handleCancelAdjustMode}
              >
                Cancel
              </button>
              <button
                className="cc-previewActionBtn cc-previewActionBtnSave"
                type="button"
                onClick={() => void saveAdjustments()}
                disabled={!editDirty || saveBusy || item.source !== "file"}
              >
                {saveBusy ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <>
              {imagePager && imagePager.total > 0 && !isSvgPreview ? (
                <div className="cc-previewPager" role="group" aria-label="Image switcher">
                  <button
                    className="cc-previewIconBtn cc-previewPagerBtn"
                    type="button"
                    onClick={imagePager.onPrev}
                    disabled={!imagePager.canPrev}
                    aria-label="Previous image"
                    title="Previous image"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M14.5 6.5 9 12l5.5 5.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <div className="cc-previewPagerCount" aria-live="polite">{imagePager.index} of {imagePager.total}</div>
                  <button
                    className="cc-previewIconBtn cc-previewPagerBtn"
                    type="button"
                    onClick={imagePager.onNext}
                    disabled={!imagePager.canNext}
                    aria-label="Next image"
                    title="Next image"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M9.5 6.5 15 12l-5.5 5.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              ) : null}
              <button
                className="cc-previewIconBtn"
                type="button"
                onClick={() => void runCopyLink()}
                disabled={!canCopyLink || copying}
                aria-label={copied ? "Link copied" : "Copy link"}
                title={copied ? "Link copied" : "Copy link"}
              >
                <Image
                  src="/icons/link-alt-1-svgrepo-com.svg"
                  alt=""
                  width={14}
                  height={14}
                  className="cc-previewCopyIcon"
                  aria-hidden="true"
                />
              </button>
              {isSvgPreview ? (
                <button
                  className="cc-previewActionBtn"
                  type="button"
                  onClick={runDownload}
                  aria-label="Download"
                >
                  Download
                </button>
              ) : (
                <>
                  <button
                    className="cc-previewIconBtn"
                    type="button"
                    onClick={() => void runShare()}
                    disabled={!canShare || shareBusy}
                    aria-label="Share"
                    title="Share"
                  >
                    <Image src="/icons/team-svgrepo-com.svg" alt="" width={14} height={14} className="cc-previewCopyIcon" aria-hidden="true" />
                  </button>
                  {mode === "panel" ? (
                    <button
                      className="cc-previewActionBtn"
                      type="button"
                      onClick={onOpen}
                      aria-label="Open viewer"
                    >
                      Open
                    </button>
                  ) : null}
                  {props.onMountInCavCodeViewer ? (
                    <button
                      className="cc-previewActionBtn"
                      type="button"
                      onClick={props.onMountInCavCodeViewer}
                      aria-label="Mount in CavCode Viewer"
                    >
                      Mount in Viewer
                    </button>
                  ) : null}
                </>
              )}
            </>
          )}
          <button
            className="cc-previewIconBtn"
            type="button"
            onClick={closePreview}
            aria-label={mode === "page" ? "Back" : "Close preview"}
            title={mode === "page" ? "Back" : "Close"}
          >
            <span className="cb-closeIcon" aria-hidden="true" />
          </button>
        </div>
      </header>

      {!isSvgPreview ? (
        <div className={`cc-previewToolbar ${toolbarHidden ? "is-hidden" : ""}`}>
          {item.mediaKind === "image" ? (
          editing ? (
            <div className="cc-previewEditActionRow">
              <button
                className="cc-previewToolBtn cc-previewToolBtnIconOnly"
                type="button"
                onClick={() => pushEditState((prev) => ({ ...prev, rotationDeg: prev.rotationDeg - 90 }))}
                aria-label="Rotate left"
                title="Rotate left"
              >
                <Image className="cc-previewToolGlyph" src="/icons/rotate-left-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
              </button>
              <button
                className="cc-previewToolBtn cc-previewToolBtnIconOnly"
                type="button"
                onClick={() => pushEditState((prev) => ({ ...prev, rotationDeg: prev.rotationDeg + 90 }))}
                aria-label="Rotate right"
                title="Rotate right"
              >
                <Image className="cc-previewToolGlyph" src="/icons/rotate-right-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
              </button>
              <button
                className="cc-previewToolBtn cc-previewToolBtnIconOnly"
                type="button"
                onClick={runEditFlip}
                aria-label={flipAriaLabel}
                title={flipAriaLabel}
              >
                <Image className="cc-previewToolGlyph" src={flipIconSrc} alt="" width={20} height={20} aria-hidden="true" />
              </button>
              <button
                className={`cc-previewToolBtn cc-previewToolModeBtn ${editTool === "crop" ? "is-active" : ""}`}
                type="button"
                onClick={() => setEditTool("crop")}
                aria-label="Crop"
                title="Crop"
              >
                <Image className="cc-previewToolGlyph" src="/icons/crop-01-svgrepo-com.svg" alt="" width={16} height={16} aria-hidden="true" />
                Crop
              </button>
              <button
                className={`cc-previewToolBtn cc-previewToolModeBtn ${editTool === "adjust" ? "is-active" : ""}`}
                type="button"
                onClick={() => setEditTool("adjust")}
                aria-label="Adjust"
                title="Adjust"
              >
                <Image className="cc-previewToolGlyph" src="/icons/controls-adjust-svgrepo-com.svg" alt="" width={16} height={16} aria-hidden="true" />
                Adjust
              </button>
              <button
                className="cc-previewToolBtn cc-previewToolBtnEdge"
                type="button"
                onClick={() => {
                  setCropPresetId("");
                  setCropFormat("custom");
                  setCropLockAspect(false);
                  cropAspectRatioRef.current = null;
                  setEditTimeline({
                    states: [{
                      ...EDIT_DEFAULT_DRAFT,
                      rotationDeg,
                      flipX,
                      flipY,
                    }],
                    index: 0,
                  });
                }}
              >
                Reset
              </button>
            </div>
          ) : (
            <>
              <div className="cc-previewZoomCluster">
                <button
                  className="cc-previewToolBtn cc-previewToolBtnIconOnly cc-previewZoomStepBtn"
                  type="button"
                onClick={() => stepZoom(-1)}
                disabled={!canZoomOut}
                aria-label="Zoom out"
                title="Zoom out"
              >
                  <svg className="cc-previewZoomStepIcon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12h14" />
                  </svg>
                </button>
                <button
                  className="cc-previewToolBtn cc-previewToolBtnIconOnly cc-previewZoomStepBtn"
                  type="button"
                onClick={() => stepZoom(1)}
                disabled={!canZoomIn}
                aria-label="Zoom in"
                title="Zoom in"
              >
                  <svg className="cc-previewZoomStepIcon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <select
                  className="cc-previewToolSelect cc-previewToolSelectZoom"
                  value={zoomPct}
                  onChange={(ev) => {
                    setFitMode("none");
                    setZoomPct(Number(ev.currentTarget.value));
                  }}
                  aria-label="Zoom"
                >
                  {IMAGE_ZOOMS.map((pct) => (
                    <option key={pct} value={pct}>{pct}%</option>
                  ))}
                </select>
              </div>
              <button className="cc-previewToolBtn cc-previewToolBtnIconOnly" type="button" onClick={() => setFitMode("width")} aria-label="Fit width" title="Fit width">
                <Image className="cc-previewToolGlyph cc-previewFitToolIcon" src="/icons/arrow-fit-width-svgrepo-com.svg" alt="" width={24} height={24} aria-hidden="true" />
              </button>
              <button className="cc-previewToolBtn cc-previewToolBtnIconOnly" type="button" onClick={() => setFitMode("screen")} aria-label="Fit screen" title="Fit screen">
                <Image className="cc-previewToolGlyph cc-previewFitToolIcon" src="/icons/fit-to-screen-svgrepo-com.svg" alt="" width={24} height={24} aria-hidden="true" />
              </button>
              {canEditImage ? (
                <>
                  <button
                    className="cc-previewToolBtn cc-previewToolIconBtn is-rotate"
                    type="button"
                    onClick={() => setRotationDeg((prev) => prev - 90)}
                    aria-label="Rotate left"
                    title="Rotate left"
                  >
                    <Image className="cc-previewToolGlyph" src="/icons/rotate-left-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
                  </button>
                  <button
                    className="cc-previewToolBtn cc-previewToolIconBtn is-rotate"
                    type="button"
                    onClick={() => setRotationDeg((prev) => prev + 90)}
                    aria-label="Rotate right"
                    title="Rotate right"
                  >
                    <Image className="cc-previewToolGlyph" src="/icons/rotate-right-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
                  </button>
                  <button className="cc-previewToolBtn cc-previewToolIconBtn" type="button" onClick={runFlip} aria-label={flipAriaLabel} title={flipAriaLabel}>
                    <Image className="cc-previewToolGlyph" src={flipIconSrc} alt="" width={20} height={20} aria-hidden="true" />
                  </button>
                  <button
                    className="cc-previewToolBtn cc-previewToolIconBtn"
                    type="button"
                    onClick={handleCropClick}
                    aria-label="Crop"
                    title="Crop"
                  >
                    <Image className="cc-previewToolGlyph" src="/icons/crop-01-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
                  </button>
                </>
              ) : null}
              <button className="cc-previewToolBtn cc-previewToolBtnIconOnly" type="button" onClick={() => void toggleFullscreen()} aria-label="Fullscreen" title="Fullscreen">
                <Image className="cc-previewToolGlyph" src="/icons/full-screen-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
              </button>
              {canEditImage ? (
                <button
                  className="cc-previewToolBtn cc-previewToolBtnIconOnly cc-previewToolBtnIconEdit"
                  type="button"
                  aria-label="Adjust"
                  title="Adjust"
                  onClick={handleAdjustClick}
                >
                  <Image className="cc-previewToolGlyph" src="/icons/controls-adjust-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
                </button>
              ) : null}
              <button
                className="cc-previewToolBtn cc-previewToolBtnIconOnly cc-previewToolBtnTail"
                type="button"
                onClick={() => setToolbarHidden(true)}
                aria-label="Hide toolbar"
                title="Hide toolbar"
              >
                <Image className="cc-previewToolGlyph" src="/icons/hide-sdebar-vert-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
              </button>
            </>
          )
          ) : (
          <>
            <button
              className="cc-previewToolBtn cc-previewToolBtnIconOnly cc-previewVideoPlayBtn"
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause" : "Play"}
            >
              <Image className="cc-previewToolGlyph cc-previewVideoPlayGlyph" src={playing ? "/icons/pause-circle-svgrepo-com.svg" : "/icons/play-circle-svgrepo-com.svg"} alt="" width={24} height={24} aria-hidden="true" />
            </button>
            <input
              className="cc-previewToolInput cc-previewVideoProgress"
              type="range"
              min={0}
              max={Math.max(1, durationSec)}
              step={0.1}
              value={Math.min(currentSec, Math.max(1, durationSec))}
              onChange={(ev) => updateCurrentTime(Number(ev.currentTarget.value))}
              aria-label="Seek"
            />
            <span className="cc-previewTime">{formatTime(currentSec)} / {formatTime(durationSec)}</span>
            <input
              className="cc-previewToolInput cc-previewVideoVolume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(ev) => updateVolume(Number(ev.currentTarget.value))}
              aria-label="Volume"
            />
            <select
              className="cc-previewToolSelect"
              value={speed}
              onChange={(ev) => updateSpeed(Number(ev.currentTarget.value))}
              aria-label="Playback speed"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={1.25}>1.25x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
            </select>
            <button className="cc-previewToolBtn cc-previewToolBtnIconOnly" type="button" onClick={() => void toggleFullscreen()} aria-label="Fullscreen">
              <Image className="cc-previewToolGlyph" src="/icons/full-screen-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
            </button>
            <button
              className="cc-previewToolBtn cc-previewToolBtnIconOnly cc-previewToolBtnEdge"
              type="button"
              onClick={() => setToolbarHidden(true)}
              aria-label="Hide toolbar"
              title="Hide toolbar"
            >
              <Image className="cc-previewToolGlyph" src="/icons/hide-sdebar-vert-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
            </button>
          </>
          )}
        </div>
      ) : null}

      <div
        ref={surfaceRef}
        className={`cc-previewCanvasWrap ${editing && item.mediaKind === "image" ? "is-editing" : ""}`}
      >
        {canEditImage && editing && item.mediaKind === "image" ? (
          <aside className="cc-previewEditSide" aria-label={editTool === "crop" ? "Crop image" : "Adjust image"}>
            {editTool === "crop" ? (
              <>
                <h3 className="cc-previewEditSideTitle">Crop</h3>
                <div className="cc-previewCropBody">
                  <label className="cc-previewCropField">
                    <span>Format</span>
                    <select
                      className="cc-previewToolSelect cc-previewCropSelect"
                      value={cropFormat}
                      onChange={(ev) => {
                        const next = ev.currentTarget.value as CropFormat;
                        setCropFormat(next);
                        setCropPresetId("");
                        if (next === "custom") return;
                        const firstPreset = CROP_PRESETS.find((preset) => preset.format === next);
                        if (firstPreset) {
                          applyCropPreset(firstPreset);
                        }
                      }}
                    >
                      <option value="custom">Custom</option>
                      <option value="ratios">Ratios</option>
                      <option value="facebook">Facebook</option>
                      <option value="instagram">Instagram</option>
                      <option value="linkedin">LinkedIn</option>
                    </select>
                  </label>
                  <div className="cc-previewCropDimGrid">
                    <label className="cc-previewCropField">
                      <span>Width</span>
                      <input
                        className="cc-previewEditNumeric"
                        type="number"
                        min={1}
                        step={1}
                        value={cropWidthInput}
                        onChange={(ev) => setCropWidthInput(ev.currentTarget.value)}
                        onBlur={() => commitCropInputs("width")}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") {
                            ev.currentTarget.blur();
                          }
                        }}
                      />
                    </label>
                    <label className="cc-previewCropField">
                      <span>Height</span>
                      <input
                        className="cc-previewEditNumeric"
                        type="number"
                        min={1}
                        step={1}
                        value={cropHeightInput}
                        onChange={(ev) => setCropHeightInput(ev.currentTarget.value)}
                        onBlur={() => commitCropInputs("height")}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") {
                            ev.currentTarget.blur();
                          }
                        }}
                      />
                    </label>
                  </div>
                  <label className="cc-previewCropLock">
                    <input
                      type="checkbox"
                      checked={cropLockAspect}
                      onChange={(ev) => {
                        const checked = ev.currentTarget.checked;
                        setCropLockAspect(checked);
                        if (checked && cropWidthPx > 0 && cropHeightPx > 0) {
                          cropAspectRatioRef.current = cropWidthPx / cropHeightPx;
                        }
                      }}
                    />
                    <span>Lock aspect ratio</span>
                  </label>
                  {cropOptions.length > 0 ? (
                    <div className="cc-previewCropPresetList" role="radiogroup" aria-label={`${cropFormat} crop presets`}>
                      {cropOptions.map((preset) => (
                        <label key={preset.id} className={`cc-previewCropPreset ${cropPresetId === preset.id ? "is-active" : ""}`}>
                          <input
                            type="radio"
                            name="cc-crop-preset"
                            checked={cropPresetId === preset.id}
                            onChange={() => applyCropPreset(preset)}
                          />
                          <span className="cc-previewCropPresetText">{preset.label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                  <div className="cc-previewCropFooter">
                    <button className="cc-previewActionBtn" type="button" onClick={handleCancelAdjustMode}>Cancel</button>
                    <button
                      className="cc-previewActionBtn cc-previewActionBtnSave"
                      type="button"
                      onClick={() => void saveAdjustments()}
                      disabled={!editDirty || saveBusy || item.source !== "file"}
                    >
                      {saveBusy ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3 className="cc-previewEditSideTitle">Adjust</h3>
                <button
                  className={`cc-previewEditSectionToggle ${editLightOpen ? "is-open" : ""}`}
                  type="button"
                  onClick={() => setEditLightOpen((prev) => !prev)}
                >
                  <span>Light</span>
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {editLightOpen ? (
                  <div className="cc-previewEditSectionBody">
                    <label className="cc-previewEditSliderRow">
                      <span>Brightness</span>
                      <input
                        type="range"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        value={editState.brightness}
                        onChange={(ev) => setEditScalar("brightness", Number(ev.currentTarget.value))}
                      />
                      <input
                        className="cc-previewEditNumeric"
                        type="number"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        step={1}
                        value={editState.brightness}
                        onChange={(ev) => setEditScalar("brightness", Number(ev.currentTarget.value))}
                      />
                    </label>
                    <label className="cc-previewEditSliderRow">
                      <span>Contrast</span>
                      <input
                        type="range"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        value={editState.contrast}
                        onChange={(ev) => setEditScalar("contrast", Number(ev.currentTarget.value))}
                      />
                      <input
                        className="cc-previewEditNumeric"
                        type="number"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        step={1}
                        value={editState.contrast}
                        onChange={(ev) => setEditScalar("contrast", Number(ev.currentTarget.value))}
                      />
                    </label>
                    <label className="cc-previewEditSliderRow">
                      <span>Highlight</span>
                      <input
                        type="range"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        value={editState.highlight}
                        onChange={(ev) => setEditScalar("highlight", Number(ev.currentTarget.value))}
                      />
                      <input
                        className="cc-previewEditNumeric"
                        type="number"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        step={1}
                        value={editState.highlight}
                        onChange={(ev) => setEditScalar("highlight", Number(ev.currentTarget.value))}
                      />
                    </label>
                    <label className="cc-previewEditSliderRow">
                      <span>Shadow</span>
                      <input
                        type="range"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        value={editState.shadow}
                        onChange={(ev) => setEditScalar("shadow", Number(ev.currentTarget.value))}
                      />
                      <input
                        className="cc-previewEditNumeric"
                        type="number"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        step={1}
                        value={editState.shadow}
                        onChange={(ev) => setEditScalar("shadow", Number(ev.currentTarget.value))}
                      />
                    </label>
                    <label className="cc-previewEditSliderRow">
                      <span>Exposure</span>
                      <input
                        type="range"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        value={editState.exposure}
                        onChange={(ev) => setEditScalar("exposure", Number(ev.currentTarget.value))}
                      />
                      <input
                        className="cc-previewEditNumeric"
                        type="number"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        step={1}
                        value={editState.exposure}
                        onChange={(ev) => setEditScalar("exposure", Number(ev.currentTarget.value))}
                      />
                    </label>
                  </div>
                ) : null}

                <button
                  className={`cc-previewEditSectionToggle ${editColorOpen ? "is-open" : ""}`}
                  type="button"
                  onClick={() => setEditColorOpen((prev) => !prev)}
                >
                  <span>Color</span>
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {editColorOpen ? (
                  <div className="cc-previewEditSectionBody">
                    <label className="cc-previewEditSliderRow">
                      <span>Saturation</span>
                      <input
                        type="range"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        value={editState.saturation}
                        onChange={(ev) => setEditScalar("saturation", Number(ev.currentTarget.value))}
                      />
                      <input
                        className="cc-previewEditNumeric"
                        type="number"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        step={1}
                        value={editState.saturation}
                        onChange={(ev) => setEditScalar("saturation", Number(ev.currentTarget.value))}
                      />
                    </label>
                    <label className="cc-previewEditSliderRow">
                      <span>Temperature</span>
                      <input
                        type="range"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        value={editState.temperature}
                        onChange={(ev) => setEditScalar("temperature", Number(ev.currentTarget.value))}
                      />
                      <input
                        className="cc-previewEditNumeric"
                        type="number"
                        min={EDIT_RANGE_MIN}
                        max={EDIT_RANGE_MAX}
                        step={1}
                        value={editState.temperature}
                        onChange={(ev) => setEditScalar("temperature", Number(ev.currentTarget.value))}
                      />
                    </label>
                  </div>
                ) : null}
              </>
            )}
          </aside>
        ) : null}

        <div className={`cc-previewCanvas ${item.mediaKind === "video" ? "is-video" : isAlphaCanvas ? "is-image-alpha" : "is-image-solid"}`}>
          {error ? <div className="cc-previewError">Preview unavailable. Use Open.</div> : null}

          {!error && item.mediaKind === "image" ? (
            <div
              ref={imageStageRef}
              className={`cc-previewImageStage ${editing && editTool === "crop" ? "is-crop-mode" : ""}`}
              style={imageStageStyle}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={activeRawSrc}
                ref={imageRef}
                className={`cc-previewImage ${mediaReady ? "is-ready" : ""}`}
                src={activeRawSrc}
                alt={item.name}
                style={imageRenderStyle}
                onLoad={(ev) => {
                  const next = ev.currentTarget;
                  if (next.naturalWidth && next.naturalHeight) {
                    setDimensions({ width: next.naturalWidth, height: next.naturalHeight });
                  }
                  setMediaReady(true);
                  setError("");
                }}
                onError={() => {
                  setError("Preview unavailable. Use Open.");
                }}
              />
              {editing && editTool === "crop" ? (
                <div className="cc-previewCropOverlay">
                  <div className="cc-previewCropShade" style={{ left: "0%", top: "0%", width: "100%", height: `${cropTopPct}%` }} />
                  <div className="cc-previewCropShade" style={{ left: "0%", top: `${cropTopPct + cropHeightPct}%`, width: "100%", height: `${cropBottomPct}%` }} />
                  <div className="cc-previewCropShade" style={{ left: "0%", top: `${cropTopPct}%`, width: `${cropLeftPct}%`, height: `${cropHeightPct}%` }} />
                  <div className="cc-previewCropShade" style={{ left: `${cropLeftPct + cropWidthPct}%`, top: `${cropTopPct}%`, width: `${cropRightPct}%`, height: `${cropHeightPct}%` }} />
                  <div
                    className="cc-previewCropRect"
                    style={{
                      left: `${cropLeftPct}%`,
                      top: `${cropTopPct}%`,
                      width: `${cropWidthPct}%`,
                      height: `${cropHeightPct}%`,
                    }}
                    onPointerDown={(ev) => startCropDrag(ev, "move")}
                  >
                    <div className="cc-previewCropGrid" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <span className="cc-previewCropHandle is-nw" onPointerDown={(ev) => startCropDrag(ev, "nw")} />
                    <span className="cc-previewCropHandle is-n" onPointerDown={(ev) => startCropDrag(ev, "n")} />
                    <span className="cc-previewCropHandle is-ne" onPointerDown={(ev) => startCropDrag(ev, "ne")} />
                    <span className="cc-previewCropHandle is-e" onPointerDown={(ev) => startCropDrag(ev, "e")} />
                    <span className="cc-previewCropHandle is-se" onPointerDown={(ev) => startCropDrag(ev, "se")} />
                    <span className="cc-previewCropHandle is-s" onPointerDown={(ev) => startCropDrag(ev, "s")} />
                    <span className="cc-previewCropHandle is-sw" onPointerDown={(ev) => startCropDrag(ev, "sw")} />
                    <span className="cc-previewCropHandle is-w" onPointerDown={(ev) => startCropDrag(ev, "w")} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {!error && item.mediaKind === "video" ? (
            <video
              key={activeRawSrc}
              ref={videoRef}
              className={`cc-previewVideo ${mediaReady ? "is-ready" : ""}`}
              src={activeRawSrc}
              preload="metadata"
              playsInline
              controls={false}
              onError={() => {
                setError("Preview unavailable. Use Open.");
              }}
            />
          ) : null}
        </div>

        {toolbarHidden && !(editing && item.mediaKind === "image") ? (
          <button
            className="cc-previewToolbarToggle"
            type="button"
            onClick={() => setToolbarHidden(false)}
            aria-label="Show toolbar"
            title="Show toolbar"
          >
            <Image className="cc-previewToolGlyph" src="/icons/show-sidebar-vert-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {discardModalOpen ? (
        <div
          className="cc-previewDiscardOverlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cc-preview-discard-title"
          aria-describedby="cc-preview-discard-text"
          onClick={dismissDiscardModal}
        >
          <div className="cc-previewDiscardCard" onClick={(ev) => ev.stopPropagation()}>
            <div className="cc-previewDiscardEyebrow">CavCloud Editor</div>
            <h3 className="cc-previewDiscardTitle" id="cc-preview-discard-title">Discard unsaved changes?</h3>
            <p className="cc-previewDiscardText" id="cc-preview-discard-text">
              Your edits have not been saved. Keep editing to continue, or discard them now.
            </p>
            <div className="cc-previewDiscardActions">
              <button className="cc-previewActionBtn" type="button" onClick={dismissDiscardModal}>
                Keep editing
              </button>
              <button
                className="cc-previewActionBtn cc-previewDiscardConfirm"
                type="button"
                onClick={confirmDiscardChanges}
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {infoOpen ? (
        <div className="cc-previewInfoOverlay" role="dialog" aria-modal="true" aria-labelledby="cc-preview-info-title" onClick={() => setInfoOpen(false)}>
          <div className="cc-previewInfoCard" onClick={(ev) => ev.stopPropagation()}>
            <div className="cc-previewInfoHead">
              <h3 className="cc-previewInfoTitle" id="cc-preview-info-title">Properties</h3>
              <button className="cc-previewInfoClose" type="button" onClick={() => setInfoOpen(false)} aria-label="Close properties">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>
            <div className="cc-previewInfoRows">
              {detailsRows.map((row) => (
                <div key={row.label} className="cc-previewInfoRow">
                  <div className="cc-previewInfoLabel">{row.label}</div>
                  <div className={`cc-previewInfoValue ${row.label === "Uploaded by" ? "is-user" : ""}`}>
                    {row.label === "Uploaded by" ? <span key={row.value} className="cc-previewInfoUserValue">{row.value}</span> : row.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="cc-previewInfoSection">
              <div className="cc-previewInfoSectionHead">
                <div className="cc-previewInfoSectionTitle">Collaboration</div>
              </div>
              {collabAccessBusy ? (
                <div className="cc-previewVersionEmpty">Loading access...</div>
              ) : collabAccessError ? (
                <div className="cc-previewVersionError">{collabAccessError}</div>
              ) : (
                <div className="cc-previewVersionList">
                  <div className="cc-previewVersionRow">
                    <div className="cc-previewVersionMeta">
                      <div className="cc-previewVersionTitle">Owner (you)</div>
                      <div className="cc-previewVersionSub">Full access</div>
                    </div>
                  </div>
                  <div className="cc-previewVersionRow">
                    <div className="cc-previewVersionMeta">
                      <div className="cc-previewVersionTitle">{sharedUsersCount} direct user share{sharedUsersCount === 1 ? "" : "s"}</div>
                      <div className="cc-previewVersionSub">
                        {collaborationEnabled ? "Collaboration enabled" : "Read-only sharing"}
                      </div>
                    </div>
                  </div>
                  {collabAccessList.length ? (
                    collabAccessList.map((row) => (
                      <div key={row.id} className="cc-previewVersionRow">
                        <div className="cc-previewVersionMeta">
                          <div className="cc-previewVersionTitle">
                            {accessUserLabel(row)}
                          </div>
                          <div className="cc-previewVersionSub">
                            {row.permission === "EDIT" ? "Collaborate" : "Read-only"}
                            {" \u00b7 "}
                            {expiryLabel(row.expiresAtISO)}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="cc-previewVersionEmpty">No direct collaborators yet.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
