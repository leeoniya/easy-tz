// Pure, browser-safe generator core: probes the runtime's Intl across THREE
// consecutive years and produces:
//
// - classGroups: zones with identical (CLDR long name, UTC offset) behavior
//   in the CURRENT year (impl 08's verified formatter-sharing hints);
// - a year-independent schedule (impls 07/09): zones are fitted to static
//   states or two-state nth-weekday-of-month rules that hold across all
//   probed years; zones whose transitions don't fit a Gregorian rule (e.g.
//   religious-calendar rules) fall back to current-year 'irregular' segments.
//
// Includes an in-runtime verification pass that replays the fitted schedule
// through the SAME resolver the impls ship (shared/rules.ts) and compares it
// against live Intl at semi-monthly instants and every transition edge of
// every probed year.
//
// Method: per zone/year, linear samples a fixed stride apart; each detected
// change is refined to a 15-minute boundary by binary search (covers
// half-hour-offset zones like Lord Howe), repeatedly where a window holds more
// than one, then timed to the exact minute (refineToMinute) for the rule fits.
// Assumes only that a window never returns to the value it started on — see
// SCHEDULE_STRIDE_DAYS.

// probe the raw runtime enumeration, NOT the augmented public list: tables
// must reflect exactly what this runtime's ICU enumerates, and the canonical
// spellings added by shared/zones.ts are bridged at lookup time via
// zoneLinks (buildScheduleIndex) instead of being baked into every table
import { scanChanges, strideSteps } from './step-scan.ts';
import { runtimeZones as zones } from '../shared/zones.ts';
import { abbrOverrides, zoneAliases, zoneAbbrOverrides } from '../shared/abbrs.ts';
import { fmtCache, formatOffset, initialsAbbr, compactGmt, readZoneSample, WALL_CLOCK_FIELDS, type ZoneSample } from '../shared/fmt.ts';
import {
  ruleInstant,
  resolveClass,
  type ScheduleClass,
  type ZoneState,
  type Rule,
  type HistoryClass,
  type HistoryEra,
} from '../shared/rules.ts';

const YEAR = new Date().getUTCFullYear();
const YEARS = [YEAR, YEAR + 1, YEAR + 2];
const YEAR_START = Date.UTC(YEAR, 0, 1);
const STEP_MS = 900_000; // 15 min
const STEPS_PER_DAY = 96;

// What a generation pass cost. Both table sets report it, and both are timed
// the same way, so the shape and the measurement live together.
export interface ProbeStats {
  probeMs: number;
  probeStrategy: 'temporal' | 'stride'; // which probe this runtime used
  probedZoneYears: number; // zone-years probed this run
}

const probeStats = (t0: number, probedZoneYears: number): ProbeStats => ({
  probeMs: Date.now() - t0,
  probeStrategy: PROBE_STRATEGY,
  probedZoneYears,
});

export interface GeneratedTables {
  year: number;
  years: number[];
  yearStart: number;
  stepMs: number;
  classGroups: string[][];
  scheduleClasses: ScheduleClass[];
  stats: {
    zones: number;
    sigClasses: number;
    groups: number;
    grouped: number;
    schedClasses: number;
    staticClasses: number;
    ruleClasses: number;
    irregularClasses: number;
    irregularZones: number;
  } & ProbeStats;
}

export interface Mismatch {
  kind: 'class-group' | 'schedule';
  zone: string;
  ts: number;
  expected: string;
  got: string;
}

export interface Verification {
  instants: number;
  checks: number;
  mismatches: Mismatch[];
}

const partsFmt = fmtCache(WALL_CLOCK_FIELDS);

// reused across the millions of probes a full generation makes
const sample: ZoneSample = { longName: '', offMin: 0 };

// "longName|offsetMin" at a given instant. Shares its wall-clock reading with
// the shipped live path (shared/fmt.ts) so a probe and a runtime lookup of the
// same instant can't disagree. Every instant probed here is minute-aligned,
// hence no `second` in the formatter above.
function probe(zone: string, ts: number): string {
  readZoneSample(partsFmt(zone), ts, sample);

  return `${sample.longName}|${sample.offMin}`;
}

interface Seg {
  step: number; // 15-min steps since the year's Jan 1 00:00 UTC
  atMs: number; // the transition instant itself, to the minute (see refineToMinute)
  longName: string;
  offsetMin: number;
}

// ---- probing a zone-year ----
//
// Two strategies produce the same Seg[]; they differ only in WHERE they
// sample. Turning "something changed between these two samples" into exact
// 15-minute edges is shared (scanAt), because BOTH need it: a stride window
// can hold several changes, and so can the span between two offset
// transitions — CLDR renames zones without moving their offset, and the
// signature carries the name.
//
// Temporal (Chrome, Firefox, official node >= 26) reports exact transition
// instants, so it needs no stride at all. Everywhere else (bun, Safari, node
// built without the Temporal component) falls back to the linear scan.
// tools/probe-equiv.ts asserts the two agree.
// bound once, so callers narrow it at the call site and pass it in rather
// than re-asserting the global on every zone-year
type TemporalApi = NonNullable<typeof Temporal>;

const temporal: TemporalApi | null = typeof Temporal === 'undefined' ? null : Temporal;

const PROBE_STRATEGY: 'temporal' | 'stride' = temporal !== null ? 'temporal' : 'stride';

// Fallback strides. scanAt() resolves any number of changes between two
// samples, so a stride does NOT have to be narrow enough to isolate them —
// only narrow enough that a window never changes and RETURNS to the same
// value, which no sampling can see. tools/tz-transition-gap.ts measures
// exactly that window, over this runtime's own data rather than a bundled
// tzdata copy: 6.96d for signatures across 1995-2028 (America/Boa_Vista's
// one-week DST blip in Oct 2000, which is also the offset-only bound), so six
// days clears it by 1.2x. Note the margin is thin by construction — a shorter
// DST experiment anywhere would tighten it, which is why the tool asserts.
export const SCHEDULE_STRIDE_DAYS = 6;
export const HISTORY_STRIDE_DAYS = 6;

const toSeg = (step: number, atMs: number, key: string): Seg => {
  const cut = key.lastIndexOf('|');
  return { step, atMs, longName: key.slice(0, cut), offsetMin: +key.slice(cut + 1) };
};

const MINUTE_MS = 60_000;

// Narrows a change already bracketed to one 15-minute window down to the exact
// minute: `lo` still holds `from` and `hi` does not, so the transition is the
// first minute-aligned instant in (lo, hi] that differs.
//
// The step grid stays 15 minutes because that is what the raw/irregular
// encodings store, but a RULE's atMin is a minutes field, so rounding a
// transition up to the grid is a straight loss — America/Goose_Bay,
// America/Moncton and America/St_Johns switched at 00:01 local until 2011 (as
// did Antarctica/Casey in 2020-22) and were being fitted as 00:15, leaving the
// baked answer 14 minutes stale twice a year. Costs one probe per change in
// virtually every case — see the fast path below.
//
// Assumes the window holds ONE change, the same assumption scanAt already makes
// at step granularity. tools/tz-transition-gap.ts measures the headroom: the
// tightest gap between consecutive signature changes is 1h (Asia/Chita 2014),
// well clear of 15 minutes.
function refineToMinute(zone: string, from: string, lo: number, hi: number): number {
  // Fast path. Virtually every transition lands ON the step boundary —
  // tz-transition-gap counts only 96 that miss it across the whole window — so
  // the change is almost always inside the window's final minute. One probe
  // settles that, where the bisection below costs four; a miss still narrows the
  // window by a minute, so it is never wasted.
  if (hi - lo > MINUTE_MS) {
    const last = hi - MINUTE_MS;

    if (probe(zone, last) === from) return hi;

    hi = last;
  }

  while (hi - lo > MINUTE_MS) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;

    if (mid <= lo) break;

    if (probe(zone, mid) === from) lo = mid;
    else hi = mid;
  }

  return hi;
}

// stride samples, plus the year's final step — a transition in the last hours
// of Dec 31 (e.g. Kosrae's +12 -> +11 at local midnight 1999-01-01, mid-day
// Dec 31 UTC) would otherwise fall between the last sample and the year end
const strideCheckpoints = (lastStep: number, strideDays: number): number[] =>
  strideSteps(lastStep, STEPS_PER_DAY * strideDays);

// every offset transition Temporal reports inside the year, each paired with
// the step before it. The pair brackets the transition tightly enough that
// scanAt's search settles immediately; the gap from one pair to the next
// brackets the offset-constant span between them, which is where a name-only
// change hides (America/Cambridge_Bay's CDT -> EST flip in Oct 2000, and 67
// others between 1995 and 2028).
function temporalCheckpoints(
  api: TemporalApi,
  zone: string,
  start: number,
  end: number,
  lastStep: number
): number[] {
  const out: number[] = [];
  let zdt = api.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(zone);

  for (;;) {
    const next = zdt.getTimeZoneTransition('next');

    if (next === null || next.epochMilliseconds >= end) break;

    const step = Math.ceil((next.epochMilliseconds - start) / STEP_MS);

    if (step > 0 && step <= lastStep) out.push(step - 1, step);

    zdt = next;
  }

  out.push(lastStep);

  return out;
}

// Samples `zone` at each checkpoint (ascending 15-min step indices, ending at
// the year's last step) and resolves every signature change between
// consecutive samples to its exact step, then times each one to the minute.
// scanChanges() owns the walk; see tools/step-scan.ts for why the outer loop
// has to re-read the value at each resolved step.
function scanAt(zone: string, start: number, checkpoints: number[]): Seg[] {
  const segs: Seg[] = [];

  scanChanges(
    (step) => probe(zone, start + step * STEP_MS),
    checkpoints,
    (step, from, to) => {
      // the bisection always closes to one step, so the change sits in the
      // single step ending at `step` — narrow enough to time to the minute
      const atMs = refineToMinute(zone, from, start + (step - 1) * STEP_MS, start + step * STEP_MS);

      segs.push(toSeg(step, atMs, to));
    },
    (open) => segs.push(toSeg(0, start, open))
  );

  return segs;
}

function signature(zone: string, start: number, end: number, strideDays: number): Seg[] {
  const lastStep = (end - start) / STEP_MS - 1;

  return scanAt(
    zone,
    start,
    temporal !== null
      ? temporalCheckpoints(temporal, zone, start, end, lastStep)
      : strideCheckpoints(lastStep, strideDays)
  );
}

// ---- strategy equivalence (tools/probe-equiv.ts) ----
//
// Which strategy a table was built with depends on whether its generating
// runtime provided Temporal. Both are meant to describe the same tzdata, so a
// disagreement means one is wrong — most likely a stride that steps over a
// transition. This measures that on any runtime that has both APIs.

export interface StrategyDiff {
  key: string; // "zone|year"
  temporal: string;
  stride: string;
}

export interface StrategyComparison {
  available: boolean; // false without Temporal: nothing to compare against
  zoneYears: number;
  diffs: StrategyDiff[];
  temporalMs: number;
  strideMs: number;
  strideDays: number;
}

export function compareProbeStrategies(
  fromYear: number,
  toYear: number,
  strideDays: number = SCHEDULE_STRIDE_DAYS
): StrategyComparison {
  if (temporal === null) {
    return { available: false, zoneYears: 0, diffs: [], temporalMs: 0, strideMs: 0, strideDays };
  }

  const api = temporal;

  const sig = (zone: string, y: number, useTemporal: boolean): string => {
    const start = Date.UTC(y, 0, 1);
    const end = Date.UTC(y + 1, 0, 1);
    const lastStep = (end - start) / STEP_MS - 1;

    return encodeSig(
      scanAt(
        zone,
        start,
        useTemporal
          ? temporalCheckpoints(api, zone, start, end, lastStep)
          : strideCheckpoints(lastStep, strideDays)
      )
    );
  };

  const run = (useTemporal: boolean): [Record<string, string>, number] => {
    const t0 = Date.now();
    const out: Record<string, string> = {};

    for (const zone of zones) {
      for (let y = fromYear; y <= toYear; y++) out[`${zone}|${y}`] = sig(zone, y, useTemporal);
    }

    return [out, Date.now() - t0];
  };

  const [byTemporal, temporalMs] = run(true);
  const [byStride, strideMs] = run(false);
  const diffs: StrategyDiff[] = [];

  for (const key in byTemporal) {
    if (byTemporal[key] !== byStride[key]) {
      diffs.push({ key, temporal: byTemporal[key]!, stride: byStride[key]! });
    }
  }

  return {
    available: true,
    zoneYears: Object.keys(byTemporal).length,
    diffs,
    temporalMs,
    strideMs,
    strideDays,
  };
}

// ---- transition spacing (tools/tz-transition-gap.ts) ----
//
// How close together do two consecutive changes ever get? A sampling window
// narrower than the tightest gap holds at most one change, and one change
// necessarily changes the value — which is what lets a probe pair prove the
// span between it is quiet. Two views of the runtime data are reported:
//
// - OFFSET transitions provide an exact Temporal-based transition and off-grid
//   census.
// - SIGNATURE changes — the (CLDR long name, offset) pair scanAt() actually
//   tracks — bound the fallback stride above. This is the stricter of the two
//   and the one the stride genuinely needs: CLDR renames zones without moving
//   their offset, so a name-only change is invisible to an offset-only bound.
//
// Both come off the runtime being measured rather than a bundled tzdata copy,
// which is the point: the stride has to be safe against the ICU the tables are
// generated from, and only that runtime knows where its own CLDR names move.
//
// Needs Temporal to enumerate offset transitions, so this is a Chrome-hosted
// measurement. The signature scan inherits scanAt's one assumption — a span
// that changes and RETURNS to its starting value is invisible to any sampling
// — so what it reports is the tightest gap between VISIBLE changes.

export interface GapEra {
  label: string;
  changes: number;
  gapMs: number; // tightest gap between consecutive changes
  gapWhere: string;
  returnMs: number; // tightest window that changes and RETURNS to its opening value
  returnWhere: string;
  offGrid: number; // changes not landing on a STEP_MS boundary
}

export interface GapMeasurement {
  available: boolean; // false without Temporal: offset transitions unavailable
  zones: number;
  fromYear: number;
  toYear: number;
  offsetEras: GapEra[];
  signature: GapEra;
  offsetMs: number;
  signatureMs: number;
}

// tzdata's earliest entries are 19th-century LMT departures and its latest are
// projected rules that just repeat, so no transition falls outside this span
const GAP_FROM = Date.UTC(1700, 0, 1);
const GAP_TO = Date.UTC(2200, 0, 1);

const GAP_ERAS: [label: string, from: number][] = [
  ['since 1700', GAP_FROM],
  ['since 1900', Date.UTC(1900, 0, 1)],
  ['since 1970', Date.UTC(1970, 0, 1)],
  ['since 2000', Date.UTC(2000, 0, 1)],
];

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// A zone as a run of constant-value segments: starts[i] is when segment i
// begins and vals[i] is what it holds. Index 0 is the opening state at the
// window start, not a change — every later index is one.
interface Segments {
  starts: number[];
  vals: string[];
}

// offset segments, from Temporal's exact transition instants
function offsetSegments(api: TemporalApi, zone: string): Segments {
  let zdt = api.Instant.fromEpochMilliseconds(GAP_FROM).toZonedDateTimeISO(zone);
  const starts = [GAP_FROM];
  const vals = [zdt.offset];

  for (;;) {
    const next = zdt.getTimeZoneTransition('next');

    if (next === null || next.epochMilliseconds >= GAP_TO) break;

    starts.push(next.epochMilliseconds);
    vals.push(next.offset);
    zdt = next;
  }

  return { starts, vals };
}

// (long name, offset) segments over [fromYear, toYear]. signature() re-reports
// each year's opening state as its first segment, so that one is folded into
// the previous year unless it actually differs — which is how a transition
// landing exactly on Jan 1 00:00 UTC gets counted exactly once.
function signatureSegments(zone: string, fromYear: number, toYear: number): Segments {
  const starts: number[] = [];
  const vals: string[] = [];

  for (let y = fromYear; y <= toYear; y++) {
    const start = Date.UTC(y, 0, 1);

    for (const s of signature(zone, start, Date.UTC(y + 1, 0, 1), SCHEDULE_STRIDE_DAYS)) {
      const key = `${s.longName}|${s.offsetMin}`;

      if (key === vals[vals.length - 1]) continue;

      starts.push(s.atMs);
      vals.push(key);
    }
  }

  return { starts, vals };
}

// Restricts `seg` to instants at or after `from`, carrying the value in force
// at `from` as the new opening segment.
function clip({ starts, vals }: Segments, from: number): Segments {
  if (from <= starts[0]!) return { starts, vals };

  let i = 0;
  while (i < starts.length && starts[i]! < from) i++;

  return { starts: [from, ...starts.slice(i)], vals: [vals[i - 1]!, ...vals.slice(i)] };
}

// The two spacing bounds, over every zone.
//
// `gapMs` is the tightest gap between consecutive changes — the conservative,
// easy-to-state number, and a valid (if pessimistic) bound since departing and
// returning takes at least two changes.
//
// `returnMs` is what the samplers actually need: the shortest window that
// changes and comes back to the value it started on, which is the only pattern
// no sampling can detect. A window [a,b] is unsafe exactly when a and b sit in
// two same-valued segments p < q with something different between, and the
// shortest such window shrinks to starts[q] - starts[p+1]. So for each segment
// q, the binding partner is the NEAREST earlier segment holding the same value,
// at least two back — tracked in `seen`, which is only allowed to know about
// indices up to q-2.
function eraGap(byZone: [zone: string, seg: Segments][], label: string, from: number): GapEra {
  let gapMs = Infinity;
  let gapWhere = '';
  let returnMs = Infinity;
  let returnWhere = '';
  let changes = 0;
  let offGrid = 0;

  for (const [zone, full] of byZone) {
    const { starts, vals } = clip(full, from);
    const seen = new Map<string, number>();

    for (let q = 1; q < starts.length; q++) {
      changes++;
      if (starts[q]! % STEP_MS !== 0) offGrid++;

      if (starts[q]! - starts[q - 1]! < gapMs) {
        gapMs = starts[q]! - starts[q - 1]!;
        gapWhere = `${zone} ${isoDay(starts[q - 1]!)} -> ${isoDay(starts[q]!)}`;
      }

      if (q < 2) continue;

      seen.set(vals[q - 2]!, q - 2);

      const p = seen.get(vals[q]!);

      if (p != null && starts[q]! - starts[p + 1]! < returnMs) {
        returnMs = starts[q]! - starts[p + 1]!;
        returnWhere = `${zone} ${isoDay(starts[p + 1]!)} -> ${isoDay(starts[q]!)} (${vals[q]})`;
      }
    }
  }

  return { label, changes, gapMs, gapWhere, returnMs, returnWhere, offGrid };
}

export function measureTransitionGaps(fromYear: number, toYear: number): GapMeasurement {
  if (temporal === null) {
    return {
      available: false,
      zones: zones.length,
      fromYear,
      toYear,
      offsetEras: [],
      signature: { label: '', changes: 0, gapMs: Infinity, gapWhere: '', returnMs: Infinity, returnWhere: '', offGrid: 0 },
      offsetMs: 0,
      signatureMs: 0,
    };
  }

  const api = temporal;

  const t0 = Date.now();
  const byOffset = zones.map((z): [string, Segments] => [z, offsetSegments(api, z)]);
  const offsetMs = Date.now() - t0;

  const t1 = Date.now();
  const bySignature = zones.map((z): [string, Segments] => [z, signatureSegments(z, fromYear, toYear)]);
  const signatureMs = Date.now() - t1;

  return {
    available: true,
    zones: zones.length,
    fromYear,
    toYear,
    offsetEras: GAP_ERAS.map(([label, from]) => eraGap(byOffset, label, from)),
    signature: eraGap(bySignature, `${fromYear}-${toYear}`, -Infinity),
    offsetMs,
    signatureMs,
  };
}

const resolveAbbr = (longName: string): string =>
  abbrOverrides[longName] ?? initialsAbbr(longName) ?? compactGmt(longName);

interface EffSeg {
  step: number;
  atMs: number;
  abbr: string;
  offMin: number;
}

// effective (abbr, offset) segments for a zone in one probed year, applying
// the curated alias/override pipeline and merging identical-output segments
function effectiveSegs(rawByZone: Map<string, Seg[]>, zone: string): EffSeg[] {
  const base = rawByZone.get(zoneAliases[zone] ?? zone)!;
  const out: EffSeg[] = [];

  for (const s of base) {
    const abbr = zoneAbbrOverrides[zone] ?? resolveAbbr(s.longName);
    const last = out[out.length - 1];

    if (last == null || last.abbr !== abbr || last.offMin !== s.offsetMin) {
      out.push({ step: s.step, atMs: s.atMs, abbr, offMin: s.offsetMin });
    }
  }

  return out;
}

const stateKey = (s: ZoneState) => `${s.abbr}|${s.offMin}`;
const sameState = (a: { abbr: string; offMin: number }, b: { abbr: string; offMin: number }) =>
  a.abbr === b.abbr && a.offMin === b.offMin;

// candidate nth encodings for a transition landing on `day` of `month`
function nthCandidates(year: number, month: number, day: number): number[] {
  const cands = [Math.floor((day - 1) / 7) + 1];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (day + 7 > daysInMonth && !cands.includes(5)) cands.push(5);

  return cands;
}

// fit one transition (index ti: 1 or 2 within the 3-segment year) across all
// probed years to an nth-weekday rule, or null
function fitRule(perYear: EffSeg[][], years: number[], ti: number, to: 0 | 1): Rule | null {
  let month = -1, dow = -1, atMin = -1;
  let nthSet: Set<number> | null = null;

  for (let yi = 0; yi < years.length; yi++) {
    const seg = perYear[yi]![ti]!;
    const before = perYear[yi]![ti - 1]!;
    const wall = new Date(seg.atMs + before.offMin * 60_000);
    const m = wall.getUTCMonth() + 1;
    const d = wall.getUTCDay();
    const at = wall.getUTCHours() * 60 + wall.getUTCMinutes();

    if (yi === 0) {
      month = m;
      dow = d;
      atMin = at;
    } else if (m !== month || d !== dow || at !== atMin) {
      return null;
    }

    const cands = new Set(nthCandidates(years[yi]!, m, wall.getUTCDate()));

    if (nthSet === null) {
      nthSet = cands;
    } else {
      const prev: Set<number> = nthSet;
      nthSet = new Set([...prev].filter((n) => cands.has(n)));
    }

    if (nthSet.size === 0) return null;
  }

  // prefer 'last' — the most common convention when both encodings fit
  const nth = nthSet!.has(5) ? 5 : [...nthSet!][0]!;

  return { month, nth, dow, atMin, to };
}

export function generateTables(): GeneratedTables {
  const t0 = Date.now();
  let probedZoneYears = 0;

  // ---- probe all zones across all years ----
  const rawByYear: Map<string, Seg[]>[] = YEARS.map((y) => {
    const start = Date.UTC(y, 0, 1);
    const end = Date.UTC(y + 1, 0, 1);
    const m = new Map<string, Seg[]>();

    for (const zone of zones) {
      m.set(zone, signature(zone, start, end, SCHEDULE_STRIDE_DAYS));
      probedZoneYears++;
    }

    return m;
  });

  // ---- classGroups: current-year (longName, offset) behavior classes ----
  const bySig = new Map<string, string[]>();

  for (const zone of zones) {
    const sig = rawByYear[0]!.get(zone)!.map((s) => `${s.step}:${s.longName}|${s.offsetMin}`).join(';');
    const group = bySig.get(sig);

    if (group == null) bySig.set(sig, [zone]);
    else group.push(zone);
  }

  const classGroups = [...bySig.values()]
    .filter((g) => g.length > 1)
    .sort((a, b) => (a[0]! < b[0]! ? -1 : 1));

  // ---- schedule: fit static / rule / irregular per zone, group identical ----
  const byKey = new Map<string, ScheduleClass>();
  let staticClasses = 0, ruleClasses = 0, irregularClasses = 0, irregularZones = 0;

  for (const zone of zones) {
    const perYear = YEARS.map((_, yi) => effectiveSegs(rawByYear[yi]!, zone));

    let make: () => ScheduleClass;
    let key: string;

    if (perYear.every((s) => s.length === 1 && sameState(s[0]!, perYear[0]![0]!))) {
      const st: ZoneState = { abbr: perYear[0]![0]!.abbr, offMin: perYear[0]![0]!.offMin };

      make = () => ({ zones: [zone], kind: 0, states: [st] });
      key = `S~${stateKey(st)}`;
    } else {
      const a = perYear[0]![0]!;
      const b = perYear[0]![1];
      const cyclic =
        b != null &&
        perYear.every(
          (s) => s.length === 3 && sameState(s[0]!, a) && sameState(s[1]!, b) && sameState(s[2]!, a)
        );

      const r1 = cyclic ? fitRule(perYear, YEARS, 1, 1) : null;
      const r2 = r1 !== null ? fitRule(perYear, YEARS, 2, 0) : null;

      if (r1 !== null && r2 !== null && r1.month !== r2.month) {
        const states: [ZoneState, ZoneState] = [
          { abbr: a.abbr, offMin: a.offMin },
          { abbr: b!.abbr, offMin: b!.offMin },
        ];
        const rules: [Rule, Rule] = r1.month < r2.month ? [r1, r2] : [r2, r1];

        make = () => ({ zones: [zone], kind: 1, states, rules });
        key = `R~${stateKey(states[0])}~${stateKey(states[1])}~${rules.map((r) => `${r.month},${r.nth},${r.dow},${r.atMin},${r.to}`).join('~')}`;
      } else {
        // irregular: current-year segments only
        const segs = perYear[0]!;

        make = () => ({
          zones: [zone],
          kind: 2,
          starts: segs.map((s) => s.step),
          abbrs: segs.map((s) => s.abbr),
          offMins: segs.map((s) => s.offMin),
        });
        key = `I~${segs.map((s) => `${s.step}:${s.abbr}|${s.offMin}`).join(';')}`;
      }
    }

    const existing = byKey.get(key);

    if (existing != null) existing.zones.push(zone);
    else byKey.set(key, make());
  }

  const scheduleClasses = [...byKey.values()].sort((a, b) => (a.zones[0]! < b.zones[0]! ? -1 : 1));

  for (const c of scheduleClasses) {
    if (c.kind === 0) staticClasses++;
    else if (c.kind === 1) ruleClasses++;
    else {
      irregularClasses++;
      irregularZones += c.zones.length;
    }
  }

  return {
    year: YEAR,
    years: YEARS,
    yearStart: YEAR_START,
    stepMs: STEP_MS,
    classGroups,
    scheduleClasses,
    stats: {
      zones: zones.length,
      sigClasses: bySig.size,
      groups: classGroups.length,
      grouped: classGroups.reduce((n, g) => n + g.length, 0),
      schedClasses: scheduleClasses.length,
      staticClasses,
      ruleClasses,
      irregularClasses,
      irregularZones,
      ...probeStats(t0, probedZoneYears),
    },
  };
}

// ---- historical eras (sidecar history tables; see shared/rules.ts) ----
//
// Probes each non-irregular zone year by year from HISTORY_FROM up to the
// bake year and compresses the observed offset behavior into eras: static
// spans, two-rule DST spans (merged across consecutive years while the
// fitted rules agree, with nth-encoding ambiguity resolved by candidate-set
// intersection like fitRule), and raw single years (explicit segments) for
// anything else — mid-year regime changes, rule-less offset moves, and
// years that fit no Gregorian rule. Rule years reproduce their observed
// transition instants exactly by construction (month/dow/atMin come from
// the probed instant; the nth candidate set maps back to the same day), so
// the result matches this runtime's ICU to the minute. Raw years keep 15-min
// steps, which is the one place an off-grid transition (Asia/Gaza 2010-11)
// still rounds. The end-to-end check is tools/sweep-validity.ts.

export const HISTORY_FROM = 1995; // matches the sweep's default range

export interface GeneratedHistory {
  fromYear: number;
  toYear: number; // exclusive: the bake year, where the main schedule takes over
  classes: HistoryClass[];
  // Every instant in the window where this runtime's "longName|offset" changed,
  // per zone, as 15-min steps from Jan 1 of fromYear (each year's step 0
  // included, changed or not). A by-product of the probe above, kept because
  // it saves tools/abbrfix-core.ts from rediscovering the same transitions with
  // its own scan — see that file's `boundaries` parameter.
  boundaries: Record<string, number[]>;
  stats: {
    zones: number;
    coveredZones: number; // schedule reproduces their whole history; no class stored
    classes: number;
    staticEras: number;
    ruleEras: number;
    rawYears: number;
    deferEras: number;
  } & ProbeStats;
}

interface TransFit {
  month: number;
  dow: number;
  atMin: number;
  nths: number[]; // candidate nth encodings, primary first
}

interface YearFit {
  year: number;
  kind: 0 | 1 | 2;
  offs: number[];
  trans: [TransFit, TransFit] | null; // kind 1
  steps: number[] | null; // kind 2
}

export interface OffSeg {
  step: number;
  atMs: number;
  off: number;
}

// offset-only view of a probed zone-year (name-only changes merged away)
function toOffSegs(segs: Seg[]): OffSeg[] {
  const out: OffSeg[] = [];

  for (const s of segs) {
    if (out.length === 0 || out[out.length - 1]!.off !== s.offsetMin) {
      out.push({ step: s.step, atMs: s.atMs, off: s.offsetMin });
    }
  }

  return out;
}

// schedule segments carry the CLDR long name (free text: spaces, digits, ':'
// as in "GMT-05:00"), so put it LAST and slice off the two leading numeric
// fields by index; segments join on ';', which long names never contain
const encodeSig = (segs: Seg[]): string =>
  segs
    .map((s) => {
      if (s.longName.includes(';')) throw new Error(`';' in zone long name: ${s.longName}`);

      return `${s.step}:${s.offsetMin}:${s.longName}`;
    })
    .join(';');

// does the zone's SCHEDULE class reproduce this observed year exactly (same
// offsets, transitions at the same instants)? Such years need no history
// storage — a defer era points the resolver at the schedule. Compared against
// the observed atMs, so a rule whose atMin came off a grid-snapped step could
// not pass this by matching its own rounding.
function matchesSchedule(cls: ScheduleClass, year: number, segs: OffSeg[]): boolean {
  if (cls.kind === 0) return segs.length === 1 && segs[0]!.off === cls.states[0].offMin;

  if (cls.kind !== 1) return false; // irregular zones are excluded anyway

  if (segs.length !== 3) return false;

  const [r1, r2] = cls.rules;
  const before = cls.states[r2.to].offMin; // state outside the two transitions
  const mid = cls.states[r1.to].offMin;

  return (
    segs[0]!.off === before &&
    segs[1]!.off === mid &&
    segs[2]!.off === before &&
    ruleInstant(year, r1, cls.states[1 - r1.to]!.offMin) === segs[1]!.atMs &&
    ruleInstant(year, r2, cls.states[1 - r2.to]!.offMin) === segs[2]!.atMs
  );
}

function fitYearOffsets(year: number, segs: OffSeg[]): YearFit {
  if (segs.length === 1) return { year, kind: 0, offs: [segs[0]!.off], trans: null, steps: null };

  if (segs.length === 3 && segs[0]!.off === segs[2]!.off) {
    const fit = (si: 1 | 2): TransFit => {
      const wall = new Date(segs[si]!.atMs + segs[si - 1]!.off * 60_000);
      const month = wall.getUTCMonth() + 1;

      return {
        month,
        dow: wall.getUTCDay(),
        atMin: wall.getUTCHours() * 60 + wall.getUTCMinutes(),
        nths: nthCandidates(year, month, wall.getUTCDate()),
      };
    };

    const t1 = fit(1);
    const t2 = fit(2);

    // transitions are time-ordered, so a rule-expressible year needs
    // strictly increasing wall months: equality is a same-month double
    // transition (religious-calendar shapes), and inversion means a wall
    // time that wrapped across a year boundary (e.g. Dhaka's 2009 DST end
    // at Dec 31 24:00 local, which is Jan 1 of the NEXT year in wall terms
    // and thus not expressible as a rule of THIS year)
    if (t1.month < t2.month) {
      return { year, kind: 1, offs: [segs[0]!.off, segs[1]!.off], trans: [t1, t2], steps: null };
    }
  }

  return { year, kind: 2, offs: segs.map((s) => s.off), trans: null, steps: segs.map((s) => s.step) };
}

const sameOffs = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// merge f into the open rule run if every fitted transition still agrees on
// (month, dow, atMin) and the nth candidate sets keep a nonempty intersection
function mergeTrans(run: [TransFit, TransFit], f: [TransFit, TransFit]): boolean {
  const merged: TransFit[] = [];

  for (let i = 0; i < 2; i++) {
    const a = run[i]!;
    const b = f[i]!;

    if (a.month !== b.month || a.dow !== b.dow || a.atMin !== b.atMin) return false;

    const nths = a.nths.filter((n) => b.nths.includes(n));

    if (nths.length === 0) return false;

    merged.push({ ...a, nths });
  }

  run[0] = merged[0]!;
  run[1] = merged[1]!;

  return true;
}

// eras for one zone, or null when the schedule class reproduces EVERY year
// (the zone then needs no history class at all). Years the schedule gets
// right become defer eras (kind 3) instead of stored data.
function buildEras(
  cls: ScheduleClass,
  fromYear: number,
  toYear: number,
  segsOf: (year: number) => OffSeg[]
): HistoryEra[] | null {
  const eras: HistoryEra[] = [];
  let run: YearFit | null = null; // open static/rule span
  let deferFrom = -1; // open defer span
  let stored = false; // any non-defer era emitted?

  const finalize = (): void => {
    if (run === null) return;

    if (run.kind === 0) {
      eras.push({ fromYear: run.year, kind: 0, offs: run.offs, rules: null, steps: null });
    } else {
      // 'last dow' is the more common convention when both encodings fit
      const rule = (t: TransFit, to: 0 | 1): Rule => ({
        month: t.month,
        nth: t.nths.includes(5) ? 5 : t.nths[0]!,
        dow: t.dow,
        atMin: t.atMin,
        to,
      });

      // transitions are time-ordered within the year, so month order matches
      // the sorted-by-month order resolveHistory expects
      eras.push({
        fromYear: run.year,
        kind: 1,
        offs: run.offs,
        rules: [rule(run.trans![0], 1), rule(run.trans![1], 0)],
        steps: null,
      });
    }

    run = null;
  };

  const closeDefer = (): void => {
    if (deferFrom !== -1) {
      eras.push({ fromYear: deferFrom, kind: 3, offs: [], rules: null, steps: null });
      deferFrom = -1;
    }
  };

  for (let year = fromYear; year < toYear; year++) {
    const segs = segsOf(year);

    if (matchesSchedule(cls, year, segs)) {
      finalize();
      if (deferFrom === -1) deferFrom = year;
      continue;
    }

    closeDefer();
    stored = true;

    const f = fitYearOffsets(year, segs);

    if (f.kind === 2) {
      finalize();
      eras.push({ fromYear: year, kind: 2, offs: f.offs, rules: null, steps: f.steps });
      continue;
    }

    if (run !== null && run.kind === f.kind && sameOffs(run.offs, f.offs)) {
      if (f.kind === 0) continue; // static span extends
      if (mergeTrans(run.trans!, f.trans!)) continue; // rule span extends
    }

    finalize();
    run = f;
  }

  finalize();
  closeDefer(); // a trailing defer era is load-bearing: without it, clamping would extend the last stored era

  return stored ? eras : null;
}

export function generateHistory(tables: GeneratedTables, fromYear: number = HISTORY_FROM): GeneratedHistory {
  const t0 = Date.now();
  const toYear = tables.year;

  // within-run memos only: a zone-year is visited more than once (era fitting
  // revisits boundary years), and probing is the expensive part. The full
  // segments are kept alongside the offset-only view the eras are fitted from,
  // because the name changes they carry are what `boundaries` reports.
  const probedSegs = new Map<string, Seg[]>();
  const offSegs = new Map<string, OffSeg[]>();
  let probedZoneYears = 0;

  const fullSegsOf = (zone: string, year: number): Seg[] => {
    const key = `${zone}|${year}`;
    const have = probedSegs.get(key);

    if (have != null) return have;

    const segs = signature(zone, Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1), HISTORY_STRIDE_DAYS);

    probedZoneYears++;
    probedSegs.set(key, segs);

    return segs;
  };

  const segsOf = (zone: string, year: number): OffSeg[] => {
    const key = `${zone}|${year}`;
    const have = offSegs.get(key);

    if (have != null) return have;

    const segs = toOffSegs(fullSegsOf(zone, year));

    offSegs.set(key, segs);

    return segs;
  };

  // the irregular-class zones are excluded: their behavior isn't
  // rule-expressible in ANY year, so history would be 31 raw years each
  const irregular = new Set<string>();
  const classOf = new Map<string, ScheduleClass>();

  for (const c of tables.scheduleClasses) {
    for (const z of c.zones) {
      if (c.kind === 2) irregular.add(z);
      else classOf.set(z, c);
    }
  }

  const byKey = new Map<string, HistoryClass>();
  let zoneCount = 0;
  let coveredZones = 0;

  for (const zone of zones) {
    if (irregular.has(zone)) continue;

    zoneCount++;

    const eras = buildEras(classOf.get(zone)!, fromYear, toYear, (y) => segsOf(zone, y));

    if (eras === null) {
      coveredZones++;
      continue;
    }

    const key = eras
      .map((e) => `${e.fromYear}${e.kind}~${e.offs.join(',')}~${e.rules?.map((r) => `${r.month},${r.nth},${r.dow},${r.atMin},${r.to}`).join('~') ?? ''}~${e.steps?.join(',') ?? ''}`)
      .join(';');

    const existing = byKey.get(key);

    if (existing != null) existing.zones.push(zone);
    else byKey.set(key, { zones: [zone], eras });
  }

  const classes = [...byKey.values()].sort((a, b) => (a.zones[0]! < b.zones[0]! ? -1 : 1));

  // rebased onto the window: every zone-year above is already memoized, so this
  // re-reads the probe rather than repeating it
  const epoch = Date.UTC(fromYear, 0, 1);
  const boundaries: Record<string, number[]> = {};

  for (const zone of zones) {
    if (irregular.has(zone)) continue;

    const steps: number[] = [];

    for (let year = fromYear; year < toYear; year++) {
      const base = (Date.UTC(year, 0, 1) - epoch) / STEP_MS;

      for (const s of fullSegsOf(zone, year)) steps.push(base + s.step);
    }

    boundaries[zone] = steps;
  }

  let staticEras = 0, ruleEras = 0, rawYears = 0, deferEras = 0;

  for (const c of classes) {
    for (const e of c.eras) {
      if (e.kind === 0) staticEras++;
      else if (e.kind === 1) ruleEras++;
      else if (e.kind === 2) rawYears++;
      else deferEras++;
    }
  }

  return {
    fromYear,
    toYear,
    classes,
    boundaries,
    stats: {
      zones: zoneCount,
      coveredZones,
      classes: classes.length,
      staticEras,
      ruleEras,
      rawYears,
      deferEras,
      ...probeStats(t0, probedZoneYears),
    },
  };
}

// Replays the fitted schedule through the shipped resolver and compares it
// against live Intl for every zone at semi-monthly instants plus every
// transition edge, across ALL probed years (irregular classes: current year
// only — beyond it they clamp by design).
export function verifyTables(tables: GeneratedTables): Verification {
  const scheduleOf = new Map<string, ScheduleClass>();

  for (const c of tables.scheduleClasses) {
    for (const z of c.zones) scheduleOf.set(z, c);
  }

  const instantsByYear = new Map<number, Set<number>>();

  for (const y of tables.years) {
    const set = new Set<number>();

    for (let m = 0; m < 12; m++) {
      for (const d of [1, 15]) {
        set.add(Date.UTC(y, m, d, 0));
        set.add(Date.UTC(y, m, d, 12));
      }
    }

    for (const c of tables.scheduleClasses) {
      if (c.kind === 1) {
        for (const r of c.rules) {
          const t = ruleInstant(y, r, c.states[1 - r.to]!.offMin);
          set.add(t);
          set.add(t - tables.stepMs);
        }
      } else if (c.kind === 2 && y === tables.year) {
        for (const step of c.starts) {
          if (step > 0) {
            set.add(tables.yearStart + step * tables.stepMs);
            set.add(tables.yearStart + (step - 1) * tables.stepMs);
          }
        }
      }
    }

    instantsByYear.set(y, set);
  }

  const mismatches: Mismatch[] = [];
  let checks = 0;
  let instantCount = 0;

  for (const [y, instants] of instantsByYear) {
    instantCount += instants.size;

    for (const ts of instants) {
      // class groups: verified for the generated year only (impl 08
      // re-verifies at runtime for whatever year it runs in)
      if (y === tables.year) {
        for (const group of tables.classGroups) {
          const repProbe = probe(group[0]!, ts);

          for (let i = 1; i < group.length; i++) {
            checks++;

            const memberProbe = probe(group[i]!, ts);

            if (memberProbe !== repProbe && mismatches.length < 20) {
              mismatches.push({ kind: 'class-group', zone: group[i]!, ts, expected: memberProbe, got: repProbe });
            }
          }
        }
      }

      for (const zone of zones) {
        const cls = scheduleOf.get(zone)!;

        if (cls.kind === 2 && y !== tables.year) continue; // clamps by design

        checks++;

        const target = zoneAliases[zone] ?? zone;
        const liveProbe = probe(target, ts);
        const cut = liveProbe.lastIndexOf('|');
        const liveAbbr = zoneAbbrOverrides[zone] ?? resolveAbbr(liveProbe.slice(0, cut));
        const liveOffMin = +liveProbe.slice(cut + 1);

        const st = resolveClass(cls, ts, tables.yearStart, tables.stepMs);

        if ((st.abbr !== liveAbbr || st.offMin !== liveOffMin) && mismatches.length < 20) {
          mismatches.push({
            kind: 'schedule',
            zone,
            ts,
            expected: `${liveAbbr} ${formatOffset(liveOffMin)}`,
            got: `${st.abbr} ${formatOffset(st.offMin)}`,
          });
        }
      }
    }
  }

  return { instants: instantCount, checks, mismatches };
}
