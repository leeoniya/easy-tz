// Comparison impl: timezonecomplete@5.15.1 — real abbreviations (EET/EEST)
// come from the separately-shipped `tzdata` package (a timezonecomplete
// dependency), which per its README must be loaded EXPLICITLY for browser
// use (node resolves it via a dynamic require that bundlers can't). No help
// from this repo's strategies. Wrapped in the same hour-bucket memo as our
// impls for measurement parity; iterates the same runtime zone list.

import * as tc from 'timezonecomplete';
import tzdata from 'tzdata';

tc.TzDatabase.init(tzdata);
import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { formatOffsetMinutes } from '../../shared/fmt.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';

const zoneCache = new Map<string, tc.TimeZone>();

function zone(name: string): tc.TimeZone {
  let z = zoneCache.get(name);

  if (z === undefined) {
    z = tc.zone(name);
    zoneCache.set(name, z);
  }

  return z;
}

function compute(timestamp: number): TimeZoneInfo[] {
  const out: TimeZoneInfo[] = [];

  for (const name of zones) {
    const dt = new tc.DateTime(timestamp, tc.utc()).toZone(zone(name));

    out.push({ name, abbr: dt.format('zzz'), offset: formatOffsetMinutes(dt.offset()) });
  }

  return out;
}

const memo = hourBucketMemo(compute);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;
