"use client";

import React from "react";

import type { CavCloudPreviewItem, CavCloudPreviewMode } from "@/components/cavcloud/preview.types";

type CavCloudPreviewContextValue = {
  selectedFileId: string | null;
  previewOpen: boolean;
  previewMode: CavCloudPreviewMode;
  previewItem: CavCloudPreviewItem | null;
  openPreviewPanel: (item: CavCloudPreviewItem) => void;
  openPreviewPage: (item: CavCloudPreviewItem) => void;
  closePreview: () => void;
};

const CavCloudPreviewContext = React.createContext<CavCloudPreviewContextValue | null>(null);

export function CavCloudPreviewProvider(props: { children: React.ReactNode }) {
  const { children } = props;
  const [selectedFileId, setSelectedFileId] = React.useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState<boolean>(false);
  const [previewMode, setPreviewMode] = React.useState<CavCloudPreviewMode>("panel");
  const [previewItem, setPreviewItem] = React.useState<CavCloudPreviewItem | null>(null);

  const openPreviewPanel = React.useCallback((item: CavCloudPreviewItem) => {
    setSelectedFileId(item.id);
    setPreviewItem(item);
    setPreviewMode("panel");
    setPreviewOpen(true);
  }, []);

  const openPreviewPage = React.useCallback((item: CavCloudPreviewItem) => {
    setSelectedFileId(item.id);
    setPreviewItem(item);
    setPreviewMode("page");
    setPreviewOpen(false);
  }, []);

  const closePreview = React.useCallback(() => {
    setPreviewOpen(false);
    setPreviewMode("panel");
  }, []);

  const value = React.useMemo<CavCloudPreviewContextValue>(() => ({
    selectedFileId,
    previewOpen,
    previewMode,
    previewItem,
    openPreviewPanel,
    openPreviewPage,
    closePreview,
  }), [closePreview, openPreviewPage, openPreviewPanel, previewItem, previewMode, previewOpen, selectedFileId]);

  return (
    <CavCloudPreviewContext.Provider value={value}>
      {children}
    </CavCloudPreviewContext.Provider>
  );
}

export function useCavCloudPreview(): CavCloudPreviewContextValue {
  const ctx = React.useContext(CavCloudPreviewContext);
  if (!ctx) {
    throw new Error("useCavCloudPreview must be used inside CavCloudPreviewProvider.");
  }
  return ctx;
}
