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
import { liveListApi } from '../../shared/listApi.ts';
import { liveZoneExists, liveZoneInfo } from '../../shared/live.ts';
import { canonicalZone } from '../../shared/zoneLinks.ts';

function compute(timestamp: number): TimeZoneInfo[] {
  const out: TimeZoneInfo[] = [];

  for (const name of zones) {
    out.push(liveZoneInfo(name, timestamp));
  }

  return out;
}

const { getTimeZonesAt, clearCache } = liveListApi(compute);

export { getTimeZonesAt, clearCache };

// current-instant convenience; 04 is fully live so there's nothing to shed —
// it shares the same hour-bucket memo as getTimeZonesAt
export const getTimeZones = (withAliases = true): TimeZoneInfo[] => getTimeZonesAt(Date.now(), withAliases);

export { formatOffset } from '../../shared/offsetFormat.ts';

// single-zone resolver (single-zone / many-timestamps use case): the same
// per-zone live-Intl leaf getTimeZonesAt() loops, resolved directly for `name`.
// Intl rejects unknown names with a RangeError; expose that as undefined while
// leaving timestamp validation to the normal formatter path.
export function getTimeZoneAt(name: string, timestamp: number, withAliases = true): TimeZoneInfo | undefined {
  const zone = withAliases ? name : canonicalZone(name);

  return liveZoneExists(zone) ? liveZoneInfo(zone, timestamp) : undefined;
}

// single zone at the current instant. 04 is fully live, so — like getTimeZones()
// vs getTimeZonesAt() — there's no history path to shed: this is exactly
// getTimeZoneAt(name, Date.now()).
export function getTimeZone(name: string, withAliases = true): TimeZoneInfo | undefined {
  return getTimeZoneAt(name, Date.now(), withAliases);
}
