// Asserts that gen-core's two probe strategies produce IDENTICAL zone-year
// signatures.
//
// Why this needs asserting: which strategy builds a table depends on whether
// its runtime provides Temporal, while the generated variants are compared as
// though they were the same tzdata seen twice. That only holds while the
// strategies agree; a disagreement means the stride stepped over a transition
// Temporal enumerates.
//
// The comparison has to run somewhere that HAS both Temporal and Intl. It is
// Chrome-hosted by default for stable target-runtime coverage; --local also
// works on current Bun and any Node build that includes Temporal.
//
// Run:
//   bun tools/probe-equiv.ts [fromYear] [toYear] [--stride N] [--local]
// Defaults: 1995 through bakeYear + 2 — the full range either table draws
// from. --local runs in this process instead of the browser, for a host that
// has Temporal. Exits 1 on any disagreement.

import { inChromePage, chromeLabel } from './chrome-harness.ts';
import { parseYearRange } from './cli-years.ts';
import { compareProbeStrategies, SCHEDULE_STRIDE_DAYS, HISTORY_FROM, type StrategyComparison } from './gen-core.ts';

const { args, local, fromYear, toYear } = parseYearRange(HISTORY_FROM);
const strideIdx = args.indexOf('--stride');
const strideDays = strideIdx === -1 ? SCHEDULE_STRIDE_DAYS : Number(args[strideIdx + 1]);

let result: StrategyComparison;
let runtime: string;

if (local) {
  result = compareProbeStrategies(fromYear, toYear, strideDays);
  runtime = `${typeof Bun === 'undefined' ? 'node' : 'bun'} ${typeof Bun === 'undefined' ? process.versions.node : Bun.version}`;
} else {
  ({ runtime, result } = await inChromePage(
    new URL('./probe-equiv-browser-entry.ts', import.meta.url).pathname,
    async (page, version) => ({
      runtime: chromeLabel(version),
      result: (await page.evaluate(
        (a, b, c) =>
          (globalThis as unknown as { __probeEquiv: (x: number, y: number, z: number) => unknown }).__probeEquiv(a, b, c),
        fromYear,
        toYear,
        strideDays
      )) as StrategyComparison,
    })
  ));
}

console.log(`${runtime}, ${fromYear}-${toYear}, fallback stride ${result.strideDays}d\n`);

if (!result.available) {
  console.log('no Temporal on this runtime — nothing to compare against (use the default Chrome host)');
  process.exit(0);
}

console.log(`  temporal  ${(result.temporalMs / 1000).toFixed(2).padStart(7)}s`);
console.log(`  stride    ${(result.strideMs / 1000).toFixed(2).padStart(7)}s   (${(result.strideMs / result.temporalMs).toFixed(0)}x slower)`);
console.log(`\n${(result.zoneYears - result.diffs.length).toLocaleString()}/${result.zoneYears.toLocaleString()} zone-years identical`);

if (result.diffs.length > 0) {
  console.error(`\nFAIL: ${result.diffs.length} zone-years disagree between the probe strategies`);

  for (const d of result.diffs.slice(0, 20)) {
    console.error(`  ${d.key}\n    temporal: ${d.temporal}\n    stride:   ${d.stride}`);
  }

  process.exit(1);
}
