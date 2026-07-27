// Generates the BUN-aligned table set (shared/tables/bun/) by probing this
// runtime's Intl. For tables aligned with latest stable Chrome, use
// tools/gen-chrome.ts. Neither generator touches the ACTIVE tables
// (shared/classes.ts + shared/schedule.ts) unless the active set is already
// this target (then it's refreshed); switch explicitly with:
// bun run tables <bun|chrome>
//
// Run: bun run gen

import { generateTables, verifyTables, generateHistory } from './gen-core.ts';
import { type GenMeta } from './emitters.ts';
import { writeAndReport } from './write-tables.ts';
import { auditAbbrFix, INCLUDE_VAGUE } from './abbrfix-core.ts';
import { zones } from '../shared/zones.ts';

const tables = generateTables();
const verification = verifyTables(tables);

if (verification.mismatches.length > 0) {
  console.error('self-verification FAILED:', JSON.stringify(verification.mismatches, null, 2));
  process.exit(1);
}

const history = generateHistory(tables);

// audited in the same session as the probe that fed it: the corrections key off
// the boundaries generateHistory already resolved, so this costs one live-Intl
// read per segment instead of its own scan
const abbrfix = auditAbbrFix(
  zones,
  tables.scheduleClasses,
  history.classes,
  history.fromYear,
  history.toYear,
  tables.yearStart,
  tables.stepMs,
  INCLUDE_VAGUE,
  history.boundaries
);

const meta: GenMeta = {
  host: `bun ${Bun.version}`,
  icu: process.versions.icu ?? null,
  generated: new Date().toISOString(),
};

writeAndReport('bun', meta, tables, history, abbrfix, verification, 'self-verified');
