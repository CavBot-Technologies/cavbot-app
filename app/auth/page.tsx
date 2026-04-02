// app/auth/page.tsx
import type { Metadata } from "next";
import AuthPageClient from "./AuthPageClient";

type AuthPageProps = {
  searchParams?: {
    mode?: string | string[];
    error?: string | string[];
  };
};

function normalizeMode(mode: string | string[] | undefined) {
  const value = Array.isArray(mode) ? mode[0] : mode;
  return value === "login" ? "login" : "signup";
}

function readSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function providerConfigured(clientId: string | undefined, clientSecret: string | undefined) {
  return Boolean(String(clientId || "").trim() && String(clientSecret || "").trim());
}

export function generateMetadata({ searchParams }: AuthPageProps): Metadata {
  const mode = normalizeMode(searchParams?.mode);
  return {
    title: {
      absolute: mode === "login" ? "CavBot · Log in" : "CavBot · Sign up",
    },
  };
}

export default function AuthPage({ searchParams }: AuthPageProps) {
  return (
    <AuthPageClient
      authErrorCode={readSearchParam(searchParams?.error) || ""}
      oauthProviders={{
        github: providerConfigured(process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET),
        google: providerConfigured(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET),
      }}
      queryMode={normalizeMode(searchParams?.mode)}
    />
  );
}
