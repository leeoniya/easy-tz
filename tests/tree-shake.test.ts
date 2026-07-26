import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { activeVariant } from '../tools/table-files.ts';

// The current-instant APIs (getTimeZones/getTimeZone) are wired through a
// history-free path so that a consumer importing ONLY them drops the 1995+
// baked eras — roughly halving the bundle (see README "Schedule-only route").
//
// Nothing about that is enforced by types or behavior: one stray import of
// shared/bakedHistory.ts from shared/bakedSchedule.ts, or a helper hoisted
// into a module both paths pull, silently re-attaches ~12KB and every other
// test still passes. So this bundles each public export on its own and checks
// the packed history literals are genuinely gone from the output.

const variant = activeVariant();

// the long packed strings the history table is made of. Read from the table
// source rather than hardcoded, so this survives `bun run gen`; string
// literals pass through minification intact, which makes them exact markers.
function historyMarkers(): string[] {
  const src = readFileSync(new URL(`../shared/tables/${variant}/history.ts`, import.meta.url), 'utf8');
  const out: string[] = [];

  for (const name of ['T', 'H']) {
    const m = new RegExp(`^const ${name} = '([^']{200,})'`, 'm').exec(src);

    expect(m).not.toBeNull();
    // a middle slice: long enough to be unique, short enough to survive any
    // future chunking of the literal
    out.push(m![1]!.slice(100, 180));
  }

  return out;
}

async function bundle(impl: string, exportName: string): Promise<string> {
  const entry = `/tmp/tree-shake-${impl}-${exportName}.mjs`;

  await Bun.write(entry, `import { ${exportName} } from '${new URL(`../impls/${impl}/index.ts`, import.meta.url).pathname}';\nglobalThis.x = ${exportName};\n`);

  const built = await Bun.build({ entrypoints: [entry], minify: true, target: 'browser' });

  expect(built.success).toBe(true);

  return await built.outputs[0]!.text();
}

const BAKED = ['07-baked-rules', '10-audited-rules'];

describe('the baked impls ship history only when a history-capable API is imported', () => {
  for (const impl of BAKED) {
    test(`${impl} (${variant} tables)`, async () => {
      const markers = historyMarkers();

      // compared as short labels rather than with toContain, so a failure
      // reports the offending export instead of dumping a 24KB bundle
      const shipsHistory = async (exportName: string) => {
        const out = await bundle(impl, exportName);

        return `${exportName}: ${markers.some((m) => out.includes(m)) ? 'ships history' : 'history-free'}`;
      };

      // sanity: the markers must actually identify the history table, or the
      // absence assertions below would pass vacuously forever
      expect(await shipsHistory('getTimeZonesAt')).toBe('getTimeZonesAt: ships history');
      expect(await shipsHistory('getTimeZoneAt')).toBe('getTimeZoneAt: ships history');

      // ...and the two schedule-only entry points must not drag it in
      expect(await shipsHistory('getTimeZones')).toBe('getTimeZones: history-free');
      expect(await shipsHistory('getTimeZone')).toBe('getTimeZone: history-free');
    });
  }
});

describe('dropping history roughly halves the bundle', () => {
  // a coarse backstop for anything the literal markers would miss (e.g. the
  // eras arriving in some other encoding), and the number the README quotes
  for (const impl of BAKED) {
    test(impl, async () => {
      const sizes = new Map<string, number>();

      for (const exportName of ['getTimeZonesAt', 'getTimeZoneAt', 'getTimeZones', 'getTimeZone']) {
        sizes.set(exportName, (await bundle(impl, exportName)).length);
      }

      const capable = Math.min(sizes.get('getTimeZonesAt')!, sizes.get('getTimeZoneAt')!);
      const scheduleOnly = Math.max(sizes.get('getTimeZones')!, sizes.get('getTimeZone')!);

      expect(scheduleOnly).toBeLessThan(capable * 0.6);
    });
  }
});

describe('the live impls have no history to shed', () => {
  // 04/08 ship no baked eras at all, so every export lands within a hair of
  // the same size — pins that the current-instant APIs stay thin wrappers
  for (const impl of ['04-live-intl', '08-verified-sharing']) {
    test(impl, async () => {
      const full = (await bundle(impl, 'getTimeZonesAt')).length;
      const now = (await bundle(impl, 'getTimeZones')).length;

      expect(Math.abs(now - full)).toBeLessThan(full * 0.05);
    });
  }
});
