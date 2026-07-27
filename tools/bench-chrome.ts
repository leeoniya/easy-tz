// CPU/memory benchmark of this repo's impls, plus (with --libs) the
// comparison libraries, inside chrome-headless-shell (stable).
// PERFORMANCE ONLY — correctness lives in tools/test-chrome.ts (bun run
// test), which also covers the no-Temporal (Safari) fallback paths; their
// perf is not re-benched here since the fallback is impl 04's path and
// benches identically to it. This is the always-run pass and so also prints
// the feature matrix; the bun pass (bench/bench.ts) is opt-in via --bun.
// Each impl runs in FRESH pages so its cold start includes real
// formatter/table initialization; cold is the median over 5 fresh-page
// samples (3 for a very slow one) since a single sample varies ±40% with
// ambient load. Each comparison library gets its OWN bundle, so a page never parses
// tzdata belonging to another library (or to our impls), and bundles are served
// over a local HTTP server so Chrome can reuse its compiled code cache across
// those fresh pages instead of recompiling per page. A `rss MB` column
// reads the VmRSS of that page's own renderer process from /proc (Linux),
// capturing ICU's native formatter memory. RSS deltas approximate peak
// allocation — treat them comparatively.
//
// Run: bun run bench  (or bun run bench:libs / bun run bench:all)

import { readdirSync, readFileSync } from 'node:fs';
import { impls } from '../impls/registry.ts';
import { minifiedSizes } from '../bench/size.ts';
import { bundleBrowserEntry, bundleSingleLibEntry, launchChrome } from './chrome-harness.ts';
import { printTable } from './print-table.ts';
import { GETONE_ZONE, GETONE_CALLS, GETONE_STEP_HOURS, SAMPLING_NOTE, SWEEP_NOTE, type SampleBudget } from './bench-config.ts';
import { withLibs } from './bench-opts.ts';
import type { BenchResult, BenchOneResult } from './bench-browser-entry.ts';

// this browser's renderer processes (Linux /proc scan). A renderer's cmdline
// carries no target information, so a page's OWN renderer is identified by
// diffing this set across the newPage() that spawns it: Puppeteer opens each
// page in its own browsing instance, hence its own process, which measured
// reliable (exactly one new pid on each of 10 consecutive pages). Attributing
// to that single pid keeps the always-open initial about:blank page — and any
// spare renderer Chrome decides to keep warm — out of the reading.
function rendererPids(): Set<number> {
  const pids = new Set<number>();

  try {
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;

      try {
        const cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8');

        if (cmdline.includes('--type=renderer') && cmdline.includes('headless')) pids.add(+entry);
      } catch {
        // process exited mid-scan
      }
    }
  } catch {
    // no /proc (non-Linux): the rss column reports n/a
  }

  return pids;
}

// VmRSS of one process, or null if it's gone or /proc is unavailable
function rssBytes(pid: number): number | null {
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));

    return m == null ? null : +m[1]! * 1024;
  } catch {
    return null;
  }
}

// bundles are keyed by NAME rather than impl id: our impls share one (~34KB
// total, so all four are benched from it), while each comparison library is
// bundled alone, since their tzdata (~0.3-1.8MB apiece) inflates the parse/GC
// cost of any page that loads it — which distorts cold-start readings and,
// multiplied by the fresh page per cold sample, dominated the benchmark's wall
// time. Sharing one name across our four impls also means their 20 pages all
// load a single url, which is what makes the code cache below pay off.
const IMPLS_BUNDLE = 'impls';

const bundles = new Map<string, string>([[IMPLS_BUNDLE, await bundleBrowserEntry()]]);

// dynamic so that a no-libs run never loads the libraries' ~4MB of tzdata
// into this orchestrating process either
const libImpls = withLibs ? (await import('../impls/lib-registry.ts')).libImpls : [];

for (const lib of libImpls) bundles.set(lib.id, await bundleSingleLibEntry(lib.id));

// Bundles are LOADED OVER HTTP as a <script src>, not injected with
// page.evaluate(code). Two reasons, both measured on the 2.2MB bigeasy bundle
// across 8 fresh pages: page.evaluate ships the whole source over the DevTools
// protocol on every page (339ms median), whereas an http fetch of the same
// bundle costs 160ms — and because every page for a bundle requests the SAME
// url, Chrome reuses the V8 code cache it keeps in the profile's disk cache,
// taking it to 123ms.
//
// This does not move the boundary of what's timed — the script is compiled and
// executed by the time `load` fires, which is before any __cold/__bench call —
// but it does make the readings slightly FASTER and tighter than the
// page.evaluate era (04: cold 64.6 -> 59.6ms, miss 2.7 -> 1.8ms medians over 3
// runs), because the renderer no longer decodes and compiles a large source
// string immediately before the timed calls. Numbers from before this change
// are therefore mildly pessimistic rather than wrong.
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req) {
    const { pathname } = new URL(req.url);
    const code = bundles.get(pathname.split('/')[1] ?? '');

    if (code == null) return new Response('unknown bundle', { status: 404 });

    if (!pathname.endsWith('/bundle.js')) {
      return new Response('<!doctype html><meta charset=utf-8><title>bench</title><script src="bundle.js"></script>', {
        headers: { 'content-type': 'text/html' },
      });
    }

    return new Response(code, {
      headers: {
        'content-type': 'text/javascript',
        // far-future expiry: the code cache rides along in the http cache entry
        'cache-control': 'public, max-age=31536000',
      },
    });
  },
});

const origin = `http://127.0.0.1:${server.port}`;
const browser = await launchChrome();

try {
  const version = (await browser.version()).replace(/^HeadlessChrome\//, '');

  // a fresh page with `bundle` compiled and executed in it
  const openPage = async (bundle: string) => {
    const page = await browser.newPage();
    await page.goto(`${origin}/${bundle}/`, { waitUntil: 'load' });

    return page;
  };

  // probe page: discover impl ids and absorb fresh-browser warmup effects
  const probePage = await openPage(IMPLS_BUNDLE);
  const mainIds = (await probePage.evaluate('__benchIds')) as string[];
  await probePage.close();

  const jobs: [id: string, bundle: string][] = mainIds.map((id): [string, string] => [id, IMPLS_BUNDLE]);

  for (const lib of libImpls) jobs.push([lib.id, lib.id]);

  // A single cold sample varies ±40% with ambient load, so cold is reported as
  // the median over several fresh page contexts (the last of which also runs
  // the full hit/miss bench). The count is budgeted like the miss loops: every
  // impl here costs ~90-200ms per sample and so takes all `max`, while a
  // library whose first call alone is ~250ms falls back to `min`. Unlike the
  // miss loops this budget spans whole page lifecycles, not just the timed
  // call, since opening the page is most of the cost for a cheap impl.
  const COLD_SAMPLES: SampleBudget = { min: 3, max: 5, budgetMs: 500 };

  const results: (BenchResult & { rendererMB: number | null })[] = [];

  for (const [id, bundle] of jobs) {
    try {
      const colds: number[] = [];
      let coldSpentMs = 0;
      let coldTarget = COLD_SAMPLES.max;

      // one fewer than the target: the bench page below contributes the final
      // sample. The budget is consulted once, at the min - 1 boundary, so the
      // count lands on exactly min or max and never between — an even count
      // would leave the median off-center on a figure the README quotes.
      for (let s = 0; s < coldTarget - 1; s++) {
        const t0 = Bun.nanoseconds();
        const coldPage = await openPage(bundle);
        colds.push((await coldPage.evaluate(`__cold(${JSON.stringify(id)})`)) as number);
        await coldPage.close();
        coldSpentMs += (Bun.nanoseconds() - t0) / 1e6;

        if (colds.length === COLD_SAMPLES.min - 1 && coldSpentMs >= COLD_SAMPLES.budgetMs) coldTarget = COLD_SAMPLES.min;
      }

      const pidsBefore = rendererPids();
      const page = await openPage(bundle);

      // this page's renderer is live and holding the bundle by now. If the diff
      // is ever ambiguous the row reports rss as n/a, rather than quietly
      // substituting a differently-scoped number that would not be comparable.
      const spawned = [...rendererPids()].filter((p) => !pidsBefore.has(p));
      const pid = spawned.length === 1 ? spawned[0]! : null;

      const rssBefore = pid == null ? null : rssBytes(pid);
      const result = (await page.evaluate(`__bench(${JSON.stringify(id)})`)) as BenchResult;
      const rssAfter = pid == null ? null : rssBytes(pid);

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
      results.push({ id, zones: 0, coldMs: NaN, hitUs: NaN, missMedMs: NaN, histMedMs: NaN, missSamples: 0, formatters: 0, rendererMB: null });
    }
  }

  const sizes = await minifiedSizes(withLibs);
  const zoneCount = results.find((r) => r.zones > 0)?.zones ?? 0;

  console.log(
    `zones: ${zoneCount}, runtime: chrome-headless-shell ${version}` +
      (withLibs ? '' : ' (comparison libraries skipped — pass --libs to include them)')
  );
  console.log(`cold: median of ${COLD_SAMPLES.min}-${COLD_SAMPLES.max} fresh pages, ${SAMPLING_NOTE}\n`);

  // hit, miss and hist are medians over the sampling loops (hist = a miss in
  // a historical year, routing 07/10 through the era resolver). `n` is how many
  // samples the budget allowed — cheap impls take all 25, a ~100ms/call library
  // stops at 5, which costs it no accuracy (see MISS_SAMPLES in bench-config).
  printTable(
    ['impl', 'cold ms', 'hit µs', 'miss ms', 'hist ms', 'n', 'formatters', 'rss MB', 'bundle KB'],
    results.map((r) => [
      r.id,
      Number.isNaN(r.coldMs) ? 'err' : r.coldMs.toFixed(1),
      // 3 decimals: a memoized hit is single-digit ns once the loop is at its
      // optimized tier, which 2 decimals rounded to 0.00
      Number.isNaN(r.hitUs) ? 'err' : r.hitUs.toFixed(3),
      Number.isNaN(r.missMedMs) ? 'err' : r.missMedMs.toFixed(1),
      Number.isNaN(r.histMedMs) ? 'err' : r.histMedMs.toFixed(1),
      r.missSamples === 0 ? '-' : String(r.missSamples),
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
      const page = await openPage(IMPLS_BUNDLE);
      const r = (await page.evaluate(`__benchOne(${JSON.stringify(id)})`)) as BenchOneResult;
      await page.close();

      if (r.supported) oneResults.push(r);
    } catch (e) {
      console.error(`${id}: getTimeZoneAt bench failed in-browser (${(e as Error).message.split('\n')[0]!.slice(0, 80)})`);
    }
  }

  console.log(`\nsingle-zone getTimeZoneAt(): ${GETONE_ZONE}, ${GETONE_CALLS} timestamps/sweep (${GETONE_STEP_HOURS}h step)`);
  console.log(`${SWEEP_NOTE}\n`);

  // 10k ms are the wall time of the fastest pass over each sweep. hist routes 07
  // through the baked era resolver and (on this Temporal runtime) 10 through live
  // Temporal. passes: how many the budget allowed, cur/hist. formatters: one per
  // zone for the live-Intl impls, none baked.
  printTable(
    ['impl', '10k cur ms', '10k hist ms', 'passes', 'formatters'],
    oneResults.map((r) => [
      r.id,
      r.curMs.toFixed(2),
      r.histMs.toFixed(2),
      `${r.curPasses}/${r.histPasses}`,
      String(r.formatters),
    ])
  );

  // strategy/feature comparison matrix: features as rows, impls as columns
  // (all left-aligned — these are text values, not numbers). Static metadata
  // rather than a measurement, so it lives in this always-run pass.
  console.log('\nfeatures:\n');

  // summary rows (risk / cold / bundle) first, separator, then the details
  const featureKeys = Object.keys(impls[0]!.features);
  const summaryKeys = ['staleness risk', 'cold cost', 'rss'];
  const featureRow = (k: string) => [k, ...impls.map((i) => i.features[k] ?? '-')];

  printTable(
    ['feature', ...impls.map((i) => i.id)],
    [
      ...summaryKeys.map(featureRow),
      ['bundle', ...impls.map((i) => `${((sizes.get(i.id) ?? 0) / 1024).toFixed(1)} KB`)],
      null,
      ...featureKeys.filter((k) => !summaryKeys.includes(k)).map(featureRow),
    ],
    true // text matrix: all left-aligned
  );
} finally {
  await browser.close();
  await server.stop(true);
}
