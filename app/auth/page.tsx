// app/auth/page.tsx
import type { Metadata } from "next";
import AuthPageClient from "./AuthPageClient";

type AuthPageProps = {
  searchParams?: {
    mode?: string | string[];
  };
};

function normalizeMode(mode: string | string[] | undefined) {
  const value = Array.isArray(mode) ? mode[0] : mode;
  return value === "login" ? "login" : "signup";
}

export function generateMetadata({ searchParams }: AuthPageProps): Metadata {
  const mode = normalizeMode(searchParams?.mode);
  return {
    title: {
      absolute: mode === "login" ? "CavBot · Log in" : "CavBot · Sign up",
    },
  };
}

export default function AuthPage() {
  return <AuthPageClient />;
}
