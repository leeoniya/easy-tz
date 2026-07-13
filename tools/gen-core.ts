// Pure, browser-safe generator core: probes the runtime's Intl across the
// current year and produces the class groupings (impl 06) and the resolved
// year schedule (impl 07), plus an in-runtime verification pass that checks
// both tables against live Intl output. No filesystem or host APIs — this
// module is bundled and evaluated inside chrome-headless-shell by
// tools/gen-chrome.ts, and used directly by tools/gen-classes.ts under bun.
//
// Method: per zone, build a signature of (longName, offsetMin) segments over
// the year. Zones are sampled daily; each detected change is refined to a
// 15-minute boundary by binary search (covers half-hour-offset zones like
// Lord Howe). Assumes at most one transition per 24h window, which holds for
// all real zones.

import { zones } from '../shared/zones.ts';
import { abbrOverrides, zoneAliases, zoneAbbrOverrides } from '../shared/abbrs.ts';
import { fmtCache, formatOffsetMinutes, initialsAbbr, compactGmt } from '../shared/fmt.ts';

export const YEAR = new Date().getUTCFullYear();
export const YEAR_START = Date.UTC(YEAR, 0, 1);
const YEAR_END = Date.UTC(YEAR + 1, 0, 1);
export const STEP_MS = 900_000; // 15 min
const STEPS_PER_DAY = 96;
const TOTAL_STEPS = (YEAR_END - YEAR_START) / STEP_MS;

export interface ScheduleClass {
  zones: string[];
  starts: number[];
  abbrs: string[];
  offsets: string[];
}

export interface GeneratedTables {
  year: number;
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
    totalSegs: number;
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
  step: number; // 15-min steps since Jan 1 00:00 UTC
  longName: string;
  offsetMin: number;
}

function signature(zone: string): Seg[] {
  const toSeg = (step: number, key: string): Seg => {
    const cut = key.lastIndexOf('|');
    return { step, longName: key.slice(0, cut), offsetMin: +key.slice(cut + 1) };
  };

  const segs: Seg[] = [];
  let prev = probe(zone, YEAR_START);

  segs.push(toSeg(0, prev));

  for (let step = STEPS_PER_DAY; step < TOTAL_STEPS; step += STEPS_PER_DAY) {
    const cur = probe(zone, YEAR_START + step * STEP_MS);

    if (cur !== prev) {
      // binary search the first STEP where the probe changed
      let lo = step - STEPS_PER_DAY; // probe(lo) === prev
      let hi = step; // probe(hi) === cur

      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (probe(zone, YEAR_START + mid * STEP_MS) === prev) lo = mid;
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

export function generateTables(): GeneratedTables {
  const t0 = Date.now();

  const segsByZone = new Map<string, Seg[]>();
  const bySig = new Map<string, string[]>();

  for (const zone of zones) {
    const segs = signature(zone);

    segsByZone.set(zone, segs);

    const sig = segs.map((s) => `${s.step}:${s.longName}|${s.offsetMin}`).join(';');
    const group = bySig.get(sig);

    if (group === undefined) bySig.set(sig, [zone]);
    else group.push(zone);
  }

  // classGroups: only multi-member groups are useful; singletons format
  // themselves. zone lists are alphabetical, so group[0] is a stable rep.
  const classGroups = [...bySig.values()]
    .filter((g) => g.length > 1)
    .sort((a, b) => (a[0]! < b[0]! ? -1 : 1));

  // scheduleClasses: per zone, resolve effective (abbr, offset) segments via
  // the same pipeline as the runtime impls, then group identical schedules.
  // Zone-level abbr overrides (e.g. Istanbul -> TRT) split a zone out of its
  // behavior class here, since its output differs.
  const bySchedule = new Map<string, ScheduleClass>();

  for (const zone of zones) {
    const base = segsByZone.get(zoneAliases[zone] ?? zone)!;
    const starts: number[] = [];
    const abbrs: string[] = [];
    const offsets: string[] = [];

    for (const s of base) {
      const abbr = zoneAbbrOverrides[zone] ?? resolveAbbr(s.longName);
      const offset = formatOffsetMinutes(s.offsetMin);

      // merge segments whose resolved output is identical
      if (abbrs.length === 0 || abbrs[abbrs.length - 1] !== abbr || offsets[offsets.length - 1] !== offset) {
        starts.push(s.step);
        abbrs.push(abbr);
        offsets.push(offset);
      }
    }

    const key = starts.map((st, i) => `${st}:${abbrs[i]}|${offsets[i]}`).join(';');
    const entry = bySchedule.get(key);

    if (entry === undefined) bySchedule.set(key, { zones: [zone], starts, abbrs, offsets });
    else entry.zones.push(zone);
  }

  const scheduleClasses = [...bySchedule.values()].sort((a, b) => (a.zones[0]! < b.zones[0]! ? -1 : 1));

  return {
    year: YEAR,
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
      totalSegs: scheduleClasses.reduce((n, c) => n + c.starts.length, 0),
      probeMs: Date.now() - t0,
    },
  };
}

// Verifies both tables against this runtime's live Intl at semi-monthly
// instants plus one step before/at every schedule transition. Formatters are
// already cached from generation, so this is cheap (~40k format calls).
export function verifyTables(tables: GeneratedTables): Verification {
  const instants = new Set<number>();

  for (let m = 0; m < 12; m++) {
    for (const d of [1, 15]) {
      instants.add(Date.UTC(YEAR, m, d, 0));
      instants.add(Date.UTC(YEAR, m, d, 12));
    }
  }

  for (const c of tables.scheduleClasses) {
    for (const step of c.starts) {
      if (step > 0) {
        instants.add(YEAR_START + step * STEP_MS);
        instants.add(YEAR_START + (step - 1) * STEP_MS);
      }
    }
  }

  const mismatches: Mismatch[] = [];
  let checks = 0;

  const scheduleOf = new Map<string, ScheduleClass>();

  for (const c of tables.scheduleClasses) {
    for (const z of c.zones) scheduleOf.set(z, c);
  }

  for (const ts of instants) {
    // class groups: every member must match its representative's live probe
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

    // schedule: table lookup must equal live resolution for every zone
    const step = Math.max(0, Math.floor((ts - YEAR_START) / STEP_MS));

    for (const zone of zones) {
      checks++;

      const target = zoneAliases[zone] ?? zone;
      const liveProbe = probe(target, ts);
      const cut = liveProbe.lastIndexOf('|');
      const liveAbbr = zoneAbbrOverrides[zone] ?? resolveAbbr(liveProbe.slice(0, cut));
      const liveOffset = formatOffsetMinutes(+liveProbe.slice(cut + 1));

      const c = scheduleOf.get(zone)!;
      let i = c.starts.length - 1;

      while (i > 0 && c.starts[i]! > step) i--;

      if ((c.abbrs[i] !== liveAbbr || c.offsets[i] !== liveOffset) && mismatches.length < 20) {
        mismatches.push({
          kind: 'schedule',
          zone,
          ts,
          expected: `${liveAbbr} ${liveOffset}`,
          got: `${c.abbrs[i]} ${c.offsets[i]}`,
        });
      }
    }
  }

  return { instants: instants.size, checks, mismatches };
}
