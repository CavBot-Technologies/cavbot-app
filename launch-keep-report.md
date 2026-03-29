# CavBot Launch Keep Report
Date: 2026-03-28

## Purpose
This report documents launch-critical files/surfaces intentionally kept in place and why they were not quarantined or removed.

## Kept: Environment files and ignore policy
1. `.env.local`
   - Kept untouched by requirement.
   - Not tracked/staged.
2. `app/console/.env.local`
   - Kept as local-only environment file.
   - Covered by `.gitignore` `.env*` rule.
3. `.env.example` and `.env.production.example`
   - Kept as placeholder templates only (no real secrets).
4. `.gitignore`
   - Kept and hardened to ignore real env files while allowing safe template files.

## Kept: Runtime assets required by active imports
1. `public/cavbot-arcade/`
   - Referenced across arcade routes/pages and launcher settings.
   - Required for current runtime media/thumbnails.
2. `public/cavai-assets/`
   - Referenced by Image Studio preset catalog in server/runtime code.
3. `public/icons/`
   - Referenced broadly by CavAi/CavPad/public artifact UI and settings surfaces.

## Kept: CDN/external integration wiring
1. `next.config.mjs` rewrite sources
   - Source paths retained intentionally.
   - Destination is external CDN; local duplicate generated files removed where appropriate.
2. `lib/cavbotAssetPolicy.ts`
   - Kept to enforce CDN-aware runtime asset policy and cache/version behavior.

## Kept: Debug/dev logic that is non-public in production
1. Dev-only localhost/origin allowances
   - `lib/apiAuth.ts`, `lib/security/embedAppOrigins.ts`, `lib/stripe.ts`, `lib/settings/snippetGenerators.ts`, `app/api/public/demo-request/route.ts`
   - Kept because all are explicitly gated to non-production behavior.
2. CavTools debug event API
   - Kept because it is used by product debug workflows and enforced by server-side project/session access checks.
3. Drive debug page
   - Kept but production-gated (`app/cavtools/drive-debug/page.tsx`).

## Kept: Security and billing critical routes
- Auth OAuth callbacks/start routes, recovery, session/login/logout routes, Stripe webhook/checkout routes.
- Rationale: launch-critical integrations; hardened origin resolution and env checks were applied without redesigning or removing functionality.

## Explicitly not kept as public test surface
- `app/api/ai/test/route.ts`
- `app/api/ai/qwen-coder-test/route.ts`
- Both are now disabled in production by default (404) unless `CAVBOT_ENABLE_AI_TEST_ROUTES=1` is explicitly set.
