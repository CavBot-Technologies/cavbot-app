# cavbot-app

CavBot is a reliability copilot and control-plane for modern SaaS teams, built on CavBot Analytics v5 and CavCore Console.

## Getting Started

Run the development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

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

1. In GitHub repo secrets, set:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
2. Push to `main` (or run `Deploy Cloudflare` from the Actions tab).
3. Workflow path: `.github/workflows/deploy-cloudflare.yml`

Local deploy commands:

```bash
npm run build:cloudflare
npm run deploy:cloudflare
```

Guard-only check:

```bash
npm run deploy:cloudflare:guard
```
