// Attempt 7: zero-Intl implementation. The entire year's (abbr, offset)
// schedule is precomputed by tools/gen-classes.ts into shared/schedule.ts;
// a call is just a segment lookup per class — no Intl.DateTimeFormat is ever
// constructed, so there is no formatter cold start and no ICU memory. The
// full response is memoized per UTC hour bucket (see shared/hourCache.ts).
//
// Timestamps outside the generated year clamp to its first/last segment.
//
// CAVEAT: abbrs and offsets are baked at generation time — regenerate with
// `bun run gen` on tzdata/CLDR changes and year rollover.
// tests/schedule.test.ts asserts output-equality with impl 04.

import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { scheduleClasses, YEAR_START, STEP_MS } from '../../shared/schedule.ts';
import { scheduleOffsets } from '../../shared/offsets.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';
import { makeInfo } from '../../shared/zoneLinks.ts';

// zones-list order -> schedule class index, resolved once at module load.
// -1 marks zones the runtime knows but the generated table doesn't (only
// possible when the table is stale); they fall back to UTC rather than throw.
const classIdxByZone = new Map<string, number>();

for (let c = 0; c < scheduleClasses.length; c++) {
  for (const z of scheduleClasses[c]!.zones) classIdxByZone.set(z, c);
}

const classIdx = zones.map((z) => classIdxByZone.get(z) ?? -1);

function compute(timestamp: number): TimeZoneInfo[] {
  const step = Math.max(0, Math.floor((timestamp - YEAR_START) / STEP_MS));

  // resolve the active segment per class (classes have 1-4 segments)
  const nClasses = scheduleClasses.length;
  const abbrNow = new Array<string>(nClasses);
  const offsetNow = new Array<string>(nClasses);

  for (let c = 0; c < nClasses; c++) {
    const { starts, abbrs } = scheduleClasses[c]!;
    let i = starts.length - 1;

    while (i > 0 && starts[i]! > step) i--;

    abbrNow[c] = abbrs[i]!;
    offsetNow[c] = scheduleOffsets[c]![i]!;
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
