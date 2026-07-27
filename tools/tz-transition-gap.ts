// How close together do two consecutive offset transitions ever get?
//
// This number is load-bearing in two places, for the same reason: a window
// narrower than the tightest gap holds at most one transition, and one
// transition necessarily changes the offset.
//
// - bench/luxon-patches.ts (offsetInterval) caches the offset across a span
//   two agreeing probes prove transition-free — valid only while the probe
//   spacing is shorter than the gap.
// - tools/gen-core.ts scans zone-years at a fixed stride. It resolves any
//   number of changes within a window, so what it needs from this number is
//   narrower: a window must never change and RETURN to the value it started
//   on, which is invisible to any sampling. Two transitions closer together
//   than the stride are what would make that possible.
//
// Run this after a tzdata bump. Both spacings are asserted below; if the
// tightest gap ever drops to meet one, that consumer needs a tighter spacing
// or needs dropping.
//
//   bun tools/tz-transition-gap.ts

import moment from 'moment-timezone';
import { printTable } from './print-table.ts';
import { SCHEDULE_STRIDE_DAYS, HISTORY_STRIDE_DAYS } from './gen-core.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;

interface Era {
  label: string;
  from: number;
}

const ERAS: Era[] = [
  { label: 'all time', from: -Infinity },
  { label: 'since 1900', from: Date.UTC(1900, 0, 1) },
  { label: 'since 1970', from: Date.UTC(1970, 0, 1) },
  { label: 'since 2000', from: Date.UTC(2000, 0, 1) },
];

interface Tightest {
  gap: number;
  where: string;
  count: number;
  aligned: number;
}

function scan(from: number): Tightest {
  let gap = Infinity;
  let where = '';
  let count = 0;
  let aligned = 0;

  for (const name of moment.tz.names()) {
    const zone = moment.tz.zone(name);

    if (zone === null) continue;

    const { untils } = zone;

    for (let i = 1; i < untils.length; i++) {
      const a = untils[i - 1]!;
      const b = untils[i]!;

      if (!isFinite(a) || !isFinite(b) || a < from) continue;

      count++;
      if (((b % HOUR) + HOUR) % HOUR === 0) aligned++;

      if (b - a < gap) {
        gap = b - a;
        where = `${name} ${new Date(a).toISOString().slice(0, 10)} -> ${new Date(b).toISOString().slice(0, 10)}`;
      }
    }
  }

  return { gap, where, count, aligned };
}

const rows = ERAS.map(({ label, from }) => {
  const t = scan(from);

  return [
    label,
    t.count.toLocaleString(),
    `${(t.gap / DAY).toFixed(2)}d`,
    `${((t.aligned / t.count) * 100).toFixed(1)}%`,
    t.where,
  ];
});

console.log(`tzdata ${moment.tz.dataVersion}, ${moment.tz.names().length} zones\n`);
printTable(['era', 'transitions', 'tightest gap', 'UTC hour-aligned', 'where'], rows);

const { gap } = scan(-Infinity);
const gapDays = gap / DAY;

const spacings: [string, number][] = [
  ['offsetInterval probe spacing', 2],
  ['gen-core schedule stride', SCHEDULE_STRIDE_DAYS],
  ['gen-core history stride', HISTORY_STRIDE_DAYS],
];

console.log('');
printTable(
  ['consumer', 'spacing', 'margin', 'ok'],
  spacings.map(([label, days]) => [
    label,
    `${days}d`,
    `${(gapDays / days).toFixed(1)}×`,
    gapDays > days ? 'yes' : 'NO',
  ])
);

const failed = spacings.filter(([, days]) => gapDays <= days);

if (failed.length > 0) {
  console.error(
    `\nFAIL: tightest gap ${gapDays.toFixed(2)}d no longer exceeds: ${failed.map(([l]) => l).join(', ')}`
  );
  process.exit(1);
}
