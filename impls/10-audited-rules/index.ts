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
// exactly 07 (pure baked, unknown zones get a UTC sentinel).
//
// vs 09-guarded-hybrid: same staleness protection on Temporal runtimes, but
// verification is amortized to init instead of per-call (misses ~0.05ms vs
// ~0.8ms) and the live-Intl fallback path (~5KB: curated maps + formatter
// machinery) is not shipped — recovered labels are GMT-style, not curated.

import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { scheduleClasses, YEAR_START, STEP_MS } from '../../shared/schedule.ts';
import { resolveClass, buildScheduleIndex, ruleInstant, type ScheduleClass } from '../../shared/rules.ts';
import { formatOffsetMinutes } from '../../shared/fmt.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';
import { makeInfo } from '../../shared/zoneLinks.ts';

const hasTemporal = typeof Temporal !== 'undefined';

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

// "+05:30" -> 330
function parseOffset(offset: string): number {
  const sign = offset[0] === '-' ? -1 : 1;
  return sign * (+offset.slice(1, 3) * 60 + +offset.slice(4, 6));
}

// generic label for recovered zones: "GMT", "GMT+2", "GMT+5:30"
function gmtLabel(offMin: number): string {
  if (offMin === 0) return 'GMT';

  const sign = offMin < 0 ? '-' : '+';
  const abs = Math.abs(offMin);
  const h = Math.trunc(abs / 60);
  const m = abs % 60;

  return `GMT${sign}${h}${m > 0 ? `:${String(m).padStart(2, '0')}` : ''}`;
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

  const instant = hasTemporal && recovered!.size > 0 ? Temporal!.Instant.fromEpochMilliseconds(timestamp) : null;

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
    const name = zones[z]!;

    if (recovered!.has(z)) {
      if (instant !== null) {
        // session-recovered: live Temporal offset, generic label
        const offset = instant.toZonedDateTimeISO(name).offset;
        out.push(makeInfo(name, gmtLabel(parseOffset(offset)), offset));
      } else {
        // no Temporal (only possible for unknown zones here): UTC sentinel
        out.push(makeInfo(name, 'UTC', '+00:00'));
      }

      continue;
    }

    const c = classIdx[z]!;

    out.push(makeInfo(name, abbrNow[c]!, offsetNow[c]!));
  }

  return out;
}

const memo = hourBucketMemo(compute);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;
