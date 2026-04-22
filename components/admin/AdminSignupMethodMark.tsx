"use client";

import Image from "next/image";

import { formatAdminSignupMethodLabel, type AdminSignupMethod } from "@/lib/admin/signupMethod";

function GoogleMark(props: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={props.size} height={props.size} focusable="false" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1S8.7 5.7 12 5.7c1.9 0 3.2.8 3.9 1.6l2.6-2.5C16.9 3.3 14.7 2 12 2 6.9 2 2.8 6.1 2.8 11.8S6.9 21.6 12 21.6c6.9 0 8.6-4.9 8.6-7.4 0-.5-.1-1-.1-1.4H12Z"
      />
      <path
        fill="#34A853"
        d="M3.6 7.3l3.2 2.3C7.7 7.4 9.7 5.7 12 5.7c1.9 0 3.2.8 3.9 1.6l2.6-2.5C16.9 3.3 14.7 2 12 2 8.4 2 5.2 4 3.6 7.3Z"
      />
      <path
        fill="#FBBC05"
        d="M12 21.6c2.7 0 5-1 6.7-2.6l-3.1-2.4c-.8.6-2 1.3-3.6 1.3-2.3 0-4.3-1.5-5.1-3.7l-3.3 2.5c1.6 3 4.7 4.9 8.4 4.9Z"
      />
      <path
        fill="#4285F4"
        d="M20.5 11.8c0-.5-.1-1-.1-1.4H12v3.9h5.5c-.3 1.4-1.2 2.6-2.6 3.4l3.1 2.4c1.8-1.7 2.5-4.2 2.5-6.3Z"
      />
    </svg>
  );
}

function GitHubMark(props: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={props.size} height={props.size} focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .5C5.73.5.75 5.63.75 12c0 5.1 3.29 9.42 7.86 10.95.57.11.78-.25.78-.56 0-.28-.01-1.02-.02-2-3.2.71-3.88-1.58-3.88-1.58-.52-1.36-1.28-1.72-1.28-1.72-1.05-.74.08-.73.08-.73 1.16.08 1.77 1.22 1.77 1.22 1.03 1.8 2.7 1.28 3.36.98.1-.77.4-1.28.72-1.58-2.55-.3-5.23-1.3-5.23-5.8 0-1.28.45-2.33 1.18-3.15-.12-.3-.51-1.53.11-3.18 0 0 .97-.32 3.18 1.2a10.7 10.7 0 0 1 2.9-.4c.98 0 1.97.14 2.9.4 2.21-1.52 3.18-1.2 3.18-1.2.62 1.65.23 2.88.11 3.18.74.82 1.18 1.87 1.18 3.15 0 4.51-2.69 5.5-5.25 5.79.41.36.78 1.08.78 2.18 0 1.58-.01 2.85-.01 3.23 0 .31.2.67.79.56A11.28 11.28 0 0 0 23.25 12C23.25 5.63 18.27.5 12 .5Z"
      />
    </svg>
  );
}

export function AdminSignupMethodMark(props: {
  method: AdminSignupMethod;
  size?: number;
}) {
  const size = props.size || 14;

  if (props.method === "google") return <GoogleMark size={size} />;
  if (props.method === "github") return <GitHubMark size={size} />;

  return <Image src="/logo/cavbot-logomark.svg" alt="" width={size} height={size} />;
}

export function AdminSignupMethodInline(props: {
  method: AdminSignupMethod;
  label?: string | null;
  className?: string;
}) {
  const label = props.label || formatAdminSignupMethodLabel(props.method);

  return (
    <span className={props.className ? `hq-signupMethodInline ${props.className}` : "hq-signupMethodInline"} data-method={props.method}>
      <span className="hq-signupMethodMark" data-method={props.method} aria-hidden="true">
        <AdminSignupMethodMark method={props.method} size={14} />
      </span>
      <span>{label}</span>
    </span>
  );
}
