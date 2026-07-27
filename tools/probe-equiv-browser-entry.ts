// Browser-bundle entry for tools/probe-equiv.ts: exposes the strategy
// comparison as globalThis.__probeEquiv so the host can invoke it via
// page.evaluate. Chrome is the runtime that HAS both strategies (native
// Temporal plus the same Intl the fallback scan uses), so it is the only
// place the two can actually be diffed against each other.

import { compareProbeStrategies } from './gen-core.ts';

(globalThis as { __probeEquiv?: unknown }).__probeEquiv = (
  fromYear: number,
  toYear: number,
  strideDays?: number
) => compareProbeStrategies(fromYear, toYear, strideDays);
