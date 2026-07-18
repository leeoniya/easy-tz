import { describe, test, expect } from 'bun:test';
import { impls } from '../impls/registry.ts';
import { zones, runtimeZones } from '../shared/zones.ts';
import { zoneLinkPairs } from '../shared/zoneLinks.ts';

// shared/zones.ts augments the runtime's Intl enumeration with BOTH
// spellings of every tzdata backward link, so getTimeZonesAt() always
// includes e.g. Asia/Kolkata and Europe/Kyiv even on runtimes whose ICU
// only enumerates the legacy spellings (Asia/Calcutta, Europe/Kiev), and
// vice versa the legacy spellings on runtimes that only enumerate the
// modern ids. These checks are name-level only, so they hold for every
// impl regardless of which runtime generated the tables.

describe('zone list augmentation (link pair spellings)', () => {
  test('zones contains every canonical id and legacy alias from zoneLinkPairs', () => {
    const set = new Set(zones);

    for (const [canonical, alias] of zoneLinkPairs) {
      expect(set.has(canonical)).toBe(true);
      expect(set.has(alias)).toBe(true);
    }
  });

  test('zones is sorted and has no duplicates', () => {
    expect([...new Set(zones)].sort()).toEqual([...zones]);
  });

  // augmentation assumes every link pair spelling is a valid Intl timeZone
  // input even when the runtime doesn't enumerate it (ICU resolves backward
  // links internally); an invalid id throws RangeError at construction
  test('both spellings of every link pair are accepted by Intl constructors', () => {
    for (const name of zoneLinkPairs.flat()) {
      expect(() => new Intl.DateTimeFormat('en', { timeZone: name })).not.toThrow();
    }
  });

  test('zones only adds link pair spellings on top of the runtime list', () => {
    const runtime = new Set(runtimeZones);
    const linked = new Set(zoneLinkPairs.flat());

    for (const z of zones) {
      expect(runtime.has(z) || linked.has(z)).toBe(true);
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

      test('returns every link pair spelling, sorted, no duplicates', () => {
        const names = impl.getTimeZonesAt(ts).map((z) => z.name);
        const set = new Set(names);

        expect(set.size).toBe(names.length);
        expect([...names].sort()).toEqual(names);

        for (const [canonical, alias] of zoneLinkPairs) {
          expect(set.has(canonical)).toBe(true);
          expect(set.has(alias)).toBe(true);
        }
      });

      // both spellings of a link pair are the same underlying zone, so they
      // must produce identical values however they were resolved (directly
      // from the table, via the zoneLinks bridge, or live). Only some pairs
      // are in the transition-rule schedule, so checking a winter AND a
      // summer instant proves the back-reference lands in the right class,
      // not just a coincidentally-matching static offset.
      test('every alias matches its canonical at winter and summer instants', () => {
        for (const when of [Date.UTC(2026, 0, 15, 12), Date.UTC(2026, 6, 15, 12)]) {
          const byName = new Map(impl.getTimeZonesAt(when).map((z) => [z.name, z]));

          for (const [canonical, alias] of zoneLinkPairs) {
            const c = byName.get(canonical)!;
            const a = byName.get(alias)!;

            expect(`${alias} ${a.abbr} ${a.offset}`).toBe(`${alias} ${c.abbr} ${c.offset}`);
          }
        }
      });
    });
  }
});
