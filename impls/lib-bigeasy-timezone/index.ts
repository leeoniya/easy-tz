// Comparison impl: timezone@1.0.23 (bigeasy) — real abbreviations (EET/EEST)
// from bundled tzdata via strftime-style %Z, with per-region data modules
// (we load the full set for parity). No help from this repo's strategies.
// Wrapped in the same hour-bucket memo as our impls; iterates the same
// runtime zone list.
//
// Caveats surfaced by probing: the package's data vintage is 2019 —
// pre-Kyiv-spelling zones and every rule change since are missing — and it
// silently returns "UTC" for zone names it doesn't know.

import timezone from 'timezone';
import zonesData from 'timezone/zones';
import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';

const tz = timezone(zonesData);

// "+0530" -> "+05:30"
const withColon = (o: string) => `${o.slice(0, 3)}:${o.slice(3)}`;

function compute(timestamp: number): TimeZoneInfo[] {
  const out: TimeZoneInfo[] = [];

  for (const name of zones) {
    out.push({
      name,
      abbr: tz(timestamp, '%Z', name),
      offset: withColon(tz(timestamp, '%z', name)),
    });
  }

  return out;
}

const memo = hourBucketMemo(compute);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;
