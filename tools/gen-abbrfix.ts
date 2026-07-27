// Derives the historical abbreviation corrections
// (shared/tables/<variant>/abbrfix.ts) from each variant's ALREADY-GENERATED
// schedule + history tables, by diffing the label those tables produce against
// the label live Intl reports at every boundary in the covered range.
//
// Like tools/gen-offsets.ts this is a post-pass over committed tables, so it
// must run AFTER the tables it audits. Unlike gen-offsets it needs a runtime,
// not just the tables: the bun variant is audited here, the chrome variant
// inside chrome-headless-shell against that browser's ICU.
//
// Run standalone (bun tools/gen-abbrfix.ts) or via `bun run gen`
// (tools/gen-all.ts), which regenerates the tables first.

import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { findHeadlessShell } from './browser.ts';
import { bundleForBrowser } from './chrome-harness.ts';
import { emitAbbrFixTs, type GenMeta } from './emitters.ts';
import { auditAbbrFix, type AbbrFixResult } from './abbrfix-core.ts';
import { zones } from '../shared/zones.ts';

// Option B: correct only the spans where the offset-keyed label is a confident
// lie — it names another identity the zone has since left. Spans where the
// historical offset matches no state of the modern class already degrade to a
// vague GMT±N, which is honest, and correcting those too (option B+) costs
// roughly 3x the bytes for labels nobody is currently being misled by.
// Flip to true to ship B+.
const INCLUDE_VAGUE = false;

async function auditChrome(includeVague: boolean): Promise<AbbrFixResult> {
  const executablePath = await findHeadlessShell();
  const code = await bundleForBrowser(new URL('./gen-abbrfix-browser-entry.ts', import.meta.url).pathname);
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-gpu'] });

  try {
    const page = await browser.newPage();

    page.setDefaultTimeout(0);
    await page.evaluate(code);

    return (await page.evaluate(
      (v) => (globalThis as unknown as { __abbrFix: (v: boolean) => unknown }).__abbrFix(v),
      includeVague
    )) as AbbrFixResult;
  } finally {
    await browser.close();
  }
}

for (const variant of ['bun', 'chrome'] as const) {
  const { scheduleClasses, YEAR_START, STEP_MS } = await import(`../shared/tables/${variant}/schedule.ts`);
  const { historyClasses, HISTORY_FROM, HISTORY_TO, genMeta } = await import(`../shared/tables/${variant}/history.ts`);

  const result =
    variant === 'chrome'
      ? await auditChrome(INCLUDE_VAGUE)
      : auditAbbrFix(zones, scheduleClasses, historyClasses, HISTORY_FROM, HISTORY_TO, YEAR_START, STEP_MS, INCLUDE_VAGUE);

  // the history table's zone-index space, which abbrfix reuses verbatim
  const orderedZones = (scheduleClasses as { zones: string[] }[]).flatMap((c) => c.zones);

  // provenance is the audited tables' own: a correction set is only meaningful
  // against the ICU that produced the labels it is correcting
  const meta: GenMeta = {
    host: genMeta.host,
    icu: genMeta.icu,
    generated: new Date().toISOString(),
  };

  writeFileSync(
    new URL(`../shared/tables/${variant}/abbrfix.ts`, import.meta.url),
    emitAbbrFixTs(result, orderedZones, HISTORY_FROM, HISTORY_TO, meta)
  );

  const s = result.stats;

  console.log(
    `wrote shared/tables/${variant}/abbrfix.ts (audited ${genMeta.host} in ${(s.auditMs / 1000).toFixed(1)}s):\n` +
      `  ${s.zones} zones -> ${result.classes.length} shared payloads (${s.deferSpans} spans in defer eras)\n` +
      `  ${s.spans} disagreeing spans -> ${s.ranges} (year range, offset) records + ${s.fallbackSpans} spans, verified equivalent\n` +
      `  corrects ${s.lieZoneYears} zone-years of confidently-wrong labels` +
      (INCLUDE_VAGUE
        ? `, plus ${s.vagueZoneYears} zone-years of GMT±N (option B+)`
        : `; left ${s.vagueZoneYears || 'the'} GMT±N spans alone (option B)`)
  );
}
