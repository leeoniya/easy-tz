// Generates the BUN-aligned table set (shared/tables/bun/) by probing this
// runtime's Intl. For tables aligned with latest stable Chrome, use
// tools/gen-chrome.ts. Neither generator touches the ACTIVE tables
// (shared/classes.ts + shared/schedule.ts) unless the active set is already
// this target (then it's refreshed); switch explicitly with:
// bun run tables <bun|chrome>
//
// Run: bun run gen

import { generateTables, verifyTables } from './gen-core.ts';
import { emitClassesTs, emitScheduleTs, emitOffsetsTs, type GenMeta } from './emitters.ts';
import { writeTableSet } from './table-files.ts';

const tables = generateTables();
const verification = verifyTables(tables);

if (verification.mismatches.length > 0) {
  console.error('self-verification FAILED:', JSON.stringify(verification.mismatches, null, 2));
  process.exit(1);
}

const meta: GenMeta = {
  host: `bun ${Bun.version}`,
  icu: process.versions.icu ?? null,
  generated: new Date().toISOString(),
};

const active = writeTableSet('bun', {
  classes: emitClassesTs(tables, meta),
  schedule: emitScheduleTs(tables, meta),
  offsets: emitOffsetsTs(tables, meta),
});

const s = tables.stats;

console.log(
  `wrote shared/tables/bun/{classes,schedule}.ts (host: ${meta.host}, icu ${meta.icu}, active variant: ${active}):\n` +
    `  ${s.zones} zones -> ${s.sigClasses} classes / ${s.schedClasses} schedule classes, ${s.totalSegs} segments, probe ${s.probeMs}ms\n` +
    `  self-verified: ${verification.checks} checks at ${verification.instants} instants, 0 mismatches`
);
