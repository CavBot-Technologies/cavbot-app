import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import AppShell from "@/components/AppShell";
import { INTEGRATION_MAP } from "../../integration-registry";

type PageProps = {
  params: {
    platform: string;
  };
};

export default function PlatformIntegrationPage({ params }: PageProps) {
  const integration = INTEGRATION_MAP.get(params.platform);
  if (!integration || integration.category !== "platforms") {
    notFound();
  }

  return (
    <AppShell title="Settings" subtitle="Account preferences and workspace configuration">
      <div className="sx-page">
        <header className="sx-top">
          <div className="sx-topLeft">
            <div className="sx-platformHero">
              <div className="sx-platformHeroIcon">
                <Image
                  src={integration.icon.src}
                  alt={integration.icon.alt}
                  width={64}
                  height={64}
                  priority
                  unoptimized
                />
              </div>
              <div>
                <h1 className="sx-h1">{integration.name}</h1>
                <p className="sx-desc">{integration.description}</p>
              </div>
            </div>
          </div>
        </header>

        <section className="sx-panel sx-integrationsPanel" aria-label="Integration stub">
          <div className="sx-body">
            <p className="sx-status-sub">
              We’re still building this experience. Check back soon.
            </p>
            <Link href="/settings/integrations" className="sx-api-link">
              Back to Integrations
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
