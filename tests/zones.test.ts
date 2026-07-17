import { describe, test, expect } from 'bun:test';
import { impls } from '../impls/registry.ts';
import { zones, runtimeZones } from '../shared/zones.ts';
import { zoneLinkPairs } from '../shared/zoneLinks.ts';

// shared/zones.ts augments the runtime's Intl enumeration with every modern
// canonical id from the tzdata backward links, so getTimeZonesAt() always
// includes e.g. Asia/Kolkata and Europe/Kyiv even on runtimes whose ICU
// only enumerates the legacy spellings (Asia/Calcutta, Europe/Kiev).
// These checks are name-level only, so they hold for every impl regardless
// of which runtime generated the tables.

describe('zone list augmentation (canonical link targets)', () => {
  test('zones contains every canonical id from zoneLinkPairs', () => {
    const set = new Set(zones);

    for (const [canonical] of zoneLinkPairs) {
      expect(set.has(canonical)).toBe(true);
    }
  });

  test('zones is sorted and has no duplicates', () => {
    expect([...new Set(zones)].sort()).toEqual([...zones]);
  });

  test('zones only adds canonical link targets on top of the runtime list', () => {
    const runtime = new Set(runtimeZones);
    const canonicals = new Set(zoneLinkPairs.map(([c]) => c));

    for (const z of zones) {
      expect(runtime.has(z) || canonicals.has(z)).toBe(true);
    }
  });

  for (const impl of impls) {
    describe(impl.id, () => {
      const ts = Date.UTC(2026, 6, 15);

      test('returns Asia/Kolkata and Europe/Kyiv (modern spellings)', () => {
        const names = impl.getTimeZonesAt(ts).map((z) => z.name);

        expect(names).toContain('Asia/Kolkata');
        expect(names).toContain('Europe/Kyiv');
      });

      test('returns every canonical link target, sorted, no duplicates', () => {
        const names = impl.getTimeZonesAt(ts).map((z) => z.name);
        const set = new Set(names);

        expect(set.size).toBe(names.length);
        expect([...names].sort()).toEqual(names);

        for (const [canonical] of zoneLinkPairs) {
          expect(set.has(canonical)).toBe(true);
        }
      });
    });
  }
});
