// Analysis: how does the historical window's start year trade off against
// bundle size and fidelity? Regenerates the packed history at several cutoffs
// (reusing the real generator + emitter, so the sizes are exactly what would
// ship) and, from the full 1995 eras, counts how many zones would lose exact
// coverage below each cutoff (a zone mismatches ICU in year Y under pure
// schedule projection iff its history has a non-defer era live at mid-Y).
//
// Run: bun tools/history-window.ts

import { gzipSync } from 'bun';
import { generateTables, generateHistory, HISTORY_FROM } from './gen-core.ts';
import { emitHistoryTs, type GenMeta } from './emitters.ts';
import { resolveHistory } from '../shared/rules.ts';
import { STEP_MS } from '../shared/schedule.ts';

const meta: GenMeta = { host: `bun ${Bun.version}`, icu: process.versions.icu ?? null, generated: new Date().toISOString() };

const tables = generateTables();
const bakeYear = tables.year;

// full-range history (the shipped 1995 window): its eras tell us, per year,
// how many zones diverge from the schedule projection
const full = generateHistory(tables, HISTORY_FROM);

// zones that diverge from the schedule in year `y` (non-defer era live at mid-year)
function divergingZones(y: number): number {
  const midY = Date.UTC(y, 5, 1, 12);
  let n = 0;

  for (const c of full.classes) {
    if (resolveHistory(c.eras, midY, STEP_MS) !== null) n += c.zones.length;
  }

  return n;
}

// per-year divergence across the full window (what each year "buys")
const perYear: [number, number][] = [];
for (let y = HISTORY_FROM; y < bakeYear; y++) perYear.push([y, divergingZones(y)]);

console.log(`bake year ${bakeYear}; full window ${HISTORY_FROM}-${bakeYear - 1}\n`);
console.log('zones diverging from pure schedule projection, by year:');
console.log('  ' + perYear.map(([y, n]) => `${String(y).slice(2)}:${n}`).join('  '));
console.log('  (these are the zones the history table exists to keep exact)\n');

const gz = (s: string) => gzipSync(Buffer.from(s), { level: 9 }).length;

const cutoffs = [1995, 2000, 2005, 2007, 2010, 2013, 2015, 2018, 2020, 2022, 2024];

const rows: string[][] = [];
let baseRaw = 0, baseGz = 0;

for (const from of cutoffs) {
  if (from >= bakeYear) continue;

  const h = generateHistory(tables, from);
  const src = emitHistoryTs(h, tables, meta);
  const raw = Buffer.byteLength(src);
  const gzip = gz(src);

  if (from === HISTORY_FROM) {
    baseRaw = raw;
    baseGz = gzip;
  }

  // zones that lose exact coverage if we start at `from`: any zone that
  // diverges in some dropped year [HISTORY_FROM, from)
  const lostZones = new Set<string>();

  for (let y = HISTORY_FROM; y < from; y++) {
    const midY = Date.UTC(y, 5, 1, 12);

    for (const c of full.classes) {
      if (resolveHistory(c.eras, midY, STEP_MS) !== null) for (const z of c.zones) lostZones.add(z);
    }
  }

  const st = h.stats;

  rows.push([
    `${from}-${bakeYear - 1}`,
    `${(raw / 1024).toFixed(1)} KB`,
    `${(gzip / 1024).toFixed(2)} KB`,
    baseGz ? `${gzip - baseGz > 0 ? '+' : ''}${((gzip - baseGz) / 1024).toFixed(2)} KB` : '-',
    `${st.classes}`,
    `${st.staticEras}/${st.ruleEras}/${st.rawYears}`,
    `${st.coveredZones}`,
    `${lostZones.size}`,
  ]);
}

console.log('window            raw       gzip      Δgzip     classes  s/r/raw eras  covered  zones losing exact coverage');
console.log('-'.repeat(108));
for (const r of rows) {
  console.log(
    `${r[0]!.padEnd(16)}  ${r[1]!.padStart(7)}  ${r[2]!.padStart(8)}  ${r[3]!.padStart(8)}  ${r[4]!.padStart(6)}  ${r[5]!.padStart(11)}  ${r[6]!.padStart(6)}  ${r[7]!.padStart(6)}`
  );
}
console.log(`\nbaseline (1995) history.ts: ${(baseRaw / 1024).toFixed(1)} KB raw, ${(baseGz / 1024).toFixed(2)} KB gzip`);
console.log('Δgzip is the change in the SHIPPED per-impl (07/10) history payload vs the 1995 baseline.');
