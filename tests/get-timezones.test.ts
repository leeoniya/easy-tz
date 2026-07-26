import { describe, test, expect } from 'bun:test';
import { getTimeZonesAt as all04, getTimeZones as now04, getTimeZone as one04, clearCache as clear04 } from '../impls/04-live-intl/index.ts';
import { getTimeZonesAt as all07, getTimeZones as now07, getTimeZone as one07, clearCache as clear07 } from '../impls/07-baked-rules/index.ts';
import { getTimeZonesAt as all08, getTimeZones as now08, getTimeZone as one08, clearCache as clear08 } from '../impls/08-verified-sharing/index.ts';
import { getTimeZonesAt as all10, getTimeZones as now10, getTimeZone as one10, clearCache as clear10 } from '../impls/10-audited-rules/index.ts';
import type { GetTimeZonesAt, GetTimeZones, GetTimeZone } from '../shared/types.ts';
import { zones } from '../shared/zones.ts';

// getTimeZones() is the no-argument current-instant convenience over
// getTimeZonesAt(Date.now()), and getTimeZone(name) its single-zone twin. On
// the baked impls (07/10) both take a distinct, history-free code path
// (schedule only), so these pin that the schedule-only route produces exactly
// the same answers as the full resolver at "now" — the current instant is
// always the bake year or later, where there's no history to consult.
const impls: { id: string; all: GetTimeZonesAt; now: GetTimeZones; one: GetTimeZone; clear: () => void }[] = [
  { id: '04-live-intl', all: all04, now: now04, one: one04, clear: clear04 },
  { id: '07-baked-rules', all: all07, now: now07, one: one07, clear: clear07 },
  { id: '08-verified-sharing', all: all08, now: now08, one: one08, clear: clear08 },
  { id: '10-audited-rules', all: all10, now: now10, one: one10, clear: clear10 },
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

describe('getTimeZone() matches getTimeZones() for every zone', () => {
  // the schedule-only single-zone route must agree with the schedule-only
  // all-zones route it mirrors, entry for entry
  for (const { id, now, one, clear } of impls) {
    test(id, () => {
      clear();
      const byName = new Map(now().map((z) => [z.name, z]));

      expect(byName.size).toBe(zones.length);

      for (const name of zones) {
        expect(one(name)).toEqual(byName.get(name)!);
      }
    });
  }
});

describe('getTimeZone() on the baked impls (07/10) handles unknown zones gracefully', () => {
  // same UTC sentinel the history-capable getTimeZoneAt() answers, rather than
  // throwing on a name the runtime doesn't know
  for (const { id, one } of [
    { id: '07-baked-rules', one: one07 },
    { id: '10-audited-rules', one: one10 },
  ]) {
    test(id, () => {
      expect(one('Not/AZone')).toEqual({ name: 'Not/AZone', abbr: 'UTC', offset: 0 });
    });
  }
});
