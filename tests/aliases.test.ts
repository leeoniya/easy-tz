import { describe, test, expect } from 'bun:test';
import {
  getTimeZonesAt as all04,
  getTimeZones as now04,
  getTimeZoneAt as at04,
  getTimeZone as one04,
  clearCache as clear04,
} from '../impls/04-live-intl/index.ts';
import {
  getTimeZonesAt as all07,
  getTimeZones as now07,
  getTimeZoneAt as at07,
  getTimeZone as one07,
  clearCache as clear07,
} from '../impls/07-baked-rules/index.ts';
import {
  getTimeZonesAt as all08,
  getTimeZones as now08,
  getTimeZoneAt as at08,
  getTimeZone as one08,
  clearCache as clear08,
} from '../impls/08-verified-sharing/index.ts';
import {
  getTimeZonesAt as all10,
  getTimeZones as now10,
  getTimeZoneAt as at10,
  getTimeZone as one10,
  clearCache as clear10,
} from '../impls/10-audited-rules/index.ts';
import type { GetTimeZonesAt, GetTimeZones, GetTimeZoneAt, GetTimeZone } from '../shared/types.ts';
import { zoneLinkPairs, canonicalZone, canonicalView } from '../shared/zoneLinks.ts';
import { zones } from '../shared/zones.ts';

// `withAliases: false` opts out of legacy-spelled results. It means two things
// that share one intent — never hand back a TimeZoneInfo carrying an aliasOf:
// the list getters DROP the alias entries, and the single-zone getters
// SUBSTITUTE the canonical zone. These pin both, plus the properties that make
// the opt-out cheap (filtered lists memoized by reference, substituted results
// reference-identical to asking for the canonical name).

interface Api {
  id: string;
  all: GetTimeZonesAt;
  now: GetTimeZones;
  at: GetTimeZoneAt;
  one: GetTimeZone;
  clear: () => void;
}

const impls: Api[] = [
  { id: '04-live-intl', all: all04, now: now04, at: at04, one: one04, clear: clear04 },
  { id: '07-baked-rules', all: all07, now: now07, at: at07, one: one07, clear: clear07 },
  { id: '08-verified-sharing', all: all08, now: now08, at: at08, one: one08, clear: clear08 },
  { id: '10-audited-rules', all: all10, now: now10, at: at10, one: one10, clear: clear10 },
];

const TS = Date.UTC(2026, 6, 15, 12);

describe('the alias set is well formed', () => {
  test('every alias and its canonical target are both enumerated', () => {
    // filtering (rather than rewriting) the list is only correct because
    // shared/zones.ts guarantees both spellings are present on every runtime
    for (const [canonical, alias] of zoneLinkPairs) {
      expect(zones).toContain(canonical);
      expect(zones).toContain(alias);
    }
  });

  test('canonicalZone() maps aliases and passes everything else through', () => {
    for (const [canonical, alias] of zoneLinkPairs) {
      expect(canonicalZone(alias)).toBe(canonical);
      expect(canonicalZone(canonical)).toBe(canonical);
    }

    for (const name of ['UTC', 'Etc/UTC', 'Etc/GMT+5', 'Not/AZone']) {
      expect(canonicalZone(name)).toBe(name);
    }
  });
});

describe('the list getters drop alias entries', () => {
  for (const { id, all, now, clear } of impls) {
    test(id, () => {
      clear();

      const full = all(TS);
      const canon = all(TS, false);
      const aliases = full.filter((z) => z.aliasOf != null);

      expect(aliases.length).toBe(zoneLinkPairs.length);
      expect(canon.length).toBe(full.length - zoneLinkPairs.length);
      expect(canon.every((z) => z.aliasOf == null)).toBe(true);

      // exactly the alias entries are missing, in the same order, and the
      // survivors are the very same interned instances (not copies)
      expect(canon).toEqual(full.filter((z) => z.aliasOf == null));
      canon.forEach((z, i) => expect(z).toBe(full.filter((x) => x.aliasOf == null)[i]!));

      // and every dropped entry's canonical counterpart survived
      for (const a of aliases) {
        expect(canon.some((z) => z.name === a.aliasOf)).toBe(true);
      }

      // current-instant twin behaves the same
      clear();
      expect(now(false)).toEqual(now().filter((z) => z.aliasOf == null));
    });
  }
});

describe('filtered lists keep the by-reference memo contract', () => {
  for (const { id, all, now, clear } of impls) {
    test(id, () => {
      clear();

      // same hour bucket -> same array identity, exactly as the unfiltered path
      expect(all(TS, false)).toBe(all(TS + 60_000, false));
      expect(now(false)).toBe(now(false));

      // and the default path is untouched by the opt-out having been used
      expect(all(TS)).toBe(all(TS + 60_000));

      // clearCache() drops the derived array too
      const before = all(TS, false);
      clear();
      expect(all(TS, false)).not.toBe(before);
      expect(all(TS, false)).toEqual(before);
    });
  }
});

describe('the single-zone getters substitute the canonical zone', () => {
  for (const { id, at, one, clear } of impls) {
    test(id, () => {
      clear();

      for (const [canonical, alias] of zoneLinkPairs) {
        // default: the legacy spelling is answered as asked, with aliasOf
        const asAlias = at(alias, TS);

        expect(asAlias.name).toBe(alias);
        expect(asAlias.aliasOf).toBe(canonical);

        // opted out: the canonical zone, and — since makeInfo pools by name —
        // the very same interned instance that spelling would have produced
        const asCanon = at(alias, TS, false);

        expect(asCanon.name).toBe(canonical);
        expect(asCanon.aliasOf).toBeUndefined();
        expect(asCanon).toBe(at(canonical, TS));

        // offset and abbr are the canonical zone's, which for a link pair are
        // the alias's too — the substitution changes only the label
        expect(asCanon.offset).toBe(asAlias.offset);

        // current-instant twin
        expect(one(alias, false)).toBe(one(canonical));
        expect(one(alias, false).name).toBe(canonical);
      }
    });
  }
});

describe('the opt-out leaves non-alias names alone', () => {
  for (const { id, at, one, clear } of impls) {
    test(id, () => {
      clear();

      for (const name of ['America/New_York', 'Asia/Kolkata', 'UTC', 'Etc/UTC', 'Etc/GMT+5', 'Etc/GMT-14']) {
        expect(at(name, TS, false)).toBe(at(name, TS));
        expect(one(name, false)).toBe(one(name));
      }
    });
  }
});

describe('unknown names still get the UTC sentinel when opted out', () => {
  // canonicalZone() passes them through, so the sentinel keeps the name as given
  for (const { id, at, one } of [
    { id: '07-baked-rules', at: at07, one: one07 },
    { id: '10-audited-rules', at: at10, one: one10 },
  ]) {
    test(id, () => {
      expect(at('Not/AZone', TS, false)).toEqual({ name: 'Not/AZone', abbr: 'UTC', offset: 0 });
      expect(one('Not/AZone', false)).toEqual({ name: 'Not/AZone', abbr: 'UTC', offset: 0 });
    });
  }
});

describe('the single-zone opt-out agrees with the filtered list', () => {
  for (const { id, all, at, clear } of impls) {
    test(id, () => {
      clear();

      const canon = all(TS, false);
      const byName = new Map(canon.map((z) => [z.name, z]));

      // every surviving entry is what the single-zone getter answers, and
      // asking by the legacy spelling lands on that same entry
      for (const z of canon) {
        expect(at(z.name, TS, false)).toBe(z);
      }

      for (const [canonical, alias] of zoneLinkPairs) {
        expect(at(alias, TS, false)).toBe(byName.get(canonical)!);
      }
    });
  }
});

describe('canonicalView() recomputes only when its input changes', () => {
  test('identity-keyed, single slot', () => {
    const view = canonicalView();
    const a = all07(TS);
    const b = all07(Date.UTC(2026, 0, 15, 12));

    expect(view(a)).toBe(view(a));

    const fromB = view(b);

    expect(fromB).not.toBe(view(a));
    // ...and coming back re-derives rather than returning B's array
    expect(view(b)).not.toBe(fromB);
  });
});
