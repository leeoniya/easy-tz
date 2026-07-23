import { describe, test, expect } from 'bun:test';
import { getTimeZonesAt as all04, getTimeZoneAt as one04, clearCache as clear04 } from '../impls/04-live-intl/index.ts';
import { getTimeZonesAt as all07, getTimeZoneAt as one07, clearCache as clear07 } from '../impls/07-baked-rules/index.ts';
import { getTimeZonesAt as all08, getTimeZoneAt as one08, clearCache as clear08 } from '../impls/08-verified-sharing/index.ts';
import { getTimeZonesAt as all10, getTimeZoneAt as one10, clearCache as clear10 } from '../impls/10-audited-rules/index.ts';
import type { GetTimeZonesAt, GetTimeZoneAt } from '../shared/types.ts';
import { zones } from '../shared/zones.ts';

// getTimeZoneAt(name, ts) is the single-zone / many-timestamps counterpart to
// getTimeZonesAt(ts); getTimeZonesAt loops the same per-zone core. This asserts
// the two APIs never disagree: for every zone at a spread of instants, the
// single-zone answer must deep-equal that zone's entry in the full response.
//
// Each impl is compared to ITSELF (not to live Intl), so this runs on any
// runtime regardless of table/ICU alignment — it's the regression guard for the
// dedup refactor, independent of the cross-impl equivalence tests.

const impls: { id: string; all: GetTimeZonesAt; one: GetTimeZoneAt; clear: () => void }[] = [
  { id: '04-live-intl', all: all04, one: one04, clear: clear04 },
  { id: '07-baked-rules', all: all07, one: one07, clear: clear07 },
  { id: '08-verified-sharing', all: all08, one: one08, clear: clear08 },
  { id: '10-audited-rules', all: all10, one: one10, clear: clear10 },
];

// current bake year, next year (rule projection), and historical years that
// exercise the baked eras / live-Temporal-history paths (pre-2007 US DST,
// Kosrae's pre-1999 +12, Dhaka's one-off 2009 DST)
const instants = [
  Date.UTC(2026, 0, 15, 12),
  Date.UTC(2026, 6, 15, 12),
  Date.UTC(2028, 6, 15, 12),
  Date.UTC(2005, 2, 20, 12),
  Date.UTC(2000, 6, 15, 12),
  Date.UTC(1998, 5, 15, 12),
  Date.UTC(2009, 7, 15, 6),
];

describe('getTimeZoneAt agrees with getTimeZonesAt for every zone', () => {
  for (const { id, all, one, clear } of impls) {
    test(id, () => {
      for (const ts of instants) {
        clear(); // full response computed fresh (getTimeZoneAt is not memoized)
        const full = all(ts);
        const byName = new Map(full.map((z) => [z.name, z]));

        expect(byName.size).toBe(zones.length);

        for (const name of zones) {
          expect(one(name, ts)).toEqual(byName.get(name)!);
        }
      }
    });
  }
});

describe('getTimeZoneAt on the baked impls (07/10) handles unknown zones gracefully', () => {
  // the full response omits unknown zones; the single-zone baked resolvers
  // answer the UTC sentinel instead of throwing (07 always; 10 on this
  // no-Temporal runtime takes 07's baked path)
  for (const { id, one } of [
    { id: '07-baked-rules', one: one07 },
    { id: '10-audited-rules', one: one10 },
  ]) {
    test(id, () => {
      const info = one('Not/AZone', Date.UTC(2026, 6, 15, 12));

      expect(info).toEqual({ name: 'Not/AZone', abbr: 'UTC', offset: '+00:00' });
    });
  }
});
