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
// Without Temporal (Safari, bun, Node built without the Temporal component): the audit is skipped and this is
// exactly 07 (pure baked schedule + baked history, unknown zones get a UTC
// sentinel).
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

import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { scheduleClasses, YEAR_START, STEP_MS } from '../../shared/schedule.ts';
import { HISTORY_TO } from '../../shared/history.ts';
import { resolveClass, ruleInstant, type ScheduleClass } from '../../shared/rules.ts';
import { gmtLabel } from '../../shared/fmt.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';
import { makeInfo } from '../../shared/zoneLinks.ts';
import { computeBaked, classIdx, historyAbbr } from '../../shared/bakedHistory.ts';

const hasTemporal = typeof Temporal !== 'undefined';

// "+05:30" -> 330
function parseOffset(offset: string): number {
  const sign = offset[0] === '-' ? -1 : 1;
  return sign * (+offset.slice(1, 3) * 60 + +offset.slice(4, 6));
}

export interface AuditInfo {
  temporal: boolean;
  auditMs: number;
  auditedZones: number;
  recoveredZones: string[]; // failed audit or unknown -> Temporal-live for the session
}

let auditInfo: AuditInfo | null = null;
let recovered: Set<number> | null = null; // zone indices

export const getAuditInfo = (): AuditInfo | null => auditInfo;

// predicted (transition instant, offset-after) list for `cls` in `year`;
// irregular classes predict transitions only within their generated year
// (they clamp outside it, which the audit will then flag against reality)
function predictedTransitions(cls: ScheduleClass, year: number): { t: number; offMin: number }[] {
  if (cls.kind === 0) return [];

  if (cls.kind === 1) {
    const [r1, r2] = cls.rules;

    return [
      { t: ruleInstant(year, r1, cls.states[1 - r1.to]!.offMin), offMin: cls.states[r1.to]!.offMin },
      { t: ruleInstant(year, r2, cls.states[1 - r2.to]!.offMin), offMin: cls.states[r2.to]!.offMin },
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
  let zdt = Temporal!.Instant.fromEpochMilliseconds(yearStart).toZonedDateTimeISO(zone);

  if (parseOffset(zdt.offset) !== resolveClass(cls, yearStart, YEAR_START, STEP_MS).offMin) return false;

  const predicted = predictedTransitions(cls, year);
  let i = 0;

  for (;;) {
    const next = zdt.getTimeZoneTransition('next');

    if (next === null || next.epochMilliseconds >= yearEnd) break;

    const exp = predicted[i];

    if (exp === undefined || next.epochMilliseconds !== exp.t || parseOffset(next.offset) !== exp.offMin) {
      return false;
    }

    i++;
    zdt = next;
  }

  return i === predicted.length;
}

function init(): void {
  const t0 = performance.now();

  recovered = new Set();

  const recoveredNames: string[] = [];
  let audited = 0;

  if (hasTemporal) {
    const year = new Date().getUTCFullYear();
    const yearStart = Date.UTC(year, 0, 1);
    const yearEnd = Date.UTC(year + 1, 0, 1);

    for (let z = 0; z < zones.length; z++) {
      const ci = classIdx[z]!;

      if (ci === -1) {
        recovered.add(z);
        recoveredNames.push(zones[z]!);
        continue;
      }

      audited++;

      if (!auditZone(zones[z]!, scheduleClasses[ci]!, yearStart, yearEnd, year)) {
        recovered.add(z);
        recoveredNames.push(zones[z]!);
      }
    }
  }

  auditInfo = {
    temporal: hasTemporal,
    auditMs: performance.now() - t0,
    auditedZones: audited,
    recoveredZones: recoveredNames,
  };
}

function compute(timestamp: number): TimeZoneInfo[] {
  if (recovered === null) init();

  // Temporal runtime + timestamp before the bake year: resolve every zone
  // live. Temporal is exact for the past, so this keeps the never-wrong
  // guarantee without auditing history; the label reuses the schedule abbr
  // when the offset matches (matching 07's baked-history labels), else GMT.
  if (hasTemporal && new Date(timestamp).getUTCFullYear() < HISTORY_TO) {
    const instant = Temporal!.Instant.fromEpochMilliseconds(timestamp);
    const out: TimeZoneInfo[] = [];

    for (let z = 0; z < zones.length; z++) {
      const name = zones[z]!;
      const offset = instant.toZonedDateTimeISO(name).offset;
      const ci = classIdx[z]!;
      const abbr = ci < 0 ? gmtLabel(parseOffset(offset)) : historyAbbr(scheduleClasses[ci]!, parseOffset(offset));

      out.push(makeInfo(name, abbr, offset));
    }

    return out;
  }

  // bake year and later, or a no-Temporal runtime: shared baked resolver
  // (schedule + baked history eras) — identical to impl 07
  const out = computeBaked(timestamp);

  // current/future on a Temporal runtime: overwrite the session-recovered
  // zones (failed the current-year audit, or unknown) with their live offset
  if (recovered!.size > 0) {
    const instant = Temporal!.Instant.fromEpochMilliseconds(timestamp);

    for (const z of recovered!) {
      const name = zones[z]!;
      const offset = instant.toZonedDateTimeISO(name).offset;
      out[z] = makeInfo(name, gmtLabel(parseOffset(offset)), offset);
    }
  }

  return out;
}

const memo = hourBucketMemo(compute);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;
