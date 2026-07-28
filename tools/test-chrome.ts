// Chrome correctness tests, part of `bun run test`: runs every impl's
// fixture validation and letter-abbr coverage inside chrome-headless-shell,
// plus deep output-equality of table-backed impls against impl 04 (live
// Intl) — each also under a no-Temporal page that exercises the Safari
// fallback paths. Exits 1 on any fixture failure or vs-04 mismatch.
// The comparison libraries (separate bundle) run afterward as an
// INFORMATIONAL, non-gating pass: their scores and sample failures are
// printed but never fail the suite (findings live in comparison.md).
//
// Run: bun run test (chained after bun's unit tests)

import { bundleBrowserEntry, bundleLibBrowserEntry, launchChrome, KILL_TEMPORAL, NO_TEMPORAL_IDS } from './chrome-harness.ts';
import { printTable } from './print-table.ts';
import type { ValidateResult } from './bench-browser-entry.ts';
import type { InitInfo } from '../impls/08-verified-sharing/index.ts';

interface Vs04 {
  checked: number;
  mismatchCount: number;
  mismatches: string[];
}

// Every check below is a Vs04 tally per impl, and they all get summarized and
// reported the same two ways. Six copies of the reporting loop is how a check
// quietly stops failing the suite while still printing a reassuring count.
type Tallies = Iterable<readonly [string, Vs04]>;

function totals(tallies: Tallies): { passed: number; checked: number } {
  let checked = 0;
  let bad = 0;

  for (const [, t] of tallies) {
    checked += t.checked;
    bad += t.mismatchCount;
  }

  return { passed: checked - bad, checked };
}

// `what` names the check; it's appended to each impl's label, and empty when
// the label already says what was checked.
function reportFailures(what: string, tallies: Tallies): boolean {
  let failed = false;

  for (const [label, t] of tallies) {
    if (t.mismatchCount === 0) continue;

    failed = true;
    console.error(`\nFAIL ${label}${what}: ${t.mismatchCount}/${t.checked} mismatched (first ${t.mismatches.length}):`);

    for (const m of t.mismatches) console.error(`  ${m}`);
  }

  return failed;
}

const VS04_IDS = ['08-verified-sharing', '10-audited-rules', '07-baked-rules'];

const code = await bundleBrowserEntry();
const browser = await launchChrome();

try {
  const version = (await browser.version()).replace(/^HeadlessChrome\//, '');

  // temporal page: validation + vs04 for all impls
  const page = await browser.newPage();
  await page.evaluate(code);

  const implIds = (await page.evaluate('__implIds')) as string[];
  const intlNames = (await page.evaluate('__verifyIntlZoneNames()')) as { checked: number; failures: string[] };
  const rows: (ValidateResult & { label: string })[] = [];
  const vs04 = new Map<string, Vs04>();
  const aliasPairs = new Map<string, Vs04>();
  const currentApis = new Map<string, Vs04>();
  const fixedOffsets = new Map<string, Vs04>();
  const canonicalOnly = new Map<string, Vs04>();

  for (const id of implIds) {
    const r = (await page.evaluate(`__validate(${JSON.stringify(id)})`)) as ValidateResult;
    rows.push({ ...r, label: id });

    aliasPairs.set(id, (await page.evaluate(`__verifyAliasPairs(${JSON.stringify(id)})`)) as Vs04);
    currentApis.set(id, (await page.evaluate(`__verifyCurrentApis(${JSON.stringify(id)})`)) as Vs04);
    fixedOffsets.set(id, (await page.evaluate(`__verifyFixedOffsets(${JSON.stringify(id)})`)) as Vs04);
    canonicalOnly.set(id, (await page.evaluate(`__verifyCanonicalOnly(${JSON.stringify(id)})`)) as Vs04);
  }

  for (const id of VS04_IDS) {
    vs04.set(id, (await page.evaluate(`__verifyVs04(${JSON.stringify(id)})`)) as Vs04);
  }

  const init08 = rows.find((r) => r.id === '08-verified-sharing')?.init as InitInfo | null | undefined;

  // rollover resistance: past the generated year, 10 and 07 must remain
  // output-identical to live 04 for rule/static zones (irregular zones are
  // skipped: 07 clamps them by design; 10 recovers them with correct
  // offsets but generic GMT-style labels)
  type Future = Vs04 & { skipped: number };
  const future10 = (await page.evaluate(`__verifyFuture('10-audited-rules', true)`)) as Future;
  const future07 = (await page.evaluate(`__verifyFuture('07-baked-rules', true)`)) as Future;

  await page.close();

  // no-Temporal page: Safari fallback paths under V8/Chrome ICU
  const noTempPage = await browser.newPage();
  await noTempPage.evaluate(KILL_TEMPORAL);
  await noTempPage.evaluate(code);

  let init08NoT: InitInfo | null | undefined;

  for (const id of NO_TEMPORAL_IDS) {
    const r = (await noTempPage.evaluate(`__validate(${JSON.stringify(id)})`)) as ValidateResult;
    rows.push({ ...r, label: `${id} (no-T)` });

    if (id === '08-verified-sharing') init08NoT = r.init as InitInfo | null | undefined;

    vs04.set(`${id} (no-T)`, (await noTempPage.evaluate(`__verifyVs04(${JSON.stringify(id)})`)) as Vs04);
    aliasPairs.set(`${id} (no-T)`, (await noTempPage.evaluate(`__verifyAliasPairs(${JSON.stringify(id)})`)) as Vs04);
  }

  await noTempPage.close();

  console.log(`chrome correctness: ${rows[0]!.zones} zones, runtime: chrome-headless-shell ${version}\n`);

  printTable(
    ['impl', 'fixtures', 'letter abbrs', 'alias pairs', 'vs 04'],
    rows.map((r) => {
      const eq = vs04.get(r.label);
      const ap = aliasPairs.get(r.label);
      return [
        r.label,
        `${r.fixturesPassed}/${r.fixturesTotal}`,
        `${r.letterAbbrs}/${r.zones}`,
        ap == null ? '-' : `${ap.checked - ap.mismatchCount}/${ap.checked}`,
        eq == null ? '-' : `${eq.checked - eq.mismatchCount}/${eq.checked}`,
      ];
    })
  );

  console.log('\n(no-T) = Temporal global removed before load: Safari fallback paths under V8/Chrome ICU');
  console.log(`intl zone names: ${intlNames.checked - intlNames.failures.length}/${intlNames.checked} link pair spellings constructible`);

  // current-instant pair (getTimeZone vs getTimeZones); on a Temporal runtime
  // this is the only place impl 10's live-recovered zones get exercised
  const cur = totals(currentApis);

  console.log(`current-instant APIs: ${cur.passed}/${cur.checked} getTimeZone() results match getTimeZones()`);

  // fixed-offset ids Chrome accepts but never enumerates (Etc/GMT±N, UTC):
  // derived arithmetically by the baked impls, checked against live Intl
  const fix = totals(fixedOffsets);

  console.log(`fixed-offset ids: ${fix.passed}/${fix.checked} Etc/GMT±N + UTC single-zone lookups match live 04`);

  // withAliases = false: here the canonical survivors are often the spelling
  // Chrome's ICU never enumerated, so they exercise the zoneLinks bridge
  const can = totals(canonicalOnly);

  console.log(`canonical-only: ${can.passed}/${can.checked} withAliases=false list drops + substitutions correct`);

  if (init08) {
    console.log(
      `08 init (temporal): temporal=${init08.temporal}, verify ${init08.verifyMs.toFixed(1)}ms, ` +
        `${init08.sharedZones} zones sharing a rep formatter, ${init08.healedZones} healed (split), ${init08.healedAliases} aliases dropped`
    );
  }

  if (init08NoT) {
    console.log(`08 init (no-T): temporal=${init08NoT.temporal} (hints ignored; plain-04 fallback)`);
  }

  console.log(
    `10 rollover audit (2027 instants, table year 2026): ${future10.checked - future10.mismatchCount}/${future10.checked} match live 04 (${future10.skipped} irregular-zone checks recovered w/ generic labels)`
  );
  console.log(
    `07 rollover rules (2027 instants, table year 2026): ${future07.checked - future07.mismatchCount}/${future07.checked} match live 04 (${future07.skipped} irregular-zone checks clamped by design)`
  );

  // --- assertions ---
  let failed = false;

  if (intlNames.failures.length > 0) {
    failed = true;
    console.error(`FAIL intl zone names: not constructible: ${intlNames.failures.join(', ')}`);
  }

  for (const r of rows) {
    if (r.fixturesPassed !== r.fixturesTotal) {
      failed = true;
      console.error(`FAIL ${r.label}: fixtures ${r.fixturesPassed}/${r.fixturesTotal}`);

      for (const f of r.fixtureFailures) console.error(`  ${f}`);
    }
  }

  const checks: [string, Tallies][] = [
    ['', [['10 rollover audit', future10], ['07 rollover rules', future07]]],
    [' vs 04', vs04],
    [' alias pairs', aliasPairs],
    [' current-instant APIs', currentApis],
    [' fixed-offset ids', fixedOffsets],
    [' canonical-only', canonicalOnly],
  ];

  for (const [what, tallies] of checks) {
    if (reportFailures(what, tallies)) failed = true;
  }

  if (failed) process.exit(1);

  console.log('\nchrome correctness: all checks passed');

  // ---- library comparison impls: INFORMATIONAL, never gates the exit ----
  // same fixtures + letter-abbr + vs-04 checks run against the bundled-tzdata
  // libraries; failures here reflect their data vintage and tzdata-vs-CLDR
  // abbreviation conventions, not bugs in this repo
  const libPage = await browser.newPage();
  await libPage.evaluate(await bundleLibBrowserEntry());

  const libIds = (await libPage.evaluate('__benchIds')) as string[];

  if (libIds.length > 0) {
    const libRows: string[][] = [];
    const details: string[] = [];

    for (const id of libIds) {
      const v = (await libPage.evaluate(`__validate(${JSON.stringify(id)})`)) as ValidateResult;
      const eq = (await libPage.evaluate(`__verifyVs04(${JSON.stringify(id)})`)) as Vs04;

      libRows.push([
        id,
        `${v.fixturesPassed}/${v.fixturesTotal}`,
        `${v.letterAbbrs}/${v.zones}`,
        `${eq.checked - eq.mismatchCount}/${eq.checked}`,
      ]);

      for (const f of v.fixtureFailures) details.push(`  ${id}: fixture ${f}`);
      for (const m of eq.mismatches.slice(0, 3)) details.push(`  ${id}: vs04 ${m}`);
    }

    console.log('\nlibrary correctness (informational, non-gating):\n');
    printTable(['library impl', 'fixtures', 'letter abbrs', 'vs 04'], libRows);

    if (details.length > 0) {
      console.log('\nsample failures:');
      for (const d of details) console.log(d);
    }
  }

  await libPage.close();
} finally {
  await browser.close();
}
