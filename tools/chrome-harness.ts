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

// bundles a browser entry (default: tools/bench-browser-entry.ts) against
// the Chrome table variant, temporarily flipping the selector and restoring it
export async function bundleBrowserEntry(entryPath?: string): Promise<string> {
  if (!existsSync(new URL('../shared/tables/chrome/schedule.ts', import.meta.url))) {
    console.error('no Chrome table set — run: bun run gen');
    process.exit(1);
  }

  const previousVariant = activeVariant() ?? 'bun';

  selectTables('chrome');

  try {
    return await bundleForBrowser(entryPath ?? new URL('./bench-browser-entry.ts', import.meta.url).pathname);
  } finally {
    selectTables(previousVariant);
  }
}

// bundles tools/lib-browser-entry.ts (comparison libraries + impl-04
// baseline); no table flip needed since nothing in it imports the tables
export async function bundleLibBrowserEntry(): Promise<string> {
  return bundleForBrowser(new URL('./lib-browser-entry.ts', import.meta.url).pathname);
}

// ONE library per bundle, for the benchmark's fresh-page-per-sample loop. The
// combined entry above is ~4.3MB, so benching all five from it made each of the
// ~25 library pages spend ~520ms parsing the other four libraries' tzdata; a
// single-library page parses only its own (~0.9MB for the largest).
//
// The entry is synthesized as a virtual module rather than kept as five
// near-identical files, so the set stays derived from lib-registry.ts. Its
// imports are absolute because a virtual module has no directory for relative
// specifiers to resolve against. The correctness pass (tools/test-chrome.ts)
// still uses the combined entry — it runs every library on one page, where the
// shared parse cost is paid once and measures nothing.
export async function bundleSingleLibEntry(libId: string): Promise<string> {
  const root = new URL('../', import.meta.url).pathname;
  const path = (rel: string) => JSON.stringify(root + rel);

  const source = `
    import { getTimeZonesAt } from ${path(`impls/${libId}/index.ts`)};
    import { getTimeZonesAt as live04 } from ${path('impls/04-live-intl/index.ts')};
    import { installKernel } from ${path('tools/browser-kernel.ts')};

    installKernel(
      [{ id: ${JSON.stringify(libId)}, label: ${JSON.stringify(libId)}, features: {}, getTimeZonesAt }],
      { id: '04-live-intl', label: 'live Intl baseline', features: {}, getTimeZonesAt: live04 }
    );
  `;

  const result = await Bun.build({
    entrypoints: ['virtual:lib-entry'],
    target: 'browser',
    format: 'iife',
    plugins: [
      {
        name: 'virtual-lib-entry',
        setup(build) {
          build.onResolve({ filter: /^virtual:lib-entry$/ }, () => ({ path: 'virtual:lib-entry', namespace: 'virtual' }));
          build.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: source, loader: 'ts' }));
        },
      },
    ],
  });

  return result.outputs[0]!.text();
}

export async function launchChrome(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: await findHeadlessShell(),
    args: ['--no-sandbox', '--disable-gpu'],
  });
}
