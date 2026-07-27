// Browser-bundle entry for tools/gen-chrome.ts: exposes the generator core
// as globalThis.__gen so the host can invoke it via page.evaluate.

import { generateTables, verifyTables, generateHistory } from './gen-core.ts';
import { auditAbbrFix, INCLUDE_VAGUE } from './abbrfix-core.ts';
import { zones } from '../shared/zones.ts';

(globalThis as { __gen?: unknown }).__gen = () => {
  const tables = generateTables();
  const verification = verifyTables(tables);
  const history = verification.mismatches.length === 0 ? generateHistory(tables) : null;

  if (history === null) return { tables, verification, history: null, abbrfix: null };

  // audited here rather than from a second browser session, against the same
  // ICU that produced the labels, reusing the probe's boundaries
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

  // boundaries are consumed above; the host has no use for ~40k more numbers
  return { tables, verification, history: { ...history, boundaries: {} }, abbrfix };
};
