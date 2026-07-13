// Unified benchmark: Chrome (the deployment target) is the primary report;
// a supplementary bun pass runs behind the scenes as the fast proxy for the
// no-Temporal (Safari) fallback paths — its absolute numbers are JSC's, not
// a browser prediction.
//
// Run: bun run bench

function run(label: string, script: string): number {
  console.log(`=== ${label} ===\n`);

  const proc = Bun.spawnSync({
    cmd: [process.execPath, new URL(script, import.meta.url).pathname],
    stdout: 'inherit',
    stderr: 'inherit',
  });

  console.log('');

  return proc.exitCode ?? 1;
}

const chrome = run('chrome-headless-shell (primary target)', './bench-chrome.ts');
const bun = run('bun — supplementary: no-Temporal (Safari) fallback paths, JSC timings', '../bench/bench.ts');

if (chrome !== 0 || bun !== 0) process.exit(1);
