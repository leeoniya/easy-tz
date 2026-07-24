// Generates the BUN-aligned table set (shared/tables/bun/) by probing this
// runtime's Intl. For tables aligned with latest stable Chrome, use
// tools/gen-chrome.ts. Neither generator touches the ACTIVE tables
// (shared/classes.ts + shared/schedule.ts) unless the active set is already
// this target (then it's refreshed); switch explicitly with:
// bun run tables <bun|chrome>
//
// Run: bun run gen

import { generateTables, verifyTables, generateHistory } from './gen-core.ts';
import { emitClassesTs, emitScheduleTs, emitHistoryTs, type GenMeta } from './emitters.ts';
import { writeTableSet } from './table-files.ts';
import { loadProbeCache, saveProbeCache } from './probe-cache.ts';

const tables = generateTables(loadProbeCache('schedule', 'bun'));

saveProbeCache('schedule', 'bun', tables.cache, tables.years[0]!, tables.years.at(-1)!);

const verification = verifyTables(tables);

if (verification.mismatches.length > 0) {
  console.error('self-verification FAILED:', JSON.stringify(verification.mismatches, null, 2));
  process.exit(1);
}

const history = generateHistory(tables, undefined, loadProbeCache('history', 'bun'));

saveProbeCache('history', 'bun', history.cache, history.fromYear, history.toYear);

const meta: GenMeta = {
  host: `bun ${Bun.version}`,
  icu: process.versions.icu ?? null,
  generated: new Date().toISOString(),
};

const active = writeTableSet('bun', {
  classes: emitClassesTs(tables, meta),
  schedule: emitScheduleTs(tables, meta),
  history: emitHistoryTs(history, tables, meta),
});

const s = tables.stats;
const h = history.stats;

console.log(
  `wrote shared/tables/bun/{classes,schedule,history}.ts (host: ${meta.host}, icu ${meta.icu}, active variant: ${active}):\n` +
    `  ${s.zones} zones -> ${s.sigClasses} classes / ${s.schedClasses} schedule classes (${s.staticClasses} static, ${s.ruleClasses} rule, ${s.irregularClasses} irregular w/ ${s.irregularZones} zones), probe ${s.probeMs}ms (${s.cachedZoneYears} cached / ${s.probedZoneYears} probed)\n` +
    `  history ${history.fromYear}-${history.toYear - 1}: ${h.zones} zones (${h.coveredZones} schedule-covered) -> ${h.classes} classes (${h.staticEras} static, ${h.ruleEras} rule, ${h.rawYears} raw, ${h.deferEras} defer eras), probe ${h.probeMs}ms (${h.cachedZoneYears} cached / ${h.probedZoneYears} probed)\n` +
    `  self-verified: ${verification.checks} checks at ${verification.instants} instants, 0 mismatches`
);
