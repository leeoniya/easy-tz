// Unified benchmark: Chrome (the deployment target) is the primary report and
// always runs. Two opt-in expansions, both off by default because they cost far
// more wall time than the information moves:
//   --libs  the third-party comparison libraries (their numbers only change
//           when package.json is bumped)
//   --bun   a supplementary bun pass, the fast proxy for the no-Temporal
//           (Safari) fallback paths — its absolute numbers are JSC's, not a
//           browser prediction
//
// Run: bun run bench          (this repo's impls, Chrome only, ~5s)
//      bun run bench:libs     (+ the comparison libraries, ~12s)
//      bun run bench:all      (+ the supplementary bun pass too, ~20s)

import { withBun } from './bench-opts.ts';

const args = process.argv.slice(2);

function run(label: string, script: string): number {
  console.log(`=== ${label} ===\n`);

  const proc = Bun.spawnSync({
    cmd: [process.execPath, new URL(script, import.meta.url).pathname, ...args],
    stdout: 'inherit',
    stderr: 'inherit',
  });

  console.log('');

  return proc.exitCode ?? 1;
}

const chrome = run('chrome-headless-shell (primary target)', './bench-chrome.ts');

const bun = withBun
  ? run('bun — supplementary: no-Temporal (Safari) fallback paths, JSC timings', '../bench/bench.ts')
  : 0;

if (!withBun) console.log('supplementary bun pass skipped — pass --bun to include it\n');

if (chrome !== 0 || bun !== 0) process.exit(1);
