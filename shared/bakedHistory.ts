// Shared baked resolver for the rule-baking impls (07, and 10's no-Temporal
// path). It answers a full getTimeZonesAt() from baked data only — no Intl,
// no Temporal:
//
//   - bake year and later: the year-independent schedule (static states,
//     nth-weekday rules, current-year irregular segments — shared/rules.ts),
//     exactly as before history existed.
//   - earlier years: the validated historical offset eras (shared/history.ts,
//     produced by tools/gen-core.ts, checked end-to-end by
//     tools/sweep-validity.ts). Zones whose whole 1995+ history already
//     matches the schedule have no era and fall through to it; a 'defer' era
//     (kind 3) does the same for the spans that match.
//
// History stores OFFSETS only. The label reuses the zone's schedule-class
// abbreviation when the historical offset equals one of its states — the
// common "same abbreviations, different DST dates" case (e.g. US EST/EDT
// before the 2007 rule change) — and otherwise falls back to a generic
// GMT-style label (historical CLDR abbreviations aren't baked; offsets are
// what historical coverage means). The offset is always exact.

import type { TimeZoneInfo } from './types.ts';
import { zones } from './zones.ts';
import { scheduleClasses, YEAR_START, STEP_MS } from './schedule.ts';
import { historyClasses, HISTORY_TO } from './history.ts';
import { resolveClass, resolveHistory, buildScheduleIndex, type ScheduleClass, type ZoneState } from './rules.ts';
import { gmtLabel } from './fmt.ts';
import { makeInfo, zoneLinks } from './zoneLinks.ts';

// zones-list order -> schedule / history class index (bridging spelling
// variants; -1 = not covered even after bridging). Both resolved once.
export const classIdx = buildScheduleIndex(zones, scheduleClasses);
export const histIdx = buildScheduleIndex(zones, historyClasses);

// UTC start of the bake year: `ts < HISTORY_TO_MS` is exactly `year < HISTORY_TO`
// (the timestamp falls before Jan 1 of the bake year) but with no Date
// allocation on the per-call hot path.
export const HISTORY_TO_MS = Date.UTC(HISTORY_TO, 0, 1);

// zone name -> its index in `zones`. Both canonical and legacy spellings are
// enumerated in `zones`, so most lookups hit directly; the zoneLinks fallback
// bridges any remaining alias exactly as buildScheduleIndex does. Built once.
const nameIdx = new Map<string, number>();
for (let z = 0; z < zones.length; z++) nameIdx.set(zones[z]!, z);

// index of `name` in the zones list (bridging alias spellings); -1 if unknown.
export function zoneIndexOf(name: string): number {
  const z = nameIdx.get(name);

  if (z != null) return z;

  const bridged = zoneLinks.get(name);

  return bridged != null ? nameIdx.get(bridged) ?? -1 : -1;
}

// label for a historical offset: the schedule class's abbr for that offset
// when it has one, else a generic GMT label
export function historyAbbr(cls: ScheduleClass, offMin: number): string {
  if (cls.kind === 0) {
    if (cls.states[0].offMin === offMin) return cls.states[0].abbr;
  } else if (cls.kind === 1) {
    for (const st of cls.states) if (st.offMin === offMin) return st.abbr;
  } else {
    for (let i = 0; i < cls.offMins.length; i++) if (cls.offMins[i] === offMin) return cls.abbrs[i]!;
  }

  return gmtLabel(offMin);
}

// Resolve ONE zone's TimeZoneInfo at `timestamp`. `ci`/`hi` are its schedule
// and history class indices (from classIdx/histIdx; -1 = uncovered). This is
// the single source of truth for the per-zone answer, shared by the single-zone
// getTimeZoneAt() and the all-zones computeBaked() loop.
//
// The optional per-class caches let the all-zones path resolve each schedule /
// history class at most once and reuse it across the (avg ~2.5) zones in that
// class — the batching that keeps getTimeZonesAt() fast. undefined entry = not
// yet computed (a resolved schedule state is an object and a resolved history
// offset is number|null, so undefined is an unambiguous "miss"). getTimeZoneAt()
// passes no caches and resolves directly.
function bakedZoneInfo(
  name: string,
  ci: number,
  hi: number,
  timestamp: number,
  historical: boolean,
  schedCache?: (ZoneState | undefined)[],
  histCache?: (number | null | undefined)[],
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
      const abbr = ci < 0 ? gmtLabel(off) : historyAbbr(scheduleClasses[ci]!, off);
      return makeInfo(name, abbr, off);
    }
  }

  // uncovered zone -> UTC sentinel
  if (ci < 0) return makeInfo(name, 'UTC', 0);

  // schedule: bake year onward, or an earlier year whose history defers/absent
  let st = schedCache != null ? schedCache[ci] : undefined;

  if (st == null) {
    st = resolveClass(scheduleClasses[ci]!, timestamp, YEAR_START, STEP_MS);
    if (schedCache != null) schedCache[ci] = st;
  }

  return makeInfo(name, st.abbr, st.offMin);
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

  return bakedZoneInfo(name, ci, hi, timestamp, timestamp < HISTORY_TO_MS);
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
    out[z] = bakedZoneInfo(zones[z]!, classIdx[z]!, histIdx[z]!, timestamp, historical, schedCache, histCache);
  }

  return out;
}
