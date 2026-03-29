"use client";

import { useSystemStatus } from "@/lib/hooks/useSystemStatus";

export default function SystemStatusBootstrap() {
  useSystemStatus({ pollMs: 15_000 });
  return null;
}
