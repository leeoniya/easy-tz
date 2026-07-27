// The measurement tools/abbrfix-equiv.ts compares across runtimes: audit one
// freshly probed table set both ways — once letting the audit discover its own
// boundaries, once seeding it with the ones gen-core's probe already resolved.
//
// Lives apart from abbrfix-equiv.ts because both the host runtime and the
// browser bundle (tools/abbrfix-equiv-browser-entry.ts) have to run exactly
// this, and abbrfix-equiv.ts itself can't be bundled for the browser — it
// launches Chrome. Two copies of a comparison's own subject would let the
// runtimes measure different things and still agree.

import { generateTables, generateHistory } from './gen-core.ts';
import { auditTableSet, type AbbrFixResult } from './abbrfix-core.ts';

export interface EquivPair {
  scanned: AbbrFixResult;
  seeded: AbbrFixResult;
}

export function auditBothWays(): EquivPair {
  const tables = generateTables();
  const history = generateHistory(tables);
  const audit = (boundaries: Record<string, number[]> | null) => auditTableSet(tables, history, boundaries);

  return { scanned: audit(null), seeded: audit(history.boundaries) };
}
