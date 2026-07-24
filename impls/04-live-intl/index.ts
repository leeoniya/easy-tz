// Attempt 4: no generated data; everything from live Intl, so it works in
// any runtime and self-heals across ICU/CLDR/tzdata differences. One cached
// formatter and ONE formatToParts() call per zone: the offset is computed
// arithmetically from the zone-local wall-clock fields instead of a second
// 'longOffset' formatter (see shared/live.ts). The full response is memoized
// per UTC hour bucket (see shared/hourCache.ts).
//
// Note: a Temporal-based variant (name-only formatters + offsets from
// Temporal.Instant#toZonedDateTimeISO) was evaluated in Chrome 150 and
// REVERTED: name-only formatters look ~30% cheaper to construct, but ICU
// compiles patterns lazily on first format(), so total cold cost converges
// (~60ms both paths for 418 zones) and warm misses were within noise.

import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';
import { liveZoneInfo } from '../../shared/live.ts';

function compute(timestamp: number): TimeZoneInfo[] {
  const out: TimeZoneInfo[] = [];

  for (const name of zones) {
    out.push(liveZoneInfo(name, timestamp));
  }

  return out;
}

const memo = hourBucketMemo(compute);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;
export { formatOffset } from '../../shared/offsetFormat.ts';

// single-zone resolver (single-zone / many-timestamps use case): the same
// per-zone live-Intl leaf getTimeZonesAt() loops, resolved directly for `name`.
export function getTimeZoneAt(name: string, timestamp: number): TimeZoneInfo {
  return liveZoneInfo(name, timestamp);
}
