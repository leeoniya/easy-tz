// Comparison impl: moment-timezone@0.6.2 — bundles its own tzdata, so real
// abbreviations (EET/EEST) come built-in with no help from this repo's
// strategies (no curated maps, no generated tables, no Intl). Wrapped in the
// same hour-bucket memo as our impls for measurement parity; iterates the
// same runtime zone list so outputs are comparable.

import moment from 'moment-timezone';
import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';

function compute(timestamp: number): TimeZoneInfo[] {
  const out: TimeZoneInfo[] = [];

  for (const name of zones) {
    const m = moment.tz(timestamp, name);

    out.push({ name, abbr: m.zoneAbbr(), offset: m.utcOffset() });
  }

  return out;
}

const memo = hourBucketMemo(compute);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;
