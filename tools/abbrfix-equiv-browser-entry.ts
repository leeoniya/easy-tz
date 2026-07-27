// Browser-bundle entry for tools/abbrfix-equiv.ts: probes this runtime, then
// runs the abbreviation audit both ways over the same freshly generated tables
// and hands both results back for comparison on the host.

import { generateTables, generateHistory } from './gen-core.ts';
import { auditAbbrFix, INCLUDE_VAGUE } from './abbrfix-core.ts';
import { zones } from '../shared/zones.ts';

(globalThis as { __abbrFixEquiv?: unknown }).__abbrFixEquiv = () => {
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
};
