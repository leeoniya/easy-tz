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
// Historical years (before the bake year) resolve through the baked offset
// eras in shared/history.ts — still zero-Intl, just more baked data — so the
// pre-2007 US/EU rule regimes, decree-driven years, etc. get exact offsets
// instead of the current rules projected backwards. All of this lives in the
// shared resolver (shared/bakedHistory.ts), which impl 10 also uses.
//
// CAVEAT: values are baked at generation time — regenerate with `bun run gen`
// on tzdata/CLDR changes. tests/schedule.test.ts asserts output-equality
// with impl 04, including next-year instants; tools/sweep-validity.ts
// validates the historical offsets.
//
// getTimeZoneAt(name, ts) resolves a SINGLE zone (the single-zone /
// many-timestamps use case) via the same baked resolver, without building or
// memoizing the full response. getTimeZonesAt() loops that same per-zone core.
// getTimeZone(name) is the current-instant, schedule-only counterpart — the
// single-zone twin of getTimeZones(), and history-free for the same reason.

import type { TimeZoneInfo } from '../../shared/types.ts';
import { computeSchedule, scheduleGetTimeZoneAt } from '../../shared/bakedSchedule.ts';
import { computeBaked, getTimeZoneAt as bakedGetTimeZoneAt } from '../../shared/bakedHistory.ts';
import { hourBucketMemo, type HourBucketMemo } from '../../shared/hourCache.ts';
import { canonicalZone, canonicalView, type CanonicalView } from '../../shared/zoneLinks.ts';

// Two hour-bucket memos, created lazily on first use. The history-backed one
// is referenced ONLY inside getTimeZonesAt/getTimeZoneAt below, and the
// history table is imported ONLY by shared/bakedHistory.ts — so a consumer that
// imports just getTimeZones() never pulls computeBaked, and the baked history
// eras tree-shake out of their bundle (see shared/bakedHistory.ts).
let histMemo: HourBucketMemo | null = null;
let schedMemo: HourBucketMemo | null = null;

// alias-free views of the two memos' outputs, built on first opt-out. One per
// memo: a shared instance would thrash between the two responses.
let histCanon: CanonicalView | null = null;
let schedCanon: CanonicalView | null = null;

// full response at `timestamp`: schedule for the bake year onward, baked
// historical eras for earlier years.
export function getTimeZonesAt(timestamp: number, withAliases?: boolean): TimeZoneInfo[] {
  const full = (histMemo ??= hourBucketMemo(computeBaked)).get(timestamp);

  return withAliases === false ? (histCanon ??= canonicalView())(full) : full;
}

// current-instant response, schedule-only — no history. Importing only this
// lets shared/history.ts tree-shake away.
export function getTimeZones(withAliases?: boolean): TimeZoneInfo[] {
  const full = (schedMemo ??= hourBucketMemo(computeSchedule)).get(Date.now());

  return withAliases === false ? (schedCanon ??= canonicalView())(full) : full;
}

// single-zone / many-timestamps resolver (history-capable, same as getTimeZonesAt)
export function getTimeZoneAt(name: string, timestamp: number, withAliases?: boolean): TimeZoneInfo {
  return bakedGetTimeZoneAt(withAliases === false ? canonicalZone(name) : name, timestamp);
}

// single zone at the current instant, schedule-only — no history. The
// single-zone counterpart to getTimeZones(); importing only the two of them
// lets shared/history.ts tree-shake away. Nothing to memoize: the result is an
// interned instance and the lookup is a map get plus the class's date math.
export function getTimeZone(name: string, withAliases?: boolean): TimeZoneInfo {
  return scheduleGetTimeZoneAt(withAliases === false ? canonicalZone(name) : name, Date.now());
}

export function clearCache(): void {
  histMemo?.clear();
  schedMemo?.clear();
  histCanon = null;
  schedCanon = null;
}

export { formatOffset } from '../../shared/offsetFormatBaked.ts';
