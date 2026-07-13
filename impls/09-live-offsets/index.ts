// Attempt 9 ("07 with live offsets"): abbreviations come BAKED from the
// generated schedule table (segment-resolved by date, like 07; zone-level
// overrides are already baked in at generation), but offsets come LIVE from
// Temporal at call time — so this impl can never report a wrong time in any
// Temporal-capable browser, regardless of which runtime generated the table
// or how stale it is. Zero Intl formatters on the fast path: cold start is
// one Temporal sweep (~4ms). The table's baked offsets (scheduleOffsets) are
// deliberately NOT imported, so they don't ship in this impl's bundle.
//
// Cross-runtime portability:
// - zone-name canonicalization skew (Chrome's Asia/Calcutta vs bun's
//   Asia/Kolkata) is bridged by shared/zoneLinks.ts, so a table generated in
//   one runtime serves the other's zone list;
// - zones with no table entry even after bridging (genuinely new zones,
//   Etc/* on browsers that omit them from tables) fall back to live Intl
//   formatting (shared/live.ts) — correct, just not free;
// - without Temporal (Safari, bun, node 26) EVERYTHING falls back to live
//   Intl: identical behavior and cost to impl 04.
//
// Residual risk: under tzdata skew the live offset updates but the baked
// label doesn't, producing coherent-offset/stale-label pairs (e.g. correct
// "-06:00" labeled "MST" for post-2026c Edmonton until regeneration).

import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { scheduleClasses, YEAR_START, STEP_MS, type ScheduleClass } from '../../shared/schedule.ts';
import { zoneLinks, makeInfo } from '../../shared/zoneLinks.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';
import { liveZoneInfo } from '../../shared/live.ts';

const hasTemporal = typeof Temporal !== 'undefined';

// zone -> schedule class, bridging spelling variants
const classOf = new Map<string, ScheduleClass>();

for (const c of scheduleClasses) {
  for (const z of c.zones) classOf.set(z, c);
}

// resolved per runtime zone: its schedule class (possibly via link) or null
const tableClass = zones.map((z) => classOf.get(z) ?? classOf.get(zoneLinks.get(z) ?? '') ?? null);

function compute(timestamp: number): TimeZoneInfo[] {
  const date = new Date(timestamp);
  const instant = hasTemporal ? Temporal!.Instant.fromEpochMilliseconds(timestamp) : null;
  const step = Math.max(0, Math.floor((timestamp - YEAR_START) / STEP_MS));
  const out: TimeZoneInfo[] = [];

  for (let z = 0; z < zones.length; z++) {
    const name = zones[z]!;
    const c = tableClass[z]!;

    if (instant === null || c === null) {
      out.push(liveZoneInfo(name, timestamp, date));
      continue;
    }

    let i = c.starts.length - 1;

    while (i > 0 && c.starts[i]! > step) i--;

    out.push(makeInfo(name, c.abbrs[i]!, instant.toZonedDateTimeISO(name).offset));
  }

  return out;
}

const memo = hourBucketMemo(compute);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;
