// Shared plumbing for the Chrome-headless-shell scripts (bench-chrome,
// test-chrome): bundling the browser entry against the Chrome table variant
// and launching the browser.

import { existsSync } from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';
import { findHeadlessShell } from './browser.ts';
import { selectTables } from './use-tables.ts';
import { activeVariant } from './table-files.ts';

// impls with a Temporal fast path; each gets a second no-Temporal pass that
// exercises its Safari fallback under real V8/Chrome ICU
export const NO_TEMPORAL_IDS = ['08-verified-sharing', '10-audited-rules'];

// evaluate BEFORE the bundle so module-load feature detection sees no Temporal
export const KILL_TEMPORAL = 'globalThis.Temporal = undefined; delete globalThis.Temporal;';

// bundles an entry for in-page evaluation (iife so page.evaluate can run it)
export async function bundleForBrowser(entryPath: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entryPath],
    target: 'browser',
    format: 'iife',
  });

  return result.outputs[0]!.text();
}

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
    return await bundleForBrowser(new URL('./bench-browser-entry.ts', import.meta.url).pathname);
  } finally {
    selectTables(previousVariant);
  }
}

// bundles tools/lib-browser-entry.ts (comparison libraries + impl-04
// baseline); no table flip needed since nothing in it imports the tables
export async function bundleLibBrowserEntry(): Promise<string> {
  return bundleForBrowser(new URL('./lib-browser-entry.ts', import.meta.url).pathname);
}

export async function launchChrome(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: await findHeadlessShell(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
}
