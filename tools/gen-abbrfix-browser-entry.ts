// Browser-bundle entry for tools/gen-abbrfix.ts: exposes the abbreviation audit
// as globalThis.__abbrFix so the host can invoke it via page.evaluate.
//
// The chrome table set has to be audited against CHROME's ICU — auditing it
// from bun would diff Chrome-probed tables against bun's CLDR and invent
// corrections that are really just runtime skew. Imports the chrome variant
// directly rather than the shared/*.ts selectors, which point at whichever
// variant is locally active.

import { auditAbbrFix } from './abbrfix-core.ts';
import { zones } from '../shared/zones.ts';
import { scheduleClasses, YEAR_START, STEP_MS } from '../shared/tables/chrome/schedule.ts';
import { historyClasses, HISTORY_FROM, HISTORY_TO } from '../shared/tables/chrome/history.ts';

(globalThis as { __abbrFix?: unknown }).__abbrFix = (includeVague: boolean) =>
  auditAbbrFix(zones, scheduleClasses, historyClasses, HISTORY_FROM, HISTORY_TO, YEAR_START, STEP_MS, includeVague);
