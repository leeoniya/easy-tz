// The two offset patches proposed for luxon upstream (bench/luxon-patches.ts)
// must be invisible: same offset, same formatted output, same NaN cases as
// stock luxon.
//
// offsetInterval is the one that needs the coverage. It is stateful and its
// answer depends on which instants it was asked about earlier, so every zone is
// replayed in three access orders — a sequential reader, a random one, and a
// backwards one — against a fresh module each time.

import { describe, expect, test } from 'bun:test';
import moment from 'moment-timezone';
import { loadLuxon, type PatchKey } from '../bench/luxon-patches.ts';

const ZONES = [
  'America/New_York',
  'Europe/London',
  'Asia/Kolkata', // no DST at all
  'Australia/Lord_Howe', // 30-minute DST step, transitions off the UTC hour
  'America/Cambridge_Bay', // holds the tightest transition gap in all of tzdata
  'Africa/Casablanca', // Ramadan transitions, the densest modern schedule
  'Pacific/Chatham',
  'America/Santiago',
  'Asia/Kathmandu', // +05:45
  'Pacific/Kiritimati', // +14, and skipped a whole day in 1994
  'Europe/Dublin', // negative DST
  'Antarctica/Troll', // 2-hour DST step
];

const VARIANTS: [string, PatchKey[]][] = [
  ['offsetScan', ['offsetScan']],
  ['offsetScan + offsetInterval', ['offsetScan', 'offsetInterval']],
];

const PATTERN = "yyyy-MM-dd HH:mm:ss 'x' ZZ z";

/** instants chosen to hit the cases the scanner and the interval cache can get wrong */
function instants(zone: string): number[] {
  const out: number[] = [];
  const base = Date.UTC(2026, 0, 1);

  for (let i = 0; i < 800; i++) out.push(base + i * 3_600_000);

  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let i = 0; i < 1500; i++) out.push(Math.floor((rnd() * 2 - 1) * 4e12));
  for (let i = 0; i < 300; i++) out.push(Math.floor(rnd() * 6e13) - 63e12); // years 0-100, and BC
  for (let i = 0; i < 200; i++) out.push(base + Math.floor(rnd() * 1000)); // sub-second

  // every real transition, to the millisecond on both sides
  const tz = moment.tz.zone(zone);

  if (tz !== null) {
    for (const until of tz.untils) {
      if (!isFinite(until)) continue;
      out.push(until - 1, until, until + 1, until - 1000, until + 1000);
    }
  }

  // the edges of the Date range, where luxon's Date.UTC round trip overflows
  out.push(NaN, 8.64e15, -8.64e15, 8.64e15 + 1, -8.64e15 - 1, Infinity, -Infinity);

  return out;
}

const stock = await loadLuxon([]);

describe.each(VARIANTS)('%s', (_label, keys) => {
  test.each(ZONES)('%s matches stock luxon in every access order', async (zone) => {
    const points = instants(zone);
    const orders: [string, number[]][] = [
      ['sequential', points],
      ['shuffled', [...points].sort(() => 0.5 - Math.random())],
      ['reversed', [...points].reverse()],
    ];

    for (const [, list] of orders) {
      // a fresh module per order, so one order cannot warm another's cache
      const patched = await loadLuxon(keys);
      const want = stock.IANAZone.create(zone);
      const got = patched.IANAZone.create(zone);
      const offsetDiffs: string[] = [];
      const formatDiffs: string[] = [];

      for (const ts of list) {
        const a = want.offset(ts);
        const b = got.offset(ts);

        if (!(a === b || (Number.isNaN(a) && Number.isNaN(b)))) {
          offsetDiffs.push(`${ts}: ${a} vs ${b}`);
        }

        if (Number.isFinite(ts) && Math.abs(ts) <= 8.64e15) {
          const fa = stock.DateTime.fromMillis(ts, { zone: want }).toFormat(PATTERN);
          const fb = patched.DateTime.fromMillis(ts, { zone: got }).toFormat(PATTERN);

          if (fa !== fb) formatDiffs.push(`${ts}: "${fa}" vs "${fb}"`);
        }
      }

      expect(offsetDiffs.slice(0, 3)).toEqual([]);
      expect(formatDiffs.slice(0, 3)).toEqual([]);
    }
  });
});
