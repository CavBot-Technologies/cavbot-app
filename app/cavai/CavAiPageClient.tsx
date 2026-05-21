"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import CavAiCenterWorkspace, { type AiCenterSurface } from "@/components/cavai/CavAiCenterWorkspace";

const PROMPT_PARAM_KEYS = ["prompt", "q", "message", "input", "draft", "initialPrompt"] as const;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function parseSurface(raw: string): AiCenterSurface {
  const value = s(raw).toLowerCase();
  if (
    value === "general" ||
    value === "workspace" ||
    value === "console" ||
    value === "cavcloud" ||
    value === "cavsafe" ||
    value === "cavpad" ||
    value === "cavcode"
  ) {
    return value;
  }
  return "general";
}

function parseProjectId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function parseInitialQuickMode(raw: string): "create_image" | "edit_image" | null {
  const value = s(raw).toLowerCase();
  if (value === "create_image" || value === "edit_image") return value;
  return null;
}

function readPromptFromParams(params: { get(name: string): string | null } | null | undefined): string {
  if (!params) return "";

  for (const key of PROMPT_PARAM_KEYS) {
    const value = s(params.get(key));
    if (value) return value;
  }

  return "";
}

function readPromptFromHash(): string {
  if (typeof window === "undefined") return "";

  const hash = s(window.location.hash).replace(/^#/, "");
  if (!hash) return "";

  try {
    return readPromptFromParams(new URLSearchParams(hash));
  } catch {
    return "";
  }
}

export default function CavAiPageClient() {
  const searchParams = useSearchParams();
  const [hashPrompt, setHashPrompt] = useState("");

  const surface = parseSurface(s(searchParams?.get("surface")));
  const contextLabel = s(searchParams?.get("context"));
  const workspaceId = s(searchParams?.get("workspaceId")) || null;
  const projectId = parseProjectId(searchParams?.get("projectId"));
  const origin = s(searchParams?.get("origin")) || null;
  const sessionId = s(searchParams?.get("sessionId")) || null;
  const initialQuickMode = parseInitialQuickMode(
    s(searchParams?.get("quickAction")) || s(searchParams?.get("quickMode"))
  );
  const initialPrompt = readPromptFromParams(searchParams) || hashPrompt;

  useEffect(() => {
    const syncHashPrompt = () => setHashPrompt(readPromptFromHash());

    syncHashPrompt();
    window.addEventListener("hashchange", syncHashPrompt);
    return () => window.removeEventListener("hashchange", syncHashPrompt);
  }, []);

  return (
    <CavAiCenterWorkspace
      overlay={false}
      surface={surface}
      contextLabel={contextLabel || undefined}
      workspaceId={workspaceId}
      projectId={projectId}
      origin={origin}
      initialSessionId={sessionId}
      initialQuickMode={initialQuickMode}
      initialPrompt={initialPrompt}
    />
  );
}
