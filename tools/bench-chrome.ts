// CPU/memory benchmark of all impls + the comparison libraries (bundled
// separately so their ~4MB of tzdata never inflates our impls' pages)
// inside chrome-headless-shell (stable),
// PERFORMANCE ONLY — correctness lives in tools/test-chrome.ts (bun run
// test), which also covers the no-Temporal (Safari) fallback paths; their
// perf is not re-benched here since the fallback is impl 04's path and
// benches identically to it. Each impl runs in FRESH pages so its cold
// start includes real formatter/table initialization; cold is the median
// over 5 fresh-page samples since a single sample varies ±40% with ambient
// load. A `rss MB` column
// reads the renderer process's VmRSS from /proc (Linux), capturing ICU's
// native formatter memory. RSS deltas approximate peak allocation — treat
// them comparatively.
//
// Run: bun run bench

import { readdirSync, readFileSync } from 'node:fs';
import { minifiedSizes } from '../bench/size.ts';
import { bundleBrowserEntry, bundleLibBrowserEntry, launchChrome } from './chrome-harness.ts';
import { printTable } from './print-table.ts';
import { GETONE_ZONE, GETONE_CALLS, GETONE_STEP_HOURS } from './bench-config.ts';
import type { BenchResult, BenchOneResult } from './bench-browser-entry.ts';

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

// our impls and the comparison libraries are bundled SEPARATELY: the
// libraries carry ~4MB of tzdata whose parse/GC cost measurably inflates
// cold-start readings of any page that loads it alongside our ~34KB
const mainCode = await bundleBrowserEntry();
const libCode = await bundleLibBrowserEntry();
const browser = await launchChrome();

try {
  const version = (await browser.version()).replace(/^HeadlessChrome\//, '');

  // probe page: discover impl ids and absorb fresh-browser warmup effects
  const probePage = await browser.newPage();
  await probePage.evaluate(mainCode);
  const mainIds = (await probePage.evaluate('__benchIds')) as string[];
  await probePage.close();

  const libProbe = await browser.newPage();
  await libProbe.evaluate(libCode);
  const libIds = (await libProbe.evaluate('__benchIds')) as string[];
  await libProbe.close();

  const jobs: [id: string, code: string][] = [
    ...mainIds.map((id): [string, string] => [id, mainCode]),
    ...libIds.map((id): [string, string] => [id, libCode]),
  ];

  // a single cold sample varies ±40% with ambient load, so cold is reported
  // as the median over COLD_SAMPLES fresh page contexts (the last of which
  // also runs the full hit/miss bench)
  const COLD_SAMPLES = 5;

  const results: (BenchResult & { rendererMB: number | null })[] = [];

  for (const [id, code] of jobs) {
    try {
      const colds: number[] = [];

      for (let s = 0; s < COLD_SAMPLES - 1; s++) {
        const coldPage = await browser.newPage();
        await coldPage.evaluate(code);
        colds.push((await coldPage.evaluate(`__cold(${JSON.stringify(id)})`)) as number);
        await coldPage.close();
      }

      const page = await browser.newPage();
      await page.evaluate(code);

      const rssBefore = rendererRssBytes();
      const result = (await page.evaluate(`__bench(${JSON.stringify(id)})`)) as BenchResult;
      const rssAfter = rendererRssBytes();

      await page.close();

      colds.push(result.coldMs);
      colds.sort((a, b) => a - b);

      results.push({
        ...result,
        coldMs: colds[colds.length >> 1]!,
        rendererMB: rssBefore !== null && rssAfter !== null ? (rssAfter - rssBefore) / 1048576 : null,
      });
    } catch (e) {
      // e.g. a comparison library whose bundle is browser-incompatible —
      // report the row as failed rather than aborting the whole bench
      console.error(`${id}: failed in-browser (${(e as Error).message.split('\n')[0]!.slice(0, 80)})`);
      results.push({ id, zones: 0, coldMs: NaN, hitUs: NaN, missMedMs: NaN, histMedMs: NaN, formatters: 0, rendererMB: null });
    }
  }

  const sizes = await minifiedSizes();
  const zoneCount = results.find((r) => r.zones > 0)?.zones ?? 0;

  console.log(`zones: ${zoneCount}, miss iterations: 25, runtime: chrome-headless-shell ${version}\n`);

  // hit, miss and hist are medians over the iteration loops (hist = a miss in
  // a historical year, routing 07/10 through the era resolver)
  printTable(
    ['impl', 'cold ms', 'hit µs', 'miss ms', 'hist ms', 'formatters', 'rss MB', 'bundle KB'],
    results.map((r) => [
      r.id,
      Number.isNaN(r.coldMs) ? 'err' : r.coldMs.toFixed(1),
      Number.isNaN(r.hitUs) ? 'err' : r.hitUs.toFixed(2),
      Number.isNaN(r.missMedMs) ? 'err' : r.missMedMs.toFixed(1),
      Number.isNaN(r.histMedMs) ? 'err' : r.histMedMs.toFixed(1),
      Number.isNaN(r.coldMs) ? '-' : String(r.formatters),
      r.rendererMB === null ? 'n/a' : r.rendererMB.toFixed(2),
      ((sizes.get(r.id) ?? 0) / 1024).toFixed(1),
    ])
  );

  // single-zone getTimeZoneAt() sweep — this repo's impls only (the comparison
  // libraries expose no equivalent single-zone API). Each runs in a fresh page
  // so its formatter count reflects just this workload.
  const oneResults: BenchOneResult[] = [];

  for (const id of mainIds) {
    try {
      const page = await browser.newPage();
      await page.evaluate(mainCode);
      const r = (await page.evaluate(`__benchOne(${JSON.stringify(id)})`)) as BenchOneResult;
      await page.close();

      if (r.supported) oneResults.push(r);
    } catch (e) {
      console.error(`${id}: getTimeZoneAt bench failed in-browser (${(e as Error).message.split('\n')[0]!.slice(0, 80)})`);
    }
  }

  console.log(`\nsingle-zone getTimeZoneAt(): ${GETONE_ZONE}, ${GETONE_CALLS} timestamps/sweep (${GETONE_STEP_HOURS}h step)\n`);

  // cur/hist ns are per-call; 10k ms are the totals for each sweep. hist routes
  // 07 through the baked era resolver and (on this Temporal runtime) 10 through
  // live Temporal. formatters: one per zone for the live-Intl impls, none baked.
  printTable(
    ['impl', 'cur ns/call', 'hist ns/call', '10k cur ms', '10k hist ms', 'formatters'],
    oneResults.map((r) => [
      r.id,
      ((r.curMs * 1e6) / r.calls).toFixed(0),
      ((r.histMs * 1e6) / r.calls).toFixed(0),
      r.curMs.toFixed(2),
      r.histMs.toFixed(2),
      String(r.formatters),
    ])
  );

} finally {
  await browser.close();
}
