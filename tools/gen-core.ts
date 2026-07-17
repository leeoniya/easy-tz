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
// Method: per zone/year, daily samples; each detected change is refined to a
// 15-minute boundary by binary search (covers half-hour-offset zones like
// Lord Howe). Assumes at most one transition per 24h window, which holds for
// all real zones.

// probe the raw runtime enumeration, NOT the augmented public list: tables
// must reflect exactly what this runtime's ICU enumerates, and the canonical
// spellings added by shared/zones.ts are bridged at lookup time via
// zoneLinks (buildScheduleIndex) instead of being baked into every table
import { runtimeZones as zones } from '../shared/zones.ts';
import { abbrOverrides, zoneAliases, zoneAbbrOverrides } from '../shared/abbrs.ts';
import { fmtCache, formatOffsetMinutes, initialsAbbr, compactGmt } from '../shared/fmt.ts';
import { ruleInstant, resolveClass, type ScheduleClass, type ZoneState, type Rule } from '../shared/rules.ts';

const YEAR = new Date().getUTCFullYear();
const YEARS = [YEAR, YEAR + 1, YEAR + 2];
const YEAR_START = Date.UTC(YEAR, 0, 1);
const STEP_MS = 900_000; // 15 min
const STEPS_PER_DAY = 96;

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
    probeMs: number;
  };
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

const partsFmt = fmtCache({
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
  timeZoneName: 'long',
});

// "longName|offsetMin" at a given instant
function probe(zone: string, ts: number): string {
  let year = 0, month = 0, day = 0, hour = 0, minute = 0;
  let longName = '';

  for (const p of partsFmt(zone).formatToParts(ts)) {
    switch (p.type) {
      case 'year': year = +p.value; break;
      case 'month': month = +p.value; break;
      case 'day': day = +p.value; break;
      case 'hour': hour = +p.value; break;
      case 'minute': minute = +p.value; break;
      case 'timeZoneName': longName = p.value; break;
    }
  }

  const offsetMin = Math.round((Date.UTC(year, month - 1, day, hour, minute) - ts) / 60_000);

  return `${longName}|${offsetMin}`;
}

interface Seg {
  step: number; // 15-min steps since the year's Jan 1 00:00 UTC
  longName: string;
  offsetMin: number;
}

function signature(zone: string, start: number, end: number): Seg[] {
  const toSeg = (step: number, key: string): Seg => {
    const cut = key.lastIndexOf('|');
    return { step, longName: key.slice(0, cut), offsetMin: +key.slice(cut + 1) };
  };

  const totalSteps = (end - start) / STEP_MS;
  const segs: Seg[] = [];
  let prev = probe(zone, start);

  segs.push(toSeg(0, prev));

  for (let step = STEPS_PER_DAY; step < totalSteps; step += STEPS_PER_DAY) {
    const cur = probe(zone, start + step * STEP_MS);

    if (cur !== prev) {
      let lo = step - STEPS_PER_DAY; // probe(lo) === prev
      let hi = step; // probe(hi) === cur

      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (probe(zone, start + mid * STEP_MS) === prev) lo = mid;
        else hi = mid;
      }

      segs.push(toSeg(hi, cur));
      prev = cur;
    }
  }

  return segs;
}

const resolveAbbr = (longName: string): string =>
  abbrOverrides[longName] ?? initialsAbbr(longName) ?? compactGmt(longName);

interface EffSeg {
  step: number;
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

    if (last === undefined || last.abbr !== abbr || last.offMin !== s.offsetMin) {
      out.push({ step: s.step, abbr, offMin: s.offsetMin });
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
    const instant = Date.UTC(years[yi]!, 0, 1) + seg.step * STEP_MS;
    const wall = new Date(instant + before.offMin * 60_000);
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

  // ---- probe all zones across all years ----
  const rawByYear: Map<string, Seg[]>[] = YEARS.map((y) => {
    const start = Date.UTC(y, 0, 1);
    const end = Date.UTC(y + 1, 0, 1);
    const m = new Map<string, Seg[]>();

    for (const zone of zones) m.set(zone, signature(zone, start, end));

    return m;
  });

  // ---- classGroups: current-year (longName, offset) behavior classes ----
  const bySig = new Map<string, string[]>();

  for (const zone of zones) {
    const sig = rawByYear[0]!.get(zone)!.map((s) => `${s.step}:${s.longName}|${s.offsetMin}`).join(';');
    const group = bySig.get(sig);

    if (group === undefined) bySig.set(sig, [zone]);
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
        b !== undefined &&
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
        const rules = (r1.month < r2.month ? [r1, r2] : [r2, r1]) as [Rule, Rule];

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

    if (existing !== undefined) existing.zones.push(zone);
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
      probeMs: Date.now() - t0,
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
            expected: `${liveAbbr} ${formatOffsetMinutes(liveOffMin)}`,
            got: `${st.abbr} ${formatOffsetMinutes(st.offMin)}`,
          });
        }
      }
    }
  }

  return { instants: instantCount, checks, mismatches };
}
