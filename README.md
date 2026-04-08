# cavbot-app

CavBot is a reliability copilot and control-plane for modern SaaS teams, built on CavBot Analytics v5 and CavCore Console.

## Getting Started

Run the development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Safe localhost workflow

`npm run dev` now runs in safe localhost mode by default.

- App origins are forced to `http://localhost:3000` for the dev server.
- Live integrations such as Stripe, Resend, Cloudflare, and R2 are stripped in dev unless you explicitly opt in.
- Remote databases are blocked by default. If your env still points at a hosted Postgres instance, dev will refuse to boot.

Recommended setup:

1. Copy `.env.development.local.example` to `.env.development.local`.
2. Set `CAVBOT_DEV_DATABASE_URL` and `CAVBOT_DEV_DIRECT_URL` to a local Postgres database.
3. Run `npm run dev`.

If you intentionally want to use remote infrastructure in dev, opt in explicitly in `.env.development.local`:

- `CAVBOT_ALLOW_REMOTE_DEV_DB=1`
- `CAVBOT_ALLOW_LIVE_INTEGRATIONS_IN_DEV=1`

That opt-in is manual on purpose so production services are not touched by accident.

## Deploy on Cloudflare

Primary deploy target is Cloudflare via OpenNext.

### Production deploy policy

- Primary path: GitHub Actions deploy on `main` via `.github/workflows/deploy-cloudflare.yml`.
- Cloudflare Pages source-triggered deploys are disabled on purpose so repo-transfer metadata cannot trigger stale builds.
- Secondary emergency path: local ad-hoc deploy with `npm run deploy:cloudflare`.
- Guardrails for ad-hoc production deploys:
  - worktree must be clean
  - `HEAD` must already be in `origin/main`
  - deploy metadata is pinned to git (`branch=main`, exact `commit_hash`, `commit_dirty=false`)

### GitHub Actions Production Deploy

GitHub Actions is the authoritative production deployment path.

1. In GitHub repo secrets, or in the GitHub `production` environment secrets for this workflow, set:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `DATABASE_URL` and/or `DIRECT_URL`
     At least one production Postgres connection string must be available to the workflow. If only one is set, the migration step mirrors it into the other variable before running Prisma.
2. Push to `main` (or run `Deploy Cloudflare` from the Actions tab).
3. Workflow path: `.github/workflows/deploy-cloudflare.yml`

Production deploys now run `prisma migrate deploy` before building so schema-dependent CavCloud and auth changes do not ship ahead of the database.

Local deploy commands:

```bash
npm run build:cloudflare
npm run deploy:cloudflare
```

Guard-only check:

```bash
npm run deploy:cloudflare:guard
```
