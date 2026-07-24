// Analysis: how many zones would answer INCORRECTLY if we contract the
// historical window one year at a time (1995 -> 2015)? A zone is incorrect for
// year Y once Y is dropped iff pure schedule projection diverges from ICU that
// year — i.e. its full-window history has a non-defer era live at mid-Y. This
// derives everything from ONE full-window history generation (no per-cutoff
// regeneration), so it's fast; it reports fidelity only, not bundle size.
//
// Run: bun tools/history-window.ts

import { generateTables, generateHistory, HISTORY_FROM } from './gen-core.ts';
import { resolveHistory } from '../shared/rules.ts';
import { STEP_MS } from '../shared/schedule.ts';

const tables = generateTables();
const bakeYear = tables.year;

// full-range history (the shipped 1995 window): its eras tell us, per year,
// how many zones diverge from the schedule projection
const full = generateHistory(tables, HISTORY_FROM);

// zones that diverge from ICU in year `y` under pure schedule projection
// (a non-defer era live at mid-year) — the zones the history keeps exact
function divergingZoneSet(y: number): string[] {
  const midY = Date.UTC(y, 5, 1, 12);
  const out: string[] = [];

  for (const c of full.classes) {
    if (resolveHistory(c.eras, midY, STEP_MS) !== null) out.push(...c.zones);
  }

  return out;
}

// per-year divergence across the full window (what each year "buys")
const perYear: [number, number][] = [];
for (let y = HISTORY_FROM; y < bakeYear; y++) perYear.push([y, divergingZoneSet(y).length]);

console.log(`bake year ${bakeYear}; full window ${HISTORY_FROM}-${bakeYear - 1}\n`);
console.log('zones diverging from pure schedule projection, by year:');
console.log('  ' + perYear.map(([y, n]) => `${String(y).slice(2)}:${n}`).join('  '));
console.log('  (these are the zones the history table exists to keep exact)\n');

// contract the window one year at a time, 1995 -> 2015: for each start year,
// how many zones would answer INCORRECTLY for some instant in the dropped
// years [1995, start)? Cumulative + unique, derived from the full eras alone.
const LAST_CUTOFF = 2015;
const totalZones = tables.stats.zones;

const rows: string[][] = [];
const lostZones = new Set<string>();
let prevLost = 0;

for (let from = HISTORY_FROM; from <= LAST_CUTOFF && from < bakeYear; from++) {
  // starting at `from` drops year (from - 1); fold that year's divergers in
  if (from > HISTORY_FROM) for (const z of divergingZoneSet(from - 1)) lostZones.add(z);

  const newly = lostZones.size - prevLost;
  prevLost = lostZones.size;

  rows.push([
    `${from}-${bakeYear - 1}`,
    `${lostZones.size}`,
    from === HISTORY_FROM ? '-' : `+${newly}`,
    `${((lostZones.size / totalZones) * 100).toFixed(1)}%`,
  ]);
}

console.log(`contracting the window one year at a time (${HISTORY_FROM} -> ${LAST_CUTOFF}); ${totalZones} zones total\n`);
console.log('window       incorrect zones  +new   % of all');
console.log('-'.repeat(48));
for (const r of rows) {
  console.log(`${r[0]!.padEnd(11)}  ${r[1]!.padStart(15)}  ${r[2]!.padStart(4)}  ${r[3]!.padStart(7)}`);
}
console.log('\n"incorrect zones" = zones that would diverge from ICU for some instant in the dropped');
console.log('years [1995, start) once the window begins at `start` (cumulative, unique).');
console.log('"+new" = zones first made incorrect by dropping that one additional year.');
