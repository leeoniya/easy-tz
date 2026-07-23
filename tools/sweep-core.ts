// Core of the validity sweep (see tools/sweep-validity.ts for the full
// story): compares the ACTIVE baked table variant against the host's own tz
// database (ICU), weekly samples per year, and returns a serializable
// result. Browser-safe — no process/console/Bun — so the same code runs
// under node/bun directly and inside chrome-headless-shell via
// tools/sweep-browser-entry.ts (page.evaluate structured-clones the result,
// hence plain arrays/objects, no Maps).
//
// Baseline: Temporal (toZonedDateTimeISO().offset — exact ICU data) when the
// host ships it (Chrome does), else an Intl.DateTimeFormat 'longOffset'
// formatter (the SAME ICU data through a slower API — node 26 builds without
// the Temporal component and bun 1.4).
//
// Weekly sampling is sufficient for rule-day drift: a projected transition
// that lands one week off the real one opens a disagreement window of
// exactly 7 days, and any half-open 7-day window contains exactly one point
// of a 7-day sample lattice — so such drift is always caught. Sub-week
// windows (rare mid-week policy flips) can slip through; this measures year
// granularity, not transition-exact instants.
//
// Alias spellings (tzdata backward links, e.g. Asia/Calcutta) are skipped:
// they share both the schedule class and the ICU data of their canonical
// zone, so counting them would only double-count the same behavior.

import { zones } from '../shared/zones.ts';
import { aliasOfZone } from '../shared/zoneLinks.ts';
import { scheduleClasses, genMeta, YEAR_START, STEP_MS } from '../shared/schedule.ts';
import { historyClasses, HISTORY_FROM, HISTORY_TO } from '../shared/history.ts';
import { resolveClass, resolveHistory, buildScheduleIndex } from '../shared/rules.ts';
import { fmtCache, tzNameFromFormat, isoOffsetFromLongOffset } from '../shared/fmt.ts';

export interface Mismatch {
  zone: string;
  irregular: boolean; // kind-2 class: current-year segments, expected to hold just the bake year
  ts: number; // first offending weekly sample
  baked: number;
  actual: number;
}

export interface YearResult {
  year: number;
  mismatches: Mismatch[]; // one entry (the first) per disagreeing zone
}

export interface SweepResult {
  genMeta: { host: string; icu: string | null; generated: string };
  bakeYear: number;
  temporal: boolean; // baseline was Temporal (vs Intl 'longOffset')
  history: { fromYear: number; toYear: number; classes: number } | null; // baked eras in use (null: --no-history)
  sweptZones: number;
  irregularZones: string[];
  skippedAliases: number;
  unknownZones: string[]; // in the host's zone list but absent from the table even after link bridging
  years: YearResult[];
}

const WEEK_MS = 7 * 86_400_000;

const hasTemporal = typeof Temporal !== 'undefined';

const offsetFmt = fmtCache({ timeZoneName: 'longOffset' });

// "+05:30" -> 330; sub-minute historical offsets ("+00:44:30") keep their
// fractional part so they can never spuriously equal a baked whole-minute
// offset
function parseIsoOffsetMin(iso: string): number {
  if (iso === '+00:00' || iso === '-00:00') return 0;

  const sign = iso[0] === '-' ? -1 : 1;
  const h = +iso.slice(1, 3);
  const m = +iso.slice(4, 6);
  const s = iso.length > 6 ? +iso.slice(7, 9) : 0;

  return sign * (h * 60 + m + s / 60);
}

function baselineOffMin(zone: string, ts: number): number {
  const iso = hasTemporal
    ? Temporal!.Instant.fromEpochMilliseconds(ts).toZonedDateTimeISO(zone).offset
    : isoOffsetFromLongOffset(tzNameFromFormat(offsetFmt(zone).format(ts)));

  return parseIsoOffsetMin(iso);
}

// default range: 1995 through bakeYear+2. The near-future edge stays in the
// routine sweep on purpose — callers query future instants even when the
// table is fresh, and it is the only detector for already-published future
// rule changes the 3-year probe can't see. Longer horizons (e.g. 2035) are
// a one-off characterization of projection drift; pass toYear explicitly.
export function runSweep(fromYear = 1995, toYear?: number, useHistory = true): SweepResult {
  const bakeYear = new Date(YEAR_START).getUTCFullYear();

  toYear ??= Math.max(bakeYear + 2, fromYear);

  // zone universe: every host zone with a baked class, aliases deduped
  const classIdx = buildScheduleIndex(zones, scheduleClasses);
  const histIdx = buildScheduleIndex(zones, historyClasses);

  const sweepZones: { name: string; ci: number; hi: number; irregular: boolean }[] = [];
  const unknownZones: string[] = [];
  let skippedAliases = 0;

  for (let z = 0; z < zones.length; z++) {
    const name = zones[z]!;

    if (aliasOfZone.has(name)) {
      skippedAliases++;
      continue;
    }

    const ci = classIdx[z]!;

    if (ci === -1) {
      unknownZones.push(name);
      continue;
    }

    sweepZones.push({
      name,
      ci,
      hi: useHistory ? histIdx[z]! : -1,
      irregular: scheduleClasses[ci]!.kind === 2,
    });
  }

  const years: YearResult[] = [];

  for (let year = fromYear; year <= toYear; year++) {
    const y0 = Date.UTC(year, 0, 1, 12); // noon UTC: past the typical 01:00-03:00 local transition hour
    const y1 = Date.UTC(year + 1, 0, 1);
    const mismatches: Mismatch[] = [];

    // years before the bake year resolve through the baked history eras
    // (when present for the zone); the bake year onward uses the schedule
    const inHistory = year >= HISTORY_FROM && year < HISTORY_TO;

    for (const z of sweepZones) {
      const cls = scheduleClasses[z.ci]!;
      const eras = inHistory && z.hi !== -1 ? historyClasses[z.hi]!.eras : null;

      for (let ts = y0; ts < y1; ts += WEEK_MS) {
        // null from resolveHistory = defer era (or no history at all):
        // the schedule class is exact for this span
        let baked = eras !== null ? resolveHistory(eras, ts, STEP_MS) : null;
        baked ??= resolveClass(cls, ts, YEAR_START, STEP_MS).offMin;

        const actual = baselineOffMin(z.name, ts);

        if (baked !== actual) {
          mismatches.push({ zone: z.name, irregular: z.irregular, ts, baked, actual });
          break;
        }
      }
    }

    years.push({ year, mismatches });
  }

  return {
    genMeta,
    bakeYear,
    temporal: hasTemporal,
    history: useHistory ? { fromYear: HISTORY_FROM, toYear: HISTORY_TO, classes: historyClasses.length } : null,
    sweptZones: sweepZones.length,
    irregularZones: sweepZones.filter((z) => z.irregular).map((z) => z.name),
    skippedAliases,
    unknownZones,
    years,
  };
}
