// Memory probe for one impl in an isolated process; spawned by bench/mem.ts.
// Reports phase-separated RSS deltas plus the JS-heap portion, so the native
// (ICU) share is attributable: table-based impls allocate mostly JS heap at
// import; Intl-based impls allocate mostly native memory at first call.
//
// Usage: bun bench/mem-probe.ts <impl-id>

import { heapStats } from 'bun:jsc';

const id = process.argv[2]!;
const HOUR_MS = 3_600_000;

const snap = () => {
  Bun.gc(true);
  return { rss: process.memoryUsage().rss, js: heapStats().heapSize };
};

const s0 = snap();

const { getTimeZonesAt } = (await import(`../impls/${id}/index.ts`)) as {
  getTimeZonesAt: (ts: number) => unknown;
};

const s1 = snap(); // + module import (table data, code)

getTimeZonesAt(Date.UTC(2026, 6, 15));

const s2 = snap(); // + first call (formatter construction / first lookup)

for (let i = 1; i <= 25; i++) getTimeZonesAt(Date.UTC(2026, 6, 15) + i * HOUR_MS);

const s3 = snap(); // + 25 cache-miss calls (sustained ICU growth)

console.log(
  JSON.stringify({
    importRss: s1.rss - s0.rss,
    firstCallRss: s2.rss - s1.rss,
    missesRss: s3.rss - s2.rss,
    totalRss: s3.rss - s0.rss,
    totalJs: s3.js - s0.js,
  })
);
