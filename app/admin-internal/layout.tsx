import type { Metadata } from "next";
import AdminHostRuntimeMounts from "./AdminHostRuntimeMounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    absolute: "CavBot HQ • Admin Portal",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminHostRuntimeMounts />
      {children}
    </>
  );
}
