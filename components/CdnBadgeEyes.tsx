type CdnBadgeEyesProps = {
  className?: string;
  ariaHidden?: boolean;
  trackingMode?: "full" | "eyeOnly";
};

export default function CdnBadgeEyes({
  className,
  ariaHidden = true,
  trackingMode = "full",
}: CdnBadgeEyesProps) {
  const baseAvatarClassName = trackingMode === "eyeOnly" ? "cavbot-dm-avatar-lite" : "cavbot-dm-avatar";
  const avatarClassName = className ? `${baseAvatarClassName} ${className}` : baseAvatarClassName;
  const trackingProps = trackingMode === "full" ? ({ "data-cavbot-head": "dm" } as const) : undefined;
  const managedPupilProps =
    trackingMode === "eyeOnly"
      ? ({ "data-cavbot-pupil-managed": "1" } as const)
      : undefined;
  return (
    // Single shared CDN badge markup keeps tracking hooks stable across route/state transitions.
    <div className={avatarClassName} {...trackingProps} aria-hidden={ariaHidden}>
      <div className="cavbot-dm-avatar-core">
        <div className="cavbot-dm-face">
          <div className="cavbot-eyes-row">
            <div className="cavbot-eye">
              <div className="cavbot-eye-inner">
                <div className="cavbot-eye-track">
                  <div className="cavbot-eye-pupil" {...managedPupilProps} />
                </div>
              </div>
              <div className="cavbot-eye-glow" />
              <div className="cavbot-blink" />
            </div>
            <div className="cavbot-eye">
              <div className="cavbot-eye-inner">
                <div className="cavbot-eye-track">
                  <div className="cavbot-eye-pupil" {...managedPupilProps} />
                </div>
              </div>
              <div className="cavbot-eye-glow" />
              <div className="cavbot-blink" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
