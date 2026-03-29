export type CavCloudPreviewMode = "panel" | "page";

export type CavCloudPreviewSource = "file" | "artifact" | "trash" | "by_path";

export type CavCloudPreviewKind = "image" | "video" | "text" | "code" | "unknown";

export type CavCloudPreviewMediaKind = CavCloudPreviewKind;

export type CavCloudPreviewItem = {
  id: string;
  resourceId: string;
  source: CavCloudPreviewSource;
  previewKind: CavCloudPreviewKind;
  mediaKind: CavCloudPreviewMediaKind;
  name: string;
  path: string;
  mimeType: string;
  bytes: number | null;
  createdAtISO?: string | null;
  modifiedAtISO?: string | null;
  uploadedAtISO?: string | null;
  uploadedBy?: string | null;
  shareUrl?: string | null;
  orientation?: string | null;
  colorProfile?: string | null;
  encoding?: string | null;
  rawSrc: string;
  downloadSrc: string;
  openHref: string;
  shareFileId?: string | null;
  sharedUserCount?: number | null;
  collaborationEnabled?: boolean | null;
};
