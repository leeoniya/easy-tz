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

import { computeBaked } from '../../shared/bakedHistory.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';

const memo = hourBucketMemo(computeBaked);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;
export { getTimeZoneAt } from '../../shared/bakedHistory.ts';
export { formatOffset } from '../../shared/offsetFormatBaked.ts';
