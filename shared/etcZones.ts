// The fixed-offset zone ids (Etc/GMT±N, UTC, Etc/UTC) that ICU accepts as
// Intl timeZone inputs but does NOT enumerate: Chrome's
// Intl.supportedValuesOf('timeZone') omits all 28 of them (bun/ICU 75 lists
// them), so on Chrome they're absent from shared/zones.ts AND from the
// generated tables. Without this the baked single-zone resolvers answer the
// unknown-zone UTC sentinel for them — a silently WRONG offset for the 26
// non-zero ones (Etc/GMT+5 would report 0 instead of -300).
//
// They need no table. POSIX fixes each offset by name, with the sign INVERTED
// (Etc/GMT+5 is UTC-05:00, Etc/GMT-14 is UTC+14:00), and none has ever
// observed DST or changed offset, so the derived values are exact at every
// instant — past, present or projected. The labels match what live Intl yields
// for the same ids on both Chrome (CLDR 48) and bun (ICU 75).

import type { TimeZoneInfo } from './types.ts';
import { gmtLabel } from './fmt.ts';
import { makeInfo } from './zoneLinks.ts';

// tzdata defines Etc/GMT+1..+12 and Etc/GMT-1..-14; the asymmetry is real (the
// eastern side reaches the +14 of Pacific/Kiritimati). Enumerating them into a
// map, rather than parsing the digits per call, keeps a repeated lookup of the
// same id — getTimeZoneAt()'s one-zone/many-timestamps case — to a single map
// get, and makes the accepted set self-evidently exactly the ids tzdata
// defines: no range checks, and near-misses like Etc/GMT+13, Etc/GMT+05 or
// Etc/GMT+0 simply aren't in it.
function buildFixedZones(): Map<string, TimeZoneInfo> {
  const out = new Map<string, TimeZoneInfo>([
    ['UTC', makeInfo('UTC', 'UTC', 0)],
    ['Etc/UTC', makeInfo('Etc/UTC', 'UTC', 0)],
  ]);

  const add = (name: string, offset: number) => out.set(name, makeInfo(name, gmtLabel(offset), offset));

  for (let h = 1; h <= 14; h++) {
    if (h <= 12) add(`Etc/GMT+${h}`, -h * 60);

    add(`Etc/GMT-${h}`, h * 60);
  }

  return out;
}

// built on first use, not at module load: the objects and their intern-pool
// entries are wasted on the vast majority of consumers, who never name one
let fixedZones: Map<string, TimeZoneInfo> | null = null;

// Resolves a fixed-offset zone id, or null if `name` isn't one — in which case
// the caller keeps whatever unknown-zone behavior it had. The zero-offset
// spellings beyond UTC/Etc/UTC (Etc/GMT, Etc/GMT+0, Etc/Zulu, …) are left out
// on purpose: Chrome and bun label those differently ("UTC" vs "GMT"), and the
// UTC sentinel already gives them the right offset.
export function etcZoneInfo(name: string): TimeZoneInfo | null {
  // cheap reject so an ordinary unknown name never builds the map
  if (name !== 'UTC' && !name.startsWith('Etc/')) return null;

  return (fixedZones ??= buildFixedZones()).get(name) ?? null;
}
