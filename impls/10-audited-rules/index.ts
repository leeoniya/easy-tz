// Attempt 10 ("audited rules"): 07's baked rule schedule with 08's exact
// verification pointed at it. At first call (once per process — a browser
// never hot-swaps its tzdata), every zone's CURRENT-YEAR behavior predicted
// by the baked schedule is audited against Temporal's actual transition walk
// (getTimeZoneTransition: exact instants + offsets, no sampling, no
// formatters, ~2-5ms for all zones). Zones that fail the audit — a policy
// change shipped in a stale table, an unknown zone, an irregular zone
// outside its generated year — are RECOVERED for the session: live Temporal
// offsets with a generic GMT-style label. Everything else runs pure baked:
// zero Temporal calls on the hot path, 07's miss cost.
//
// Guarantees on Temporal runtimes: never a wrong offset (audited or live),
// at worst a generic label for the few recovered zones until regeneration.
// Without Temporal (Safari, bun, Node built without the Temporal component):
// the audit is skipped and this is exactly 07 (pure baked schedule + baked
// history; unknown names return undefined from the single-zone APIs).
//
// History: for timestamps before the bake year, a Temporal runtime resolves
// every zone live (Temporal is authoritative for the past; the baked history
// eras are only gen-time-validated, so live keeps the never-wrong-offset
// guarantee) with the same schedule-abbr-reuse labels as impl 07. Without
// Temporal, historical years come from the shared baked resolver's eras,
// identical to 07.
//
// vs 09-guarded-hybrid: same staleness protection on Temporal runtimes, but
// verification is amortized to init instead of per-call (misses ~0.05ms vs
// ~0.8ms) and the live-Intl fallback path (~5KB: curated maps + formatter
// machinery) is not shipped — recovered labels are GMT-style, not curated.
//
// getTimeZoneAt(name, ts) resolves a SINGLE zone (single-zone / many-timestamps
// use case) through the same three regimes as getTimeZonesAt() — live-Temporal
// history, live-Temporal recovered, else shared baked resolver — for one zone,
// with no full-response allocation. getTimeZone(name) is its current-instant
// counterpart, taking the same history-free route as getTimeZones().

import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { scheduleClasses, YEAR_START, STEP_MS } from '../../shared/schedule.ts';
import { resolveClass, ruleInstant, historyAbbr, type ScheduleClass } from '../../shared/rules.ts';
import { gmtLabel } from '../../shared/fmt.ts';
import { lazyList, listAt, clearList } from '../../shared/listApi.ts';
import { makeInfo, canonicalZone } from '../../shared/zoneLinks.ts';
import { computeSchedule, scheduleZoneInfo, scheduleGetTimeZoneAt, classIdx, zoneIndexOf } from '../../shared/bakedSchedule.ts';
import { computeBaked, getTimeZoneAt as bakedGetTimeZoneAt, HISTORY_TO_MS } from '../../shared/bakedHistory.ts';

const hasTemporal = typeof Temporal !== 'undefined';

// the Temporal.Instant returned by fromEpochMilliseconds (no named ambient type)
type TZInstant = ReturnType<NonNullable<typeof Temporal>['Instant']['fromEpochMilliseconds']>;

// "+05:30" -> 330
function parseOffset(offset: string): number {
  const sign = offset[0] === '-' ? -1 : 1;
  return sign * (+offset.slice(1, 3) * 60 + +offset.slice(4, 6));
}

// exact live offset from Temporal for one zone; the label reuses the schedule
// class's abbr when the live offset matches one of its states (matching 07's
// baked-history labels), else a generic GMT label. Shared by the historical
// all-zones loop and the single-zone getTimeZoneAt().
function liveInfo(name: string, ci: number, instant: TZInstant): TimeZoneInfo {
  const offMin = parseOffset(instant.toZonedDateTimeISO(name).offset);
  const abbr = ci < 0 ? gmtLabel(offMin) : historyAbbr(scheduleClasses[ci]!, offMin);

  return makeInfo(name, abbr, offMin);
}

// exact live offset from Temporal for a session-recovered zone (failed the
// current-year audit, or unknown): always a generic GMT-style label.
function liveRecovered(name: string, instant: TZInstant): TimeZoneInfo {
  const offMin = parseOffset(instant.toZonedDateTimeISO(name).offset);

  return makeInfo(name, gmtLabel(offMin), offMin);
}

let recovered: Set<number> | null = null; // zone indices

// predicted (transition instant, offset-after) list for `cls` in `year`;
// irregular classes predict transitions only within their generated year
// (they clamp outside it, which the audit will then flag against reality)
function predictedTransitions(cls: ScheduleClass, year: number): { t: number; offMin: number }[] {
  if (cls.kind === 0) return [];

  if (cls.kind === 1) {
    const [r1, r2] = cls.rules;

    return [
      { t: ruleInstant(year, r1, cls.states[1 - r1.to]!.offMin), offMin: cls.states[r1.to].offMin },
      { t: ruleInstant(year, r2, cls.states[1 - r2.to]!.offMin), offMin: cls.states[r2.to].offMin },
    ];
  }

  if (Date.UTC(year, 0, 1) !== YEAR_START) return [];

  const out: { t: number; offMin: number }[] = [];

  for (let i = 1; i < cls.starts.length; i++) {
    out.push({ t: YEAR_START + cls.starts[i]! * STEP_MS, offMin: cls.offMins[i]! });
  }

  return out;
}

// exact audit of one zone's current-year behavior vs its baked class
function auditZone(zone: string, cls: ScheduleClass, yearStart: number, yearEnd: number, year: number): boolean {
  let zdt = Temporal.Instant.fromEpochMilliseconds(yearStart).toZonedDateTimeISO(zone);

  if (parseOffset(zdt.offset) !== resolveClass(cls, yearStart, YEAR_START, STEP_MS).offMin) return false;

  const predicted = predictedTransitions(cls, year);
  let i = 0;

  for (;;) {
    const next = zdt.getTimeZoneTransition('next');

    if (next === null || next.epochMilliseconds >= yearEnd) break;

    const exp = predicted[i];

    if (exp == null || next.epochMilliseconds !== exp.t || parseOffset(next.offset) !== exp.offMin) {
      return false;
    }

    i++;
    zdt = next;
  }

  return i === predicted.length;
}

function init(): void {
  recovered = new Set();

  if (hasTemporal) {
    const year = new Date().getUTCFullYear();
    const yearStart = Date.UTC(year, 0, 1);
    const yearEnd = Date.UTC(year + 1, 0, 1);

    for (let z = 0; z < zones.length; z++) {
      const ci = classIdx[z]!;

      // unknown zone, or one whose baked class disagrees with this year's
      // reality — either way it runs Temporal-live for the session
      if (ci === -1 || !auditZone(zones[z]!, scheduleClasses[ci]!, yearStart, yearEnd, year)) {
        recovered.add(z);
      }
    }
  }
}

// Overwrites the session-recovered zones — those that failed the current-year
// audit, or were unknown at init — with their live offset. Deliberately touches
// only the schedule side, so computeCurrent() can call it without pulling the
// history eras into a getTimeZones()-only bundle.
function applyRecovered(out: TimeZoneInfo[], timestamp: number): TimeZoneInfo[] {
  if (recovered!.size > 0) {
    const instant = Temporal.Instant.fromEpochMilliseconds(timestamp);

    for (const z of recovered!) out[z] = liveRecovered(zones[z]!, instant);
  }

  return out;
}

function compute(timestamp: number): TimeZoneInfo[] {
  if (recovered === null) init();

  // Temporal runtime + timestamp before the bake year: resolve every zone
  // live. Temporal is exact for the past, so this keeps the never-wrong
  // guarantee without auditing history; the label reuses the schedule abbr
  // when the offset matches (matching 07's baked-history labels), else GMT.
  if (hasTemporal && timestamp < HISTORY_TO_MS) {
    const instant = Temporal.Instant.fromEpochMilliseconds(timestamp);
    const out: TimeZoneInfo[] = new Array(zones.length);

    for (let z = 0; z < zones.length; z++) out[z] = liveInfo(zones[z]!, classIdx[z]!, instant);

    return out;
  }

  // bake year and later, or a no-Temporal runtime: shared baked resolver
  // (schedule + baked history eras) — identical to impl 07
  return applyRecovered(computeBaked(timestamp), timestamp);
}

// single-zone resolver mirroring compute()'s three regimes for one zone (same
// values getTimeZonesAt() would return at this index), without building the
// full response. Reuses the shared baked single-zone resolver for the baked
// path and the same live-Temporal helpers as the all-zones loop.
function computeOne(name: string, timestamp: number): TimeZoneInfo | undefined {
  if (recovered === null) init();

  const z = zoneIndexOf(name);

  // unknown zone: undefined via the baked resolver (never live — a bad name
  // would make Temporal throw), identical to impl 07
  if (z === -1) return bakedGetTimeZoneAt(name, timestamp);

  // Temporal runtime + before the bake year: exact live past, schedule label
  if (hasTemporal && timestamp < HISTORY_TO_MS) {
    return liveInfo(name, classIdx[z]!, Temporal.Instant.fromEpochMilliseconds(timestamp));
  }

  // current/future recovered zone on a Temporal runtime: live offset, GMT label
  if (recovered!.size > 0 && recovered!.has(z)) {
    return liveRecovered(name, Temporal.Instant.fromEpochMilliseconds(timestamp));
  }

  // bake year and later, or a no-Temporal runtime: shared baked resolver
  return bakedGetTimeZoneAt(name, timestamp);
}

// current-instant response, schedule-only. The init-time audit and live
// recovery still apply (both use Temporal + the schedule, never the baked
// history table), so this matches compute() for current/future instants — but
// it never references computeBaked/shared/history.ts, so importing only
// getTimeZones() tree-shakes the history eras out of the bundle.
function computeCurrent(timestamp: number): TimeZoneInfo[] {
  if (recovered === null) init();

  return applyRecovered(computeSchedule(timestamp), timestamp);
}

// single-zone counterpart to computeCurrent(): the same two current-instant
// regimes (session-recovered zones go Temporal-live, everything else runs the
// baked schedule) resolved for one zone. Like computeCurrent() it never
// references computeBaked/bakedGetTimeZoneAt, so importing only the
// current-instant APIs tree-shakes the history eras out.
function computeOneCurrent(name: string, timestamp: number): TimeZoneInfo | undefined {
  if (recovered === null) init();

  const z = zoneIndexOf(name);

  // unknown zone: undefined (never live — a bad name would make Temporal
  // throw), while uncovered fixed-offset Etc ids remain supported
  if (z === -1) return scheduleGetTimeZoneAt(name, timestamp);

  if (recovered!.has(z)) return liveRecovered(name, Temporal.Instant.fromEpochMilliseconds(timestamp));

  return scheduleZoneInfo(name, classIdx[z]!, timestamp);
}

// One lazy memo (plus its alias-free view) per response shape. compute() is
// handed to listAt() inside getTimeZonesAt's body rather than at module scope,
// so a getTimeZones()-only consumer never references compute()/computeBaked()
// and drops the baked history eras — see shared/listApi.ts.
const full = lazyList();
const cur = lazyList();

export function getTimeZonesAt(timestamp: number, withAliases = true): TimeZoneInfo[] {
  return listAt(full, compute, timestamp, withAliases);
}

export function getTimeZones(withAliases = true): TimeZoneInfo[] {
  return listAt(cur, computeCurrent, Date.now(), withAliases);
}

// the canonical substitution happens out here rather than inside computeOne /
// computeOneCurrent: both spellings share a schedule class and audit outcome,
// so swapping the name up front changes only the label on the result
export function getTimeZoneAt(name: string, timestamp: number, withAliases = true): TimeZoneInfo | undefined {
  return computeOne(withAliases ? name : canonicalZone(name), timestamp);
}

export function getTimeZone(name: string, withAliases = true): TimeZoneInfo | undefined {
  return computeOneCurrent(withAliases ? name : canonicalZone(name), Date.now());
}

export function clearCache(): void {
  clearList(full);
  clearList(cur);
}

export { formatOffset } from '../../shared/offsetFormatBaked.ts';
