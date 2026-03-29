import type { PropsWithChildren } from "react";

import "./statusShell.css";

type StatusShellVariant = "status" | "history" | "incident";

type StatusShellProps = PropsWithChildren<{
  toneClass?: string;
  variant?: StatusShellVariant;
  className?: string;
}>;

export default function StatusShell({ children, className, toneClass, variant = "status" }: StatusShellProps) {
  const routeClasses = ["status-route"];
  if (variant) {
    routeClasses.push(`status-route--${variant}`);
  }

  const shellClasses = [
    "status-shell",
    `status-shell--${variant}`,
    toneClass,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={routeClasses.join(" ")}>
      <div className={shellClasses}>{children}</div>
    </div>
  );
}
