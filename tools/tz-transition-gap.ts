// How close together do two consecutive transitions ever get?
//
// This number is load-bearing wherever the code samples a zone at a fixed
// spacing and treats "two probes agree" as proof that nothing happened in
// between: a window narrower than the tightest gap holds at most one change,
// and one change necessarily changes the value. Two views are reported:
//
// - Exact Temporal OFFSET transitions provide a transition and off-grid census.
// - tools/gen-core.ts scans zone-years at a fixed stride when the runtime has
//   no Temporal. What it tracks is the (CLDR long name, offset) SIGNATURE, so
//   its bound is the tightest gap between signature changes — the stricter of
//   the two, since CLDR renames zones without moving their offset and an
//   offset-only bound cannot see that.
//
// Measured against the RUNTIME's own ICU rather than a bundled tzdata copy.
// That is the whole point: the stride has to be safe against the data the
// tables are generated from, and only that runtime knows where its own CLDR
// names move. Offset transitions come from Temporal, so this is Chrome-hosted
// by default — the same runtime that generates the shipped table variant.
//
// Both generator spacings are asserted below; if the tightest gap ever drops
// to meet one, that consumer needs a tighter spacing.
//
// Run:
//   bun tools/tz-transition-gap.ts [fromYear] [toYear] [--local]
// Defaults: signature scan over 1995 through bakeYear + 2, the full range
// either table draws from. --local runs in this process instead of the browser,
// for a host that has Temporal.

import { inChromePage, chromeLabel } from './chrome-harness.ts';
import { printTable } from './print-table.ts';
import { parseYearRange } from './cli-years.ts';
import {
  measureTransitionGaps,
  SCHEDULE_STRIDE_DAYS,
  HISTORY_STRIDE_DAYS,
  HISTORY_FROM,
  type GapEra,
  type GapMeasurement,
} from './gen-core.ts';

const DAY = 86_400_000;

const { local, fromYear, toYear } = parseYearRange(HISTORY_FROM);

let result: GapMeasurement;
let runtime: string;

if (local) {
  result = measureTransitionGaps(fromYear, toYear);
  runtime = typeof Bun === 'undefined' ? `node ${process.versions.node}` : `bun ${Bun.version}`;
} else {
  ({ runtime, result } = await inChromePage(
    new URL('./tz-transition-gap-browser-entry.ts', import.meta.url).pathname,
    async (page, version) => ({
      runtime: chromeLabel(version),
      result: (await page.evaluate(
        (a, b) => (globalThis as unknown as { __tzGaps: (x: number, y: number) => unknown }).__tzGaps(a, b),
        fromYear,
        toYear
      )) as GapMeasurement,
    })
  ));
}

console.log(`${runtime}, ${result.zones} zones\n`);

if (!result.available) {
  console.error('no Temporal on this runtime — offset transitions cannot be enumerated');
  console.error('(run without --local to measure inside chrome-headless-shell)');
  process.exit(1);
}

// what the samplers need is the change-and-return window; the consecutive gap
// is the conservative proxy the old tzdata-based version reported, kept for
// continuity (and because it is the number quoted in the consumers' comments)
const gapRow = (e: GapEra): string[] => [
  e.label,
  e.changes.toLocaleString(),
  `${(e.gapMs / DAY).toFixed(2)}d`,
  e.gapWhere,
];

const returnRow = (e: GapEra): string[] => [
  e.label,
  `${(e.returnMs / DAY).toFixed(2)}d`,
  `${e.offGrid}`,
  e.returnWhere,
];

console.log('offset transitions, via Temporal\n');
printTable(['era', 'transitions', 'consecutive gap', 'where'], result.offsetEras.map(gapRow));
console.log('');
printTable(['era', 'change-and-return', 'off-grid', 'where'], result.offsetEras.map(returnRow));

console.log(`\nsignature changes (CLDR long name + offset), via ${local ? 'this runtime' : 'Chrome'}'s Intl\n`);
printTable(['years', 'changes', 'consecutive gap', 'where'], [gapRow(result.signature)]);
console.log('');
printTable(['years', 'change-and-return', 'off-grid', 'where'], [returnRow(result.signature)]);

if (result.signature.offGrid > 0 || result.offsetEras.some((e) => e.offGrid > 0)) {
  console.log(
    '\noff-grid = transitions that miss gen-core\u2019s 15-minute step grid. Rule-fitted classes\n' +
      'serve these exactly anyway: Rule.atMin is wall MINUTES and scanAt times every change to\n' +
      'the minute (refineToMinute). They cost precision only where a zone falls into a raw or\n' +
      'irregular encoding, whose stored steps stay on the grid. In the window above that is just\n' +
      'Asia/Gaza and Asia/Hebron, whose Ramadan-driven dates the table only approximates anyway.'
  );
}

console.log(
  `\nscanned in ${(result.offsetMs / 1000).toFixed(2)}s (offsets) + ${(result.signatureMs / 1000).toFixed(2)}s (signatures)`
);

const signatureBound = result.signature;

const spacings: [label: string, days: number][] = [
  ['gen-core schedule stride', SCHEDULE_STRIDE_DAYS],
  ['gen-core history stride', HISTORY_STRIDE_DAYS],
];

console.log('');
printTable(
  ['consumer', 'spacing', 'bounded by', 'change-and-return', 'margin', 'ok'],
  spacings.map(([label, days]) => [
    label,
    `${days}d`,
    'signature',
    `${(signatureBound.returnMs / DAY).toFixed(2)}d`,
    `${(signatureBound.returnMs / DAY / days).toFixed(1)}×`,
    signatureBound.returnMs / DAY > days ? 'yes' : 'NO',
  ])
);

const failed = spacings.filter(([, days]) => signatureBound.returnMs / DAY <= days);

if (failed.length > 0) {
  console.error(`\nFAIL: tightest gap no longer exceeds: ${failed.map(([l]) => l).join(', ')}`);
  process.exit(1);
}
