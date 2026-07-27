// Asserts that the abbreviation audit reaches the SAME corrections whether it
// discovers boundaries itself or is handed the ones gen-core's probe already
// resolved.
//
// Why this needs asserting: generation feeds auditAbbrFix the probe's
// "longName|offset" change instants, while the audit's own key is
// "abbr|offset" — a SHORT name, and for a few zones a borrowed one
// (shared/abbrs.ts zoneAliases) or a constant override. Seeding is sound only
// because a long-name change accompanies every short-name change, making the
// probe's boundaries a superset. That's an empirical claim about CLDR, not a
// guarantee, so it gets checked rather than assumed: a boundary the probe
// missed would silently merge two spans and drop a correction.
//
// Both sides run over the same freshly probed tables, so this needs a runtime,
// not the committed files. The scan side is the slow one (~1M live-Intl reads),
// which is exactly why generation no longer does it.
//
// Run:
//   bun run abbrfix-equiv          both runtimes (chrome via headless shell)
//   bun run abbrfix-equiv --local  this runtime only
// Exits 1 on any disagreement.

import { inChromePage } from './chrome-harness.ts';
import { generateTables, generateHistory } from './gen-core.ts';
import { auditAbbrFix, INCLUDE_VAGUE, type AbbrFixResult } from './abbrfix-core.ts';
import { zones } from '../shared/zones.ts';

interface Pair {
  scanned: AbbrFixResult;
  seeded: AbbrFixResult;
}

// every correction as a flat, zone-qualified line, so a disagreement names the
// zone and span rather than just a count
function describe(r: AbbrFixResult): string[] {
  return r.classes
    .flatMap((c) =>
      c.zones.flatMap((z) => [
        ...c.ranges.map((g) => `${z} ${g.fromYear}-${g.toYear} @${g.offMin} = ${g.abbr}`),
        ...c.spans.map((s) => `${z} steps ${s.from}-${s.to} = ${s.abbr}`),
      ])
    )
    .toSorted();
}

function runLocal(): Pair {
  const tables = generateTables();
  const history = generateHistory(tables);

  const audit = (boundaries: Record<string, number[]> | null) =>
    auditAbbrFix(
      zones,
      tables.scheduleClasses,
      history.classes,
      history.fromYear,
      history.toYear,
      tables.yearStart,
      tables.stepMs,
      INCLUDE_VAGUE,
      boundaries
    );

  return { scanned: audit(null), seeded: audit(history.boundaries) };
}

async function runChrome(): Promise<Pair> {
  return inChromePage(
    new URL('./abbrfix-equiv-browser-entry.ts', import.meta.url).pathname,
    async (page) =>
      (await page.evaluate(() => (globalThis as unknown as { __abbrFixEquiv: () => unknown }).__abbrFixEquiv())) as Pair
  );
}

const local = process.argv.includes('--local');
const runtimes: [string, () => Pair | Promise<Pair>][] = local
  ? [[`bun ${Bun.version}`, runLocal]]
  : [
      [`bun ${Bun.version}`, runLocal],
      ['chrome-headless-shell', runChrome],
    ];

let failed = false;

for (const [runtime, run] of runtimes) {
  const { scanned, seeded } = await run();
  const a = describe(scanned);
  const b = describe(seeded);
  const only = (xs: string[], ys: string[]) => xs.filter((x) => !ys.includes(x));

  const scanS = (scanned.stats.auditMs / 1000).toFixed(2);
  const seedS = (seeded.stats.auditMs / 1000).toFixed(2);
  const speedup = (scanned.stats.auditMs / Math.max(seeded.stats.auditMs, 1)).toFixed(0);

  console.log(`${runtime}\n  scan     ${scanS.padStart(6)}s\n  seeded   ${seedS.padStart(6)}s   (${speedup}x faster)`);

  if (a.join('\n') === b.join('\n')) {
    console.log(`  ${a.length.toLocaleString()} corrections identical\n`);
  } else {
    failed = true;

    console.error(`\nFAIL: the two paths disagree on ${only(a, b).length + only(b, a).length} corrections`);

    for (const line of only(a, b).slice(0, 10)) console.error(`  scan only:   ${line}`);
    for (const line of only(b, a).slice(0, 10)) console.error(`  seeded only: ${line}`);
  }
}

if (failed) process.exit(1);
