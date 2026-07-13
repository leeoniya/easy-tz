// Memory benchmark: runs bench/mem-probe.ts in a fresh subprocess per impl,
// SAMPLES times each, and reports per-phase medians:
//
//   import      — module load (generated table data for 06/07)
//   first call  — formatter construction (Intl-based impls) / first lookup
//   +25 misses  — sustained growth across cache-miss calls (ICU internals)
//   js heap     — the JS-heap share of the total; the remainder is native
//                 memory, i.e. almost entirely ICU formatter state
//
// Run: bun bench/mem.ts

import { impls } from '../impls/registry.ts';

const SAMPLES = 5;

interface Probe {
  importRss: number;
  firstCallRss: number;
  missesRss: number;
  totalRss: number;
  totalJs: number;
}

const median = (xs: number[]) => xs.toSorted((a, b) => a - b)[xs.length >> 1]!;
const probePath = new URL('./mem-probe.ts', import.meta.url).pathname;

const rows: string[][] = [];

for (const impl of impls) {
  const samples: Probe[] = [];

  for (let i = 0; i < SAMPLES; i++) {
    const proc = Bun.spawnSync({ cmd: [process.execPath, probePath, impl.id] });
    samples.push(JSON.parse(proc.stdout.toString()) as Probe);
  }

  const med = (key: keyof Probe) => median(samples.map((s) => s[key]));
  const MB = (b: number) => (b / 1048576).toFixed(2);

  const totalRss = med('totalRss');
  const totalJs = med('totalJs');

  rows.push([
    impl.id,
    MB(med('importRss')),
    MB(med('firstCallRss')),
    MB(med('missesRss')),
    MB(totalRss),
    MB(totalJs),
    MB(Math.max(0, totalRss - totalJs)),
  ]);
}

console.log(`fresh subprocess per impl, median of ${SAMPLES} runs, MB deltas (Bun.gc before each reading), runtime: bun ${Bun.version}\n`);

const headers = ['impl', 'import', 'first call', '+25 misses', 'total rss', 'js heap', 'native (~icu)'];
const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
const line = (c: string[]) => c.map((v, i) => v.padEnd(widths[i]!)).join('  ');

console.log(line(headers));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) console.log(line(r));
