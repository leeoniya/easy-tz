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
import {
  GETONE_ZONE,
  GETONE_CALLS,
  GETONE_STEP_MS,
  GETONE_CUR_BASE,
  GETONE_HIST_BASE,
  MISS_SAMPLES,
  WARMUP_SAMPLES,
  SWEEP_PASSES,
  sampleTimes,
  median,
  steadyState,
} from './bench-config.ts';

// 200k rather than 50k because Chrome coarsens performance.now() to ~100µs: at
// single-digit ns/hit a 50k pass spans only ~4 ticks, quantizing the result to
// ±25%. 200k costs ~1.6ms per pass — nothing next to the sweeps — and buys 4x
// the resolution.
const HIT_CALLS = 200_000;
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
  missSamples: number; // samples the budget allowed (see MISS_SAMPLES)
  // Intl.DateTimeFormat constructions, counted via a global constructor
  // proxy so library-internal formatters are measured too. Each impl is
  // benched in a fresh page, so the count attributes to that impl alone.
  formatters: number;
}

export interface BenchOneResult {
  id: string;
  supported: boolean; // false for impls without a getTimeZoneAt() (the libs)
  calls: number;
  curMs: number; // fastest pass: ms to resolve `calls` present-era timestamps
  histMs: number; // same, anchored in a historical year
  curPasses: number; // passes taken before the budget ran out (see SWEEP_PASSES)
  histPasses: number;
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
    sampleTimes(() => performance.now(), (i) => impl.getTimeZonesAt(BASE_TS - (i + 1) * HOUR_MS), WARMUP_SAMPLES);
    sampleTimes(() => performance.now(), (i) => impl.getTimeZonesAt(HIST_TS - (i + 1) * HOUR_MS), WARMUP_SAMPLES);

    // hits: aggregate loop within one hour bucket. Same steady-state treatment
    // as the single-zone sweeps — one shared sweep function, fastest pass wins —
    // since a single pass reads 2-4x high on the ramp (08: 0.040 -> 0.010µs).
    impl.getTimeZonesAt(BASE_TS);

    // the result is summed rather than discarded: once the loop reaches its
    // optimized tier an unused return value invites the engine to elide the work
    let hitSink = 0;

    const hitSweep = (): number => {
      const h0 = performance.now();

      for (let i = 0; i < HIT_CALLS; i++) hitSink += impl.getTimeZonesAt(BASE_TS + (i % 1000)).length;

      return performance.now() - h0;
    };

    const hitUs = (steadyState(hitSweep, SWEEP_PASSES).ms / HIT_CALLS) * 1000;

    if (hitSink < 0) throw new Error('unreachable');

    // misses: individually timed, each iteration advances one hour bucket
    const missTimes = sampleTimes(
      () => performance.now(),
      (i) => impl.getTimeZonesAt(BASE_TS + (i + 1) * HOUR_MS),
      MISS_SAMPLES
    );

    // historical misses: same loop anchored in a pre-bake-year year, so the
    // rule-baking impls run the era resolver instead of the schedule
    const histTimes = sampleTimes(
      () => performance.now(),
      (i) => impl.getTimeZonesAt(HIST_TS + (i + 1) * HOUR_MS),
      MISS_SAMPLES
    );

    return {
      id: implId,
      zones: zones.length,
      coldMs,
      hitUs,
      missMedMs: median(missTimes),
      histMedMs: median(histTimes),
      missSamples: missTimes.length,
      formatters: intlConstructCount(),
    };
  };

  // single-zone getTimeZoneAt() sweep: one DST zone resolved at GETONE_CALLS
  // timestamps in the present, then in a historical year, each reported as the
  // fastest of several passes (see SWEEP_PASSES — a single pass measures the
  // JIT ramp more than the impl). Run in its own fresh
  // page (see bench-chrome.ts) so the formatter count reflects only this
  // workload — one formatter for 04/08, none for the baked impls. Impls without
  // a getTimeZoneAt() (the comparison libraries) report supported: false.
  (globalThis as { __benchOne?: unknown }).__benchOne = (implId: string): BenchOneResult => {
    const one = find(implId).getTimeZoneAt;

    if (one == null) {
      return { id: implId, supported: false, calls: 0, curMs: 0, histMs: 0, curPasses: 0, histPasses: 0, formatters: 0 };
    }

    let sink = 0;

    // ONE sweep function, so every pass shares its inner call site and therefore
    // its type-feedback slots — a sweep written inline per era would hand each
    // era an untrained slot and re-pay the ramp (see SWEEP_PASSES).
    const sweep = (base: number, calls: number): number => {
      const t0 = performance.now();

      for (let i = 0; i < calls; i++) sink += Math.abs(one(GETONE_ZONE, base + i * GETONE_STEP_MS).offset);

      return performance.now() - t0;
    };

    // short untimed priming for ONE-TIME work only — impl init (10's Temporal
    // audit) and the intern pool for both DST states. The JIT ramp is handled by
    // repeating the timed sweep, which no amount of priming here can substitute
    // for.
    sweep(GETONE_CUR_BASE, 100);
    sweep(GETONE_HIST_BASE, 100);

    const cur = steadyState(() => sweep(GETONE_CUR_BASE, GETONE_CALLS), SWEEP_PASSES);
    const hist = steadyState(() => sweep(GETONE_HIST_BASE, GETONE_CALLS), SWEEP_PASSES);

    if (sink < 0) throw new Error('unreachable'); // keep the loops from being optimized away

    return {
      id: implId,
      supported: true,
      calls: GETONE_CALLS,
      curMs: cur.ms,
      histMs: hist.ms,
      curPasses: cur.passes,
      histPasses: hist.passes,
      formatters: intlConstructCount(),
    };
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

  // the withAliases = false opt-out. Worth checking HERE specifically because
  // Chrome's ICU enumerates the LEGACY spelling for several link pairs
  // (Asia/Calcutta, not Asia/Kolkata), so filtering to canonical-only KEEPS
  // entries this runtime never listed — they're in the response only because
  // shared/zones.ts adds them and the bridge resolves them. This pins that
  // they carry the pair's real values rather than a UTC sentinel, and that the
  // single-zone substitution lands on that same interned instance.
  (globalThis as { __verifyCanonicalOnly?: unknown }).__verifyCanonicalOnly = (implId: string): Vs04 => {
    const impl = find(implId);

    let checked = 0;
    let mismatchCount = 0;
    const mismatches: string[] = [];

    const ts = Date.UTC(2026, 6, 15, 12);
    const full = impl.getTimeZonesAt(ts);
    const canon = impl.getTimeZonesAt(ts, false);
    const byName = new Map(canon.map((z) => [z.name, z]));

    checked++;

    const survivors = canon.filter((z) => z.aliasOf != null).length;

    if (canon.length !== full.length - zoneLinkPairs.length || survivors > 0) {
      mismatchCount++;
      mismatches.push(`list: kept ${canon.length} of ${full.length}, expected ${full.length - zoneLinkPairs.length}; ${survivors} aliasOf survivors`);
    }

    // filtered lists honor the same by-reference memo contract
    checked++;

    if (impl.getTimeZonesAt(ts, false) !== canon) {
      mismatchCount++;
      mismatches.push('list: filtered array not returned by reference');
    }

    const one = impl.getTimeZoneAt;

    for (const [canonical, alias] of zoneLinkPairs) {
      checked++;

      const kept = byName.get(canonical);
      const dropped = full.find((z) => z.name === alias);

      if (kept == null || dropped == null || kept.abbr !== dropped.abbr || kept.offset !== dropped.offset) {
        mismatchCount++;

        if (mismatches.length < 10) {
          const show = (z: typeof kept) => (z == null ? 'missing' : `${z.abbr} ${z.offset}`);
          mismatches.push(`${canonical}: ${show(kept)} vs dropped ${alias}=${show(dropped)}`);
        }

        continue;
      }

      if (one == null) continue;

      const sub = one(alias, ts, false);

      if (sub !== kept) {
        mismatchCount++;

        if (mismatches.length < 10) {
          mismatches.push(`${alias} -> ${canonical}: substitution is ${sub.name} ${sub.abbr} ${sub.offset}, not the list instance`);
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
