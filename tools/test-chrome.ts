// Chrome correctness tests, part of `bun run test`: runs every impl's
// fixture validation and letter-abbr coverage inside chrome-headless-shell,
// plus deep output-equality of table-backed impls against impl 04 (live
// Intl) — each also under a no-Temporal page that exercises the Safari
// fallback paths. Exits 1 on any fixture failure or vs-04 mismatch.
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

const VS04_IDS = ['08-verified-sharing', '10-audited-rules', '07-baked-rules'];

const code = await bundleBrowserEntry();
const browser = await launchChrome();

try {
  const version = (await browser.version()).replace(/^HeadlessChrome\//, '');

  // temporal page: validation + vs04 for all impls
  const page = await browser.newPage();
  await page.evaluate(code);

  const implIds = (await page.evaluate('__implIds')) as string[];
  const rows: (ValidateResult & { label: string })[] = [];
  const vs04 = new Map<string, Vs04>();

  for (const id of implIds) {
    const r = (await page.evaluate(`__validate(${JSON.stringify(id)})`)) as ValidateResult;
    rows.push({ ...r, label: id });
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
  }

  await noTempPage.close();

  console.log(`chrome correctness: ${rows[0]!.zones} zones, runtime: chrome-headless-shell ${version}\n`);

  printTable(
    ['impl', 'fixtures', 'letter abbrs', 'vs 04'],
    rows.map((r) => {
      const eq = vs04.get(r.label);
      return [
        r.label,
        `${r.fixturesPassed}/${r.fixturesTotal}`,
        `${r.letterAbbrs}/${r.zones}`,
        eq === undefined ? '-' : `${eq.checked - eq.mismatchCount}/${eq.checked}`,
      ];
    })
  );

  console.log('\n(no-T) = Temporal global removed before load: Safari fallback paths under V8/Chrome ICU');

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

  for (const r of rows) {
    if (r.fixturesPassed !== r.fixturesTotal) {
      failed = true;
      console.error(`FAIL ${r.label}: fixtures ${r.fixturesPassed}/${r.fixturesTotal}`);
    }
  }

  for (const [label, f] of [['10 rollover audit', future10], ['07 rollover rules', future07]] as const) {
    if (f.mismatchCount > 0) {
      failed = true;
      console.error(`\nFAIL ${label}: ${f.mismatchCount}/${f.checked} mismatched (first ${f.mismatches.length}):`);

      for (const m of f.mismatches) console.error(`  ${m}`);
    }
  }

  for (const [label, eq] of vs04) {
    if (eq.mismatchCount > 0) {
      failed = true;
      console.error(`\nFAIL ${label} vs 04: ${eq.mismatchCount}/${eq.checked} mismatched (first ${eq.mismatches.length}):`);

      for (const m of eq.mismatches) console.error(`  ${m}`);
    }
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
