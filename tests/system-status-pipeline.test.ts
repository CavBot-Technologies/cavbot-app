import assert from "node:assert/strict";
import test from "node:test";
import { createSystemStatusPipeline } from "@/lib/system-status/pipeline";
import type { SystemStatusServiceDefinition } from "@/lib/system-status/types";

type MockProbeResponse = {
  status?: number;
  latencyMs?: number;
  error?: string;
};

function createMockFetch(
  responses: Record<string, MockProbeResponse>,
  clock: { nowMs: number; calls: number }
) {
  return async (input: RequestInfo | URL) => {
    clock.calls += 1;
    const url = String(input);
    const row = responses[url];
    assert.ok(row, `Unexpected probe URL: ${url}`);
    clock.nowMs += row.latencyMs ?? 0;
    if (row.error) {
      throw new Error(row.error);
    }
    return new Response("", {
      status: row.status ?? 200,
    });
  };
}

function createSequentialMockFetch(
  responses: Record<string, MockProbeResponse[]>,
  clock: { nowMs: number; calls: number }
) {
  return async (input: RequestInfo | URL) => {
    clock.calls += 1;
    const url = String(input);
    const queue = responses[url];
    assert.ok(queue && queue.length > 0, `Unexpected probe URL: ${url}`);
    const row = queue.length > 1 ? queue.shift()! : queue[0]!;
    clock.nowMs += row.latencyMs ?? 0;
    if (row.error) {
      throw new Error(row.error);
    }
    return new Response("", {
      status: row.status ?? 200,
    });
  };
}

test("system status pipeline maps live / at-risk / down / unknown deterministically", async () => {
  const clock = { nowMs: 1_700_000_000_000, calls: 0 };
  const services: SystemStatusServiceDefinition[] = [
    {
      key: "cavai_analytics",
      label: "CavAi Analytics",
      latencyThresholdMs: 10_000,
      probes: [
        {
          name: "Live probe",
          url: "https://svc.example/live",
          expectedStatus: [200],
        },
      ],
    },
    {
      key: "cavai",
      label: "CavAi",
      latencyThresholdMs: 100,
      probes: [
        {
          name: "Slow probe",
          url: "https://svc.example/slow",
          expectedStatus: [200],
        },
      ],
    },
    {
      key: "cavtools",
      label: "CavTools",
      latencyThresholdMs: 200,
      probes: [
        {
          name: "Failing probe",
          url: "https://svc.example/down",
          expectedStatus: [200],
        },
      ],
    },
    {
      key: "cavcode",
      label: "CavCode",
      latencyThresholdMs: 200,
      probes: [],
    },
  ];

  const fetchImpl = createMockFetch(
    {
      "https://svc.example/live": { status: 200, latencyMs: 25 },
      "https://svc.example/slow": { status: 200, latencyMs: 320 },
      "https://svc.example/down": { status: 503, latencyMs: 40 },
    },
    clock
  );

  const pipeline = createSystemStatusPipeline({
    services,
    fetchImpl,
    now: () => clock.nowMs,
    cacheTtlMs: 10_000,
  });

  const snapshot = await pipeline.getSnapshot({ forceRefresh: true, allowStale: false });
  const byKey = new Map(snapshot.services.map((service) => [service.key, service]));

  assert.equal(byKey.get("cavai_analytics")?.status, "live");
  assert.equal(byKey.get("cavai")?.status, "at_risk");
  assert.equal(byKey.get("cavtools")?.status, "down");
  assert.equal(byKey.get("cavcode")?.status, "unknown");
  assert.equal(byKey.get("cavcode")?.reason, "No health endpoints configured");
  assert.equal(snapshot.summary.liveCount, 1);
  assert.equal(snapshot.summary.atRiskCount, 1);
  assert.equal(snapshot.summary.downCount, 1);
  assert.equal(snapshot.summary.unknownCount, 1);
  assert.equal(snapshot.summary.allLive, false);
  assert.ok(snapshot.checkedAt, "checkedAt must be populated");
});

test("system status pipeline caches within TTL and avoids repeated probe storms", async () => {
  const clock = { nowMs: 1_700_000_000_000, calls: 0 };
  const services: SystemStatusServiceDefinition[] = [
    {
      key: "cavai_analytics",
      label: "CavAi Analytics",
      latencyThresholdMs: 200,
      probes: [
        {
          name: "Primary probe",
          url: "https://svc.example/cache",
          expectedStatus: [200],
        },
      ],
    },
  ];

  const fetchImpl = createMockFetch(
    {
      "https://svc.example/cache": { status: 200, latencyMs: 15 },
    },
    clock
  );

  const pipeline = createSystemStatusPipeline({
    services,
    fetchImpl,
    now: () => clock.nowMs,
    cacheTtlMs: 1_000,
  });

  await pipeline.getSnapshot({ allowStale: false });
  await pipeline.getSnapshot({ allowStale: false });
  assert.equal(clock.calls, 1, "second read inside TTL must reuse cache");

  clock.nowMs += 1_050;
  await pipeline.getSnapshot({ allowStale: false });
  assert.equal(clock.calls, 2, "TTL expiry must trigger one new refresh");
});

test("system status timeline reflects live probe samples and current severity", async () => {
  const clock = { nowMs: 1_700_000_000_000, calls: 0 };
  const services: SystemStatusServiceDefinition[] = [
    {
      key: "cavai_analytics",
      label: "CavAi Analytics",
      latencyThresholdMs: 500,
      probes: [
        {
          name: "Timeline probe",
          url: "https://svc.example/timeline",
          expectedStatus: [200],
        },
      ],
    },
  ];

  const fetchImpl = createSequentialMockFetch(
    {
      "https://svc.example/timeline": [
        { status: 200, latencyMs: 25 },
        { status: 503, latencyMs: 45 },
      ],
    },
    clock
  );

  const pipeline = createSystemStatusPipeline({
    services,
    fetchImpl,
    now: () => clock.nowMs,
    cacheTtlMs: 1_000,
  });

  await pipeline.getSnapshot({ forceRefresh: true, allowStale: false });
  clock.nowMs += 2_000;
  await pipeline.getSnapshot({ forceRefresh: true, allowStale: false });

  const timeline = await pipeline.getTimeline(30);
  const lane = timeline.services.find((service) => service.serviceKey === "cavai_analytics");
  assert.ok(lane, "Expected cavai_analytics lane in timeline payload");
  const todayEntry = lane!.timeline[lane!.timeline.length - 1];

  assert.equal(todayEntry.status, "INCIDENT");
  assert.equal(timeline.global.samplesLogged, 2);
  assert.equal(timeline.global.uptimePct, 50);
  assert.equal(lane!.uptimePct, 50);
});

test("system status month metrics are derived from live samples and month key navigation", async () => {
  const clock = { nowMs: Date.UTC(2026, 0, 10, 12, 0, 0), calls: 0 };
  const services: SystemStatusServiceDefinition[] = [
    {
      key: "cavai_analytics",
      label: "CavAi Analytics",
      latencyThresholdMs: 1_000,
      probes: [
        {
          name: "History probe",
          url: "https://svc.example/history",
          expectedStatus: [200],
        },
      ],
    },
  ];

  const fetchImpl = createSequentialMockFetch(
    {
      "https://svc.example/history": [
        { status: 200, latencyMs: 20 },
        { status: 503, latencyMs: 40 },
        { status: 200, latencyMs: 30 },
      ],
    },
    clock
  );

  const pipeline = createSystemStatusPipeline({
    services,
    fetchImpl,
    now: () => clock.nowMs,
    cacheTtlMs: 60_000,
  });

  await pipeline.getSnapshot({ forceRefresh: true, allowStale: false });
  clock.nowMs = Date.UTC(2026, 0, 11, 12, 0, 0);
  await pipeline.getSnapshot({ forceRefresh: true, allowStale: false });
  clock.nowMs = Date.UTC(2026, 1, 1, 12, 0, 0);
  await pipeline.getSnapshot({ forceRefresh: true, allowStale: false });

  const january = await pipeline.getHistoryMonthMetrics("2026-01");
  assert.equal(january.monthKey, "2026-01");
  assert.equal(january.prevMonthKey, null);
  assert.equal(january.nextMonthKey, "2026-02");
  assert.equal(january.metrics.sampleCount, 2);
  assert.equal(january.metrics.healthySamples, 1);
  assert.equal(january.metrics.incidentSamples, 1);
  assert.equal(january.metrics.atRiskSamples, 0);
  assert.equal(january.metrics.unknownSamples, 0);
  assert.equal(january.metrics.uptimePct, 50);
  assert.equal(january.metrics.activeDays, 2);
});

test("system status month metrics respect requested timezone month boundaries", async () => {
  const clock = { nowMs: Date.UTC(2026, 1, 1, 7, 30, 0), calls: 0 };
  const services: SystemStatusServiceDefinition[] = [
    {
      key: "cavai_analytics",
      label: "CavAi Analytics",
      latencyThresholdMs: 500,
      probes: [
        {
          name: "Timezone probe",
          url: "https://svc.example/tz",
          expectedStatus: [200],
        },
      ],
    },
  ];

  const fetchImpl = createMockFetch(
    {
      "https://svc.example/tz": { status: 200, latencyMs: 15 },
    },
    clock
  );

  const pipeline = createSystemStatusPipeline({
    services,
    fetchImpl,
    now: () => clock.nowMs,
    cacheTtlMs: 60_000,
  });

  await pipeline.getSnapshot({ forceRefresh: true, allowStale: false });

  const laMonth = await pipeline.getHistoryMonthMetrics(undefined, "America/Los_Angeles");
  assert.equal(laMonth.monthKey, "2026-01");
  assert.equal(laMonth.metrics.sampleCount, 1);
});
