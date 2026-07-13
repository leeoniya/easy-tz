// Unified table generation: Chrome is the primary target (tables verified
// in-browser, the shippable artifact in shared/tables/chrome/), and the
// bun-aligned variant is regenerated behind the scenes so the fast local
// test suite (bun, which also exercises the no-Temporal/Safari fallback
// paths) can run its live-Intl equivalence checks fully.
//
// Leaves the active selector on the bun variant: that's the dev/test state;
// what ships is shared/tables/chrome/ regardless of local selection.
//
// Run: bun run gen

import { selectTables } from './use-tables.ts';

function run(label: string, script: string): void {
  console.log(`--- ${label} ---`);

  const proc = Bun.spawnSync({
    cmd: [process.execPath, new URL(script, import.meta.url).pathname],
    stdout: 'inherit',
    stderr: 'inherit',
  });

  if (proc.exitCode !== 0) {
    console.error(`${label} failed (exit ${proc.exitCode})`);
    process.exit(proc.exitCode ?? 1);
  }
}

run('chrome tables (primary, verified in-browser)', './gen-chrome.ts');
run('bun tables (supplementary, for local tests + Safari-fallback coverage)', './gen-classes.ts');

selectTables('bun');
console.log('--- active variant: bun (local dev/tests); shippable artifact: shared/tables/chrome/ ---');
