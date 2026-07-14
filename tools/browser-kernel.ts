// Browser-side measurement/validation kernel shared by the two bundle
// entries (bench-browser-entry.ts for this repo's impls, lib-browser-entry
// for the comparison libraries). Installing per-entry keeps each bundle
// slim: our impls' pages must not parse the libraries' ~4MB of tzdata, which
// measurably inflates their cold-start readings.
//
// Chrome coarsens performance.now() to ~100µs in normal contexts, so cache
// hits (sub-µs) are timed as an aggregate loop and divided, while misses
// (ms-scale) are timed individually like the bun bench.

import type { Impl } from '../shared/types.ts';
import { fixtures } from '../shared/fixtures.ts';
import { zones } from '../shared/zones.ts';
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

export interface ValidateResult {
  id: string;
  zones: number;
  fixturesPassed: number;
  fixturesTotal: number;
  fixtureFailures: string[];
  letterAbbrs: number;
  init?: unknown;
}

export interface Vs04 {
  checked: number;
  mismatchCount: number;
  mismatches: string[];
}

export function installKernel(
  list: Impl[],
  baseline: Impl,
  initInfoFor: (id: string) => unknown = () => undefined
): void {
  const find = (id: string) => list.find((i) => i.id === id) ?? baseline;

  (globalThis as { __benchIds?: string[] }).__benchIds = list.map((i) => i.id);

  // cold-only measurement: the very first call in a fresh page context.
  // The host benches cold as a median over several fresh pages (via this)
  // because a single cold sample varies ±40% with ambient system load.
  (globalThis as { __cold?: unknown }).__cold = (implId: string): number => {
    const impl = find(implId);
    const t0 = performance.now();
    impl.getTimeZonesAt(Date.UTC(2026, 6, 15));
    return performance.now() - t0;
  };

  (globalThis as { __bench?: unknown }).__bench = (implId: string): BenchResult => {
    const impl = find(implId);

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

  (globalThis as { __validate?: unknown }).__validate = (implId: string): ValidateResult => {
    const impl = find(implId);

    let fixturesPassed = 0;
    const fixtureFailures: string[] = [];

    for (const f of fixtures) {
      const info = impl.getTimeZonesAt(f.ts).find((z) => z.name === f.zone || z.name === f.altZone);

      if (info !== undefined && info.abbr === f.abbr && info.offset === f.offset) {
        fixturesPassed++;
      } else if (fixtureFailures.length < 10) {
        fixtureFailures.push(
          `${f.zone} (${f.desc}): expected ${f.abbr} ${f.offset}, got ${info === undefined ? 'missing' : `${info.abbr} ${info.offset}`}`
        );
      }
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
      fixtureFailures,
      letterAbbrs,
      init: initInfoFor(implId),
    };
  };

  // deep output-equality against the live-Intl baseline at monthly +
  // transition-edge instants
  (globalThis as { __verifyVs04?: unknown }).__verifyVs04 = (implId: string): Vs04 => {
    const other = find(implId);

    const instants: number[] = [];

    for (let m = 0; m < 12; m++) instants.push(Date.UTC(2026, m, 15, 12));

    for (const t of [Date.UTC(2026, 2, 8, 7), Date.UTC(2026, 2, 29, 1), Date.UTC(2026, 9, 25, 1), Date.UTC(2026, 10, 1, 6)]) {
      instants.push(t - 60_000, t + 60_000);
    }

    let checked = 0;
    let mismatchCount = 0;
    const mismatches: string[] = [];

    for (const ts of instants) {
      const a = baseline.getTimeZonesAt(ts);
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
}
