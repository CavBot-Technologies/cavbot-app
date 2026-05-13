"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import CavbotGlobalFooter from "@/components/footer/CavbotGlobalFooter";
import { isAdminPublicPath } from "@/lib/admin/config";

const ROUTE_FOOTER_BLOCKLIST = ["/status", "/status/history"] as const;
const ARCADE_FOOTER_BLOCKLIST = ["/cavbot-arcade", "/cavbot-arcade/gallery"] as const;
const AUTH_ROUTE_PREFIXES = ["/auth", "/users/recovery", "/users/reset", "/accept-invite", "/request-access"] as const;
const MODAL_LOCK_CLASSES = [
  "cb-modal-open",
  "cb-modals-lock",
  "modal-open",
  "modal-lock",
  "cb-console-lock",
] as const;
const FOOTER_DIALOG_IDS = ["cb-footer-developer-panel", "cb-footer-human-resources-panel"] as const;

function normalizePathname(pathname: string | null): string {
  if (!pathname) return "";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }
  return pathname;
}

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isCavAiRoute(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === "/cavai" || pathname.startsWith("/cavai/")) return true;
  // Locale-prefixed paths (for example: /en/cavai).
  if (pathname.endsWith("/cavai") || pathname.includes("/cavai/")) return true;
  return false;
}

function isCavcodeRoute(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === "/cavcode" || pathname.startsWith("/cavcode/")) return true;
  // Locale-prefixed paths (for example: /en/cavcode).
  if (pathname.endsWith("/cavcode") || pathname.includes("/cavcode/")) return true;
  return false;
}

function isVisibleModalNode(node: HTMLElement): boolean {
  if (FOOTER_DIALOG_IDS.includes(node.id as (typeof FOOTER_DIALOG_IDS)[number])) return false;
  if (FOOTER_DIALOG_IDS.some((dialogId) => node.closest(`#${dialogId}`))) return false;
  let current: HTMLElement | null = node;
  while (current) {
    if (current.hasAttribute("hidden")) return false;
    if (current.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(current);
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    current = current.parentElement;
  }
  return true;
}

function hasOpenModal(): boolean {
  if (typeof document === "undefined") return false;
  const body = document.body;
  const html = document.documentElement;
  if (!body || !html) return false;

  const hasModalClass = MODAL_LOCK_CLASSES.some(
    (className) => body.classList.contains(className) || html.classList.contains(className)
  );
  if (hasModalClass) return true;

  const modalNodes = document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="dialog"][aria-modal="true"]');
  for (const node of modalNodes) {
    if (isVisibleModalNode(node)) return true;
  }
  return false;
}

export default function GlobalFooterMount() {
  const pathname = usePathname();
  const [modalOpen, setModalOpen] = useState(false);
  const normalizedPathname = useMemo(() => normalizePathname(pathname), [pathname]);
  const hideFooterForRoute = useMemo(() => {
    if (ROUTE_FOOTER_BLOCKLIST.some((route) => route === normalizedPathname)) return true;
    if (ARCADE_FOOTER_BLOCKLIST.some((route) => route === normalizedPathname)) return true;
    if (isCavAiRoute(normalizedPathname)) return true;
    if (isCavcodeRoute(normalizedPathname)) return true;
    if (isAuthRoute(normalizedPathname)) return true;
    if (isAdminPublicPath(normalizedPathname)) return true;
    return false;
  }, [normalizedPathname]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const syncModalState = () => setModalOpen(hasOpenModal());
    syncModalState();

    const observer = new MutationObserver(() => {
      syncModalState();
    });

    const observerConfig: MutationObserverInit = {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-hidden", "style", "open"],
    };

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    observer.observe(document.body, observerConfig);

    return () => observer.disconnect();
  }, [normalizedPathname]);

  const hideFooter = hideFooterForRoute || modalOpen;

  useEffect(() => {
    if (!document.body) return;
    if (hideFooter) {
      document.body.dataset.cbFooterHidden = "1";
      return () => {
        delete document.body.dataset.cbFooterHidden;
      };
    }
    delete document.body.dataset.cbFooterHidden;
    return () => {
      delete document.body.dataset.cbFooterHidden;
    };
  }, [hideFooter]);

  if (hideFooter) return null;
  return <CavbotGlobalFooter />;
}
