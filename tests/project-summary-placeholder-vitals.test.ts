import assert from "node:assert/strict";
import test from "node:test";

import { suppressPlaceholderWebVitals } from "@/lib/projectSummaryEnrichment.server";

test("placeholder vitals zeroes are cleared when no samples exist", () => {
  const summary = {
    webVitals: {
      rollup: {
        samples: 0,
        lcpP75Ms: 0,
        inpP75Ms: 0,
        clsP75: 0,
        fcpP75Ms: 0,
        ttfbP75Ms: 0,
      },
    },
    metrics: {
      avgLcpMs: 0,
      avgTtfbMs: 0,
      globalCls: 0,
      lcpP75Ms: 0,
      inpP75Ms: 0,
      clsP75: 0,
      fcpP75Ms: 0,
      ttfbP75Ms: 0,
    },
  };

  const normalized = suppressPlaceholderWebVitals(summary as never) as unknown as {
    webVitals: { rollup: { samples: number | null; lcpP75Ms: number | null } };
    metrics: { avgLcpMs: number | null; globalCls: number | null };
  };

  assert.equal(normalized.webVitals.rollup.samples, null);
  assert.equal(normalized.webVitals.rollup.lcpP75Ms, null);
  assert.equal(normalized.metrics.avgLcpMs, null);
  assert.equal(normalized.metrics.globalCls, null);
});

test("real vitals samples are preserved", () => {
  const summary = {
    webVitals: {
      rollup: {
        samples: 8,
        lcpP75Ms: 2140,
        inpP75Ms: 160,
        clsP75: 0.06,
      },
    },
    metrics: {
      avgLcpMs: 2140,
      globalCls: 0.06,
    },
  };

  const normalized = suppressPlaceholderWebVitals(summary as never) as unknown as {
    webVitals: { rollup: { samples: number | null; lcpP75Ms: number | null } };
    metrics: { avgLcpMs: number | null };
  };

  assert.equal(normalized.webVitals.rollup.samples, 8);
  assert.equal(normalized.webVitals.rollup.lcpP75Ms, 2140);
  assert.equal(normalized.metrics.avgLcpMs, 2140);
});
