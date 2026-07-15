// Comparison impl: leeoniya-timezones@2cd74a8 (github:leeoniya/timezones,
// package name "timezones", installed under an alias) — at generation time
// it compiles pinned IANA tzdb source (2026c) with zic and samples it into a
// compact offset->abbreviation lookup; at runtime, Intl shortOffset
// formatters (one per multi-offset abbreviation group; single-offset zones
// skip Intl entirely) resolve each zone's offset at the requested instant.
// Same hybrid shape as our generated-table impls, but with tzdata-style
// abbreviations (EET/EEST, numeric "+03") instead of CLDR-derived ones.
//
// Its getTimeZonesAt() returns ITS OWN 438-zone list (tzdb canonical zones
// plus runtime-enumerated aliases, which carry aliasOf metadata like our
// impls) and has its own internal hour-bucket cache. It intentionally omits
// fixed-offset Etc/GMT+-N and legacy ids (see the package's
// omitted-zones.md). The harness compares outputs index-by-index against the
// runtime zone list, so this wrapper projects the library's output onto
// `zones`; entries the library doesn't emit — the omitted Etc/* zones, plus
// anything newer than the pinned tzdb — get the same '?' sentinel as
// timezone-support's unknowns.
//
// The hourBucketMemo below is NOT redundant with the library's internal hour
// cache: that cache covers the library's own list, while the memo covers
// this wrapper's projection (~33µs/call unmemoized vs ~0.3µs hit). It also
// keeps measurement parity — all lib wrappers memoize identically, so the
// hit benchmark measures the same path for every row. Both layers quantize
// by the same UTC-hour bucket, so they always agree on boundaries.

import { getTimeZonesAt as libGetTimeZonesAt } from 'leeoniya-timezones';
import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';

function compute(timestamp: number): TimeZoneInfo[] {
  const byName = new Map<string, TimeZoneInfo>();

  for (const z of libGetTimeZonesAt(timestamp)) {
    byName.set(z.name, z);
  }

  return zones.map((name) => byName.get(name) ?? { name, abbr: '?', offset: '+00:00' });
}

const memo = hourBucketMemo(compute);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;
