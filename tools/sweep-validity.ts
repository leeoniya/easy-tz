// Measures the validity window of the vendored schedule table by sweeping
// weekly samples of every baked zone against a runtime's own tz database
// (ICU), one year at a time. This is the measurement behind the summary in
// devinfo/README: all zones agree only in the bake year; the four
// irregular-class zones (Casablanca, El Aaiun, Gaza, Hebron) hold only that
// one year; going back, mismatches grow at each rule-regime change (2007 US
// DST act, 1990s EU/xUSSR churn); going forward, a handful of zones drift
// where "nth weekday" projection picks a different day than tzdata's "day on
// or after" rules. Sweep mechanics live in tools/sweep-core.ts.
//
// Two modes:
//   local (default) — sweeps the ACTIVE table variant against this host's
//     ICU. Runs under node or bun (both currently lack Temporal, so the
//     baseline is the Intl 'longOffset' formatter — same ICU data).
//   --chrome — bundles the core against the CHROME table variant and runs it
//     inside chrome-headless-shell (bun-only host; needs the browser once:
//     bun run browsers:install). Chrome ships native Temporal, so the
//     baseline is exact Temporal offsets from Chrome's own ICU — the actual
//     environment the shipped table serves.
//
// Run:
//   node tools/sweep-validity.ts [fromYear] [toYear] [--verbose|--by-zone]
//   bun  tools/sweep-validity.ts [fromYear] [toYear] [--verbose|--by-zone] [--chrome]
// Defaults: 1995 through bakeYear+2 — the near-future edge belongs in the
// routine sweep (callers query future instants even when the table is
// fresh, and it catches already-published future rule changes), while long
// horizons (e.g. 2035) are a one-off projection-drift characterization you
// opt into with an explicit toYear. --verbose lists every mismatched zone
// per year with its first offending sample; --by-zone pivots the report
// into a zone -> mismatch-years table (America/Europe first, irregular
// zones last). Exits 1 if the BAKE year itself has any mismatch (the table
// is stale vs that runtime's ICU — rerun bun run gen).

import { type SweepResult, type Mismatch } from './sweep-core.ts';
import { formatOffset } from '../shared/fmt.ts';

// ---- CLI ----

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const byZone = args.includes('--by-zone');
const chrome = args.includes('--chrome');
const useHistory = !args.includes('--no-history'); // --no-history: schedule-only (pre-history behavior)
const years = args.filter((a) => /^\d{4}$/.test(a)).map(Number);

if (years.length === 2 && years[0]! > years[1]!) {
  console.error(`from year ${years[0]} > to year ${years[1]}`);
  process.exit(1);
}

// ---- run the sweep (in-process, or inside chrome-headless-shell) ----

let result: SweepResult;
let runtime: string;

if (chrome) {
  if (typeof Bun === 'undefined') {
    console.error('--chrome needs Bun (Bun.build bundles the browser entry) — run: bun tools/sweep-validity.ts --chrome');
    process.exit(1);
  }

  const { bundleBrowserEntry, launchChrome } = await import('./chrome-harness.ts');

  // bundle against the chrome table variant (the shippable one)
  const code = await bundleBrowserEntry(new URL('./sweep-browser-entry.ts', import.meta.url).pathname);
  const browser = await launchChrome();

  try {
    const version = await browser.version(); // e.g. "HeadlessChrome/151.0.7922.47"
    const page = await browser.newPage();

    await page.evaluate(code);

    result = (await page.evaluate(`__sweep(${years[0]}, ${years[1]}, ${useHistory})`)) as SweepResult;
    runtime = `chrome-headless-shell ${version.replace(/^HeadlessChrome\//, '')}`;
  } finally {
    await browser.close();
  }
} else {
  const { runSweep } = await import('./sweep-core.ts');

  result = runSweep(years[0], years[1], useHistory);

  const rt = typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.versions.node}`;

  runtime = `${rt} (icu ${process.versions.icu}, tz ${process.versions.tz ?? '?'})`;
}

// ---- report ----

const { genMeta, bakeYear, sweptZones, irregularZones, skippedAliases, unknownZones } = result;

// actual swept range (defaults are resolved inside runSweep)
const fromYear = result.years[0]!.year;
const toYear = result.years[result.years.length - 1]!.year;

console.log(`runtime:   ${runtime}`);
console.log(`table:     ${chrome ? 'chrome variant' : 'active variant'}: ${genMeta.host}${genMeta.icu !== null ? ` (icu ${genMeta.icu})` : ''}, generated ${genMeta.generated}, bake year ${bakeYear}`);
console.log(`baseline:  ${result.temporal ? 'Temporal.Instant offsets' : "Intl 'longOffset' formatter"} (runtime ICU)`);
console.log(
  `history:   ${result.history !== null ? `${result.history.fromYear}-${result.history.toYear - 1} baked eras (${result.history.classes} classes; irregular zones excluded)` : 'disabled (--no-history)'}`
);
console.log(
  `zones:     ${sweptZones} swept (${irregularZones.length} irregular: ${irregularZones.join(', ')})` +
    `, ${skippedAliases} alias spellings deduped, ${unknownZones.length} unknown to table` +
    (unknownZones.length > 0 ? ` (${unknownZones.join(', ')})` : '')
);
console.log(`sweep:     ${fromYear}-${toYear}, weekly samples (Jan 1 12:00 UTC + n*7d)\n`);

const fmtDate = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const fmtOff = (min: number) => (Number.isInteger(min) ? formatOffset(min) : `${min.toFixed(2)}m`);

// ---- by-zone pivot: zone -> the years it mismatches ----

if (byZone) {
  const yearsOf = new Map<string, { irregular: boolean; years: number[] }>();

  for (const { year, mismatches } of result.years) {
    for (const m of mismatches) {
      (yearsOf.get(m.zone) ?? yearsOf.set(m.zone, { irregular: m.irregular, years: [] }).get(m.zone)!).years.push(year);
    }
  }

  // America/Europe first (the zones most users care about), then the rest,
  // irregular zones last; within a group, most mismatch years first
  const rank = (zone: string, irregular: boolean) =>
    irregular ? 2 : zone.startsWith('America/') || zone.startsWith('Europe/') ? 0 : 1;

  const rows = [...yearsOf]
    .map(([zone, { irregular, years: yrs }]) => ({ zone, irregular, years: yrs, rank: rank(zone, irregular) }))
    .sort((a, b) => a.rank - b.rank || b.years.length - a.years.length || (a.zone < b.zone ? -1 : 1));

  // consecutive years -> ranges: [1995..2006, 2008, 2030] -> "1995-2006, 2008, 2030"
  const fmtYears = (yrs: number[]) => {
    const parts: string[] = [];

    for (let i = 0; i < yrs.length; ) {
      let j = i;

      while (j + 1 < yrs.length && (yrs[j + 1]!) === yrs[j]! + 1) j++;

      parts.push(j > i ? `${yrs[i]}-${yrs[j]}` : `${yrs[i]}`);
      i = j + 1;
    }

    return parts.join(', ');
  };

  const nameW = Math.max(8, ...rows.map((r) => r.zone.length + (r.irregular ? 12 : 0)));

  console.log(`${'timezone'.padEnd(nameW)}  years (${rows.length} zones mismatch at least once)`);
  console.log('-'.repeat(nameW + 42));

  for (const r of rows) {
    console.log(`${(r.zone + (r.irregular ? ' [irregular]' : '')).padEnd(nameW)}  ${fmtYears(r.years)}`);
  }
} else {
  const header = `year   mismatch  agree      zones`;
  console.log(header);
  console.log('-'.repeat(header.length + 40));

  for (const { year, mismatches: ms } of result.years) {
    const names = ms.map((m) => m.zone);
    const shown = verbose ? [] : names.slice(0, 4); // verbose lists all below
    const more = verbose ? 0 : names.length - shown.length;
    const mark = year === bakeYear ? '*' : ' ';

    console.log(
      `${year}${mark}  ${String(ms.length).padStart(6)}    ${`${sweptZones - ms.length}/${sweptZones}`.padEnd(9)}  ` +
        `${shown.join(', ')}${more > 0 ? `${shown.length > 0 ? ', ' : ''}+${more} more` : ''}`
    );

    if (verbose) {
      for (const m of ms) {
        console.log(
          `           ${m.zone}${m.irregular ? ' [irregular]' : ''}: baked ${fmtOff(m.baked)} vs icu ${fmtOff(m.actual)} at ${fmtDate(m.ts)}`
        );
      }
    }
  }
}

// ---- validity windows & claim checks ----

const mismatchesByYear = new Map<number, Mismatch[]>(result.years.map((y) => [y.year, y.mismatches]));

// widest contiguous year run containing the bake year where `ok` holds
function window(ok: (ms: Mismatch[]) => boolean): [number, number] | null {
  if (!ok(mismatchesByYear.get(bakeYear)!)) return null;

  let lo = bakeYear;
  let hi = bakeYear;

  while (mismatchesByYear.has(lo - 1) && ok(mismatchesByYear.get(lo - 1)!)) lo--;
  while (mismatchesByYear.has(hi + 1) && ok(mismatchesByYear.get(hi + 1)!)) hi++;

  return [lo, hi];
}

if (mismatchesByYear.has(bakeYear)) {
  const strictWin = window((ms) => ms.length === 0);
  const regularWin = window((ms) => ms.every((m) => m.irregular));

  const fmtWin = (w: [number, number] | null) =>
    w === null ? 'none (bake year itself mismatches!)' : `${w[0]}-${w[1]}${w[0] === fromYear ? ' (hit sweep edge)' : ''}${w[1] === toYear ? ' (hit sweep edge)' : ''}`;

  console.log(`\nvalidity windows (contiguous around bake year ${bakeYear}):`);
  console.log(`  all zones agree:            ${fmtWin(strictWin)}`);
  console.log(`  irregular zones excluded:   ${fmtWin(regularWin)}`);

  if (regularWin !== null) {
    // what a production hybrid would bake alongside the table, with the future
    // edge capped (~1-2y) since forward agreement is projection, not fact
    const capTo = Math.min(regularWin[1], bakeYear + 2);

    console.log(`  suggested validFrom/validTo: ${regularWin[0]}-01-01 / ${capTo + 1}-01-01 (future edge capped at bake year + 2)`);
  }
} else {
  console.log(`\nvalidity windows: n/a — sweep range ${fromYear}-${toYear} does not include the bake year ${bakeYear}`);
}

const bakeMismatches = mismatchesByYear.get(bakeYear) ?? [];

if (mismatchesByYear.has(bakeYear) && bakeMismatches.length > 0) {
  console.log(`\nERROR: ${bakeMismatches.length} zone(s) mismatch in the bake year ${bakeYear} itself — the table is`);
  console.log(`stale vs this runtime's ICU. Regenerate: bun run gen`);
  process.exit(1);
}
