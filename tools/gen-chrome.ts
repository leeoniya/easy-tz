// Generates the CHROME-aligned table set (shared/tables/chrome/): bundles
// tools/gen-core.ts, evaluates it inside chrome-headless-shell, verifies
// both tables against that browser's live Intl in the same session, and only
// then writes the files (with Chrome provenance in genMeta). Does not change
// which variant is active — switch with: bun run tables <bun|chrome>.
//
// Requires the browser once: bunx browsers install chrome-headless-shell@stable --path .browsers
// Run via `bun run gen` (tools/gen-all.ts); not exposed as its own script.

import { inChromePage, chromeLabel } from './chrome-harness.ts';
import { type GenMeta } from './emitters.ts';
import { writeAndReport } from './write-tables.ts';
import type { GeneratedTables, GeneratedHistory, Verification } from './gen-core.ts';
import type { AbbrFixResult } from './abbrfix-core.ts';

// the entry is self-contained for the browser: it defines globalThis.__gen
await inChromePage(new URL('./gen-browser-entry.ts', import.meta.url).pathname, async (page, version) => {
  const { tables, verification, history, abbrfix } = (await page.evaluate(() =>
    (globalThis as unknown as { __gen: () => unknown }).__gen()
  )) as {
    tables: GeneratedTables;
    verification: Verification;
    history: GeneratedHistory | null;
    abbrfix: AbbrFixResult | null;
  };

  if (verification.mismatches.length > 0 || history === null || abbrfix === null) {
    console.error('in-browser verification FAILED:', JSON.stringify(verification.mismatches, null, 2));
    process.exit(1);
  }

  const meta: GenMeta = {
    host: chromeLabel(version),
    icu: null, // browsers don't expose their ICU version
    generated: new Date().toISOString(),
  };

  writeAndReport('chrome', meta, tables, history, abbrfix, verification, 'in-browser verified');
});
