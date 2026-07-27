// How close together do two consecutive offset transitions ever get?
//
// This number is load-bearing for the offsetInterval patch in
// bench/luxon-patches.ts, which caches the offset across a span proven
// transition-free by two probes that agree. That proof only holds while the
// probe spacing is shorter than the tightest real gap: a window narrower than
// the gap can hold at most one transition, one transition necessarily changes
// the offset, so agreeing probes mean no transition at all.
//
// Run this after a tzdata bump. If the tightest gap ever drops near the 2-day
// probe spacing, that patch needs a smaller spacing or needs dropping.
//
//   bun tools/tz-transition-gap.ts

import moment from 'moment-timezone';
import { printTable } from './print-table.ts';

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
const PROBE_DAYS = 2;

console.log(
  `\noffsetInterval probes ${PROBE_DAYS}d apart, ${(gap / DAY / PROBE_DAYS).toFixed(1)}× inside the tightest gap.`
);

if (gap / DAY <= PROBE_DAYS) {
  console.error('\nFAIL: probe spacing is no longer shorter than the tightest gap');
  process.exit(1);
}
