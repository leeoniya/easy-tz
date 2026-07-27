// The list half of every impl's public surface — getTimeZonesAt(), the
// getTimeZones() convenience over it, and clearCache() — in the two shapes the
// impls need. Each shape was duplicated verbatim across two impls before this;
// both encode the withAliases contract (the alias-free view is built on first
// opt-out and dropped by clearCache), and two copies of that can drift apart
// into a published-API bug without anything failing loudly.
//
// Costs ~65 bytes minified per impl over inlining, because the returned
// object's property names survive minification where top-level functions get
// mangled. Deliberate: the drift is worth more than the bytes.

import type { TimeZoneInfo } from './types.ts';
import { hourBucketMemo, type HourBucketMemo } from './hourCache.ts';
import { canonicalView, type CanonicalView } from './zoneLinks.ts';

type Compute = (timestamp: number) => TimeZoneInfo[];

export interface ListApi {
  getTimeZonesAt: (timestamp: number, withAliases?: boolean) => TimeZoneInfo[];
  clearCache: () => void;
}

// LIVE impls (04, 08): one memo, built eagerly. They have no history table to
// shed, so there is nothing to gain from deferring it.
export function liveListApi(compute: Compute): ListApi {
  const memo = hourBucketMemo(compute);

  // alias-free view of the memo's output, built on first opt-out. One instance
  // serves both list getters, since they share the one memo.
  let canon: CanonicalView | null = null;

  return {
    getTimeZonesAt(timestamp, withAliases = true) {
      const full = memo.get(timestamp);

      return withAliases ? full : (canon ??= canonicalView())(full);
    },
    clearCache() {
      memo.clear();
      canon = null;
    },
  };
}

// BAKED impls (07, 10): one of these per response shape — a history-backed one
// behind getTimeZonesAt() and a schedule-only one behind getTimeZones().
//
// Why this is a state box plus free functions rather than a second factory
// returning closures: `compute` is passed to listAt() at CALL time, so the
// history-backed compute stays referenced only from inside the body of
// getTimeZonesAt(). A consumer importing just the current-instant API shakes
// that function out, and the baked history eras (~16KB) go with it. Handing the
// computes to a factory at module scope would reference both eagerly and pin
// the history table into every bundle — see shared/bakedHistory.ts.
export interface LazyList {
  memo: HourBucketMemo | null;
  canon: CanonicalView | null;
}

export const lazyList = (): LazyList => ({ memo: null, canon: null });

export function listAt(state: LazyList, compute: Compute, timestamp: number, withAliases: boolean): TimeZoneInfo[] {
  const full = (state.memo ??= hourBucketMemo(compute)).get(timestamp);

  return withAliases ? full : (state.canon ??= canonicalView())(full);
}

export function clearList(state: LazyList): void {
  state.memo?.clear();
  state.canon = null;
}
