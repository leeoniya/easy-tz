// Browser-bundle entry for tools/bench-chrome.ts: exposes __bench(implId),
// which measures one impl inside a fresh page context (cold start is real —
// no formatter or table state exists before the first call).
//
// Chrome coarsens performance.now() to ~100µs in normal contexts, so
// cache hits (sub-µs) are timed as an aggregate loop and divided, while
// misses (ms-scale) are timed individually like the bun bench.

import { impls } from '../impls/registry.ts';
import { getInitInfo, type InitInfo } from '../impls/08-verified-reps/index.ts';
import { fixtures } from '../shared/fixtures.ts';
import { zones } from '../shared/zones.ts';

const MISS_ITERATIONS = 25;
const HIT_CALLS = 50_000;
const HOUR_MS = 3_600_000;
const BASE_TS = Date.UTC(2026, 5, 1, 12, 0);

export interface BenchResult {
  id: string;
  zones: number;
  fixturesPassed: number;
  fixturesTotal: number;
  letterAbbrs: number;
  coldMs: number;
  hitUs: number;
  missMeanMs: number;
  missMinMs: number;
  init?: InitInfo | null;
}

(globalThis as { __bench?: unknown }).__bench = (implId: string): BenchResult => {
  const impl = impls.find((i) => i.id === implId)!;

  // cold: very first call in this page context
  const t0 = performance.now();
  impl.getTimeZonesAt(Date.UTC(2026, 6, 15));
  const coldMs = performance.now() - t0;

  // validation (also finishes warming everything)
  let fixturesPassed = 0;

  for (const f of fixtures) {
    const info = impl.getTimeZonesAt(f.ts).find((z) => z.name === f.zone || z.name === f.altZone);

    if (info !== undefined && info.abbr === f.abbr && info.offset === f.offset) fixturesPassed++;
  }

  const summer = impl.getTimeZonesAt(Date.UTC(2026, 6, 15));
  const letterAbbrs = summer.filter(
    (z) => !/^(GMT|UTC?)([+-]|$)/.test(z.abbr) || z.abbr === 'GMT' || z.abbr === 'UTC'
  ).length;

  // hits: aggregate loop within one hour bucket
  impl.getTimeZonesAt(BASE_TS);

  const h0 = performance.now();

  for (let i = 0; i < HIT_CALLS; i++) {
    impl.getTimeZonesAt(BASE_TS + (i % 1000));
  }

  const hitUs = ((performance.now() - h0) / HIT_CALLS) * 1000;

  // misses: individually timed, each iteration advances one hour bucket
  const missTimes: number[] = [];

  for (let i = 0; i < MISS_ITERATIONS; i++) {
    const m0 = performance.now();
    impl.getTimeZonesAt(BASE_TS + (i + 1) * HOUR_MS);
    missTimes.push(performance.now() - m0);
  }

  return {
    id: implId,
    zones: zones.length,
    fixturesPassed,
    fixturesTotal: fixtures.length,
    letterAbbrs,
    coldMs,
    hitUs,
    missMeanMs: missTimes.reduce((a, b) => a + b, 0) / missTimes.length,
    missMinMs: Math.min(...missTimes),
    init: implId === '08-verified-reps' ? getInitInfo() : undefined,
  };
};

(globalThis as { __implIds?: string[] }).__implIds = impls.map((i) => i.id);

// deep output-equality of a table-backed impl against 04 (live per-zone) at
// monthly + transition-edge instants; run in a separate page AFTER benching
// so 04's formatters don't pollute the other impls' measurements
(globalThis as { __verifyVs04?: unknown }).__verifyVs04 = (implId: string) => {
  const i04 = impls.find((i) => i.id === '04-intl-single-fmt')!;
  const other = impls.find((i) => i.id === implId)!;

  const instants: number[] = [];

  for (let m = 0; m < 12; m++) instants.push(Date.UTC(2026, m, 15, 12));

  for (const t of [Date.UTC(2026, 2, 8, 7), Date.UTC(2026, 2, 29, 1), Date.UTC(2026, 9, 25, 1), Date.UTC(2026, 10, 1, 6)]) {
    instants.push(t - 60_000, t + 60_000);
  }

  let checked = 0;
  const mismatches: string[] = [];

  for (const ts of instants) {
    const a = i04.getTimeZonesAt(ts);
    const b = other.getTimeZonesAt(ts);

    for (let k = 0; k < a.length; k++) {
      checked++;

      const x = a[k]!;
      const y = b[k]!;

      if ((x.name !== y.name || x.abbr !== y.abbr || x.offset !== y.offset) && mismatches.length < 10) {
        mismatches.push(`${x.name} @ ${new Date(ts).toISOString()}: 04=${x.abbr} ${x.offset} vs ${implId}=${y.abbr} ${y.offset}`);
      }
    }
  }

  return { checked, mismatches, init: getInitInfo() };
};
