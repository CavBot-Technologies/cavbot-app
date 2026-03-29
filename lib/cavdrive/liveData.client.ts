"use client";

import { useMemo } from "react";

export type DriveNamespace = "cloud" | "safe";

type DriveTreeLike = {
  folder?: { id?: string | null; path?: string | null } | null;
  breadcrumbs?: unknown[] | null;
  folders?: unknown[] | null;
  files?: unknown[] | null;
  trash?: unknown[] | null;
  usage?: unknown;
  activity?: unknown[] | null;
  storageHistory?: unknown[] | null;
} | null;

type UseDriveChildrenArgs = {
  namespace: DriveNamespace;
  folderPath: string;
  tree: DriveTreeLike;
  isLoading: boolean;
  isFetching: boolean;
};

export function buildDriveListingQueryKey(namespace: DriveNamespace, folderPath: string): string {
  const normalizedPath = String(folderPath || "/").trim() || "/";
  return `drive:${namespace}:tree:${normalizedPath}`;
}

export function getDriveDebugEnabled(search: string): boolean {
  if (String(process.env.NEXT_PUBLIC_DRIVE_DEBUG || "").trim() === "1") return true;
  try {
    const params = new URLSearchParams(String(search || ""));
    return String(params.get("driveDebug") || "").trim() === "1";
  } catch {
    return false;
  }
}

export function countDriveListingItems(tree: DriveTreeLike): number {
  const folders = Array.isArray(tree?.folders) ? tree.folders.length : 0;
  const files = Array.isArray(tree?.files) ? tree.files.length : 0;
  const trash = Array.isArray(tree?.trash) ? tree.trash.length : 0;
  return folders + files + trash;
}

export function debugDriveLog(namespace: DriveNamespace, enabled: boolean, event: string, payload?: unknown) {
  if (!enabled) return;
  const prefix = `[drive:${namespace}]`;
  if (payload === undefined) {
    console.info(prefix, event);
    return;
  }
  console.info(prefix, event, payload);
}

export function useDriveChildren(args: UseDriveChildrenArgs) {
  const { namespace, folderPath, tree, isLoading, isFetching } = args;
  return useMemo(() => {
    const folders = Array.isArray(tree?.folders) ? tree.folders : [];
    const files = Array.isArray(tree?.files) ? tree.files : [];
    const breadcrumbs = Array.isArray(tree?.breadcrumbs) ? tree.breadcrumbs : [];
    const trash = Array.isArray(tree?.trash) ? tree.trash : [];
    const activity = Array.isArray(tree?.activity) ? tree.activity : [];
    const storageHistory = Array.isArray(tree?.storageHistory) ? tree.storageHistory : [];
    const currentFolderId = String(tree?.folder?.id || "").trim() || null;
    const listingQueryKey = buildDriveListingQueryKey(namespace, folderPath);

    return {
      namespace,
      currentFolderId,
      folderPath,
      listingQueryKey,
      folders,
      files,
      breadcrumbs,
      trash,
      activity,
      storageHistory,
      usage: tree?.usage || null,
      totals: {
        folders: folders.length,
        files: files.length,
        trash: trash.length,
        total: folders.length + files.length + trash.length,
      },
      isLoading,
      isFetching,
    };
  }, [namespace, folderPath, tree, isLoading, isFetching]);
}

