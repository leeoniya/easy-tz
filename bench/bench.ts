// Bun performance pass across all implementations + comparison libraries:
// cold/hit/miss timings, Intl formatter constructions, subprocess RSS, and
// minified bundle size. Correctness lives in the test suites, not here.
// Run: bun bench/bench.ts

import { impls } from '../impls/registry.ts';
import { libImpls } from '../impls/lib-registry.ts';
import { printTable } from '../tools/print-table.ts';
import { zones } from '../shared/zones.ts';
import { genMeta } from '../shared/schedule.ts';
import { minifiedSizes } from './size.ts';

const ITERATIONS = 25;
const HOUR_MS = 3_600_000;
const BASE_TS = Date.UTC(2026, 5, 1, 12, 0);
// pre-2007-US / EU-stable / single-year-DST era: a miss here routes the
// rule-baking impls (07, 10) through the historical era resolver
// (shared/history.ts: resolveHistory over every history class) instead of the
// year-independent schedule, so the cost of the baked history is measured
// rather than assumed. Intl-based impls (04, 08) and the libraries call the
// same formatter path regardless of year, so their hist column tracks miss.
const HIST_TS = Date.UTC(2000, 5, 1, 12, 0);

// three perf loops per impl:
// - hit:  timestamps stay within one hour bucket -> hour-bucket memo hits
// - miss: each iteration advances to the next hour bucket -> full recompute
//         (current year: schedule path for 07/10)
// - hist: same as miss but in a historical year -> exercises the era resolver
const hitTimestamps = Array.from({ length: ITERATIONS }, (_, i) => BASE_TS + i * 1000);
const missTimestamps = Array.from({ length: ITERATIONS }, (_, i) => BASE_TS + (i + 1) * HOUR_MS);
const histTimestamps = Array.from({ length: ITERATIONS }, (_, i) => HIST_TS + (i + 1) * HOUR_MS);

interface Row {
  id: string;
  coldMs: string;
  hitMedUs: string;
  missMedMs: string;
  histMedMs: string;
  formatters: string;
  rssMB: string;
}

const rows: Row[] = [];

const benchImpls = [...impls, ...libImpls];

for (const impl of benchImpls) {
  // the warm-up below primes this impl's formatter caches; the true cold
  // cost is measured separately in fresh subprocesses.
  const timeMs = (ts: number) => {
    const t0 = Bun.nanoseconds();
    impl.getTimeZonesAt(ts);
    return (Bun.nanoseconds() - t0) / 1e6;
  };

  // brief untimed warm-up (formatter caches + JIT + memo paths) — replaces
  // the warming the validation sweep used to provide, at ~2% of its cost;
  // both the current-year schedule path and the historical era path are
  // primed so neither eats first-call JIT in the timed loops
  for (let i = 0; i < 5; i++) impl.getTimeZonesAt(BASE_TS - (i + 1) * HOUR_MS);
  for (let i = 0; i < 5; i++) impl.getTimeZonesAt(HIST_TS - (i + 1) * HOUR_MS);

  impl.getTimeZonesAt(BASE_TS); // populate the hour-bucket memo slot
  const hitTimes = hitTimestamps.map(timeMs);

  const missTimes = missTimestamps.map(timeMs);
  const histTimes = histTimestamps.map(timeMs);

  const median = (xs: number[]) => xs.toSorted((a, b) => a - b)[xs.length >> 1]!;

  rows.push({
    id: impl.id,
    coldMs: '-',
    hitMedUs: (median(hitTimes) * 1000).toFixed(1),
    missMedMs: median(missTimes).toFixed(1),
    histMedMs: median(histTimes).toFixed(1),
    formatters: '-',
    rssMB: '-',
  });
}

// true cold-start cost (formatter construction) measured in fresh subprocesses
for (const row of rows) {
  const proc = Bun.spawnSync({
    cmd: [
      process.execPath,
      '-e',
      `// counting proxy over Intl.DateTimeFormat: catches library-internal
       // formatter constructions too, not just this repo's fmtCache. Installed
       // before the first getTimeZonesAt() call (construction is lazy).
       const { installIntlCounter, intlConstructCount } = await import(${JSON.stringify(new URL('../shared/intl-count.ts', import.meta.url).pathname)});
       installIntlCounter();
       const { impls } = await import(${JSON.stringify(new URL('../impls/registry.ts', import.meta.url).pathname)});
       const { libImpls } = await import(${JSON.stringify(new URL('../impls/lib-registry.ts', import.meta.url).pathname)});
       const impl = [...impls, ...libImpls].find((i) => i.id === ${JSON.stringify(row.id)});
       Bun.gc(true);
       const rss0 = process.memoryUsage().rss;
       const t0 = Bun.nanoseconds();
       impl.getTimeZonesAt(${Date.UTC(2026, 6, 15)});
       const cold = (Bun.nanoseconds() - t0) / 1e6;
       for (let i = 1; i <= 25; i++) impl.getTimeZonesAt(${Date.UTC(2026, 6, 15)} + i * 3600000);
       Bun.gc(true);
       const rssMB = (process.memoryUsage().rss - rss0) / 1048576;
       console.log(JSON.stringify({ cold: +cold.toFixed(1), formatters: intlConstructCount(), rssMB: +rssMB.toFixed(2) }));`,
    ],
  });

  const parsed = JSON.parse(proc.stdout.toString() || '{}') as { cold?: number; formatters?: number; rssMB?: number };

  row.coldMs = parsed.cold?.toFixed(1) ?? 'err';
  row.formatters = String(parsed.formatters ?? '-');
  row.rssMB = parsed.rssMB?.toFixed(2) ?? 'err';
}

const sizes = await minifiedSizes();

console.log(`zones: ${zones.length}, iterations: ${ITERATIONS}, runtime: bun ${Bun.version}, tables: ${genMeta.host}\n`);

if (!genMeta.host.startsWith('bun')) {
  console.warn(`WARNING: active tables were generated by "${genMeta.host}" — run \`bun run tables bun\` for a fair bun benchmark\n`);
}

// hit, miss and hist are medians over the iteration loops (hist = a miss in a
// historical year, routing 07/10 through the era resolver). correctness lives
// in `bun run test` (bun suite + chrome correctness), not here. rss MB is the
// subprocess's delta across first call + 25 misses (mirrors the chrome
// bench's per-page semantics; excludes the memoized-result-only baseline).
printTable(
  ['impl', 'cold ms', 'hit µs', 'miss ms', 'hist ms', 'formatters', 'rss MB', 'bundle KB'],
  rows.map((r) => [
    r.id,
    r.coldMs,
    r.hitMedUs,
    r.missMedMs,
    r.histMedMs,
    r.formatters,
    r.rssMB,
    ((sizes.get(r.id) ?? 0) / 1024).toFixed(1),
  ])
);

// strategy/feature comparison matrix: features as rows, impls as columns
// (all left-aligned — these are text values, not numbers)
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
