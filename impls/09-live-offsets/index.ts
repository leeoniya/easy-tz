// Attempt 9 ("07 with live offsets"): abbreviations come BAKED from the
// generated schedule (static states, year-independent nth-weekday rules,
// current-year irregular segments — see shared/rules.ts), but offsets come
// LIVE from Temporal at call time — so this impl can never report a wrong
// time in any Temporal-capable browser, regardless of table staleness. Zero
// Intl formatters on the fast path: cold start is one Temporal sweep (~4ms).
//
// LABEL/TIME COHERENCE GUARD: a baked label is only used when its state's
// baked offset matches the live offset. A mismatch means the table is stale
// for that zone at that instant (policy change, or an irregular zone past
// the generated year) — the zone falls back to live Intl formatting, trading
// speed for correctness per zone. With year-independent rules the guard
// fires only for genuine rule changes, not at year rollover. Residual: a
// stale label whose offset coincides with the live one (MDT vs CST, both
// -06:00) passes the guard — wrong-ish caption, never a contradicted time.
//
// Cross-runtime portability:
// - zone-name canonicalization skew (Chrome's Asia/Calcutta vs bun's
//   Asia/Kolkata) is bridged by shared/zoneLinks.ts;
// - zones with no table entry even after bridging fall back to live Intl;
// - without Temporal (Safari, bun, node 26) EVERYTHING falls back to live
//   Intl: identical behavior and cost to impl 04.

import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { scheduleClasses, YEAR_START, STEP_MS } from '../../shared/schedule.ts';
import { resolveClass, buildScheduleIndex, type ZoneState } from '../../shared/rules.ts';
import { formatOffsetMinutes } from '../../shared/fmt.ts';
import { makeInfo } from '../../shared/zoneLinks.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';
import { liveZoneInfo } from '../../shared/live.ts';

const hasTemporal = typeof Temporal !== 'undefined';

// zone -> schedule class index, bridging spelling variants (-1 = no entry)
const tableClassIdx = buildScheduleIndex(zones, scheduleClasses);

function compute(timestamp: number): TimeZoneInfo[] {
  const date = new Date(timestamp);
  const instant = hasTemporal ? Temporal!.Instant.fromEpochMilliseconds(timestamp) : null;
  const out: TimeZoneInfo[] = [];

  // per-call memo: resolved state + expected offset string per class
  const resolved = new Array<{ st: ZoneState; offStr: string } | undefined>(scheduleClasses.length);

  for (let z = 0; z < zones.length; z++) {
    const name = zones[z]!;
    const ci = tableClassIdx[z]!;

    if (instant === null || ci === -1) {
      out.push(liveZoneInfo(name, timestamp, date));
      continue;
    }

    let r = resolved[ci];

    if (r === undefined) {
      const st = resolveClass(scheduleClasses[ci]!, timestamp, YEAR_START, STEP_MS);
      r = { st, offStr: formatOffsetMinutes(st.offMin) };
      resolved[ci] = r;
    }

    const liveOffset = instant.toZonedDateTimeISO(name).offset;

    // coherence guard: stale state (baked offset disagrees with reality)
    // -> live fallback for this zone only
    if (r.offStr !== liveOffset) {
      out.push(liveZoneInfo(name, timestamp, date));
      continue;
    }

    out.push(makeInfo(name, r.st.abbr, liveOffset));
  }

  return out;
}

const memo = hourBucketMemo(compute);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;
