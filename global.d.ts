export {};

declare global {
  type CavbotPayload = Record<string, unknown>;
  type CavbotUnknownFn = (...args: never[]) => unknown;
  type CavbotUnknownAsyncFn = (...args: never[]) => Promise<unknown>;
  type CavBrowserStore = {
    readonly length: number;
    key: (index: number) => string | null;
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
    clear: () => void;
  };
  type CavbotClientAuthBootstrap = {
    authenticated: boolean;
    session?: {
      userId?: string;
      accountId?: string;
      memberRole?: string | null;
    } | null;
    profile?: {
      fullName?: string | null;
      email?: string | null;
      username?: string | null;
      initials?: string | null;
      avatarTone?: string | null;
      avatarImage?: string | null;
      publicProfileEnabled?: boolean | null;
    } | null;
    plan?: {
      planId?: string | null;
      planTier?: string | null;
      planLabel?: string | null;
      memberRole?: string | null;
      trialActive?: boolean;
      trialDaysLeft?: number;
    } | null;
    ts?: number;
  };

  type CavbotAnalyticsClient = {
    track?: (name: string, payload?: CavbotPayload, options?: CavbotPayload) => void | Promise<void>;

    trackPageView?: (
      pageType?: string,
      component?: string,
      extraPayload?: CavbotPayload
    ) => void | Promise<void>;

    trackConsole?: (event: string, payload?: CavbotPayload) => void | Promise<void>;

    trackError?: (kind: string, details?: CavbotPayload, options?: CavbotPayload) => void | Promise<void>;

    flush?: () => void | Promise<void>;

    report?: () => unknown;
    runAuditNow?: (reason?: string) => void;

    // Optional: buffer calls until the CDN SDK boots
    __queue?: Array<() => void>;
  };

  type CavbotConsoleRangeKey = "24h" | "7d" | "30d";
  type CavbotConsoleApiRange = "7d" | "30d";
  var __cbLocalStore: CavBrowserStore;
  var __cbSessionStore: CavBrowserStore;
  var __CB_AUTH_BOOTSTRAP__: CavbotClientAuthBootstrap | null | undefined;

  interface Window {
    cavbotAnalytics?: CavbotAnalyticsClient;
    __cbLocalStore?: CavBrowserStore;
    __cbSessionStore?: CavBrowserStore;
    __CB_AUTH_BOOTSTRAP__?: CavbotClientAuthBootstrap | null;

    // Global CavBot SDK config surface (set by your install snippet if you want)
    __CAVBOT__?: {
      sitePublicId?: string;
      siteOrigin?: string;
      env?: "prod" | "staging" | "dev" | string;
      sdkVersion?: string;
    };

    // CavAi brain (your unified JS brain file)
    cavai?: {
      getSessionId?: () => string;
      enableHeadTracking?: () => void;
      intelligence?: {
        diagnostics?: CavbotUnknownAsyncFn;
        fixPlan?: CavbotUnknownAsyncFn;
        priorityToCavPadNote?: CavbotUnknownFn;
        openTargetsForPriority?: (...args: never[]) => unknown[];
        resolveOpenTarget?: CavbotUnknownAsyncFn;
        buildCavCodeHref?: (...args: never[]) => string;
      };
    };

    cavbotIntelligence?: {
      diagnostics?: CavbotUnknownAsyncFn;
      fixPlan?: CavbotUnknownAsyncFn;
      priorityToCavPadNote?: CavbotUnknownFn;
      openTargetsForPriority?: (...args: never[]) => unknown[];
      resolveOpenTarget?: CavbotUnknownAsyncFn;
      buildCavCodeHref?: (...args: never[]) => string;
    };

    __cavaiHeadTrackingRefresh?: () => void;
    __cavbotHeadTrackingReady?: boolean;
    __cavbotHeadTrackingLastRefresh?: number;
    __cavbotHeadTrackingHeadCount?: number;
    __cavbotHeadTrackingRefresh?: () => void;
    __cavbotEyeTrackingReady?: boolean;
    __cavbotEyeTrackingLastRefresh?: number;
    __cavaiEyeTrackingRefresh?: () => void;
    __cavbotEyeTrackingRefresh?: () => void;

    // Console range values published by AppShell (prevents TS “property does not exist”)
    __CAVBOT_CONSOLE_RANGE__?: CavbotConsoleRangeKey;
    __CAVBOT_CONSOLE_API_RANGE__?: CavbotConsoleApiRange;
  }
}
