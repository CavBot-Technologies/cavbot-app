"use client";

import Image from "next/image";

type ArcadePreviewProps = {
  thumbnailUrl: string | null;
  alt?: string;
  placeholderText?: string;
  imagePriority?: boolean;
};

export default function ArcadePreview({
  thumbnailUrl,
  alt = "Arcade preview",
  placeholderText = "Select a game to preview",
  imagePriority = false,
}: ArcadePreviewProps) {
  return (
    <div className="cb-arcadePreview" aria-live="polite">
      <div className="cb-arcadePreviewTablet" role="presentation">
        {thumbnailUrl ? (
          <div className="cb-arcadeDevice cb-arcadePreviewDevice">
            <div className="cb-arcadeDeviceTop">
              <span className="cb-arcadeDeviceCamera" aria-hidden="true" />
              <span className="cb-arcadeDeviceSensor" aria-hidden="true" />
            </div>
            <div className="cb-arcadeGameThumb cb-arcadePreviewThumb">
              <Image
                src={thumbnailUrl}
                alt={alt}
                fill
                sizes="(min-width: 960px) 260px, 100vw"
                className="cb-arcadeGameImage cb-arcadePreviewImage"
                priority={imagePriority}
              />
              <span className="cb-arcadeGameHighlight" aria-hidden="true" />
            </div>
            <div className="cb-arcadeDeviceBottom" aria-hidden="true">
              <span className="cb-arcadeDeviceHome" />
            </div>
          </div>
        ) : (
          <div className="cb-arcadePreviewEmpty">
            <p className="cb-arcadePreviewEmptyText">{placeholderText}</p>
          </div>
        )}
      </div>
    </div>
  );
}
