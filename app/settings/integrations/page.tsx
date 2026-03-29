"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/AppShell";
import { CATEGORY_ITEMS, useIntegrationFilter } from "./integration-filter";
import { INTEGRATIONS } from "./integration-registry";

import "../settings.css";
import "./integrations.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<typeof INTEGRATIONS[number]["status"], string> = {
  available: "Install",
  "coming-soon": "Install",
};

type ApiKeysResponse = {
  ok?: boolean;
  site: { id: string; origin: string } | null;
};

type InstallEntry = {
  status: string;
};

type InstallStatePayload = {
  ok: true;
  installs: InstallEntry[];
};

const INTEGRATION_MODULE_WARMERS: Record<string, () => Promise<unknown>> = {
  cavbot: () => import("./[slug]/page"),
  "custom-html": () => import("./platforms/custom-html/page"),
  webflow: () => import("./platforms/webflow/page"),
  wix: () => import("./platforms/wix/page"),
  shopify: () => import("./platforms/shopify/page"),
  wordpress: () => import("./platforms/wordpress/page"),
  squarespace: () => import("./platforms/squarespace/page"),
  framer: () => import("./platforms/framer/page"),
};

function integrationHref(slug: string, category: "cavbot" | "platforms") {
  return category === "platforms"
    ? `/settings/integrations/platforms/${slug}`
    : `/settings/integrations/${slug}`;
}

export default function IntegrationsPage() {
  const router = useRouter();
  const { selected, setSelected, filteredIntegrations } = useIntegrationFilter();

  const [siteId, setSiteId] = useState<string | null>(null);
  const [cavbotConnected, setCavbotConnected] = useState(false);
  const warmedRoutesRef = useRef<Set<string>>(new Set());

  const allIntegrationTargets = useMemo(
    () =>
      INTEGRATIONS.map((integration) => ({
        slug: integration.slug,
        href: integrationHref(integration.slug, integration.category),
      })),
    []
  );

  const warmIntegrationRoute = useCallback(
    (slug: string, href: string) => {
      if (warmedRoutesRef.current.has(href)) return;
      warmedRoutesRef.current.add(href);

      try {
        router.prefetch(href);
      } catch {}

      const warmModule = INTEGRATION_MODULE_WARMERS[slug];
      if (warmModule) {
        void warmModule().catch(() => {});
      }
    },
    [router]
  );

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      allIntegrationTargets.forEach((target) => {
        warmIntegrationRoute(target.slug, target.href);
      });
    }, 120);

    return () => window.clearTimeout(timerId);
  }, [allIntegrationTargets, warmIntegrationRoute]);

  useEffect(() => {
    const controller = new AbortController();

    const loadSite = async () => {
      try {
        const response = await fetch("/api/settings/api-keys", {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => null)) as ApiKeysResponse | null;
        if (!response.ok || !data || data.ok === false) {
          throw new Error("Unable to load workspace context.");
        }
        if (!controller.signal.aborted) {
          setSiteId(data.site?.id ?? null);
        }
      } catch {
        if (!controller.signal.aborted) {
          setSiteId(null);
        }
      }
    };

    void loadSite();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!siteId) {
      setCavbotConnected(false);
      return;
    }

    const controller = new AbortController();

    const loadInstallState = async () => {
      try {
        const response = await fetch(
          `/api/settings/integrations/cavbot/install-state?siteId=${encodeURIComponent(siteId)}`,
          {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          }
        );
        const data = (await response.json().catch(() => null)) as InstallStatePayload | null;
        if (!response.ok || !data?.ok) {
          throw new Error("Unable to load CavBot install status.");
        }
        if (!controller.signal.aborted) {
          setCavbotConnected(data.installs.some((entry) => entry.status === "ACTIVE"));
        }
      } catch {
        if (!controller.signal.aborted) {
          setCavbotConnected(false);
        }
      }
    };

    void loadInstallState();
    return () => controller.abort();
  }, [siteId]);

  return (
    <AppShell title="Settings" subtitle="Account preferences and workspace configuration">
      <div className="sx-page">
        <header className="sx-top">
          <div className="sx-topLeft">
            <h1 className="sx-h1">Integrations</h1>
            <p className="sx-desc">
              Discover curated integrations that keep CavBot and your systems perfectly aligned.
            </p>
          </div>
          <Link href="/settings" className="sx-integrationSettingsCta" aria-label="Return to Settings">
            <Image
              src="/icons/back-svgrepo-com.svg"
              alt=""
              aria-hidden="true"
              width={22}
              height={22}
              className="sx-integrationSettingsIcon"
            />
          </Link>
        </header>

        <section className="sx-integrationsLayout">
          <aside className="sx-panel sx-integrationsRail" aria-label="Integration categories">
            <header className="sx-panelHead sx-integrationRailHead">
              <div>
                <p className="sx-footK">Categories</p>
              </div>
            </header>
            <div className="sx-body">
              <ul className="sx-integrationCategoryList">
                {CATEGORY_ITEMS.map((item) => (
                  <li
                    key={item.id}
                    className={`sx-integrationCategory ${selected === item.id ? "is-on" : ""}`}
                  >
                    <button
                      type="button"
                      className="sx-integrationCategoryBtn"
                      onClick={() => setSelected(item.id)}
                      aria-pressed={selected === item.id}
                    >
                      <span>{item.label}</span>
                      <span
                        className={`sx-integrationCategoryStatus sx-integrationCategoryStatus--${item.status}`}
                      >
                        <span className="sx-integrationCategoryDot" aria-hidden="true" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <section className="sx-panel sx-integrationsPanel" aria-label="Integrations list">
            <header className="sx-panelHead">
              <div>
                <h2 className="sx-h2">Connections</h2>
                <p className="sx-sub">
                  Enable CavBot experiences wherever your team already works.
                </p>
              </div>
            </header>

            <div className="sx-body">
              <div className="sx-integrationsGrid">
                {filteredIntegrations.map((integration) => {
                  const isIntegrationConnected =
                    integration.slug === "cavbot" && cavbotConnected;
                  const statusClass = isIntegrationConnected
                    ? "sx-integrationStatus--connected"
                    : `sx-integrationStatus--${integration.status}`;
                  const targetHref = integrationHref(integration.slug, integration.category);

                  return (
                    <Link
                      key={integration.id}
                      href={targetHref}
                      prefetch={true}
                      className="sx-integrationCard"
                      aria-label={`View ${integration.name} integration`}
                      onMouseEnter={() => warmIntegrationRoute(integration.slug, targetHref)}
                      onFocus={() => warmIntegrationRoute(integration.slug, targetHref)}
                      onTouchStart={() => warmIntegrationRoute(integration.slug, targetHref)}
                      onPointerDown={() => warmIntegrationRoute(integration.slug, targetHref)}
                    >
                      <div className="sx-integrationCardIcon">
                        <Image
                          src={integration.icon.src}
                          alt={integration.icon.alt}
                          width={32}
                          height={32}
                          priority
                          unoptimized
                        />
                      </div>

                      <div className="sx-integrationCardBody">
                        <p className="sx-integrationTitle">{integration.name}</p>
                        <br aria-hidden="true" />
                        <p className="sx-integrationDescription">{integration.description}</p>
                      </div>

                <span className={`sx-integrationStatus ${statusClass}`}>
                  {isIntegrationConnected
                    ? "Connected"
                    : integration.slug === "cavbot"
                    ? "Connect"
                    : STATUS_LABELS[integration.status]}
                </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        </section>
      </div>
    </AppShell>
  );
}
