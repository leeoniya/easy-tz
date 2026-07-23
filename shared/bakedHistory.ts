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
import { resolveClass, resolveHistory, buildScheduleIndex, type ScheduleClass } from './rules.ts';
import { formatOffsetMinutes, gmtLabel } from './fmt.ts';
import { makeInfo } from './zoneLinks.ts';

// zones-list order -> schedule / history class index (bridging spelling
// variants; -1 = not covered even after bridging). Both resolved once.
export const classIdx = buildScheduleIndex(zones, scheduleClasses);
const histIdx = buildScheduleIndex(zones, historyClasses);

const offsetStrCache = new Map<number, string>();

export function offsetStr(offMin: number): string {
  let s = offsetStrCache.get(offMin);

  if (s === undefined) {
    s = formatOffsetMinutes(offMin);
    offsetStrCache.set(offMin, s);
  }

  return s;
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

// full baked response at `timestamp`: schedule for the bake year onward,
// historical eras for earlier years, UTC sentinel for uncovered zones.
export function computeBaked(timestamp: number): TimeZoneInfo[] {
  const year = new Date(timestamp).getUTCFullYear();
  const historical = year < HISTORY_TO;

  // schedule state per class (cheap; also the fallback for deferring eras)
  const nClasses = scheduleClasses.length;
  const schedAbbr = new Array<string>(nClasses);
  const schedOff = new Array<string>(nClasses);

  for (let c = 0; c < nClasses; c++) {
    const st = resolveClass(scheduleClasses[c]!, timestamp, YEAR_START, STEP_MS);
    schedAbbr[c] = st.abbr;
    schedOff[c] = offsetStr(st.offMin);
  }

  // historical offset (minutes) per history class, or null when the era
  // defers to the schedule; computed once per class, shared by its zones
  let histOffMin: (number | null)[] | null = null;

  if (historical) {
    const nHist = historyClasses.length;
    histOffMin = new Array<number | null>(nHist);

    for (let h = 0; h < nHist; h++) {
      histOffMin[h] = resolveHistory(historyClasses[h]!.eras, timestamp, STEP_MS);
    }
  }

  const out: TimeZoneInfo[] = [];

  for (let z = 0; z < zones.length; z++) {
    const name = zones[z]!;
    const ci = classIdx[z]!;

    if (historical) {
      const hi = histIdx[z]!;

      if (hi !== -1) {
        const off = histOffMin![hi];

        if (off != null) {
          const abbr = ci < 0 ? gmtLabel(off) : historyAbbr(scheduleClasses[ci]!, off);
          out.push(makeInfo(name, abbr, offsetStr(off)));
          continue;
        }
      }
    }

    out.push(ci < 0 ? makeInfo(name, 'UTC', '+00:00') : makeInfo(name, schedAbbr[ci]!, schedOff[ci]!));
  }

  return out;
}
