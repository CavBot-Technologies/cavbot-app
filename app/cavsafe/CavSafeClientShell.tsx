"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const CavSafeClientNoSsr = dynamic(() => import("./CavSafeClient"), {
  ssr: false,
});

export default function CavSafeClientShell() {
  const router = useRouter();

  useEffect(() => {
    void import("../cavcloud/CavCloudClient");
  }, []);

  useEffect(() => {
    try {
      router.prefetch("/cavcloud");
    } catch {
      // ignore prefetch failures and keep normal navigation
    }
  }, [router]);

  return (
    <>
      <CavSafeClientNoSsr />
    </>
  );
}
