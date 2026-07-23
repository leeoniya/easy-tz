// Generates the CHROME-aligned table set (shared/tables/chrome/): bundles
// tools/gen-core.ts, evaluates it inside chrome-headless-shell, verifies
// both tables against that browser's live Intl in the same session, and only
// then writes the files (with Chrome provenance in genMeta). Does not change
// which variant is active — switch with: bun run tables <bun|chrome>.
//
// Requires the browser once: bunx browsers install chrome-headless-shell@stable --path .browsers
// Run via `bun run gen` (tools/gen-all.ts); not exposed as its own script.

import puppeteer from 'puppeteer-core';
import { findHeadlessShell } from './browser.ts';
import { bundleForBrowser } from './chrome-harness.ts';
import { emitClassesTs, emitScheduleTs, emitHistoryTs, type GenMeta } from './emitters.ts';
import { writeTableSet } from './table-files.ts';
import type { GeneratedTables, GeneratedHistory, Verification } from './gen-core.ts';

const executablePath = await findHeadlessShell();

// self-contained script for the browser: defines globalThis.__gen
const code = await bundleForBrowser(new URL('./gen-browser-entry.ts', import.meta.url).pathname);

const browser = await puppeteer.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-gpu'],
});

try {
  const version = await browser.version(); // e.g. "HeadlessChrome/150.0.7871.115"
  const page = await browser.newPage();

  await page.evaluate(code);

  const { tables, verification, history } = (await page.evaluate('__gen()')) as {
    tables: GeneratedTables;
    verification: Verification;
    history: GeneratedHistory | null;
  };

  if (verification.mismatches.length > 0 || history === null) {
    console.error('in-browser verification FAILED:', JSON.stringify(verification.mismatches, null, 2));
    process.exit(1);
  }

  const meta: GenMeta = {
    host: `chrome-headless-shell ${version.replace(/^HeadlessChrome\//, '')}`,
    icu: null, // browsers don't expose their ICU version
    generated: new Date().toISOString(),
  };

  const active = writeTableSet('chrome', {
    classes: emitClassesTs(tables, meta),
    schedule: emitScheduleTs(tables, meta),
    history: emitHistoryTs(history, tables, meta),
  });

  const s = tables.stats;
  const h = history.stats;

  console.log(
    `wrote shared/tables/chrome/{classes,schedule,history}.ts (host: ${meta.host}, active variant: ${active}):\n` +
      `  ${s.zones} zones -> ${s.sigClasses} classes / ${s.schedClasses} schedule classes (${s.staticClasses} static, ${s.ruleClasses} rule, ${s.irregularClasses} irregular w/ ${s.irregularZones} zones), probe ${s.probeMs}ms\n` +
      `  history ${history.fromYear}-${history.toYear - 1}: ${h.zones} zones (${h.coveredZones} schedule-covered) -> ${h.classes} classes (${h.staticEras} static, ${h.ruleEras} rule, ${h.rawYears} raw, ${h.deferEras} defer eras), probe ${h.probeMs}ms\n` +
      `  in-browser verified: ${verification.checks} checks at ${verification.instants} instants, 0 mismatches`
  );
} finally {
  await browser.close();
}
