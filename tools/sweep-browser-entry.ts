// Browser-bundle entry for tools/sweep-validity.ts --chrome: exposes the
// sweep core as globalThis.__sweep so the host can invoke it via
// page.evaluate. Bundled against the Chrome table variant (the harness flips
// the selector), so the sweep compares the SHIPPABLE table against Chrome's
// own ICU — with Chrome's native Temporal as the baseline.

import { runSweep } from './sweep-core.ts';

(globalThis as { __sweep?: unknown }).__sweep = (fromYear?: number, toYear?: number, useHistory?: boolean) =>
  runSweep(fromYear, toYear, useHistory);
