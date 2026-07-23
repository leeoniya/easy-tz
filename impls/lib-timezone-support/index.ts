// Comparison impl: timezone-support@3.1.0 — bundles packed tzdata, so real
// abbreviations (EET/EEST) come built-in with no help from this repo's
// strategies. Wrapped in the same hour-bucket memo as our impls for
// measurement parity; iterates the same runtime zone list.
//
// Note: zone.offset uses the inverted JS getTimezoneOffset convention
// (minutes WEST of UTC), hence the negation. Zones newer than the library's
// bundled tzdata (2022 vintage: e.g. America/Ciudad_Juarez) are unknown to
// it and reported with a '?' sentinel — an honest datapoint for the
// bundled-data staleness trade-off.

import { findTimeZone, getZonedTime } from 'timezone-support';
import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { formatOffsetMinutes } from '../../shared/fmt.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';

const tzCache = new Map<string, ReturnType<typeof findTimeZone> | null>();

function tz(name: string) {
  let t = tzCache.get(name);

  // strict `=== undefined` on purpose: null is a valid cached result (zone
  // unknown to the bundled tzdata), distinct from undefined (not yet looked up)
  if (t === undefined) {
    try {
      t = findTimeZone(name);
    } catch {
      t = null; // zone unknown to the library's bundled tzdata
    }

    tzCache.set(name, t);
  }

  return t;
}

function compute(timestamp: number): TimeZoneInfo[] {
  const date = new Date(timestamp);
  const out: TimeZoneInfo[] = [];

  for (const name of zones) {
    const t = tz(name);

    if (t === null) {
      out.push({ name, abbr: '?', offset: '+00:00' });
      continue;
    }

    const zone = getZonedTime(date, t).zone!;

    out.push({ name, abbr: zone.abbreviation!, offset: formatOffsetMinutes(-zone.offset!) });
  }

  return out;
}

const memo = hourBucketMemo(compute);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;
