# CavBot Production Analytics Stabilization Report

Date: 2026-04-29

## Root Causes Found

- Server-rendered analytics surfaces were not consistently using the tenant-aware project/site resolver. Several paths could fall back to the first active project or stale workspace state, which could show the wrong account/site metrics.
- Authenticated dashboard reads could depend on missing per-project analytics server keys. Older projects without encrypted dashboard keys could not reliably read live Worker summaries.
- `/api/embed/analytics` did not fully support Analytics v5 browser preflight/header requirements and did not forward the verified browser origin to the Worker, causing accepted app-side requests to fail Worker origin mapping.
- Existing publishable keys could have legacy analytics scopes (`events:write` / `analytics:write`) while the app proxy required only `analytics:events`.
- Worker summary aggregation was too sparse and used non-real health defaults, including a hardcoded guardian score path for empty data.
- SEO/page discovery depended on collapsed or missing route-path aggregation, so observed pages could show as one page even when multiple pages emitted events.
- Plan gates used stale account tier in some paths instead of the server-trusted billing/subscription/trial resolver.
- Billing summary could block plan state behind optional Qwen usage/schema work.
- Runtime script wiring still had old asset assumptions and could load CavAi Brain before Analytics v5.
- User-facing app-owned Codex references were removed or avoided; remaining `cavcodeX` strings are internal variable names for CavCode coordinates, not Codex branding.

## Files Changed

- Analytics context and dashboard reads: `lib/analyticsConsole.server.ts`, `lib/projectAnalyticsKey.server.ts`, `lib/cavbotApi.server.ts`.
- Console/modules/API routes: `/console`, `/routes`, `/seo`, `/errors`, `/404-control-room`, `/a11y`, `/insights`, `/api/summary`, `/api/console`, export/report routes.
- Ingestion/security: `app/api/embed/analytics/route.ts`, `lib/security/embedVerifier.ts`, `lib/apiKeys.server.ts`.
- Worker/storage/aggregation: `cloudfare.worker.js`, `public/cavbot/d1/migrations/*`, `scripts/verify-analytics-d1-schema.sh`.
- Auth/plan gating: `lib/moduleGate.server.ts`, `app/api/billing/summary/route.ts`, `app/api/auth/login/route.ts`.
- Runtime assets: `app/_components/AppHostRuntimeMounts.tsx`, `next.config.mjs`, `public/cavai/cavai-analytics-v5.js`, `public/cavai/cavai.js`.
- Tests: Worker/SDK/asset/billing/navigation regression tests.

## Fix Summary

- Routed server-rendered analytics pages through one account/project/site/range resolver.
- Made `/api/summary` use DB-backed workspace project/site selection before falling back.
- Allowed authenticated server-side reads to use a server-only admin token while public ingestion still requires verified publishable/project keys.
- Fixed app-proxy CORS OPTIONS support and allowed Analytics v5 headers.
- Preserved real client IP for Worker rate buckets through trusted proxy headers.
- Forwarded verified browser origin to the Worker for safe site mapping.
- Made scope validation backward-compatible for installed snippets.
- Rebuilt Worker summary from stored events: routes, SEO pages, 404, JS/API errors, trends, last-updated timestamps, and honest nulls for empty data.
- Removed hardcoded/fake production metric defaults from the live summary path.
- Made plan gating use the billing plan resolver shared with billing summary.
- Bounded optional Qwen usage in billing summary so plan state returns quickly.
- Restored same-origin Analytics v5 and CavAi Brain assets and deterministic analytics-before-brain loading.
- Added D1 schema/index migrations for analytics event storage and bounded query filters.
- Applied a targeted live Worker hotfix through Cloudflare API with existing bindings preserved, then verified through the app proxy.

## Verification

- `npm run test:sdk` passed: 61/61.
- `node --import tsx --test tests/billing-plan-source-of-truth.test.ts` passed: 4/4.
- `npm run lint` passed with 0 errors and 20 pre-existing warnings in unrelated/admin/temp areas.
- `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` passed. There is no `npm run typecheck` script.
- `npm run build` passed.
- `npm run build:cloudflare` passed and wrote `.open-next/worker.js`.
- Manual authenticated route smoke on rebuilt app passed:
  `/console`, `/routes`, `/seo`, `/errors`, `/404-control-room`, `/a11y`, `/api/settings/api-keys`.
- Manual owner/Premium smoke passed: billing summary returned Premium.
- Manual CORS smoke passed: `/api/embed/analytics` returned 204 for Analytics v5 headers.
- Manual live ingestion smoke passed: a real Analytics v5 `cavbot_page_view` with a unique route path was posted through the rebuilt app proxy, accepted by the live Worker with 202, and then appeared in authenticated summary data.
- Final smoke route: `/cavbot-live-verification-1777453703370`.
- Final summary proof: `observedRoute: true`, route count `13`, SEO page count `13`.

## Remaining Risks

- Browser DevTools automation was not run because Playwright is not installed in this workspace. Server smoke and production route checks showed no app-caused 500s during verification.
- Wrangler CLI could not be used for direct D1 inspection because no non-interactive Cloudflare API token was configured locally. Live behavior was verified through the app proxy and Worker endpoint instead.
- Full cleanup of unrelated existing lint warnings and unrelated dirty files was intentionally left out of this incident commit.
