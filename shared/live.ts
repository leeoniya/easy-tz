// Shared live-Intl resolution path, used by impl 04 for everything and by
// impl 08 for self-formatting zones: one cached full-fields formatter per zone,
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
import { fmtCache, initialsAbbr, compactGmt, readZoneSample, WALL_CLOCK_FIELDS, type ZoneSample } from './fmt.ts';

// seconds on top of the shared fields: this path serves arbitrary timestamps,
// where the zone-local seconds have to be carried through the offset subtraction
const partsFmt = fmtCache({ ...WALL_CLOCK_FIELDS, second: 'numeric' });

const abbrCache = new Map<string, string>();

function resolveAbbr(longName: string): string {
  let abbr = abbrCache.get(longName);

  if (abbr == null) {
    abbr = abbrOverrides[longName] ?? initialsAbbr(longName) ?? compactGmt(longName);
    abbrCache.set(longName, abbr);
  }

  return abbr;
}

// reused across calls; readZoneSample fills it and we read it out immediately,
// so nothing can observe it between the two
const sample: ZoneSample = { longName: '', offMin: 0 };

// Validate a caller-supplied zone without formatting a timestamp. Keeping this
// separate lets the public single-zone APIs return undefined for unknown names
// while preserving Intl's errors for invalid timestamps.
export function liveZoneExists(name: string): boolean {
  try {
    partsFmt(zoneAliases[name] ?? name);
    return true;
  } catch (err) {
    if (err instanceof RangeError) return false;
    throw err;
  }
}

// parses `fmtZone`'s live Intl output at an instant: resolved abbr + offset in
// signed minutes. callers sharing one fmtZone across grouped zones (impl 08)
// memoize this result per call and apply per-zone overrides themselves.
// formatToParts accepts the epoch-ms directly, so no Date is allocated.
export function liveParts(fmtZone: string, timestamp: number): { abbr: string; offset: number } {
  readZoneSample(partsFmt(fmtZone), timestamp, sample);

  return { abbr: resolveAbbr(sample.longName), offset: sample.offMin };
}

// full live resolution for one zone, applying the curated metazone alias
// (e.g. Guernsey -> London) and zone-level abbr overrides (Istanbul -> TRT)
export function liveZoneInfo(name: string, timestamp: number): TimeZoneInfo {
  const r = liveParts(zoneAliases[name] ?? name, timestamp);

  return makeInfo(name, zoneAbbrOverrides[name] ?? r.abbr, r.offset);
}
