// Browser-bundle entry for tools/abbrfix-equiv.ts: probes this runtime, then
// runs the abbreviation audit both ways over the same freshly generated tables
// and hands both results back for comparison on the host.

import { auditBothWays } from './abbrfix-equiv-core.ts';

(globalThis as { __abbrFixEquiv?: unknown }).__abbrFixEquiv = () => auditBothWays();
