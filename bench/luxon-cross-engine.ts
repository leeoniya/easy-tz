// Runs bench/luxon-upstream.ts under node and bun and diffs the two.
//
// Worth doing because the two engines do not agree about the small patches.
// Most of them trade an allocation or a dispatch for slightly more code, and
// whether that pays depends on the engine's escape analysis and inline caches
// rather than on anything in luxon. The large wins (C, I) hold everywhere; the
// rest need checking on both before being argued for upstream. V8 is the one
// that matters for luxon's users, but a patch that only helps V8 is a weaker
// pitch than one that helps both, and one that hurts JSC is weaker still.
//
// The two runs are sequential, never concurrent — they are timing each other's
// workload otherwise. Budget ~4 minutes.

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { printTable } from '../tools/print-table.ts';

interface Run {
  runtime: string;
  icu: string | null;
  ms: Record<string, Record<string, number>>;
}

const BENCH = new URL('./luxon-upstream.ts', import.meta.url).pathname;

/** returns an error message, or null if the run produced results */
function run(exe: string): string | null {
  const started = Date.now();
  process.stdout.write(`running ${exe}... `);

  const proc = spawnSync(exe, [BENCH], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  if (proc.error !== undefined) {
    console.log('not available');
    return `${exe} could not be started (${proc.error.message})`;
  }

  if (proc.status !== 0) {
    console.log('failed');
    return `${exe} exited ${proc.status}:\n${(proc.stderr || proc.stdout || '').trim().split('\n').slice(-8).join('\n')}`;
  }

  console.log(`${((Date.now() - started) / 1000).toFixed(0)}s`);
  return null;
}

const failures = ['node', 'bun'].map(run).filter((e): e is string => e !== null);

async function load(tag: string): Promise<Run | null> {
  try {
    return JSON.parse(await readFile(new URL(`../.tmp/luxon-upstream-${tag}.json`, import.meta.url), 'utf8')) as Run;
  } catch {
    return null;
  }
}

const v8 = await load('node');
const jsc = await load('bun');

if (v8 === null || jsc === null) {
  console.error(`\nneed both runs to compare.\n${failures.join('\n') || 'missing results file'}`);
  process.exit(1);
}

console.log(`\nV8:  ${v8.runtime}, ICU ${v8.icu ?? '?'}`);
console.log(`JSC: ${jsc.runtime}, ICU ${jsc.icu ?? '?'}`);

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

/** what `path` saves against the unpatched easy-tz zone, on that engine */
function saved(run: Run, fmt: string, path: string): number {
  const base = run.ms[fmt]!['easytz zone']!;

  return (base - run.ms[fmt]![path]!) / base;
}

/** each engine gets its own noise floor — they are not equally steady */
function floor(run: Run, fmt: string): number {
  return Math.abs(saved(run, fmt, 'easytz zone (control)'));
}

const FMT = 'numeric';
const patches = Object.keys(v8.ms[FMT]!)
  .filter((k) => k.startsWith('easytz +'))
  .map((path) => ({ path, label: path.slice('easytz +'.length) }));

const rows = patches
  .map((p) => ({
    ...p,
    a: saved(v8, FMT, p.path),
    b: saved(jsc, FMT, p.path),
  }))
  .sort((x, y) => y.a - x.a);

const verdict = (r: (typeof rows)[number]) => {
  const clears = (s: number, run: Run) => s >= Math.max(3 * floor(run, FMT), 0.04);
  const a = clears(r.a, v8);
  const b = clears(r.b, jsc);

  return a && b ? 'both' : a ? 'V8 only' : b ? 'JSC only' : 'neither';
};

console.log(`\n% saved vs the unpatched easy-tz zone, ${FMT} format`);
console.log(`(noise floor: ${pct(floor(v8, FMT))} on V8, ${pct(floor(jsc, FMT))} on JSC)\n`);

printTable(
  ['patch', 'V8', 'JSC', 'clears noise on'],
  rows.map((r) => [r.label, pct(r.a), pct(r.b), verdict(r)])
);

console.log('\nheadline ratios vs moment\n');

printTable(
  ['path', 'V8 numeric', 'JSC numeric', 'V8 abbr', 'JSC abbr'],
  [
    'luxon (stock)',
    'luxon C+J',
    'luxon C+J+K',
    'luxon ABCDEFGHI (formatter only)',
    'luxon all 11 (A-K)',
    'easytz zone',
    'easytz ABCDEFGHI (all)',
    'easytz fast path',
  ].map((path) => {
    const ratio = (run: Run, fmt: string) => `${(run.ms[fmt]![path]! / run.ms[fmt]!['moment']!).toFixed(2)}×`;

    return [path, ratio(v8, 'numeric'), ratio(jsc, 'numeric'), ratio(v8, 'abbr'), ratio(jsc, 'abbr')];
  })
);

const agreed = rows.filter((r) => verdict(r) === 'both').map((r) => r.label[0]!);
const split = rows.filter((r) => verdict(r) === 'V8 only' || verdict(r) === 'JSC only');

console.log(`
Patches that clear the noise floor on both engines: ${agreed.join('') || 'none'}${
  split.length === 0
    ? ''
    : `
Engine-specific, and the weakest part of any upstream pitch: ${split.map((r) => `${r.label[0]!} (${verdict(r)})`).join(', ')}`
}`);
