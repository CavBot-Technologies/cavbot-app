// app/auth/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./auth.css";

export const metadata: Metadata = {
  description:
    "Create your CavBot workspace. Sign up with GitHub or Google, or use email. Access CavAI Console.",
  robots: { index: true, follow: true },
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#01030f" };

export default function AuthLayout({ children }: { children: ReactNode }) {
  // Nested layouts must NOT render <html> or <head>.
  // Root layout owns document structure.
  return (
    <div className="auth-shell" data-cavbot-page="auth">
      {children}
    </div>
  );
  
}
