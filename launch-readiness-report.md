# CavBot Launch Readiness Report
Date: 2026-03-28

## Executive status
- Launch hardening sweep completed for localhost removal (production paths), secret exposure prevention, debug/test surface isolation, and commit safety.
- No known build/type/runtime blockers after validation.
- `.env.local` was preserved and not modified.

## 1) Localhost / dev-path sweep

### Classification
1. Safe dev-only references retained (explicitly gated by `process.env.NODE_ENV !== "production"`):
   - `lib/apiAuth.ts`
   - `lib/stripe.ts`
   - `lib/security/embedAppOrigins.ts`
   - `lib/settings/snippetGenerators.ts`
   - `app/api/public/demo-request/route.ts`
2. Production blockers fixed:
   - Removed hardcoded localhost fallback origin behavior from production runtime/auth/invite/share flows.
   - Removed runtime references to quarantined `* copy` assets that would 404.
3. Env-driven abstraction/hardening completed:
   - Centralized production-origin fallback via `getAppOrigin()` in critical server flows.
   - Production now fails fast for missing app-origin config in critical paths (instead of silent localhost assumptions).
4. Documentation/test-only references retained:
   - `README.md`, `scripts/*`, `tests/*` dev-local references.

### Key localhost hardening changes
- Origin + callback hardening:
  - `lib/apiAuth.ts`
  - `lib/stripe.ts`
  - `lib/status/checker.ts`
  - `lib/system-status/pipeline.ts`
  - `lib/cavtools/commandPlane.server.ts`
- Auth/recovery/invite/share route origin hardening:
  - `app/api/auth/recovery/email/by-domain/route.ts`
  - `app/api/auth/recovery/email/route.ts`
  - `app/api/auth/recovery/password/route.ts`
  - `app/api/workspaces/invites/route.ts`
  - `app/api/members/invite/route.ts`
  - `app/api/cavsafe/files/[id]/route.ts`
  - `app/api/cavsafe/snapshots/route.ts`
  - `app/api/cavcloud/files/[id]/route.ts`
- Embed/arcade and token origin hardening:
  - `app/api/embed/arcade/config/route.ts`
  - `app/api/arcade-ent/token/route.ts`
  - `app/api/cavcode/mounts/token/route.ts`
  - `app/api/cavcode/mounts/share/token/route.ts`
- Synthetic request host fallback hardening:
  - `app/cavcloud/page.tsx`
  - `app/cavcloud/dashboard/page.tsx`
  - `app/cavsafe/access.server.ts`
  - `app/cavbot-arcade/layout.tsx`
  - `lib/workspaceStore.server.ts`
  - `lib/settings/ownerAuth.server.ts`
  - `app/settings/upgrade/page.tsx`
  - `app/settings/downgrade/page.tsx`
  - `app/not-found.tsx`
- Non-runtime parser defaults changed from localhost:
  - `app/auth/page.tsx`
  - `lib/auth/cavbotVerify.ts`
- Public runtime local-port helper removed hardcoded localhost fallback:
  - `app/cavcode/page.tsx`

## 2) Secret / exposure sweep
- No hardcoded live/test key signatures detected in tracked source using pattern scans (`sk_live_`, `sk_test_`, `AKIA...`, `ghp_`, private key headers, etc.).
- No tracked `.env*`, `.pem`, `.p12`, `.pfx`, `.key`, `.crt` files found.
- Server-only env usage remains server-side; client-side env usage remains `NEXT_PUBLIC_*` for public-safe values.
- No secret values were printed in reports or logs.

## 3) Production env structure
- Added placeholder-only templates:
  - `.env.example`
  - `.env.production.example`
- Updated `.gitignore` to allow committed templates while still ignoring real `.env*` files.
- `.env.local` preserved untouched.

## 4) Client/server config boundary hardening
- Enforced server-side origin resolution for sensitive paths using `getAppOrigin()` and validated origins.
- Maintained browser-only exposure to public-safe envs.
- Hardened token/origin checks for mount/share token APIs.

## 5) Prelaunch/demo/debug gate audit
- Production-gated debug/test-only surfaces:
  - `app/cavtools/drive-debug/page.tsx` (already gated, preserved)
  - `app/api/ai/test/route.ts` (404 in production unless `CAVBOT_ENABLE_AI_TEST_ROUTES=1`)
  - `app/api/ai/qwen-coder-test/route.ts` (404 in production unless `CAVBOT_ENABLE_AI_TEST_ROUTES=1`)
- Arcade live-mode default in production is now live-enabled:
  - `lib/arcade/settings.ts`

## 6) External assets / duplicate bundle hardening
- Verified CDN rewrite path remains active in `next.config.mjs` for badge/widget/head assets.
- Duplicate tracked local SDK bundle files already removed from app tree (rewrites point to CDN).
- Fixed runtime references that still targeted quarantined duplicates:
  - `app/cavbot-arcade/gallery/page.tsx`
  - `app/settings/sections/security.css`

## 7) Auth/callback/billing/webhook URL sweep
- Auth recovery/invite/share URLs are env-driven via hardened origin resolution.
- Stripe checkout redirect base now fails fast in production when app-origin env is missing (`lib/stripe.ts`).
- OAuth callback flows remain origin-aware and no localhost production fallback was introduced.

## 8) Deployment/provider path
- Existing deployment path preserved (no platform migration).
- Existing provider configs validated:
  - `next.config.mjs` rewrites/headers/security headers intact.
  - `wrangler.toml` compatibility/pages output config intact.

## 9) Commit safety checks
- `.env.local` not staged.
- `.env`, `.env.local`, nested `.env.local` remain ignored.
- Launch archive is outside repo root (`/tmp/cavbot-launch-archive/...`).
- No secret-bearing file types tracked.

## 10) Validation results
- Lint (changed files): pass with warnings only (no errors).
  - Known warnings in `app/cavcode/page.tsx` (`react-hooks/exhaustive-deps`) are pre-existing and non-blocking.
- Typecheck: `npx tsc --noEmit` passed.
- Production build: `npm run build` passed.
- Production boot probe (localhost:3055):
  - `home=307`
  - `auth=200`
  - `status=200`
  - `api/ai/test=404` (expected production gate)
  - `api/ai/qwen-coder-test=404` (expected production gate)

## 11) Required founder/admin production inputs (no guessed values)
Set real production values before deploy (placeholders exist in `.env.production.example`):
- Core (official): set all to `https://app.cavbot.io`
  - `CAVBOT_APP_ORIGIN=https://app.cavbot.io`
  - `APP_URL=https://app.cavbot.io`
  - `NEXT_PUBLIC_APP_ORIGIN=https://app.cavbot.io`
  - `NEXT_PUBLIC_APP_URL=https://app.cavbot.io`
- Auth/security: `DATABASE_URL`, `CAVBOT_SESSION_SECRET`, `CAVBOT_KEY_ENC_SECRET`, `CAVCLOUD_TOKEN_SECRET`, `CAVBOT_EMBED_TOKEN_SECRET`, `CAVBOT_VERIFY_SECRET`, `CAVBOT_INTEGRATIONS_TOKEN_ENC_SECRET`
- AI provider credentials/models (DeepSeek and/or Alibaba/Qwen)
- Storage: `CAVCLOUD_R2_*`, `CAVCLOUD_GATEWAY_ORIGIN`
- Billing: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, Stripe price IDs, `STRIPE_WEBHOOK_SECRET`
- Email controls: `RESEND_API_KEY`, `CAVBOT_MAIL_FROM`

## Final readiness call
- After this sweep, there are no known code-level launch blockers.
- Remaining go-live dependency is supplying real production env values in deployment.
