// Shared live-Intl resolution path, used by impl 04 for everything and by
// impls 08/09 as their fallback: one cached full-fields formatter per zone,
// one formatToParts() call, offset derived arithmetically from the
// zone-local wall-clock fields, abbr resolved from the CLDR long name
// (curated overrides -> initials -> compact GMT).
//
// The formatter and memo caches are module-level and shared across impls;
// that's safe (formatters are immutable and keyed by zone) and mirrors what
// a real bundle would do.

import type { TimeZoneInfo } from './types.ts';
import { abbrOverrides, zoneAliases, zoneAbbrOverrides } from './abbrs.ts';
import { makeInfo } from './zoneLinks.ts';
import { fmtCache, formatOffsetMinutes, initialsAbbr, compactGmt } from './fmt.ts';

const partsFmt = fmtCache({
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
  timeZoneName: 'long',
});

const abbrCache = new Map<string, string>();

function resolveAbbr(longName: string): string {
  let abbr = abbrCache.get(longName);

  if (abbr === undefined) {
    abbr = abbrOverrides[longName] ?? initialsAbbr(longName) ?? compactGmt(longName);
    abbrCache.set(longName, abbr);
  }

  return abbr;
}

// offsets are memoized per offset-minutes value; the set of distinct offsets
// per instant is small (<40), so formatting repeats are avoided
const offsetStrCache = new Map<number, string>();

// parses `fmtZone`'s live Intl output at an instant: resolved abbr + offset.
// callers sharing one fmtZone across grouped zones (impl 08) memoize this
// result per call and apply per-zone overrides themselves.
export function liveParts(fmtZone: string, timestamp: number, date: Date): { abbr: string; offset: string } {
  const parts = partsFmt(fmtZone).formatToParts(date);

  let year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
  let longName = '';

  for (const p of parts) {
    switch (p.type) {
      case 'year': year = +p.value; break;
      case 'month': month = +p.value; break;
      case 'day': day = +p.value; break;
      case 'hour': hour = +p.value; break;
      case 'minute': minute = +p.value; break;
      case 'second': second = +p.value; break;
      case 'timeZoneName': longName = p.value; break;
    }
  }

  const asUTC = Date.UTC(year, month - 1, day, hour, minute, second);
  // round to whole minutes; sub-second remainder of `timestamp` cancels out
  const offsetMin = Math.round((asUTC - timestamp) / 60_000);

  let offset = offsetStrCache.get(offsetMin);

  if (offset === undefined) {
    offset = formatOffsetMinutes(offsetMin);
    offsetStrCache.set(offsetMin, offset);
  }

  return { abbr: resolveAbbr(longName), offset };
}

// full live resolution for one zone, applying the curated metazone alias
// (e.g. Guernsey -> London) and zone-level abbr overrides (Istanbul -> TRT)
export function liveZoneInfo(name: string, timestamp: number, date: Date): TimeZoneInfo {
  const r = liveParts(zoneAliases[name] ?? name, timestamp, date);

  return makeInfo(name, zoneAbbrOverrides[name] ?? r.abbr, r.offset);
}
