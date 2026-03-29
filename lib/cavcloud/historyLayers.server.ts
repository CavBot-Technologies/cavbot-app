import "server-only";

import type { CavCloudOperationKind, Prisma } from "@prisma/client";

export const CAVCLOUD_ACTIVITY_OPERATION_KINDS: CavCloudOperationKind[] = [
  "CREATE_FOLDER",
  "UPLOAD_FILE",
  "FILE_UPLOADED",
  "MOVE_FILE",
  "FOLDER_MOVED",
  "RENAME_FILE",
  "FILE_RENAMED",
  "DELETE_FILE",
  "FILE_DELETED",
  "RESTORE_FILE",
  "SHARE_CREATED",
  "SHARE_REVOKED",
  "DUPLICATE_FILE",
  "ZIP_CREATED",
  "PUBLISHED_ARTIFACT",
  "ARTIFACT_PUBLISHED",
  "UNPUBLISHED_ARTIFACT",
  "COLLAB_ACCESS_GRANTED",
  "COLLAB_ACCESS_REVOKED",
  "COLLAB_GRANTED",
  "COLLAB_REVOKED",
  "GOOGLE_DRIVE_CONNECTED",
  "GOOGLE_DRIVE_DISCONNECTED",
  "GOOGLE_DRIVE_IMPORT_STARTED",
  "GOOGLE_DRIVE_IMPORT_COMPLETED",
  "GOOGLE_DRIVE_IMPORT_FILE_FAILED",
];

export const CAVCLOUD_ACCESS_OPERATION_KINDS: CavCloudOperationKind[] = [
  "ACCESS_GRANTED",
  "ACCESS_REVOKED",
  "COLLAB_ACCESS_GRANTED",
  "COLLAB_ACCESS_REVOKED",
  "COLLAB_GRANTED",
  "COLLAB_REVOKED",
  "FILE_OPENED",
  "FILE_DOWNLOADED",
  "FILE_EDIT_SAVED",
  "FILE_EDIT_CONFLICT",
  "FILE_EDIT_DENIED",
  "EDIT_SAVED",
  "EDIT_CONFLICT",
  "FAILED_EDIT_ATTEMPT",
];

export type CavCloudAccessAuditFilter = "all" | "grants" | "open_downloads" | "edits";

export function cavcloudAccessKindsForFilter(filter: CavCloudAccessAuditFilter): CavCloudOperationKind[] {
  if (filter === "grants") {
    return [
      "ACCESS_GRANTED",
      "ACCESS_REVOKED",
      "COLLAB_ACCESS_GRANTED",
      "COLLAB_ACCESS_REVOKED",
      "COLLAB_GRANTED",
      "COLLAB_REVOKED",
    ];
  }
  if (filter === "open_downloads") {
    return ["FILE_OPENED", "FILE_DOWNLOADED"];
  }
  if (filter === "edits") {
    return [
      "FILE_EDIT_SAVED",
      "FILE_EDIT_CONFLICT",
      "FILE_EDIT_DENIED",
      "EDIT_SAVED",
      "EDIT_CONFLICT",
      "FAILED_EDIT_ATTEMPT",
    ];
  }
  return CAVCLOUD_ACCESS_OPERATION_KINDS;
}

export function asMetaObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function operationKindToLegacyActivityAction(args: {
  kind: CavCloudOperationKind | string;
  subjectType?: string | null;
  meta?: Record<string, unknown> | null;
}): string {
  const kind = String(args.kind || "").trim().toUpperCase();
  const subjectType = String(args.subjectType || "").trim().toLowerCase();
  const meta = args.meta || null;

  if (kind === "UPLOAD_FILE" || kind === "FILE_UPLOADED") {
    const action = String(meta?.action || "").trim().toLowerCase();
    if (action === "upload.folder") return "upload.folder";
    if (action === "upload.camera_roll") return "upload.camera_roll";
    if (action === "upload.preview") return "upload.preview";
    return "file.upload.simple";
  }
  if (kind === "CREATE_FOLDER") return "folder.create";
  if (kind === "MOVE_FILE" || kind === "RENAME_FILE" || kind === "FILE_RENAMED" || kind === "FOLDER_MOVED") {
    return subjectType === "folder" ? "folder.update" : "file.update";
  }
  if (kind === "DELETE_FILE" || kind === "FILE_DELETED") {
    return subjectType === "folder" ? "folder.delete" : "file.delete";
  }
  if (kind === "RESTORE_FILE") return "trash.restore";
  if (kind === "SHARE_CREATED") return "share.create";
  if (kind === "SHARE_REVOKED") return "share.revoke";
  if (kind === "DUPLICATE_FILE") return "file.duplicate";
  if (kind === "ZIP_CREATED") return subjectType === "folder" ? "folder.zip" : "file.zip";
  if (kind === "PUBLISHED_ARTIFACT" || kind === "ARTIFACT_PUBLISHED") return "artifact.publish";
  if (kind === "UNPUBLISHED_ARTIFACT") return "artifact.unpublish";
  if (kind === "GOOGLE_DRIVE_CONNECTED") return "integration.google_drive.connected";
  if (kind === "GOOGLE_DRIVE_DISCONNECTED") return "integration.google_drive.disconnected";
  if (kind === "GOOGLE_DRIVE_IMPORT_STARTED") return "upload.google_drive.started";
  if (kind === "GOOGLE_DRIVE_IMPORT_COMPLETED") return "upload.google_drive.completed";
  if (kind === "GOOGLE_DRIVE_IMPORT_FILE_FAILED") return "upload.google_drive.failed";
  if (
    kind === "ACCESS_GRANTED"
    || kind === "COLLAB_ACCESS_GRANTED"
    || kind === "COLLAB_GRANTED"
  ) {
    return "collab.grant";
  }
  if (
    kind === "ACCESS_REVOKED"
    || kind === "COLLAB_ACCESS_REVOKED"
    || kind === "COLLAB_REVOKED"
  ) {
    return "collab.revoke";
  }
  return kind.toLowerCase();
}

export function cavcloudAccessActionLabel(kindRaw: CavCloudOperationKind | string): string {
  const kind = String(kindRaw || "").trim().toUpperCase();
  if (kind === "FILE_OPENED") return "Opened";
  if (kind === "FILE_DOWNLOADED") return "Downloaded";
  if (kind === "FILE_EDIT_SAVED" || kind === "EDIT_SAVED") return "Edit saved";
  if (kind === "FILE_EDIT_CONFLICT" || kind === "EDIT_CONFLICT") return "Conflict";
  if (kind === "FILE_EDIT_DENIED" || kind === "FAILED_EDIT_ATTEMPT") return "Denied";
  if (
    kind === "ACCESS_GRANTED"
    || kind === "COLLAB_ACCESS_GRANTED"
    || kind === "COLLAB_GRANTED"
  ) {
    return "Access granted";
  }
  if (
    kind === "ACCESS_REVOKED"
    || kind === "COLLAB_ACCESS_REVOKED"
    || kind === "COLLAB_REVOKED"
  ) {
    return "Access revoked";
  }
  return kind.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()) || "Access event";
}
