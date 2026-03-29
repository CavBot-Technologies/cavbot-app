export type IntegrationStatus = "available" | "coming-soon";

type IntegrationIcon = { src: string; alt: string };

export type IntegrationCategory = "cavbot" | "platforms";

export type IntegrationRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: IntegrationIcon;
  status: IntegrationStatus;
  category: IntegrationCategory;
};

export const INTEGRATIONS: IntegrationRecord[] = [
  {
    id: "cavbot",
    slug: "cavbot",
    name: "CavBot",
    description: "Native CavBot widgets, intelligence, and interactive experiences for every workspace.",
    icon: {
      src: "/logo/cavbot-logomark.svg",
      alt: "CavBot logomark",
    },
    status: "available",
    category: "cavbot",
  },
  {
    id: "custom-html",
    slug: "custom-html",
    name: "Custom HTML",
    description: "Drop CavBot scripts into any custom HTML site and keep every page in sync.",
    icon: {
      src: "/integrations/html5-badge.svg",
      alt: "Custom HTML platform",
    },
    status: "available",
    category: "platforms",
  },
  {
    id: "webflow",
    slug: "webflow",
    name: "Webflow",
    description: "Ship CavBot scripts across your Webflow projects so your CMS-powered pages stay interactive.",
    icon: {
      src: "/integrations/webflow-mark-blue.svg",
      alt: "Webflow logomark",
    },
    status: "available",
    category: "platforms",
  },
  {
    id: "wix",
    slug: "wix",
    name: "Wix",
    description: "Add CavBot scripts inside Wix so your builder-powered pages and storefronts feel alive.",
    icon: {
      src: "/integrations/Wix logoB.svg",
      alt: "Wix logomark",
    },
    status: "available",
    category: "platforms",
  },
  {
    id: "shopify",
    slug: "shopify",
    name: "Shopify",
    description: "Layer CavBot widgets and intelligence into Shopify themes to guide every storefront visit.",
    icon: {
      src: "/integrations/shopify_glyph.svg",
      alt: "Shopify logomark",
    },
    status: "available",
    category: "platforms",
  },
  {
    id: "wordpress",
    slug: "wordpress",
    name: "WordPress",
    description: "Embed CavBot scripts into WordPress so every template and page loads the Arcade experience.",
    icon: {
      src: "/integrations/WordPress-logotype-wmark-white.png",
      alt: "WordPress logomark",
    },
    status: "available",
    category: "platforms",
  },
  {
    id: "squarespace",
    slug: "squarespace",
    name: "Squarespace",
    description: "Drop CavBot Arcade scripts into Squarespace so managed sites deliver secure 404 recovery.",
    icon: {
      src: "/integrations/squarespace-svgrepo-com-white.svg",
      alt: "Squarespace logomark",
    },
    status: "coming-soon",
    category: "platforms",
  },
  {
    id: "framer",
    slug: "framer",
    name: "Framer",
    description:
      "Ship CavBot scripts into Framer so your design-driven prototypes and sites stay interactive.",
    icon: {
      src: "/integrations/white-mark.svg",
      alt: "Framer logomark",
    },
    status: "coming-soon",
    category: "platforms",
  },
];

export const INTEGRATION_MAP = new Map<string, IntegrationRecord>(
  INTEGRATIONS.map((item) => [item.slug, item])
);
