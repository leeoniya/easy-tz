// Browser-bundle entry for tools/tz-transition-gap.ts: exposes the spacing
// measurement as globalThis.__tzGaps so the host can invoke it via
// page.evaluate. Chrome is where this has to run — enumerating offset
// transitions needs native Temporal, and the whole point is to measure the ICU
// the shipped tables are generated from.

import { measureTransitionGaps } from './gen-core.ts';

(globalThis as { __tzGaps?: unknown }).__tzGaps = (fromYear: number, toYear: number) =>
  measureTransitionGaps(fromYear, toYear);
