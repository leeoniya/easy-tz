// Asserts that gen-core's two probe strategies produce IDENTICAL zone-year
// signatures.
//
// Why this needs asserting: which strategy builds a table is an accident of
// the runtime doing the building — the chrome variant comes off Temporal, the
// bun variant off the stride scan — and the two are compared against each
// other as though they were the same tzdata seen twice. That only holds while
// the strategies agree; a disagreement means the stride stepped over a
// transition Temporal enumerates.
//
// The comparison has to run somewhere that HAS both: Chrome ships native
// Temporal alongside the same Intl the fallback scan uses. bun and node
// (built without the Temporal component) can only run the stride side, so
// this is a Chrome-hosted check by default.
//
// Run:
//   bun tools/probe-equiv.ts [fromYear] [toYear] [--stride N] [--local]
// Defaults: 1995 through bakeYear + 2 — the full range either table draws
// from. --local runs in this process instead of the browser, for a host that
// has Temporal. Exits 1 on any disagreement.

import { inChromePage, chromeLabel } from './chrome-harness.ts';
import { compareProbeStrategies, SCHEDULE_STRIDE_DAYS, type StrategyComparison } from './gen-core.ts';

const args = process.argv.slice(2);
const local = args.includes('--local');
const strideIdx = args.indexOf('--stride');
const strideDays = strideIdx === -1 ? SCHEDULE_STRIDE_DAYS : Number(args[strideIdx + 1]);
const years = args.filter((a) => /^\d{4}$/.test(a)).map(Number);

const bakeYear = new Date().getUTCFullYear();
const fromYear = years[0] ?? 1995;
const toYear = years[1] ?? bakeYear + 2;

if (fromYear > toYear) {
  console.error(`from year ${fromYear} > to year ${toYear}`);
  process.exit(1);
}

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
