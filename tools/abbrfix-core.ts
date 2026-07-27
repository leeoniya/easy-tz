// Audits an ALREADY-GENERATED table set's historical ABBREVIATIONS against the
// runtime's live Intl and emits the spans where they disagree.
//
// The history table stores offsets only, so below the bake year a label is a
// pure function of the resolved offset (shared/rules.ts historyAbbr).
// That means the baked impls serve exactly ONE abbreviation per run of constant
// offset. When a zone's historical identity differs from the one its modern
// schedule class describes, that single label is wrong for part or all of the
// run — America/Ciudad_Juarez sat on Central in 1998, but -360 matches its
// modern Mountain class's MDT state, so MDT comes back with full confidence.
//
// Two flavours of disagreement, kept separate because they cost very different
// numbers of bytes to correct (see the `includeVague` switch):
//   - the offset matches no state of the modern class, so historyAbbr falls
//     back to GMT±N: vague, but not a lie
//   - the offset matches a state whose abbreviation belongs to another
//     identity: a confident lie
//
// Browser-safe (no node imports): the chrome variant is audited inside
// chrome-headless-shell, against THAT runtime's ICU.

import { scanChanges, strideSteps } from './step-scan.ts';
import { liveParts } from '../shared/live.ts';
import { zones } from '../shared/zones.ts';
import type { GeneratedTables, GeneratedHistory } from './gen-core.ts';
import { zoneAliases, zoneAbbrOverrides } from '../shared/abbrs.ts';
import { resolveHistory, resolveClass, buildScheduleIndex, historyAbbr, irregularZones, type ScheduleClass, type HistoryClass } from '../shared/rules.ts';
import { gmtLabel } from '../shared/fmt.ts';

// probe stride for the boundary scan, in 15-min steps. 6d, the same bound
// tools/tz-transition-gap.ts holds gen-core to: below the tightest window in
// which the runtime's own data changes and returns to where it started (6.96d,
// America/Boa_Vista 2000), so a window can never hide a whole segment.
// scanChanges() resolves any number of changes inside one window.
const STRIDE = 6 * 96;

// Option B: correct only the spans where the offset-keyed label is a confident
// lie — it names another identity the zone has since left. Spans where the
// historical offset matches no state of the modern class already degrade to a
// vague GMT±N, which is honest, and correcting those too (option B+) costs
// roughly 3x the bytes for labels nobody is currently being misled by.
// Flip to true to ship B+.
export const INCLUDE_VAGUE = false;

export interface FixSpan {
  from: number; // 15-min steps since Jan 1 of fromYear
  to: number; // exclusive
  abbr: string; // what live Intl says, and what the baked path should serve
  vague: boolean; // baked currently says GMT±N here rather than a wrong label
  defer: boolean; // the era defers to the schedule class (no historical offset)
}

// The stored form. The WRONG label is already a pure function of the resolved
// offset (rules.ts historyAbbr), so a correction only has to say "in
// these years, this offset means X" — which drops every timestamp. America/Cancun
// went from 17 near-identical summer spans to one record this way.
export interface FixRange {
  fromYear: number;
  toYear: number; // inclusive
  offMin: number;
  abbr: string;
}

export interface FixClass {
  zones: string[];
  ranges: FixRange[];
  // years where one offset carries two different identities can't be described
  // by a range, so they keep explicit spans
  spans: FixSpan[];
}

export interface AbbrFixResult {
  classes: FixClass[];
  stats: {
    zones: number;
    spans: number;
    lieSpans: number;
    vagueSpans: number;
    deferSpans: number;
    lieZoneYears: number;
    vagueZoneYears: number;
    ranges: number;
    fallbackSpans: number;
    auditMs: number;
  };
}

// Every caller audits a table set it just generated, and seven of the nine
// arguments below are then the same projections of `tables` and `history`.
// Spelling them out per call site is how they get transposed, so the four
// generators and equivalence checks go through here instead. Only `boundaries`
// varies: tools/abbrfix-equiv.ts passes null to force the standalone scan.
export function auditTableSet(
  tables: GeneratedTables,
  history: GeneratedHistory,
  boundaries: Record<string, number[]> | null = history.boundaries
): AbbrFixResult {
  return auditAbbrFix(
    zones,
    tables.scheduleClasses,
    history.classes,
    history.fromYear,
    history.toYear,
    tables.yearStart,
    tables.stepMs,
    INCLUDE_VAGUE,
    boundaries
  );
}

export function auditAbbrFix(
  zoneList: readonly string[],
  scheduleClasses: ScheduleClass[],
  historyClasses: HistoryClass[],
  fromYear: number,
  toYear: number,
  yearStart: number,
  stepMs: number,
  includeVague: boolean,
  boundaries: Record<string, number[]> | null = null
): AbbrFixResult {
  const t0 = Date.now();

  const classIdx = buildScheduleIndex(zoneList, scheduleClasses);
  const histIdx = buildScheduleIndex(zoneList, historyClasses);
  const epoch = Date.UTC(fromYear, 0, 1);
  const lastStep = (Date.UTC(toYear, 0, 1) - epoch) / stepMs;

  const liveAbbr = (zone: string, ts: number): string =>
    zoneAbbrOverrides[zone] ?? liveParts(zoneAliases[zone] ?? zone, ts).abbr;

  // exactly what shared/bakedHistory.ts bakedZoneInfo() serves at `ts`, minus
  // the correction being generated here
  const bakedAt = (z: number, ts: number): { abbr: string; vague: boolean; defer: boolean } => {
    const ci = classIdx[z]!;
    const hi = histIdx[z]!;
    const off = hi === -1 ? null : resolveHistory(historyClasses[hi]!.eras, ts, stepMs);

    if (off === null) {
      // no era, or an era that defers: the schedule class answers
      const st = resolveClass(scheduleClasses[ci]!, ts, yearStart, stepMs);

      return { abbr: st.abbr, vague: false, defer: true };
    }

    const abbr = ci < 0 ? gmtLabel(off) : historyAbbr(scheduleClasses[ci]!, off);

    return { abbr, vague: abbr.startsWith('GMT'), defer: false };
  };

  // Skipped here for the same reason gen-core skips them in history (see
  // irregularZones). Correcting only the LABEL on a knowingly-approximate
  // offset would dress it in an authoritative name, and these four zones alone
  // were 15-19% of the payload.
  const irregular = irregularZones(scheduleClasses);

  // every Jan 1 in the window, where the baked side can move on its own
  const yearStarts: number[] = [];

  for (let y = fromYear; y < toYear; y++) yearStarts.push((Date.UTC(y, 0, 1) - epoch) / stepMs);

  const merge = (a: readonly number[], b: readonly number[]): number[] =>
    [...new Set([...a, ...b])].sort((x, y) => x - y);

  // The generator resolved every change of a zone's "longName|offset" while
  // probing, so when it hands those over this costs one liveAbbr per segment
  // instead of a scan. Reuse is sound because the audit's own key is coarser:
  // its abbreviation is derived from that same long name, so an abbr change
  // cannot happen without one. A superset is fine either way — emit re-merges
  // adjacent identical spans. The exception is the handful of zones that borrow
  // another zone's name (zoneAliases), where the label follows the TARGET's
  // transitions, so the target's boundaries have to come along too.
  // tools/abbrfix-equiv.ts holds this to the standalone scan.
  const seeded = (zone: string): number[] | null => {
    const own = boundaries?.[zone];

    if (own == null) return null;

    const alias = zoneAliases[zone];
    const viaAlias = alias == null ? null : boundaries?.[alias];

    return merge(yearStarts, viaAlias == null ? own : merge(own, viaAlias));
  };

  const byPayload = new Map<string, { zones: string[]; spans: FixSpan[] }>();
  let lieSpans = 0, vagueSpans = 0, deferSpans = 0, lieSteps = 0, vagueSteps = 0, zoneCount = 0;

  for (let z = 0; z < zoneList.length; z++) {
    const zone = zoneList[z]!;

    // Etc/* and anything the schedule doesn't index can't be corrected here;
    // they never reach the historical branch either
    if (classIdx[z] === -1 || irregular.has(zone)) continue;

    const spans: FixSpan[] = [];
    let open: FixSpan | null = null;

    // the live label plus the offset, which is what moves the baked label
    const key = (ts: number) => {
      const p = liveParts(zoneAliases[zone] ?? zone, ts);

      return `${zoneAbbrOverrides[zone] ?? p.abbr}|${p.offset}`;
    };

    // fallback when no boundaries were supplied: find this zone's live changes
    // the slow way, at a stride below the tightest change-and-return window,
    // bisecting each stride window (which may hold more than one change)
    const scan = (): number[] => {
      const found: number[] = [];

      scanChanges(
        (step) => key(epoch + step * stepMs),
        strideSteps(lastStep, STRIDE),
        (step) => found.push(step)
      );

      return merge(yearStarts, found);
    };

    const boundariesFor = (z2: string): number[] => seeded(z2) ?? scan();

    const emit = (fromStep: number, toStep: number) => {
      const ts = epoch + fromStep * stepMs;
      const want = liveAbbr(zone, ts);
      const got = bakedAt(z, ts);

      if (want === got.abbr) { open = null; return; }
      if (got.vague && !includeVague) { open = null; return; }

      if (open != null && open.to === fromStep && open.abbr === want && open.vague === got.vague && open.defer === got.defer) {
        open.to = toStep;
      } else {
        open = { from: fromStep, to: toStep, abbr: want, vague: got.vague, defer: got.defer };
        spans.push(open);
      }
    };

    // Both sides of the comparison move, so a segment has to start wherever
    // EITHER could change. Live moves at this runtime's transitions; the baked
    // answer moves at those too, plus every Jan 1, where an era can begin or
    // start deferring to the schedule class without anything happening in the
    // real world. Asia/Anadyr 2012 is the case that shows it: live sits on MAGT
    // across 2011-2015 while the era behind it flips to a defer at the year
    // line, so a walk that only follows live reads the baked label once, in
    // 2011, and never notices.
    let prevStep = 0;

    for (const s of boundariesFor(zone)) {
      if (s <= prevStep) continue;

      emit(prevStep, s);
      prevStep = s;
    }

    emit(prevStep, lastStep);

    if (spans.length === 0) continue;

    zoneCount++;

    for (const sp of spans) {
      if (sp.defer) deferSpans++;
      if (sp.vague) { vagueSpans++; vagueSteps += sp.to - sp.from; }
      else { lieSpans++; lieSteps += sp.to - sp.from; }
    }

    // zones with identical correction lists share one payload, exactly as the
    // history table shares era payloads (Argentina's 13 zones collapse to one)
    const sig = spans.map((sp) => `${sp.from},${sp.to},${sp.abbr}`).join(';');
    let g = byPayload.get(sig);

    if (g == null) byPayload.set(sig, (g = { zones: [], spans }));

    g.zones.push(zone);
  }

  const perYear = (steps: number) => (steps * stepMs) / 86_400_000 / 365;

  // ---- span list -> (year range, offset) records ---------------------------
  //
  // The offset key must be the SAME one shared/bakedHistory.ts has in hand at
  // the two call sites: the historical era's offset where one is live, else the
  // schedule class's. Anything else and the runtime would miss the record.
  const keyOff = (z: number, ts: number): number => {
    const hi = histIdx[z]!;
    const off = hi === -1 ? null : resolveHistory(historyClasses[hi]!.eras, ts, stepMs);

    return off ?? resolveClass(scheduleClasses[classIdx[z]!]!, ts, yearStart, stepMs).offMin;
  };

  const spanAbbrAt = (spans: FixSpan[], step: number): string => {
    for (const sp of spans) if (step >= sp.from && step < sp.to) return sp.abbr;

    return '';
  };

  const DAY_STEPS = 86_400_000 / stepMs;
  const yearStep = (y: number) => (Date.UTC(y, 0, 1) - epoch) / stepMs;

  // sample points for year `y`: a daily walk plus both edges of every span that
  // touches the year, so a span shorter than the stride can't slip through
  const samples = (y: number, spans: FixSpan[]): number[] => {
    const lo = yearStep(y);
    const hi = Math.min(yearStep(y + 1), lastStep);
    const pts: number[] = [];

    for (let s = lo; s < hi; s += DAY_STEPS) pts.push(s);
    for (const sp of spans) {
      for (const s of [sp.from, sp.to - 1]) if (s >= lo && s < hi) pts.push(s);
    }

    return pts;
  };

  let rangeCount = 0;
  let fallbackCount = 0;

  const toRangeForm = (zone: string, spans: FixSpan[]): { ranges: FixRange[]; spans: FixSpan[] } => {
    const z = zoneList.indexOf(zone);

    // per year: offset -> required label ('' = leave the offset-keyed answer
    // alone), or null when one offset needs two different labels that year
    const maps: (Map<number, string> | null)[] = [];

    for (let y = fromYear; y < toYear; y++) {
      const m = new Map<number, string>();
      let ok = true;

      for (const s of samples(y, spans)) {
        const off = keyOff(z, epoch + s * stepMs);
        const want = spanAbbrAt(spans, s);
        const prev = m.get(off);

        if (prev == null) m.set(off, want);
        else if (prev !== want) { ok = false; break; }
      }

      maps.push(ok ? m : null);
    }

    const sig = (m: Map<number, string> | null) =>
      m == null
        ? '\u0000'
        : [...m].filter(([, v]) => v !== '').sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(',');

    const ranges: FixRange[] = [];
    const keep: FixSpan[] = [];

    for (let i = 0; i < maps.length; ) {
      const s = sig(maps[i]!);
      let end = i;

      while (end + 1 < maps.length && sig(maps[end + 1]!) === s) end++;

      if (s === '\u0000') {
        // undescribable years fall back to spans — any span OVERLAPPING the run,
        // not merely starting in it, or a span straddling Jan 1 would vanish
        const lo = yearStep(fromYear + i);
        const hi = Math.min(yearStep(fromYear + end + 1), lastStep);

        for (const sp of spans) if (sp.from < hi && sp.to > lo && !keep.includes(sp)) keep.push(sp);
      } else if (s !== '') {
        for (const [offMin, abbr] of maps[i]!) {
          if (abbr !== '') ranges.push({ fromYear: fromYear + i, toYear: fromYear + end, offMin, abbr });
        }
      }

      i = end + 1;
    }

    ranges.sort((a, b) => a.fromYear - b.fromYear || a.offMin - b.offMin);
    keep.sort((a, b) => a.from - b.from);

    rangeCount += ranges.length;
    fallbackCount += keep.length;

    return { ranges, spans: keep };
  };

  // ---- self-check: the stored form must answer exactly like the span list ---
  //
  // Cheap insurance against a sampling hole in the conversion above: replay both
  // forms daily across the covered range, plus a 15-min sweep around every span
  // edge where a discrepancy would actually hide.
  const verify = (zone: string, spans: FixSpan[], form: { ranges: FixRange[]; spans: FixSpan[] }) => {
    const z = zoneList.indexOf(zone);

    const lookup = (step: number): string => {
      for (const sp of form.spans) if (step >= sp.from && step < sp.to) return sp.abbr;

      const ts = epoch + step * stepMs;
      const y = new Date(ts).getUTCFullYear();
      const off = keyOff(z, ts);

      for (const r of form.ranges) {
        if (y >= r.fromYear && y <= r.toYear && r.offMin === off) return r.abbr;
      }

      return '';
    };

    const check = (step: number) => {
      const want = spanAbbrAt(spans, step);
      const got = lookup(step);

      if (want !== got) {
        throw new Error(
          `abbrfix range form disagrees for ${zone} at step ${step} ` +
            `(${new Date(epoch + step * stepMs).toISOString()}): spans say "${want}", ranges say "${got}"`
        );
      }
    };

    for (let s = 0; s < lastStep; s += DAY_STEPS) check(s);
    for (const sp of spans) {
      for (let d = -2; d <= 2; d++) {
        for (const edge of [sp.from, sp.to]) {
          const s = edge + d;

          if (s >= 0 && s < lastStep) check(s);
        }
      }
    }
  };

  const classes: FixClass[] = [];

  for (const g of byPayload.values()) {
    const form = toRangeForm(g.zones[0]!, g.spans);

    verify(g.zones[0]!, g.spans, form);
    classes.push({ zones: g.zones, ranges: form.ranges, spans: form.spans });
  }

  return {
    classes,
    stats: {
      zones: zoneCount,
      spans: lieSpans + vagueSpans,
      lieSpans,
      vagueSpans,
      deferSpans,
      lieZoneYears: Math.round(perYear(lieSteps)),
      vagueZoneYears: Math.round(perYear(vagueSteps)),
      ranges: rangeCount,
      fallbackSpans: fallbackCount,
      auditMs: Date.now() - t0,
    },
  };
}
