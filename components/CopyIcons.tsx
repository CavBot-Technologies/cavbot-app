import type { CSSProperties } from "react";

type IconMaskProps = {
  src: string;
};

const ICON_MASK_STYLE: CSSProperties = {
  width: 18,
  height: 18,
  display: "inline-block",
  backgroundColor: "currentColor",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  maskPosition: "center",
  WebkitMaskSize: "contain",
  maskSize: "contain",
};

function IconMask({ src }: IconMaskProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        ...ICON_MASK_STYLE,
        WebkitMaskImage: `url("${src}")`,
        maskImage: `url("${src}")`,
      }}
    />
  );
}

export function CopyIcon() {
  return <IconMask src="/icons/copy-svgrepo-com.svg" />;
}

export function CheckIcon() {
  return <IconMask src="/icons/copy-success-svgrepo-com.svg" />;
}
