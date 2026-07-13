// Single-slot memoization of a full getTimeZonesAt() response, keyed by UTC
// hour bucket (Math.floor(ts / 1h)) — offsets and abbreviations only change
// at DST transitions, which are hour-aligned in UTC for nearly all zones.
//
// - `compute` is always invoked at the bucket START, so results are
//   deterministic regardless of which timestamp within the hour is seen
//   first. DST-transition instants land exactly on bucket boundaries, so
//   before/after queries still resolve correctly (see tests/dst fixtures).
// - single-slot means only same-bucket repeats hit; alternating between two
//   buckets recomputes every call. ideal for the expected workload of
//   clock-driven queries near "now".
// - a few zones transition on a half-hour UTC boundary (e.g. Lord Howe,
//   UTC+10:30); for those, results within the single transition hour can be
//   stale by up to an hour. acceptable per project scope.
// - the returned array is shared across calls in the same bucket: treat it
//   as immutable. copying would forfeit most of the cache-hit win.

import type { GetTimeZonesAt, TimeZoneInfo } from './types.ts';

const HOUR_MS = 3_600_000;

export interface HourBucketMemo {
  get: GetTimeZonesAt;
  clear: () => void;
}

export function hourBucketMemo(compute: GetTimeZonesAt): HourBucketMemo {
  let lastBucket = NaN; // NaN never equals anything, so the first call misses
  let lastResult: TimeZoneInfo[] = [];

  return {
    get(timestamp) {
      const bucket = Math.floor(timestamp / HOUR_MS);

      if (bucket !== lastBucket) {
        lastResult = compute(bucket * HOUR_MS);
        lastBucket = bucket;
      }

      return lastResult;
    },
    clear() {
      lastBucket = NaN;
      lastResult = [];
    },
  };
}
