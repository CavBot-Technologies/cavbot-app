export {};

declare global {
  type CavbotPayload = Record<string, unknown>;

  type CavbotAnalyticsClient = {
    track?: (
      name: string,
      payload?: CavbotPayload,
      options?: CavbotPayload
    ) => void | Promise<void>;

    trackPageView?: (
      pageType?: string,
      component?: string,
      extraPayload?: CavbotPayload
    ) => void | Promise<void>;

    trackConsole?: (
      event: string,
      payload?: CavbotPayload
    ) => void | Promise<void>;

    trackError?: (
      kind: string,
      details?: CavbotPayload,
      options?: CavbotPayload
    ) => void | Promise<void>;

    flush?: () => void | Promise<void>;

    report?: () => unknown;
    runAuditNow?: (reason?: string) => void;

    // Optional: buffer calls until the CDN SDK boots
    __queue?: Array<() => void>;
  };

  interface Window {
    cavbotAnalytics?: CavbotAnalyticsClient;

    // Global CavBot SDK config surface (set by your install snippet if you want)
    __CAVBOT__?: {
      sitePublicId?: string;
      siteOrigin?: string;
      env?: "prod" | "staging" | "dev" | string;
      sdkVersion?: string;
    };

    cavbotBrain?: {
      getSessionId?: () => string;
    };
  }
}