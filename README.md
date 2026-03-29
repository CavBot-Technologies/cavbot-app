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

### GitHub Actions Deploy Fallback (recommended)

If Cloudflare's Git integration returns an internal installation error, deploy via GitHub Actions.

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
