// Browser-bundle entry for the Chrome scripts. Exposes:
//   __bench(implId)      — pure performance measurement (tools/bench-chrome.ts)
//   __validate(implId)   — fixtures + letter-abbr correctness (tools/test-chrome.ts)
//   __verifyVs04(implId) — deep output-equality vs impl 04 (tools/test-chrome.ts)
// Each runs against a fresh page context created by the host script, so cold
// starts are real and impls don't pollute each other.
//
// Chrome coarsens performance.now() to ~100µs in normal contexts, so cache
// hits (sub-µs) are timed as an aggregate loop and divided, while misses
// (ms-scale) are timed individually like the bun bench.

import { impls } from '../impls/registry.ts';
import { getInitInfo, type InitInfo } from '../impls/08-verified-reps/index.ts';
import { fixtures } from '../shared/fixtures.ts';
import { zones } from '../shared/zones.ts';
import { scheduleClasses } from '../shared/schedule.ts';
import { formatterCount } from '../shared/fmt.ts';

const MISS_ITERATIONS = 25;
const HIT_CALLS = 50_000;
const HOUR_MS = 3_600_000;
const BASE_TS = Date.UTC(2026, 5, 1, 12, 0);

export interface BenchResult {
  id: string;
  zones: number;
  coldMs: number;
  hitUs: number;
  missMedMs: number; // median over the miss loop
  formatters: number; // Intl.DateTimeFormat instances constructed
}

(globalThis as { __bench?: unknown }).__bench = (implId: string): BenchResult => {
  const impl = impls.find((i) => i.id === implId)!;

  // cold: very first call in this page context (also warms all caches)
  const t0 = performance.now();
  impl.getTimeZonesAt(Date.UTC(2026, 6, 15));
  const coldMs = performance.now() - t0;

  // brief untimed warm-up (JIT + memo paths)
  for (let i = 0; i < 5; i++) impl.getTimeZonesAt(BASE_TS - (i + 1) * HOUR_MS);

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
    coldMs,
    hitUs,
    missMedMs: missTimes.toSorted((a, b) => a - b)[missTimes.length >> 1]!,
    formatters: formatterCount(),
  };
};

export interface ValidateResult {
  id: string;
  zones: number;
  fixturesPassed: number;
  fixturesTotal: number;
  letterAbbrs: number;
  init?: InitInfo | null;
}

(globalThis as { __validate?: unknown }).__validate = (implId: string): ValidateResult => {
  const impl = impls.find((i) => i.id === implId)!;

  let fixturesPassed = 0;

  for (const f of fixtures) {
    const info = impl.getTimeZonesAt(f.ts).find((z) => z.name === f.zone || z.name === f.altZone);

    if (info !== undefined && info.abbr === f.abbr && info.offset === f.offset) fixturesPassed++;
  }

  const summer = impl.getTimeZonesAt(Date.UTC(2026, 6, 15));
  const letterAbbrs = summer.filter(
    (z) => !/^(GMT|UTC?)([+-]|$)/.test(z.abbr) || z.abbr === 'GMT' || z.abbr === 'UTC'
  ).length;

  return {
    id: implId,
    zones: zones.length,
    fixturesPassed,
    fixturesTotal: fixtures.length,
    letterAbbrs,
    init: implId === '08-verified-reps' ? getInitInfo() : undefined,
  };
};

(globalThis as { __implIds?: string[] }).__implIds = impls.map((i) => i.id);

// rollover-resistance check: at instants PAST the generated year, output
// must still deep-equal live 04. For 07, zones in irregular classes (clamped
// by design outside the generated year) are skipped; 09's coherence guard
// must handle them via live fallback, so nothing is skipped there.
(globalThis as { __verifyFuture?: unknown }).__verifyFuture = (implId: string, skipIrregular: boolean) => {
  const i04 = impls.find((i) => i.id === '04-intl-single-fmt')!;
  const other = impls.find((i) => i.id === implId)!;

  const irregular = new Set<string>();

  for (const c of scheduleClasses) {
    if (c.kind === 2) for (const z of c.zones) irregular.add(z);
  }

  // winter + summer + just past the next year's US/EU spring-forwards
  const instants = [
    Date.UTC(2027, 0, 15, 12),
    Date.UTC(2027, 6, 15, 12),
    Date.UTC(2027, 2, 14, 8),
    Date.UTC(2027, 2, 28, 2),
  ];

  let checked = 0;
  let skipped = 0;
  let mismatchCount = 0;
  const mismatches: string[] = [];

  for (const ts of instants) {
    const a = i04.getTimeZonesAt(ts);
    const b = other.getTimeZonesAt(ts);

    for (let k = 0; k < a.length; k++) {
      const x = a[k]!;
      const y = b[k]!;

      if (skipIrregular && irregular.has(x.name)) {
        skipped++;
        continue;
      }

      checked++;

      if (x.name !== y.name || x.abbr !== y.abbr || x.offset !== y.offset) {
        mismatchCount++;

        if (mismatches.length < 10) {
          mismatches.push(`${x.name} @ ${new Date(ts).toISOString()}: 04=${x.abbr} ${x.offset} vs ${implId}=${y.abbr} ${y.offset}`);
        }
      }
    }
  }

  return { checked, skipped, mismatchCount, mismatches };
};

(globalThis as { __verifyVs04?: unknown }).__verifyVs04 = (implId: string) => {
  const i04 = impls.find((i) => i.id === '04-intl-single-fmt')!;
  const other = impls.find((i) => i.id === implId)!;

  const instants: number[] = [];

  for (let m = 0; m < 12; m++) instants.push(Date.UTC(2026, m, 15, 12));

  for (const t of [Date.UTC(2026, 2, 8, 7), Date.UTC(2026, 2, 29, 1), Date.UTC(2026, 9, 25, 1), Date.UTC(2026, 10, 1, 6)]) {
    instants.push(t - 60_000, t + 60_000);
  }

  let checked = 0;
  let mismatchCount = 0;
  const mismatches: string[] = [];

  for (const ts of instants) {
    const a = i04.getTimeZonesAt(ts);
    const b = other.getTimeZonesAt(ts);

    for (let k = 0; k < a.length; k++) {
      checked++;

      const x = a[k]!;
      const y = b[k]!;

      if (x.name !== y.name || x.abbr !== y.abbr || x.offset !== y.offset) {
        mismatchCount++;

        if (mismatches.length < 10) {
          mismatches.push(`${x.name} @ ${new Date(ts).toISOString()}: 04=${x.abbr} ${x.offset} vs ${implId}=${y.abbr} ${y.offset}`);
        }
      }
    }
  }

  return { checked, mismatchCount, mismatches };
};
