// Shared plumbing for the Chrome-headless-shell scripts (bench-chrome,
// test-chrome): bundling the browser entry against the Chrome table variant
// and launching the browser.

import { existsSync } from 'node:fs';
import { bundle } from '@swc/core';
import puppeteer, { type Browser } from 'puppeteer-core';
import { findHeadlessShell } from './browser.ts';
import { selectTables } from './use-tables.ts';
import { activeVariant } from './table-files.ts';

// impls with a Temporal fast path; each gets a second no-Temporal pass that
// exercises its Safari fallback under real V8/Chrome ICU
export const NO_TEMPORAL_IDS = ['08-verified-reps', '09-live-offsets'];

// evaluate BEFORE the bundle so module-load feature detection sees no Temporal
export const KILL_TEMPORAL = 'globalThis.Temporal = undefined; delete globalThis.Temporal;';

// bundles tools/bench-browser-entry.ts against the Chrome table variant,
// temporarily flipping the selector and restoring it
export async function bundleBrowserEntry(): Promise<string> {
  if (!existsSync(new URL('../shared/tables/chrome/schedule.ts', import.meta.url))) {
    console.error('no Chrome table set — run: bun run gen');
    process.exit(1);
  }

  const previousVariant = activeVariant() ?? 'bun';

  selectTables('chrome');

  try {
    const bundled = await bundle({
      entry: { main: new URL('./bench-browser-entry.ts', import.meta.url).pathname },
      output: { name: 'main', path: '.' },
      module: {},
      mode: 'production',
      target: 'browser',
      options: { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' } },
    });

    return bundled['main']!.code;
  } finally {
    selectTables(previousVariant);
  }
}

export async function launchChrome(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: await findHeadlessShell(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
}

// right-aligned report table (first column left-aligned)
export function printTable(headers: string[], cells: string[][]): void {
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i]!.length)));
  const line = (c: string[]) =>
    c.map((v, i) => (i === 0 ? v.padEnd(widths[i]!) : v.padStart(widths[i]!))).join('  ');

  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const c of cells) console.log(line(c));
}
