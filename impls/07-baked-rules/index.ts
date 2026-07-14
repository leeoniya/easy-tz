// Attempt 7: zero-Intl implementation. The generated schedule (static states,
// year-independent nth-weekday rules, and current-year irregular segments —
// see shared/rules.ts) is baked by tools/gen-core.ts into shared/schedule.ts;
// a call resolves each class's state with pure date math — no
// Intl.DateTimeFormat is ever constructed, so there is no formatter cold
// start and no ICU memory. The full response is memoized per UTC hour bucket
// (see shared/hourCache.ts).
//
// Year rollover: static and rule classes stay correct in future years until
// a country changes policy; only irregular zones (non-Gregorian rules) clamp
// to their current-year segments outside the generated year.
//
// CAVEAT: values are baked at generation time — regenerate with `bun run gen`
// on tzdata/CLDR changes. tests/schedule.test.ts asserts output-equality
// with impl 04, including next-year instants.

import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { scheduleClasses, YEAR_START, STEP_MS } from '../../shared/schedule.ts';
import { resolveClass, buildScheduleIndex } from '../../shared/rules.ts';
import { formatOffsetMinutes } from '../../shared/fmt.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';
import { makeInfo } from '../../shared/zoneLinks.ts';

// zones-list order -> schedule class index, resolved once at module load,
// bridging spelling variants (Asia/Kolkata <-> Asia/Calcutta) so tables from
// a different runtime's zone list still serve this one. -1 marks zones the
// table doesn't cover even after bridging (genuinely new zones on a stale
// table); with no Intl available here they fall back to UTC rather than throw.
const classIdx = buildScheduleIndex(zones, scheduleClasses);

const offsetStrCache = new Map<number, string>();

function offsetStr(offMin: number): string {
  let s = offsetStrCache.get(offMin);

  if (s === undefined) {
    s = formatOffsetMinutes(offMin);
    offsetStrCache.set(offMin, s);
  }

  return s;
}

function compute(timestamp: number): TimeZoneInfo[] {
  const nClasses = scheduleClasses.length;
  const abbrNow = new Array<string>(nClasses);
  const offsetNow = new Array<string>(nClasses);

  for (let c = 0; c < nClasses; c++) {
    const st = resolveClass(scheduleClasses[c]!, timestamp, YEAR_START, STEP_MS);

    abbrNow[c] = st.abbr;
    offsetNow[c] = offsetStr(st.offMin);
  }

  const out: TimeZoneInfo[] = [];

  for (let z = 0; z < zones.length; z++) {
    const c = classIdx[z]!;

    out.push(
      c < 0
        ? makeInfo(zones[z]!, 'UTC', '+00:00')
        : makeInfo(zones[z]!, abbrNow[c]!, offsetNow[c]!)
    );
  }

  return out;
}

const memo = hourBucketMemo(compute);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;
