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
import { zoneLinkPairs } from '../shared/zoneLinks.ts';
import { installIntlCounter, intlConstructCount } from '../shared/intl-count.ts';
import { formatOffset } from '../shared/fmt.ts';
import { GETONE_ZONE, GETONE_CALLS, GETONE_STEP_MS, GETONE_CUR_BASE, GETONE_HIST_BASE } from './bench-config.ts';

const MISS_ITERATIONS = 25;
const HIT_CALLS = 50_000;
const HOUR_MS = 3_600_000;
const BASE_TS = Date.UTC(2026, 5, 1, 12, 0);
// historical anchor (pre-2007 US / EU-stable / single-year DST): a miss here
// routes the rule-baking impls (07, 10) through the historical era resolver
// (shared/history.ts) rather than the year-independent schedule, so the baked
// history's runtime cost is measured. On a Temporal runtime impl 10 resolves
// the past live via Temporal, so its hist column reflects that path.
const HIST_TS = Date.UTC(2000, 5, 1, 12, 0);

export interface BenchResult {
  id: string;
  zones: number;
  coldMs: number;
  hitUs: number;
  missMedMs: number; // median over the miss loop (current year)
  histMedMs: number; // median over the miss loop anchored in a historical year
  // Intl.DateTimeFormat constructions, counted via a global constructor
  // proxy so library-internal formatters are measured too. Each impl is
  // benched in a fresh page, so the count attributes to that impl alone.
  formatters: number;
}

export interface BenchOneResult {
  id: string;
  supported: boolean; // false for impls without a getTimeZoneAt() (the libs)
  calls: number;
  curMs: number; // total ms to resolve `calls` present-era timestamps
  histMs: number; // same, anchored in a historical year
  formatters: number; // Intl.DateTimeFormat constructions during the sweeps
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
  initInfoFor: (id: string) => unknown = () => null
): void {
  // must precede the first getTimeZonesAt() call; formatter construction is
  // lazy in all impls/libs, so kernel-install time is early enough
  installIntlCounter();

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

    // brief untimed warm-up (JIT + memo paths) for both the current-year
    // schedule path and the historical era path
    for (let i = 0; i < 5; i++) impl.getTimeZonesAt(BASE_TS - (i + 1) * HOUR_MS);
    for (let i = 0; i < 5; i++) impl.getTimeZonesAt(HIST_TS - (i + 1) * HOUR_MS);

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

    // historical misses: same loop anchored in a pre-bake-year year, so the
    // rule-baking impls run the era resolver instead of the schedule
    const histTimes: number[] = [];

    for (let i = 0; i < MISS_ITERATIONS; i++) {
      const m0 = performance.now();
      impl.getTimeZonesAt(HIST_TS + (i + 1) * HOUR_MS);
      histTimes.push(performance.now() - m0);
    }

    const med = (xs: number[]) => xs.toSorted((a, b) => a - b)[xs.length >> 1]!;

    return {
      id: implId,
      zones: zones.length,
      coldMs,
      hitUs,
      missMedMs: med(missTimes),
      histMedMs: med(histTimes),
      formatters: intlConstructCount(),
    };
  };

  // single-zone getTimeZoneAt() sweep: one DST zone resolved at GETONE_CALLS
  // timestamps in the present, then in a historical year. Run in its own fresh
  // page (see bench-chrome.ts) so the formatter count reflects only this
  // workload — one formatter for 04/08, none for the baked impls. Impls without
  // a getTimeZoneAt() (the comparison libraries) report supported: false.
  (globalThis as { __benchOne?: unknown }).__benchOne = (implId: string): BenchOneResult => {
    const one = find(implId).getTimeZoneAt;

    if (one == null) return { id: implId, supported: false, calls: 0, curMs: 0, histMs: 0, formatters: 0 };

    // untimed warm-up (JIT + intern pool for both DST states, both eras)
    let sink = 0;

    for (let i = 0; i < 500; i++) {
      sink += Math.abs(one(GETONE_ZONE, GETONE_CUR_BASE + i * GETONE_STEP_MS).offset);
      sink += Math.abs(one(GETONE_ZONE, GETONE_HIST_BASE + i * GETONE_STEP_MS).offset);
    }

    let t0 = performance.now();
    for (let i = 0; i < GETONE_CALLS; i++) sink += Math.abs(one(GETONE_ZONE, GETONE_CUR_BASE + i * GETONE_STEP_MS).offset);
    const curMs = performance.now() - t0;

    t0 = performance.now();
    for (let i = 0; i < GETONE_CALLS; i++) sink += Math.abs(one(GETONE_ZONE, GETONE_HIST_BASE + i * GETONE_STEP_MS).offset);
    const histMs = performance.now() - t0;

    if (sink < 0) throw new Error('unreachable'); // keep the loops from being optimized away

    return { id: implId, supported: true, calls: GETONE_CALLS, curMs, histMs, formatters: intlConstructCount() };
  };

  (globalThis as { __validate?: unknown }).__validate = (implId: string): ValidateResult => {
    const impl = find(implId);

    let fixturesPassed = 0;
    const fixtureFailures: string[] = [];

    for (const f of fixtures) {
      const info = impl.getTimeZonesAt(f.ts).find((z) => z.name === f.zone || z.name === f.altZone);

      if (info != null && info.abbr === f.abbr && formatOffset(info.offset) === f.offset) {
        fixturesPassed++;
      } else if (fixtureFailures.length < 10) {
        fixtureFailures.push(
          `${f.zone} (${f.desc}): expected ${f.abbr} ${f.offset}, got ${info == null ? 'missing' : `${info.abbr} ${formatOffset(info.offset)}`}`
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

  // runtime-level (impl-independent): both spellings of every link pair
  // must be constructible Intl time zones in this runtime, regardless of
  // which side its ICU enumerates — the list augmentation in
  // shared/zones.ts depends on this (invalid ids throw RangeError)
  (globalThis as { __verifyIntlZoneNames?: unknown }).__verifyIntlZoneNames = (): { checked: number; failures: string[] } => {
    const failures: string[] = [];
    let checked = 0;

    for (const name of zoneLinkPairs.flat()) {
      checked++;

      try {
        // constructing (even without `new`) validates the zone id — throws RangeError if unknown
        Intl.DateTimeFormat('en', { timeZone: name });
      } catch {
        failures.push(name);
      }
    }

    return { checked, failures };
  };

  // every tzdata link pair spelling must resolve to identical values: both
  // names are the same underlying zone, whether served directly from the
  // table or back-referenced through the zoneLinks bridge. Winter + summer
  // instants so rule-scheduled pairs are checked in both DST states.
  (globalThis as { __verifyAliasPairs?: unknown }).__verifyAliasPairs = (implId: string): Vs04 => {
    const impl = find(implId);

    let checked = 0;
    let mismatchCount = 0;
    const mismatches: string[] = [];

    for (const ts of [Date.UTC(2026, 0, 15, 12), Date.UTC(2026, 6, 15, 12)]) {
      const byName = new Map(impl.getTimeZonesAt(ts).map((z) => [z.name, z]));

      for (const [canonical, alias] of zoneLinkPairs) {
        checked++;

        const c = byName.get(canonical);
        const a = byName.get(alias);

        if (c == null || a == null || a.abbr !== c.abbr || a.offset !== c.offset) {
          mismatchCount++;

          if (mismatches.length < 10) {
            const show = (z: typeof c) => (z == null ? 'missing' : `${z.abbr} ${z.offset}`);
            mismatches.push(`${alias} @ ${new Date(ts).toISOString()}: ${show(a)} vs ${canonical}=${show(c)}`);
          }
        }
      }
    }

    return { checked, mismatchCount, mismatches };
  };

  // the fixed-offset ids (Etc/GMT±N, UTC, Etc/UTC) that Chrome's ICU accepts
  // but doesn't enumerate, so they reach neither the zone list nor the tables.
  // The baked impls derive them (shared/etcZones.ts); here they're checked
  // against live Intl, which CAN format them — this is the runtime the
  // derivation exists for, and the one the bun tests can't stand in for.
  (globalThis as { __verifyFixedOffsets?: unknown }).__verifyFixedOffsets = (implId: string): Vs04 => {
    const impl = find(implId);
    const one = impl.getTimeZoneAt;
    const baseOne = baseline.getTimeZoneAt;

    let checked = 0;
    let mismatchCount = 0;
    const mismatches: string[] = [];

    if (one == null || baseOne == null) return { checked, mismatchCount, mismatches };

    const names = ['UTC', 'Etc/UTC'];

    for (let n = 1; n <= 12; n++) names.push(`Etc/GMT+${n}`);
    for (let n = 1; n <= 14; n++) names.push(`Etc/GMT-${n}`);

    // present and a pre-bake-year instant: these ids are fixed for all time,
    // so the historical route must answer identically
    for (const ts of [Date.UTC(2026, 6, 15, 12), Date.UTC(1998, 5, 15, 12)]) {
      for (const name of names) {
        checked++;

        const x = baseOne(name, ts);
        const y = one(name, ts);

        if (x.abbr !== y.abbr || x.offset !== y.offset) {
          mismatchCount++;

          if (mismatches.length < 10) {
            mismatches.push(`${name} @ ${new Date(ts).toISOString()}: 04=${x.abbr} ${x.offset} vs ${implId}=${y.abbr} ${y.offset}`);
          }
        } else if (one(name, ts) !== y || !Object.isFrozen(y)) {
          // interning: on Chrome these ids reach the derived fallback rather
          // than a table class, and must still be pooled like any other zone
          mismatchCount++;

          if (mismatches.length < 10) mismatches.push(`${name}: not interned/frozen`);
        }
      }
    }

    return { checked, mismatchCount, mismatches };
  };

  // the two current-instant APIs must agree zone for zone. Worth checking
  // HERE specifically: on a Temporal runtime impl 10 answers its
  // session-recovered zones live, and that branch is unreachable from the bun
  // tests (no Temporal), where both APIs collapse onto the baked schedule.
  (globalThis as { __verifyCurrentApis?: unknown }).__verifyCurrentApis = (implId: string): Vs04 => {
    const impl = find(implId);

    let checked = 0;
    let mismatchCount = 0;
    const mismatches: string[] = [];

    if (impl.getTimeZones != null && impl.getTimeZone != null) {
      const one = impl.getTimeZone;

      for (const z of impl.getTimeZones()) {
        checked++;

        const o = one(z.name);

        if (o.name !== z.name || o.abbr !== z.abbr || o.offset !== z.offset) {
          mismatchCount++;

          if (mismatches.length < 10) {
            mismatches.push(`${z.name}: getTimeZone()=${o.abbr} ${o.offset} vs getTimeZones()=${z.abbr} ${z.offset}`);
          }
        }
      }
    }

    return { checked, mismatchCount, mismatches };
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
