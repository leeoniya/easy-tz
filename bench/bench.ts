// Bun performance pass across this repo's implementations (plus, with --libs,
// the comparison libraries): cold/hit/miss timings, Intl formatter
// constructions, subprocess RSS, and minified bundle size. Correctness lives
// in the test suites, not here.
// Run: bun bench/bench.ts [--libs]

import { impls } from '../impls/registry.ts';
import { printTable } from '../tools/print-table.ts';
import { zones } from '../shared/zones.ts';
import { genMeta } from '../shared/schedule.ts';
import { minifiedSizes } from './size.ts';
import {
  GETONE_ZONE,
  GETONE_CALLS,
  GETONE_STEP_MS,
  GETONE_STEP_HOURS,
  GETONE_CUR_BASE,
  GETONE_HIST_BASE,
  MISS_SAMPLES,
  WARMUP_SAMPLES,
  SAMPLING_NOTE,
  SWEEP_NOTE,
  sampleTimes,
  median,
} from '../tools/bench-config.ts';
import { withLibs } from '../tools/bench-opts.ts';

const HIT_ITERATIONS = 25;
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
//         (always the full count: memo hits are sub-µs, so sampling is free)
// - miss: each iteration advances to the next hour bucket -> full recompute
//         (current year: schedule path for 07/10)
// - hist: same as miss but in a historical year -> exercises the era resolver
// miss/hist are sampled under MISS_SAMPLES' time budget rather than a fixed
// count, since the median is no more stable at 25 samples than at 5.
const hitTimestamps = Array.from({ length: HIT_ITERATIONS }, (_, i) => BASE_TS + i * 1000);

interface Row {
  id: string;
  coldMs: string;
  hitMedUs: string;
  missMedMs: string;
  histMedMs: string;
  missSamples: string;
  formatters: string;
  rssMB: string;
}

const rows: Row[] = [];

// the library registry pulls in ~4MB of tzdata across the 5 libraries, so it's
// imported only when those rows are actually being measured
const benchImpls = withLibs ? [...impls, ...(await import('../impls/lib-registry.ts')).libImpls] : impls;

const nowMs = () => Bun.nanoseconds() / 1e6;

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
  sampleTimes(nowMs, (i) => impl.getTimeZonesAt(BASE_TS - (i + 1) * HOUR_MS), WARMUP_SAMPLES);
  sampleTimes(nowMs, (i) => impl.getTimeZonesAt(HIST_TS - (i + 1) * HOUR_MS), WARMUP_SAMPLES);

  impl.getTimeZonesAt(BASE_TS); // populate the hour-bucket memo slot
  const hitTimes = hitTimestamps.map(timeMs);

  const missTimes = sampleTimes(nowMs, (i) => impl.getTimeZonesAt(BASE_TS + (i + 1) * HOUR_MS), MISS_SAMPLES);
  const histTimes = sampleTimes(nowMs, (i) => impl.getTimeZonesAt(HIST_TS + (i + 1) * HOUR_MS), MISS_SAMPLES);

  rows.push({
    id: impl.id,
    coldMs: '-',
    hitMedUs: (median(hitTimes) * 1000).toFixed(1),
    missMedMs: median(missTimes).toFixed(1),
    histMedMs: median(histTimes).toFixed(1),
    missSamples: String(missTimes.length),
    formatters: '-',
    rssMB: '-',
  });
}

// true cold-start cost (formatter construction) measured in fresh subprocesses.
// Each imports ONLY the impl under measurement (every impl directory exports
// getTimeZonesAt), never a registry: going through lib-registry.ts would load
// all five libraries' ~4MB of tzdata to measure one of them, which is both
// slower (-0.9s over a --libs run) and a distorted baseline — the rss delta was
// being read against a heap four other libraries had already inflated, the same
// way the Chrome pass used to share one bundle across libraries.
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
       const { getTimeZonesAt } = await import(${JSON.stringify(new URL('../impls/', import.meta.url).pathname)} + ${JSON.stringify(`${row.id}/index.ts`)});
       const { sampleTimes, MISS_SAMPLES } = await import(${JSON.stringify(new URL('../tools/bench-config.ts', import.meta.url).pathname)});
       Bun.gc(true);
       const rss0 = process.memoryUsage().rss;
       const t0 = Bun.nanoseconds();
       getTimeZonesAt(${Date.UTC(2026, 6, 15)});
       const cold = (Bun.nanoseconds() - t0) / 1e6;
       // the rss delta is read after a run of misses, under the same budget as
       // the timed loops: the cheap impls (whose allocation per miss is the
       // interesting part) still get all 25, while a ~100ms/call library stops
       // early — its footprint is dominated by its tzdata load, not by these
       // calls, so the reading barely moves (timezonecomplete: 64 -> 60MB).
       const misses = sampleTimes(() => Bun.nanoseconds() / 1e6, (i) => getTimeZonesAt(${Date.UTC(2026, 6, 15)} + (i + 1) * 3600000), MISS_SAMPLES);
       Bun.gc(true);
       const rssMB = (process.memoryUsage().rss - rss0) / 1048576;
       console.log(JSON.stringify({ cold: +cold.toFixed(1), formatters: intlConstructCount(), rssMB: +rssMB.toFixed(2), misses: misses.length }));`,
    ],
  });

  const parsed = JSON.parse(proc.stdout.toString() || '{}') as { cold?: number; formatters?: number; rssMB?: number };

  row.coldMs = parsed.cold?.toFixed(1) ?? 'err';
  row.formatters = String(parsed.formatters ?? '-');
  row.rssMB = parsed.rssMB?.toFixed(2) ?? 'err';
}

const sizes = await minifiedSizes(withLibs);

console.log(
  `zones: ${zones.length}, ${SAMPLING_NOTE}, runtime: bun ${Bun.version}, tables: ${genMeta.host}` +
    (withLibs ? '' : ' (comparison libraries skipped — pass --libs to include them)') +
    '\n'
);

if (!genMeta.host.startsWith('bun')) {
  console.warn(`WARNING: active tables were generated by "${genMeta.host}" — run \`bun run tables bun\` for a fair bun benchmark\n`);
}

// hit, miss and hist are medians over the sampling loops (hist = a miss in a
// historical year, routing 07/10 through the era resolver); `n` is how many
// samples MISS_SAMPLES' budget allowed. correctness lives in `bun run test`
// (bun suite + chrome correctness), not here. rss MB is the subprocess's delta
// across first call + that same run of misses (mirrors the chrome bench's
// per-page semantics; excludes the memoized-result-only baseline).
printTable(
  ['impl', 'cold ms', 'hit µs', 'miss ms', 'hist ms', 'n', 'formatters', 'rss MB', 'bundle KB'],
  rows.map((r) => [
    r.id,
    r.coldMs,
    r.hitMedUs,
    r.missMedMs,
    r.histMedMs,
    r.missSamples,
    r.formatters,
    r.rssMB,
    ((sizes.get(r.id) ?? 0) / 1024).toFixed(1),
  ])
);

// --- single-zone getTimeZoneAt() benchmark --------------------------------
// The single-zone / many-timestamps use case: one DST zone resolved at
// GETONE_CALLS timestamps stepping across DST transitions, timed once in the
// projected present and once in a historical year. Only this repo's impls
// expose getTimeZoneAt(); the comparison libraries have no equivalent API, so
// they're absent here. Each impl runs in a FRESH subprocess so the formatter
// count is clean (04/08 build one formatter for the zone, the baked impls
// none) and unpolluted by the getTimeZonesAt warm-up above. Each sweep is
// reported as the fastest of several passes (see SWEEP_PASSES): under JSC a
// single pass measured the JIT ramp, not the impl — 07's historical sweep read
// 53.8ms against a 2.3ms steady state.
interface OneRow {
  id: string;
  curMs: string;
  histMs: string;
  passes: string;
  formatters: string;
}

const intlCountUrl = new URL('../shared/intl-count.ts', import.meta.url).pathname;
const implsDir = new URL('../impls/', import.meta.url).pathname;
const sweepConfigUrl = new URL('../tools/bench-config.ts', import.meta.url).pathname;
const oneRows: OneRow[] = [];

for (const impl of impls) {
  if (impl.getTimeZoneAt == null) continue;

  const proc = Bun.spawnSync({
    cmd: [
      process.execPath,
      '-e',
      `const { installIntlCounter, intlConstructCount } = await import(${JSON.stringify(intlCountUrl)});
       installIntlCounter();
       const { getTimeZoneAt: one } = await import(${JSON.stringify(implsDir)} + ${JSON.stringify(`${impl.id}/index.ts`)});
       const { SWEEP_PASSES, steadyState } = await import(${JSON.stringify(sweepConfigUrl)});
       const Z = ${JSON.stringify(GETONE_ZONE)}, N = ${GETONE_CALLS}, STEP = ${GETONE_STEP_MS};
       const CUR = ${GETONE_CUR_BASE}, HIST = ${GETONE_HIST_BASE};
       let s = 0;
       // ONE sweep function so all passes share its call site (and so its type
       // feedback), then the fastest pass wins — see SWEEP_PASSES. JSC needs this
       // badly: its first pass ran 23x the steady state whatever the warm-up.
       const sweep = (base, calls) => {
         const t0 = Bun.nanoseconds();
         for (let i = 0; i < calls; i++) s += Math.abs(one(Z, base + i * STEP).offset);
         return (Bun.nanoseconds() - t0) / 1e6;
       };
       // one-time work only (impl init, intern pool), not a JIT warm-up
       sweep(CUR, 100);
       sweep(HIST, 100);
       const cur = steadyState(() => sweep(CUR, N), SWEEP_PASSES);
       const hist = steadyState(() => sweep(HIST, N), SWEEP_PASSES);
       if (s < 0) throw new Error('unreachable');
       console.log(JSON.stringify({ curMs: cur.ms, histMs: hist.ms, curPasses: cur.passes, histPasses: hist.passes, formatters: intlConstructCount() }));`,
    ],
  });

  const p = JSON.parse(proc.stdout.toString() || '{}') as {
    curMs?: number;
    histMs?: number;
    curPasses?: number;
    histPasses?: number;
    formatters?: number;
  };

  oneRows.push({
    id: impl.id,
    curMs: p.curMs != null ? p.curMs.toFixed(2) : 'err',
    histMs: p.histMs != null ? p.histMs.toFixed(2) : 'err',
    passes: p.curPasses != null ? `${p.curPasses}/${p.histPasses}` : '-',
    formatters: String(p.formatters ?? '-'),
  });
}

console.log(`\nsingle-zone getTimeZoneAt(): ${GETONE_ZONE}, ${GETONE_CALLS} timestamps/sweep (${GETONE_STEP_HOURS}h step)`);
console.log(`${SWEEP_NOTE}\n`);

// 10k ms are the wall time of the fastest pass over each sweep (hist routes
// 07/10 through the baked era resolver — bun has no Temporal). passes: how many
// the budget allowed, cur/hist. formatters: one per zone for the live-Intl
// impls, none for the baked ones.
printTable(
  ['impl', '10k cur ms', '10k hist ms', 'passes', 'formatters'],
  oneRows.map((r) => [r.id, r.curMs, r.histMs, r.passes, r.formatters])
);

// the strategy/feature matrix lives in the Chrome pass (tools/bench-chrome.ts),
// which always runs — this one is opt-in via --bun
