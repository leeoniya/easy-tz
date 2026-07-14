// CPU/memory benchmark of all impls inside chrome-headless-shell (stable),
// PERFORMANCE ONLY — correctness lives in tools/test-chrome.ts (bun run
// test), which also covers the no-Temporal (Safari) fallback paths; their
// perf is not re-benched here since the fallback is impl 04's path and
// benches identically to it. Each impl runs in a FRESH page so its cold
// start includes real formatter/table initialization. A `rss MB` column
// reads the renderer process's VmRSS from /proc (Linux), capturing ICU's
// native formatter memory. RSS deltas approximate peak allocation — treat
// them comparatively.
//
// Run: bun run bench

import { readdirSync, readFileSync } from 'node:fs';
import { minifiedSizes } from '../bench/size.ts';
import { bundleBrowserEntry, launchChrome } from './chrome-harness.ts';
import { printTable } from './print-table.ts';
import type { BenchResult } from './bench-browser-entry.ts';

// sum of VmRSS across this browser's renderer processes (Linux /proc scan)
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

const code = await bundleBrowserEntry();
const browser = await launchChrome();

try {
  const version = (await browser.version()).replace(/^HeadlessChrome\//, '');

  // probe page: discover impl ids and absorb fresh-browser warmup effects
  const probePage = await browser.newPage();
  await probePage.evaluate(code);
  const implIds = (await probePage.evaluate('__implIds')) as string[];
  await probePage.close();

  const results: (BenchResult & { rendererMB: number | null })[] = [];

  for (const id of implIds) {
    const page = await browser.newPage();

    await page.evaluate(code);

    const rssBefore = rendererRssBytes();
    const result = (await page.evaluate(`__bench(${JSON.stringify(id)})`)) as BenchResult;
    const rssAfter = rendererRssBytes();

    results.push({
      ...result,
      rendererMB: rssBefore !== null && rssAfter !== null ? (rssAfter - rssBefore) / 1048576 : null,
    });

    await page.close();
  }

  const sizes = await minifiedSizes();

  console.log(`zones: ${results[0]!.zones}, miss iterations: 25, runtime: chrome-headless-shell ${version}\n`);

  // hit and miss are medians over the iteration loops
  printTable(
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

} finally {
  await browser.close();
}
