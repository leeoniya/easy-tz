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
import { canonicalZone, canonicalView, type CanonicalView } from '../../shared/zoneLinks.ts';

function compute(timestamp: number): TimeZoneInfo[] {
  const out: TimeZoneInfo[] = [];

  for (const name of zones) {
    out.push(liveZoneInfo(name, timestamp));
  }

  return out;
}

const memo = hourBucketMemo(compute);

// alias-free view of the memo's output, built on first opt-out. One instance
// serves both list getters here, since they share the one memo.
let canon: CanonicalView | null = null;

export function getTimeZonesAt(timestamp: number, withAliases?: boolean): TimeZoneInfo[] {
  const full = memo.get(timestamp);

  return withAliases === false ? (canon ??= canonicalView())(full) : full;
}

// current-instant convenience; 04 is fully live so there's nothing to shed —
// it shares the same hour-bucket memo as getTimeZonesAt
export const getTimeZones = (withAliases?: boolean): TimeZoneInfo[] => getTimeZonesAt(Date.now(), withAliases);

export function clearCache(): void {
  memo.clear();
  canon = null;
}

export { formatOffset } from '../../shared/offsetFormat.ts';

// single-zone resolver (single-zone / many-timestamps use case): the same
// per-zone live-Intl leaf getTimeZonesAt() loops, resolved directly for `name`.
export function getTimeZoneAt(name: string, timestamp: number, withAliases?: boolean): TimeZoneInfo {
  return liveZoneInfo(withAliases === false ? canonicalZone(name) : name, timestamp);
}

// single zone at the current instant. 04 is fully live, so — like getTimeZones()
// vs getTimeZonesAt() — there's no history path to shed: this is exactly
// getTimeZoneAt(name, Date.now()).
export function getTimeZone(name: string, withAliases?: boolean): TimeZoneInfo {
  return getTimeZoneAt(name, Date.now(), withAliases);
}
