# System Status Root Cause Report

## Scope
- Account Settings `Live System Status` widget
- `/status` (`CavBot System Status`) page live service cards/hero
- `/status` uptime timeline panel (last 30 days section)
- `/status/history` month view (incident list + month summary)

## Root Causes
1. Settings widget used isolated client state + local fetch and started from a hardcoded all-`UNKNOWN` payload.
- File: `app/settings/page.tsx` (previous `STATUS_PAYLOAD_FALLBACK`)
- File: `app/settings/sections/SettingsStatusCard.tsx` (previous local `useEffect` + `/api/status` fetch)
- Impact: widget often stayed unknown when first request failed and had no shared cache from elsewhere.

2. Status page "healthy" headline logic treated `UNKNOWN` as implicitly healthy.
- File: `app/status/page.tsx` (previous `hasIncident/hasRisk` only; fallback branch rendered `"All systems healthy"`)
- Impact: page could show "All systems healthy" while latency/last-checked were blank.

3. Existing status path depended on DB-backed status rows and silently fell back to unknown on DB/probe failures.
- File: `lib/status/service.ts` (`getStatusPayload` catch -> fallback unknown payload)
- File: `lib/status/checker.ts` (`ensureStatusSnapshotFresh` runtime gating and DB writes)
- Impact: status frequently degraded to unknown/blank without deterministic operator reason.

4. No single shared client data source for Settings widget and Status page.
- File: `app/settings/sections/SettingsStatusCard.tsx` (local polling)
- File: `app/status/page.tsx` (server-side DB payload)
- Impact: each surface initialized independently and could diverge.

5. No app-level prewarm for status pipeline.
- File: `app/layout.tsx` (before fix had no system status bootstrap)
- Impact: status fetch could start late, only after specific surface mounted.

6. Uptime timeline used a separate legacy timeline source instead of the live shared status pipeline.
- File: `app/status/page.tsx` (previous timeline from `getStatusTimeline`)
- File: `lib/status/service.ts` (DB-backed timeline path)
- Impact: timeline and percentages drifted from live service checks, producing stale `Unknown`/`0.0% healthy` output.

## Why Settings Did Not Update Reliably
- It was seeded with an all-unknown fallback and depended on its own request lifecycle.
- If `/api/status` path returned fallback unknown (DB/probe issue), the widget had no alternate real-time source.
- There was no shared app-level cache/hook to hand it already-fetched status.

## Why Statuses Appeared to Flip / Misreport
- Headline logic mapped "not incident + not at-risk" to "All systems healthy", even for `UNKNOWN`.
- DB/probe fallback behavior could swap between unknown and checked states across requests.
- There was no deterministic, in-memory stale-while-revalidate health snapshot for both surfaces.
- Timeline panel read from a different historical source than the live cards, so the two sections diverged.

## Fix Summary
- Added a new deterministic aggregation pipeline with TTL cache + in-flight dedupe:
  - `lib/system-status/pipeline.ts`
  - `app/api/system-status/route.ts`
- Added one shared client hook with SWR dedupe/polling:
  - `lib/hooks/useSystemStatus.ts`
- Added AppShell bootstrap so status starts on app load:
  - `components/status/SystemStatusBootstrap.tsx`
  - `app/layout.tsx`
- Rewired Settings widget to shared hook:
  - `app/settings/sections/SettingsStatusCard.tsx`
  - `app/settings/page.tsx`
- Rewired Status page live hero/service cards to shared hook source via client component:
  - `components/status/StatusLiveOverview.tsx`
  - `app/status/page.tsx`
- Rewired status timeline to the same shared system status pipeline:
  - `lib/system-status/pipeline.ts` (in-memory day-bucket timeline aggregation)
  - `app/api/system-status/timeline/route.ts` (shared timeline endpoint)
  - `components/status/StatusTimelineSection.tsx` (SWR polling, same data source)
  - `app/status/page.tsx` (timeline section now uses shared endpoint payload)
- Added regression tests:
  - `tests/system-status-pipeline.test.ts`
  - `tests/system-status-wiring.test.ts`
  - Included in `package.json` `test:sdk`

## Before vs After
- Before: settings widget could stay unknown; status page could say healthy with blank checks; timeline panel could stay stale/unknown from a separate source.
- After: live cards and timeline are fed by the same shared system-status pipeline with deterministic status mapping, polling, dedupe, and app-shell prewarm.

## Verification Steps
1. Open Settings first (`/settings`) and confirm live status rows populate without visiting `/status`.
2. Navigate to `/status`; hero + service cards should reflect same statuses/checked timestamps.
3. In `/status`, confirm the uptime timeline dots and percentages update from real checks (not static unknown values).
4. Navigate back to Settings and again to `/status`; values should stay consistent (same source, no random swapping).
5. Wait >15s and confirm automatic background updates without manual refresh.

## History Page Wiring Update
1. Root cause for static history month view:
- File: `app/status/history/page.tsx`
- File: `app/api/status/history/route.ts`
- The view relied on incident rows only, so months with no incident writes looked static and metric-free.

2. What changed:
- Added shared month metrics endpoint in live pipeline:
  - File: `lib/system-status/pipeline.ts` (`getSystemStatusHistoryMonthMetrics`)
- Added month metrics payload type:
  - File: `lib/status/types.ts` (`StatusHistoryMonthMetrics`)
- Rewired `/status/history` page to consume shared live month metrics and show sampled health counts/uptime for the selected month:
  - File: `app/status/history/page.tsx`
- Rewired `/api/status/history` to merge live month metrics into history payload:
  - File: `app/api/status/history/route.ts`

3. Before/after:
- Before: history month could render only "No incidents recorded..." with no live metric context.
- After: history month always includes real sampled metrics (health checks, active days, monthly healthy %) from the shared pipeline, even when no incidents are logged.
