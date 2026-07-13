// Chrome correctness tests, part of `bun run test`: runs every impl's
// fixture validation and letter-abbr coverage inside chrome-headless-shell,
// plus deep output-equality of table-backed impls against impl 04 (live
// Intl) — each also under a no-Temporal page that exercises the Safari
// fallback paths. Exits 1 on any fixture failure or vs-04 mismatch.
//
// Run: bun run test (chained after bun's unit tests)

import { bundleBrowserEntry, launchChrome, printTable, KILL_TEMPORAL, NO_TEMPORAL_IDS } from './chrome-harness.ts';
import type { ValidateResult } from './bench-browser-entry.ts';

interface Vs04 {
  checked: number;
  mismatchCount: number;
  mismatches: string[];
}

const VS04_IDS = ['08-verified-reps', '09-live-offsets', '07-precomputed'];

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

  const init08 = rows.find((r) => r.id === '08-verified-reps')?.init;

  await page.close();

  // no-Temporal page: Safari fallback paths under V8/Chrome ICU
  const noTempPage = await browser.newPage();
  await noTempPage.evaluate(KILL_TEMPORAL);
  await noTempPage.evaluate(code);

  let init08NoT: ValidateResult['init'];

  for (const id of NO_TEMPORAL_IDS) {
    const r = (await noTempPage.evaluate(`__validate(${JSON.stringify(id)})`)) as ValidateResult;
    rows.push({ ...r, label: `${id} (no-T)` });

    if (id === '08-verified-reps') init08NoT = r.init;

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

  // --- assertions ---
  let failed = false;

  for (const r of rows) {
    if (r.fixturesPassed !== r.fixturesTotal) {
      failed = true;
      console.error(`FAIL ${r.label}: fixtures ${r.fixturesPassed}/${r.fixturesTotal}`);
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
} finally {
  await browser.close();
}
