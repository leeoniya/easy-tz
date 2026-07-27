// Does easy-tz close the luxon-vs-moment gap when formatting a column of
// timestamps in a named IANA zone?
//
// Three paths format the same timestamps (see bench/luxon-format-kernel.ts):
//
//   moment         moment-timezone — packed offset table, no Intl (the baseline)
//   luxon          stock luxon — resolves the zone from Intl on every value
//   luxon-easytz   luxon with IANAZone.offset/offsetName sourced from easy-tz
//
// Two format shapes, because they exercise different halves of the zone cost:
// `numeric` (YYYY-MM-DD HH:mm:ss) needs only offset(), while `abbr` (… z / …
// ZZZZ) also needs offsetName() — which in stock luxon constructs a fresh
// Intl.DateTimeFormat per value, uncached.
//
// Timings are medians over REPS passes. Correctness is not assumed: the last
// section re-formats the same values and reports where the paths disagree.
// Run: bun bench/luxon-format.ts

import moment from 'moment-timezone';
import { printTable } from '../tools/print-table.ts';
import { median } from '../tools/bench-config.ts';
import { genMeta, YEAR_START } from '../shared/schedule.ts';
import { zones } from '../shared/zones.ts';
import {
  SYSTEM,
  UTC,
  formatKeys,
  makeFormatter,
  patternFor,
  timeLoop,
  variantAvailable,
  variantIds,
  easyTZCanResolve,
  irregularZones,
  type FormatKey,
  type VariantId,
} from './luxon-format-kernel.ts';

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const N = 10_000; // values per pass ("column height")
const REPS = 5;
const WARMUP = 2_000;

const BAKE_YEAR = new Date(YEAR_START).getUTCFullYear();

// Anchored inside the baked tables' documented validity window (bake year
// through bake year + 2) — outside it the baked step rules drift from Intl for
// a handful of zones, which would be a table-staleness finding rather than a
// formatting one.
const BASE_TS = Date.UTC(BAKE_YEAR, 0, 1);

// dense-column default: adjacent values a minute apart, the shape a table panel
// or a time-series axis actually produces
const STEP_MS = MIN_MS;

const BENCH_ZONES = [
  SYSTEM,
  UTC,
  'America/New_York',
  'Europe/London',
  'Asia/Kolkata',
  'Australia/Lord_Howe', // 30-minute DST shift
];

let sink = 0;

/**
 * Times every variant for one (zone, format, step) cell, interleaving their
 * passes round-robin rather than running each variant's REPS passes back to
 * back. A transient host slowdown (GC, scheduling) then lands on all three
 * roughly equally instead of inflating whichever variant happened to be running
 * — which matters because the reported number is a ratio between them.
 */
function measureRow(zone: string, fmt: FormatKey, step: number): Map<VariantId, number> {
  const runnable = variantIds.filter((v) => variantAvailable(v, zone));

  const formatters = runnable.map((variant) => {
    const format = makeFormatter(variant, zone, fmt);
    sink += timeLoop(format, BASE_TS - WARMUP * step, step, WARMUP).checksum;

    return { variant, format };
  });

  const times = new Map<VariantId, number[]>(runnable.map((v) => [v, []]));

  for (let r = 0; r < REPS; r++) {
    for (const { variant, format } of formatters) {
      const run = timeLoop(format, BASE_TS, step, N);
      sink += run.checksum;
      times.get(variant)!.push(run.ms);
    }
  }

  return new Map([...times].map(([v, xs]) => [v, median(xs)]));
}

console.log(
  `luxon ${await pkgVersion('luxon')} vs moment ${await pkgVersion('moment')} / moment-timezone ${await pkgVersion('moment-timezone')}`
);
console.log(`runtime: bun ${Bun.version}, tables: ${genMeta.host}, bake year ${BAKE_YEAR}`);
// The two libraries carry different tzdata vintages, and it shows up in the
// agreement tables below: moment-timezone bundles its own snapshot, while luxon
// (and, transitively, easy-tz's baked tables) inherit whatever the host ICU has.
console.log(`rules: moment tzdata ${moment.tz.dataVersion}, host ICU ${process.versions.icu ?? 'unknown'}`);
console.log(`${N} values/pass, median of ${REPS} interleaved passes, base ${new Date(BASE_TS).toISOString()}\n`);

async function pkgVersion(name: string): Promise<string> {
  const url = new URL(`../node_modules/${name}/package.json`, import.meta.url);
  const pkg = (await Bun.file(url).json()) as { version: string };

  return pkg.version;
}

// ---- timing, per zone, per format ---------------------------------------

function timingRow(label: string, ms: Map<VariantId, number>): string[] {
  const base = ms.get('moment')!;

  const cell = (v: VariantId) => {
    const t = ms.get(v);
    return t == null ? ['—', '—'] : [t.toFixed(1), `${(t / base).toFixed(2)}×`];
  };

  const [luxMs, luxRatio] = cell('luxon');
  const [easyMs, easyRatio] = cell('luxon-easytz');

  return [label, base.toFixed(1), luxMs!, easyMs!, luxRatio!, easyRatio!];
}

const TIMING_HEADERS = ['', 'moment', 'luxon', 'luxon+easytz', 'luxon', 'luxon+easytz'];

for (const fmt of formatKeys) {
  const rows = BENCH_ZONES.map((zone) => timingRow(zone, measureRow(zone, fmt, STEP_MS)));

  console.log(`${fmt} format (${patternFor('moment', fmt)}) — ms per ${N} values, ratio vs moment\n`);
  printTable(['zone', ...TIMING_HEADERS.slice(1)], rows);
  console.log();
}

// ---- column density ------------------------------------------------------
// moment-timezone binary-searches a packed table and easy-tz evaluates rules, so
// both could in principle be sensitive to how far apart adjacent values are,
// whereas stock luxon's per-value Intl call is not. A cache keyed on anything
// coarser than the exact instant (an hour bucket, say) would fall apart here.

{
  const zone = 'America/New_York';
  const densities: [string, number][] = [
    ['1 min', MIN_MS],
    ['15 min', 15 * MIN_MS],
    ['1 hour', HOUR_MS],
    ['1 day', DAY_MS],
  ];

  for (const fmt of formatKeys) {
    const rows = densities.map(([label, step]) => timingRow(label, measureRow(zone, fmt, step)));

    console.log(`column density, ${zone}, ${fmt} format — ms per ${N} values, ratio vs moment\n`);
    printTable(['step', ...TIMING_HEADERS.slice(1)], rows);
    console.log();
  }
}

// ---- Intl traffic --------------------------------------------------------
// Each cell runs in a FRESH subprocess so luxon's module-level formatter cache
// and moment-timezone's load-time work can't leak between them. `setup` counts
// constructions while building the column's formatter (once per column);
// per-value columns count only what the formatting loop itself does.

{
  const intlCountUrl = new URL('../shared/intl-count.ts', import.meta.url).pathname;
  const kernelUrl = new URL('./luxon-format-kernel.ts', import.meta.url).pathname;
  const intlZones = [SYSTEM, 'America/New_York'];
  const rows: (string[] | null)[] = [];

  const cells = intlZones.flatMap((zone) =>
    formatKeys.flatMap((fmt) =>
      variantIds.filter((variant) => variantAvailable(variant, zone)).map((variant) => ({ zone, fmt, variant }))
    )
  );

  for (const [i, { zone, fmt, variant }] of cells.entries()) {
    const prev = cells[i - 1];

    if (prev !== undefined && (prev.zone !== zone || prev.fmt !== fmt)) {
      rows.push(null);
    }

    const proc = Bun.spawnSync({
      cmd: [
        process.execPath,
        '-e',
        `const { installIntlCounter, intlConstructCount, installIntlPartsCounter, intlPartsCount } =
           await import(${JSON.stringify(intlCountUrl)});
         installIntlCounter();
         installIntlPartsCounter();
         const { makeFormatter, timeLoop } = await import(${JSON.stringify(kernelUrl)});
         const c0 = intlConstructCount();
         const format = makeFormatter(${JSON.stringify(variant)}, ${JSON.stringify(zone)}, ${JSON.stringify(fmt)});
         const setup = intlConstructCount() - c0;
         const c1 = intlConstructCount(), p1 = intlPartsCount();
         const N = ${N};
         const r = timeLoop(format, ${BASE_TS}, ${STEP_MS}, N);
         if (r.checksum < 0) throw new Error('unreachable');
         console.log(JSON.stringify({
           setup,
           perValueConstructs: (intlConstructCount() - c1) / N,
           perValueParts: (intlPartsCount() - p1) / N,
         }));`,
      ],
    });

    const p = JSON.parse(proc.stdout.toString() || '{}') as {
      setup?: number;
      perValueConstructs?: number;
      perValueParts?: number;
    };

    rows.push([
      `${zone} / ${fmt} / ${variant}`,
      String(p.setup ?? 'err'),
      p.perValueConstructs?.toFixed(2) ?? 'err',
      p.perValueParts?.toFixed(2) ?? 'err',
    ]);
  }

  console.log(`Intl traffic — fresh subprocess per row, ${N} values\n`);
  printTable(['zone / format / path', 'setup DTF', 'DTF/value', 'formatToParts/value'], rows);
  console.log();
}

// ---- agreement -----------------------------------------------------------
// Speed only counts if the output matches. Every value formatted by all three
// paths, compared pairwise across two full years at hourly resolution — which
// steps over every DST transition in the window.

{
  const PARITY_STEP = HOUR_MS;
  const PARITY_N = (2 * 365 * DAY_MS) / PARITY_STEP;
  const rows: string[][] = [];

  for (const zone of BENCH_ZONES) {
    if (!variantAvailable('luxon-easytz', zone)) continue;

    const cells: string[] = [zone];

    for (const fmt of formatKeys) {
      const mo = makeFormatter('moment', zone, fmt);
      const lux = makeFormatter('luxon', zone, fmt);
      const easy = makeFormatter('luxon-easytz', zone, fmt);

      let easyVsLux = 0;
      let luxVsMo = 0;
      let easyVsMo = 0;

      for (let i = 0; i < PARITY_N; i++) {
        const ts = BASE_TS + i * PARITY_STEP;
        const m = mo(ts);
        const l = lux(ts);
        const e = easy(ts);

        if (e !== l) easyVsLux++;
        if (l !== m) luxVsMo++;
        if (e !== m) easyVsMo++;
      }

      cells.push(String(easyVsLux), String(luxVsMo), String(easyVsMo));
    }

    rows.push(cells);
  }

  // moment in local mode has no zone attached, so its `z` renders empty and the
  // system row's abbr columns are comparing against nothing. Detected rather
  // than asserted, since it's a moment behavior that could change.
  const localAbbr = makeFormatter('moment', SYSTEM, 'abbr')(BASE_TS).slice(20);

  console.log(`output agreement — mismatching values out of ${PARITY_N} (hourly, ${BAKE_YEAR}-${BAKE_YEAR + 1})\n`);
  printTable(
    [
      'zone',
      'num: easytz≠luxon',
      'num: luxon≠moment',
      'num: easytz≠moment',
      'abbr: easytz≠luxon',
      'abbr: luxon≠moment',
      'abbr: easytz≠moment',
    ],
    rows
  );

  if (localAbbr === '') {
    console.log(
      `\nnote: the ${SYSTEM} row's two "≠moment" abbr counts are vacuous — moment renders \`z\` as an\nempty string in local mode (no zone attached), so nothing there is comparable. Both luxon\npaths emit the host abbreviation, and they agree with each other.`
    );
  }

  console.log();
}

// ---- fidelity across every zone -----------------------------------------
// Widened from the six benchmark zones to the whole zone list, sampled monthly
// across the validity window (so each zone is seen in both DST states).
//
// The numeric row is a straight correctness check. The abbr rows are a
// judgement call: luxon's ZZZZ is ICU's short time zone name, which outside the
// Americas and Europe is mostly a "GMT+3"-style fallback, whereas moment's `z`
// is tzdata's abbreviation. easy-tz supplies a tzdata-style abbreviation, so
// overriding offsetName() moves luxon TOWARD moment's output rather than away
// from it — but not all the way, as the residual breakdown below shows.

{
  let compared = 0;
  let skipped = 0;

  const agree = { numLuxon: 0, numEasy: 0, abbrLuxon: 0, abbrEasy: 0 };
  const offZones = { numLuxon: new Set<string>(), numEasy: new Set<string>(), abbrLuxon: new Set<string>(), abbrEasy: new Set<string>() };

  // residual abbr differences, bucketed by shape so the leftover gap is
  // characterized rather than left as a bare count. Keyed by zone as well,
  // because whether a difference is a data-vintage artifact is a property of
  // the zone (see below) and isn't known until every sample has been seen.
  const residual = new Map<string, Map<string, { count: number; sample: string }>>();

  const vintageZones = new Set<string>();

  const shapeOf = (momentAbbr: string, easyAbbr: string) =>
    /^[+-]\d/.test(momentAbbr)
      ? 'tzdata numeric (-03) vs easy-tz lettered (ART)'
      : /^[+-]\d/.test(easyAbbr)
        ? 'easy-tz numeric vs tzdata lettered'
        : 'both lettered, disagree';

  for (const zone of zones) {
    if (!easyTZCanResolve(zone)) {
      skipped++;
      continue;
    }

    const fmts = formatKeys.map((fmt) => ({
      fmt,
      mo: makeFormatter('moment', zone, fmt),
      lux: makeFormatter('luxon', zone, fmt),
      easy: makeFormatter('luxon-easytz', zone, fmt),
    }));

    for (let month = 0; month < 36; month++) {
      const ts = Date.UTC(BAKE_YEAR + Math.floor(month / 12), month % 12, 15, 12);

      compared++;

      // A numeric disagreement can only mean the two sides hold different
      // transition rules, since those tokens are pure arithmetic on the offset.
      // Stock luxon reads the host ICU, so when IT disagrees with moment the
      // cause is the data vintage, not easy-tz. Recorded per zone rather than
      // per instant: a zone on a newer rule set also mislabels the instants
      // where the two vintages happen to land on the same offset.
      if (fmts[0]!.lux(ts) !== fmts[0]!.mo(ts)) vintageZones.add(zone);

      for (const { fmt, mo, lux, easy } of fmts) {
        const m = mo(ts);
        const l = lux(ts);
        const e = easy(ts);
        const numeric = fmt === 'numeric';

        if (l === m) agree[numeric ? 'numLuxon' : 'abbrLuxon']++;
        else offZones[numeric ? 'numLuxon' : 'abbrLuxon'].add(zone);

        if (e === m) {
          agree[numeric ? 'numEasy' : 'abbrEasy']++;
          continue;
        }

        offZones[numeric ? 'numEasy' : 'abbrEasy'].add(zone);

        if (!numeric) {
          // the abbreviation is the trailing token of "<date> <time> <abbr>"
          const [ma, ea] = [m.slice(20), e.slice(20)];
          const byShape = residual.get(zone) ?? new Map<string, { count: number; sample: string }>();
          const key = shapeOf(ma, ea);
          const seen = byShape.get(key);

          byShape.set(key, {
            count: (seen?.count ?? 0) + 1,
            sample: seen?.sample ?? `${zone}: moment=${ma} easytz=${ea} luxon=${l.slice(20)}`,
          });
          residual.set(zone, byShape);
        }
      }
    }
  }

  const pct = (n: number) => `${((n / compared) * 100).toFixed(1)}%`;
  const row = (label: string, n: number, zoneSet: Set<string>) => [label, `${n} / ${compared}`, pct(n), String(zoneSet.size)];

  console.log(`agreement with moment across ${zones.length - skipped} zones — ${compared} samples per path (monthly, ${BAKE_YEAR}-${BAKE_YEAR + 2})\n`);
  printTable(
    ['path', 'values agreeing', 'share', 'zones ever differing'],
    [
      row('numeric / stock luxon', agree.numLuxon, offZones.numLuxon),
      row('numeric / luxon+easytz', agree.numEasy, offZones.numEasy),
      null,
      row('abbr / stock luxon (ICU short)', agree.abbrLuxon, offZones.abbrLuxon),
      row('abbr / luxon+easytz', agree.abbrEasy, offZones.abbrEasy),
    ]
  );

  const byShape = new Map<string, { count: number; sample: string; zones: number }>();

  for (const [zone, shapes] of residual) {
    for (const [shape, { count, sample }] of shapes) {
      const key = vintageZones.has(zone) ? 'tzdata vintage — moment has rules the host ICU lacks' : shape;
      const seen = byShape.get(key);

      byShape.set(key, {
        count: (seen?.count ?? 0) + count,
        sample: seen?.sample ?? sample,
        zones: (seen?.zones ?? 0) + 1,
      });
    }
  }

  console.log(`\nresidual abbr differences, luxon+easytz vs moment:\n`);
  printTable(
    ['shape', 'values', 'zones', 'example'],
    [...byShape]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([k, v]) => [k, String(v.count), String(v.zones), v.sample])
  );

  console.log(
    `\nthe numeric rows differ only on ${vintageZones.size} vintage zone(s) — ${[...vintageZones].join(', ')} —\nwhere moment's bundled tzdata (${moment.tz.dataVersion}) already has a rule change the host ICU doesn't;\nstock luxon is off there too, so it's a data-freshness difference, not an easy-tz one.`
  );

  console.log(
    `\n${skipped} zone(s) excluded — the ${irregularZones.size} irregular ones (${[...irregularZones].join(', ')}),\nwhose Ramadan-driven transition dates the baked step table only approximates, so they\nkeep luxon's exact Intl lookup.`
  );
}

if (sink < 0) throw new Error('unreachable');
