// Browser-bundle entry for the Chrome scripts, covering THIS REPO'S impls
// only (~34KB minified). The comparison libraries live in a separate entry
// (lib-browser-entry.ts) so their ~4MB of bundled tzdata never inflates the
// parse/GC cost of pages measuring our impls. Exposes (via browser-kernel):
//   __bench(implId)      — pure performance measurement (tools/bench-chrome.ts)
//   __validate(implId)   — fixtures + letter-abbr correctness (tools/test-chrome.ts)
//   __verifyVs04(implId) — deep output-equality vs impl 04 (tools/test-chrome.ts)
// plus __implIds and __verifyFuture (rollover checks) defined here.
// Each runs against a fresh page context created by the host script, so cold
// starts are real and impls don't pollute each other.

import { impls } from '../impls/registry.ts';
import { getInitInfo } from '../impls/08-verified-sharing/index.ts';
import { scheduleClasses } from '../shared/schedule.ts';
import { installKernel } from './browser-kernel.ts';

export type { BenchResult, ValidateResult, Vs04 } from './browser-kernel.ts';

const impl04 = impls.find((i) => i.id === '04-live-intl')!;

installKernel(impls, impl04, (id) => (id === '08-verified-sharing' ? getInitInfo() : undefined));

(globalThis as { __implIds?: string[] }).__implIds = impls.map((i) => i.id);

// rollover-resistance check: at instants PAST the generated year, output
// must still deep-equal live 04. For 07, zones in irregular classes (clamped
// by design outside the generated year) are skipped; 09's coherence guard
// must handle them via live fallback, so nothing is skipped there.
(globalThis as { __verifyFuture?: unknown }).__verifyFuture = (implId: string, skipIrregular: boolean) => {
  const other = impls.find((i) => i.id === implId)!;

  const irregular = new Set<string>();

  for (const c of scheduleClasses) {
    if (c.kind === 2) for (const z of c.zones) irregular.add(z);
  }

  // winter + summer + just past the next year's US/EU spring-forwards
  const instants = [
    Date.UTC(2027, 0, 15, 12),
    Date.UTC(2027, 6, 15, 12),
    Date.UTC(2027, 2, 14, 8),
    Date.UTC(2027, 2, 28, 2),
  ];

  let checked = 0;
  let skipped = 0;
  let mismatchCount = 0;
  const mismatches: string[] = [];

  for (const ts of instants) {
    const a = impl04.getTimeZonesAt(ts);
    const b = other.getTimeZonesAt(ts);

    for (let k = 0; k < a.length; k++) {
      const x = a[k]!;
      const y = b[k]!;

      if (skipIrregular && irregular.has(x.name)) {
        skipped++;
        continue;
      }

      checked++;

      if (x.name !== y.name || x.abbr !== y.abbr || x.offset !== y.offset) {
        mismatchCount++;

        if (mismatches.length < 10) {
          mismatches.push(`${x.name} @ ${new Date(ts).toISOString()}: 04=${x.abbr} ${x.offset} vs ${implId}=${y.abbr} ${y.offset}`);
        }
      }
    }
  }

  return { checked, skipped, mismatchCount, mismatches };
};
