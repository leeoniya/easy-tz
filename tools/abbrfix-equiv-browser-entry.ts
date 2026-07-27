// Browser-bundle entry for tools/abbrfix-equiv.ts: probes this runtime, then
// runs the abbreviation audit both ways over the same freshly generated tables
// and hands both results back for comparison on the host.

import { generateTables, generateHistory } from './gen-core.ts';
import { auditTableSet } from './abbrfix-core.ts';

(globalThis as { __abbrFixEquiv?: unknown }).__abbrFixEquiv = () => {
  const tables = generateTables();
  const history = generateHistory(tables);
  const audit = (boundaries: Record<string, number[]> | null) => auditTableSet(tables, history, boundaries);

  return { scanned: audit(null), seeded: audit(history.boundaries) };
};
