// CPU benchmark of all impls inside chrome-headless-shell (stable). Each
// impl runs in a FRESH page so its cold start includes real formatter/table
// initialization. Also reports the JS heap delta per page (note: ICU's
// native formatter memory is not part of the JS heap, so table-based impls
// look closer to Intl-based ones here than in RSS terms).
//
// The generated tables should be Chrome-aligned first (bun run gen:chrome),
// otherwise table-based impls are benched against mismatched data.
//
// Run: bun run bench:chrome

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { bundle } from '@swc/core';
import puppeteer from 'puppeteer-core';
import { findHeadlessShell } from './browser.ts';
import { selectTables } from './use-tables.ts';
import { activeVariant } from './table-files.ts';
import { minifiedSizes } from '../bench/size.ts';
import type { BenchResult } from './bench-browser-entry.ts';

// sum of VmRSS across this browser's renderer processes (Linux /proc scan);
// captures ICU's native formatter memory that the JS heap metric misses
function rendererRssBytes(): number | null {
  try {
    let total = 0;
    let found = false;

    for (const pid of readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue;

      try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');

        if (!cmdline.includes('--type=renderer') || !cmdline.includes('headless')) continue;

        const status = readFileSync(`/proc/${pid}/status`, 'utf8');
        const m = /VmRSS:\s+(\d+) kB/.exec(status);

        if (m) {
          total += +m[1]! * 1024;
          found = true;
        }
      } catch {
        // process exited mid-scan
      }
    }

    return found ? total : null;
  } catch {
    return null;
  }
}

if (!existsSync(new URL('../shared/tables/chrome/schedule.ts', import.meta.url))) {
  console.error('no Chrome table set — run: bun run gen:chrome');
  process.exit(1);
}

// bundle against the Chrome table variant regardless of the active selector,
// then restore the selection so the repo state is untouched
const previousVariant = activeVariant() ?? 'bun';

selectTables('chrome');

let bundled;

try {
  const entry = new URL('./bench-browser-entry.ts', import.meta.url).pathname;

  bundled = await bundle({
    entry: { main: entry },
    output: { name: 'main', path: '.' },
    module: {},
    mode: 'production',
    target: 'browser',
    options: { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' } },
  });
} finally {
  selectTables(previousVariant);
}

const browser = await puppeteer.launch({
  executablePath: await findHeadlessShell(),
  args: ['--no-sandbox', '--disable-gpu'],
});

try {
  const version = (await browser.version()).replace(/^HeadlessChrome\//, '');

  // discover impl ids from the bundle itself
  const probePage = await browser.newPage();
  await probePage.evaluate(bundled['main']!.code);
  const implIds = (await probePage.evaluate('__implIds')) as string[];
  await probePage.close();

  const results: (BenchResult & { rendererMB: number | null })[] = [];

  for (const id of implIds) {
    const page = await browser.newPage();

    await page.evaluate(bundled['main']!.code);

    const rssBefore = rendererRssBytes();
    const result = (await page.evaluate(`__bench(${JSON.stringify(id)})`)) as BenchResult;
    const rssAfter = rendererRssBytes();

    results.push({
      ...result,
      rendererMB: rssBefore !== null && rssAfter !== null ? (rssAfter - rssBefore) / 1048576 : null,
    });

    await page.close();
  }

  // deep output-equality of table-backed impls vs 04, in a fresh page so no
  // bench was polluted by another impl's formatters
  const verifyPage = await browser.newPage();

  await verifyPage.evaluate(bundled['main']!.code);

  const vs04 = new Map<string, { checked: number; mismatchCount: number; mismatches: string[] }>();

  for (const id of ['08-verified-reps', '09-live-offsets', '07-precomputed']) {
    vs04.set(
      id,
      (await verifyPage.evaluate(`__verifyVs04(${JSON.stringify(id)})`)) as {
        checked: number;
        mismatchCount: number;
        mismatches: string[];
      }
    );
  }

  await verifyPage.close();

  console.log(`zones: ${results[0]!.zones}, miss iterations: 25, runtime: chrome-headless-shell ${version}\n`);

  const table = (headers: string[], cells: string[][]) => {
    const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i]!.length)));
    // first column (impl) left-aligned, value columns right-aligned
    const line = (c: string[]) =>
      c.map((v, i) => (i === 0 ? v.padEnd(widths[i]!) : v.padStart(widths[i]!))).join('  ');

    console.log(line(headers));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const c of cells) console.log(line(c));
  };

  console.log('performance:\n');
  const sizes = await minifiedSizes();

  // hit and miss are medians over the iteration loops
  table(
    ['impl', 'cold ms', 'hit µs', 'miss ms', 'formatters', 'rss MB', 'bundle KB'],
    results.map((r) => [
      r.id,
      r.coldMs.toFixed(1),
      r.hitUs.toFixed(2),
      r.missMedMs.toFixed(1),
      String(r.formatters),
      r.rendererMB === null ? 'n/a' : r.rendererMB.toFixed(2),
      ((sizes.get(r.id) ?? 0) / 1024).toFixed(1),
    ])
  );

  console.log('\ncorrectness:\n');
  table(
    ['impl', 'fixtures', 'letter abbrs', 'vs 04'],
    results.map((r) => {
      const eq = vs04.get(r.id);
      return [
        r.id,
        `${r.fixturesPassed}/${r.fixturesTotal}`,
        `${r.letterAbbrs}/${r.zones}`,
        eq === undefined ? '-' : `${eq.checked - eq.mismatchCount}/${eq.checked}`,
      ];
    })
  );

  const init08 = results.find((r) => r.id === '08-verified-reps')?.init;

  if (init08) {
    console.log(
      `\n08 init: temporal=${init08.temporal}, verify ${init08.verifyMs.toFixed(1)}ms, ` +
        `${init08.sharedZones} zones sharing a rep formatter, ${init08.healedZones} healed (split), ${init08.healedAliases} aliases dropped`
    );
  }

  let failed = false;

  for (const [id, eq] of vs04) {
    if (eq.mismatchCount > 0) {
      failed = true;
      console.log(`\n${id} vs 04: ${eq.mismatchCount}/${eq.checked} MISMATCHED (first ${eq.mismatches.length}):`);

      for (const m of eq.mismatches) console.log(`  ${m}`);
    }
  }

  if (failed) process.exit(1);
} finally {
  await browser.close();
}
