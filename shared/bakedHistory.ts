// Historical layer on top of the schedule-only core (shared/bakedSchedule.ts),
// used by the rule-baking impls (07, and 10's no-Temporal path). It answers a
// full getTimeZonesAt() from baked data only — no Intl, no Temporal:
//
//   - bake year and later: the year-independent schedule (shared/schedule.ts),
//     resolved by shared/bakedSchedule.ts, exactly as before history existed.
//   - earlier years: the validated historical offset eras (shared/history.ts,
//     produced by tools/gen-core.ts, checked end-to-end by
//     tools/sweep-validity.ts). Zones whose whole 1995+ history already
//     matches the schedule have no era and fall through to it; a 'defer' era
//     (kind 3) does the same for the spans that match.
//
// This module is the ONLY link from the baked resolver to shared/history.ts.
// Entry points that never call computeBaked()/getTimeZoneAt() (e.g. the
// schedule-only getTimeZones()) don't import it, so the history eras
// tree-shake away; the eager decode/index below are /*@__PURE__*/ so a
// bundler can drop them when unused.
//
// History stores OFFSETS only. The label reuses the zone's schedule-class
// abbreviation when the historical offset equals one of its states (the
// common "same abbreviations, different DST dates" case, e.g. US EST/EDT
// before the 2007 rule change) and otherwise falls back to a generic
// GMT-style label. The offset is always exact.
//
// That offset-keyed label is wrong wherever a zone's historical identity
// differs from the one its modern schedule class describes, so a sparse
// correction table (shared/abbrfix.ts) overrides it on the spans where it
// would otherwise confidently report another identity's abbreviation. Spans
// where the offset matches no modern state — where the fallback is a vague
// GMT±N rather than a wrong name — are left alone; see tools/abbrfix-core.ts.

import type { TimeZoneInfo } from './types.ts';
import { zones } from './zones.ts';
import { scheduleClasses, STEP_MS } from './schedule.ts';
import { historyClasses, HISTORY_TO } from './history.ts';
import { abbrFixClasses } from './abbrfix.ts';
import { resolveHistory, resolveAbbrFix, buildScheduleIndex, yearFromMs, type ZoneState } from './rules.ts';
import { gmtLabel } from './fmt.ts';
import { makeInfo } from './zoneLinks.ts';
import { classIdx, zoneIndexOf, historyAbbr, scheduleZoneInfo } from './bakedSchedule.ts';

// zones-list order -> history class index (bridging spelling variants; -1 =
// not covered). Resolved once. /*@__PURE__*/ so that if nothing references it
// (schedule-only bundles), it — and the historyClasses it reads — tree-shake.
export const histIdx = /*@__PURE__*/ buildScheduleIndex(zones, historyClasses);

// zones-list order -> abbreviation-correction class index (-1 = this zone's
// historical labels are already right, which is 392 of 464 zones). Same
// /*@__PURE__*/ reasoning as histIdx above.
export const fixIdx = /*@__PURE__*/ buildScheduleIndex(zones, abbrFixClasses);

// UTC start of the bake year: `ts < HISTORY_TO_MS` is exactly `year < HISTORY_TO`
// (the timestamp falls before Jan 1 of the bake year) but with no Date
// allocation on the per-call hot path.
export const HISTORY_TO_MS = Date.UTC(HISTORY_TO, 0, 1);

// Resolve ONE zone's TimeZoneInfo at `timestamp`. `ci`/`hi` are its schedule
// and history class indices (from classIdx/histIdx; -1 = uncovered). Single
// source of truth for the per-zone answer, shared by the single-zone
// getTimeZoneAt() and the all-zones computeBaked() loop. Historical eras win
// when the zone has one live at this instant; otherwise it defers to the
// schedule-only resolver (shared/bakedSchedule.ts).
//
// The optional per-class caches let the all-zones path resolve each schedule /
// history class at most once. undefined history entry = not yet computed (a
// resolved history offset is number|null, so undefined is an unambiguous
// "miss"). getTimeZoneAt() passes no caches and resolves directly.
//
// `z` is the zones-list index, forwarded to the schedule resolver's identity
// cache (see shared/bakedSchedule.ts). Only the bake-year-onward answer can use
// it; a historical offset isn't a schedule state, so it interns the long way.
// corrected historical label for zones-list index `z`, or null when this
// instant needs no correction (the overwhelmingly common case: one array read
// and a compare for the 392 zones that have no corrections at all)
// `offMin` is the offset about to be labelled — the generator keyed the
// corrections on it, so passing anything else silently misses. yearFromMs is
// only paid by the 68 zones that have corrections at all.
function fixedAbbr(z: number, timestamp: number, offMin: number): string | null {
  if (z === -1) return null;

  const fi = fixIdx[z]!;

  return fi === -1 ? null : resolveAbbrFix(abbrFixClasses[fi]!, timestamp, yearFromMs(timestamp), offMin);
}

function bakedZoneInfo(
  name: string,
  ci: number,
  hi: number,
  timestamp: number,
  historical: boolean,
  schedCache?: (ZoneState | undefined)[],
  histCache?: (number | null | undefined)[],
  z = -1,
): TimeZoneInfo {
  // historical era wins when the zone has one live at this instant (non-null)
  if (historical && hi !== -1) {
    let off = histCache != null ? histCache[hi] : undefined;

    // strict `=== undefined` on purpose: null is a valid cached result (the
    // era defers to the schedule), distinct from undefined (not yet resolved)
    if (off === undefined) {
      off = resolveHistory(historyClasses[hi]!.eras, timestamp, STEP_MS);
      if (histCache != null) histCache[hi] = off;
    }

    if (off !== null) {
      const abbr = fixedAbbr(z, timestamp, off) ?? (ci < 0 ? gmtLabel(off) : historyAbbr(scheduleClasses[ci]!, off));
      return makeInfo(name, abbr, off);
    }
  }

  // bake year onward, or an earlier year whose history defers/absent
  const info = scheduleZoneInfo(name, ci, timestamp, schedCache, z);

  // a deferring era still reaches this path, and the schedule class labels it
  // with today's identity — so corrections apply here too (185 of the spans)
  if (historical) {
    const fix = fixedAbbr(z, timestamp, info.offset);

    if (fix !== null && fix !== info.abbr) return makeInfo(name, fix, info.offset);
  }

  return info;
}

// Single-zone resolver for the single-zone / many-timestamps use case: resolves
// just `name` with no all-zones allocation, using the exact per-zone logic of
// computeBaked(). Unknown names resolve to the UTC sentinel (as they do in the
// full response). Not memoized — callers sweeping many distinct timestamps get
// a fresh, allocation-light answer each call.
export function getTimeZoneAt(name: string, timestamp: number): TimeZoneInfo {
  const z = zoneIndexOf(name);
  const ci = z === -1 ? -1 : classIdx[z]!;
  const hi = z === -1 ? -1 : histIdx[z]!;

  return bakedZoneInfo(name, ci, hi, timestamp, timestamp < HISTORY_TO_MS, undefined, undefined, z);
}

// full baked response at `timestamp`: schedule for the bake year onward,
// historical eras for earlier years, UTC sentinel for uncovered zones. Loops
// the same per-zone resolver as getTimeZoneAt(), with per-class caches so each
// class is resolved once and shared across its zones (lazily — in a historical
// year, schedule classes are only touched for zones whose history defers).
export function computeBaked(timestamp: number): TimeZoneInfo[] {
  const historical = timestamp < HISTORY_TO_MS;
  const schedCache = new Array<ZoneState | undefined>(scheduleClasses.length);
  const histCache = historical ? new Array<number | null | undefined>(historyClasses.length) : undefined;
  const out: TimeZoneInfo[] = new Array(zones.length);

  for (let z = 0; z < zones.length; z++) {
    out[z] = bakedZoneInfo(zones[z]!, classIdx[z]!, histIdx[z]!, timestamp, historical, schedCache, histCache, z);
  }

  return out;
}
