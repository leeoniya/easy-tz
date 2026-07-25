import { describe, test, expect } from 'bun:test';
import { getTimeZonesAt as all04, getTimeZones as now04, clearCache as clear04 } from '../impls/04-live-intl/index.ts';
import { getTimeZonesAt as all07, getTimeZones as now07, clearCache as clear07 } from '../impls/07-baked-rules/index.ts';
import { getTimeZonesAt as all08, getTimeZones as now08, clearCache as clear08 } from '../impls/08-verified-sharing/index.ts';
import { getTimeZonesAt as all10, getTimeZones as now10, clearCache as clear10 } from '../impls/10-audited-rules/index.ts';
import type { GetTimeZonesAt, GetTimeZones } from '../shared/types.ts';

// getTimeZones() is the no-argument current-instant convenience over
// getTimeZonesAt(Date.now()). On the baked impls (07/10) it takes a distinct,
// history-free code path (schedule only), so this pins that the schedule-only
// route produces exactly the same answer as the full resolver at "now" — the
// current instant is always the bake year or later, where there's no history
// to consult.
const impls: { id: string; all: GetTimeZonesAt; now: GetTimeZones; clear: () => void }[] = [
  { id: '04-live-intl', all: all04, now: now04, clear: clear04 },
  { id: '07-baked-rules', all: all07, now: now07, clear: clear07 },
  { id: '08-verified-sharing', all: all08, now: now08, clear: clear08 },
  { id: '10-audited-rules', all: all10, now: now10, clear: clear10 },
];

describe('getTimeZones() matches getTimeZonesAt(now)', () => {
  for (const { id, all, now, clear } of impls) {
    test(id, () => {
      clear();
      const ts = Date.now();

      expect(now()).toEqual(all(ts));
    });
  }
});
