import { describe, test, expect } from 'bun:test';
import { etcZoneInfo } from '../shared/etcZones.ts';
import { scheduleZoneInfo } from '../shared/bakedSchedule.ts';
import { getTimeZoneAt as one04 } from '../impls/04-live-intl/index.ts';
import { getTimeZoneAt as one07, getTimeZone as now07 } from '../impls/07-baked-rules/index.ts';
import { getTimeZoneAt as one10, getTimeZone as now10 } from '../impls/10-audited-rules/index.ts';

// Etc/GMT±N, UTC and Etc/UTC are valid Intl timeZone inputs everywhere but
// Chrome's ICU doesn't ENUMERATE them, so on Chrome they're missing from both
// the zone list and the generated tables and the baked resolvers would answer
// the unknown-zone UTC sentinel — wrong for the 26 non-zero ones.
// shared/etcZones.ts derives them arithmetically instead.
//
// This bun runtime does enumerate them (they're in its tables), so the tests
// below drive the fallback two ways: etcZoneInfo() directly, and
// scheduleZoneInfo(name, -1, ...) — ci = -1 being exactly the "uncovered zone"
// state a Chrome runtime lands in.

const ts = Date.UTC(2026, 6, 15, 12);

// POSIX sign inversion: Etc/GMT+N is UTC-N
const westward = Array.from({ length: 12 }, (_, i) => [`Etc/GMT+${i + 1}`, -(i + 1) * 60] as const);
const eastward = Array.from({ length: 14 }, (_, i) => [`Etc/GMT-${i + 1}`, (i + 1) * 60] as const);
const fixed = [...westward, ...eastward];

describe('etcZoneInfo() derives the fixed-offset zones', () => {
  test('Etc/GMT+N is UTC-N and Etc/GMT-N is UTC+N', () => {
    for (const [name, offset] of fixed) {
      expect(etcZoneInfo(name)).toEqual({ name, abbr: `GMT${offset < 0 ? '-' : '+'}${Math.abs(offset) / 60}`, offset });
    }
  });

  test('UTC and Etc/UTC keep the UTC abbreviation', () => {
    expect(etcZoneInfo('UTC')).toEqual({ name: 'UTC', abbr: 'UTC', offset: 0 });
    expect(etcZoneInfo('Etc/UTC')).toEqual({ name: 'Etc/UTC', abbr: 'UTC', offset: 0 });
  });

  test('ids tzdata does not define are left unresolved', () => {
    // out of range, zero-padded, zero-offset spellings the runtimes label
    // inconsistently, and plain junk — all must fall through, never be invented
    for (const name of [
      'Etc/GMT+13', 'Etc/GMT-15', 'Etc/GMT+99', 'Etc/GMT+05', 'Etc/GMT-00',
      'Etc/GMT+0', 'Etc/GMT-0', 'Etc/GMT', 'Etc/GMT0', 'Etc/Zulu', 'Etc/Greenwich',
      'Etc/GMT+', 'Etc/GMT++1', 'Etc/GMTx', 'Etc/GMT+1x', 'America/New_York', 'Not/AZone', '',
    ]) {
      expect(`${name} -> ${JSON.stringify(etcZoneInfo(name))}`).toBe(`${name} -> null`);
    }
  });

});

describe('fixed-offset results are interned and frozen', () => {
  // these go through makeInfo like every other zone, so they must obey the
  // same no-per-call-allocation contract: one frozen instance per id, handed
  // back by every route that can produce it
  const all = [...fixed.map(([name]) => name), 'UTC', 'Etc/UTC'];

  test('one frozen instance per id, reused across calls and timestamps', () => {
    for (const name of all) {
      const info = etcZoneInfo(name)!;

      expect(Object.isFrozen(info)).toBe(true);
      expect(etcZoneInfo(name)).toBe(info);
      expect(scheduleZoneInfo(name, -1, ts)).toBe(info);
      expect(scheduleZoneInfo(name, -1, Date.UTC(1998, 5, 15, 12))).toBe(info);
    }
  });

  test('the derived instance is the one the intern pool already holds', () => {
    // this runtime's tables DO cover these, so the impls resolve them through
    // a schedule class rather than the fallback. Both routes call makeInfo
    // with the same (name, abbr, offset), so the pool must hand back the very
    // same object — the derivation can't fork a parallel set of instances.
    for (const name of [...fixed.map(([n]) => n), 'UTC']) {
      const info = etcZoneInfo(name)!;

      expect(one07(name, ts)).toBe(info);
      expect(one10(name, ts)).toBe(info);
    }
  });

  test('getTimeZone() and getTimeZoneAt() hand back the same instance', () => {
    for (const name of ['Etc/GMT+5', 'Etc/GMT-14', 'UTC']) {
      const now = Date.now();

      expect(now07(name)).toBe(one07(name, now));
      expect(now10(name)).toBe(one10(name, now));
    }
  });
});

describe('the uncovered-zone path resolves them (the Chrome situation)', () => {
  // ci = -1 is what a runtime whose tables lack these names produces
  test('scheduleZoneInfo() with no schedule class answers the fixed offset', () => {
    for (const [name, offset] of fixed) {
      expect(scheduleZoneInfo(name, -1, ts).offset).toBe(offset);
    }

    expect(scheduleZoneInfo('UTC', -1, ts)).toEqual({ name: 'UTC', abbr: 'UTC', offset: 0 });
  });

  test('genuinely unknown names still get the UTC sentinel', () => {
    expect(scheduleZoneInfo('Not/AZone', -1, ts)).toEqual({ name: 'Not/AZone', abbr: 'UTC', offset: 0 });
  });
});

describe('derived values match this runtime\'s live Intl output', () => {
  // bun enumerates these, so impl 04 resolves them through live CLDR — an
  // independent oracle for both the offsets and the GMT±N labels
  test('etcZoneInfo() agrees with live Intl for every fixed-offset id', () => {
    for (const [name] of [...fixed, ['UTC'], ['Etc/UTC']] as const) {
      expect(etcZoneInfo(name)).toEqual(one04(name, ts));
    }
  });

  test('the baked impls agree with live Intl too, at past and present instants', () => {
    for (const when of [ts, Date.UTC(1998, 5, 15, 12)]) {
      for (const [name] of fixed) {
        expect(one07(name, when)).toEqual(one04(name, when));
        expect(one10(name, when)).toEqual(one04(name, when));
      }
    }
  });

  test('getTimeZone() resolves them at the current instant', () => {
    for (const [name, offset] of fixed) {
      expect(now07(name).offset).toBe(offset);
      expect(now10(name).offset).toBe(offset);
    }
  });
});
