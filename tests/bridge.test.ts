import { describe, test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { zones } from '../shared/zones.ts';
import { buildScheduleIndex, resolveClass } from '../shared/rules.ts';

// Cross-runtime zone-name bridging (impls 07/09): this bun runtime's zone
// list (modern names: Asia/Kolkata, Europe/Kyiv, 445 zones incl. Etc/*) is
// resolved against the CHROME-generated table (legacy names: Asia/Calcutta,
// Europe/Kiev, 418 zones, no Etc/*) — the worst-case spelling skew we can
// exercise locally. This deliberately bypasses the active-table selector.

const chromeTables = new URL('../shared/tables/chrome/schedule.ts', import.meta.url).pathname;
const haveChrome = existsSync(chromeTables);
const testIfChrome = haveChrome ? test : test.skip;

if (!haveChrome) {
  console.warn('  [bridge.test] no chrome table set (bun run gen); skipping cross-runtime bridge tests');
}

describe('zone-name bridge: bun zone list vs chrome-generated table', () => {
  testIfChrome('every runtime zone resolves directly, via bridge, or is a known gap', async () => {
    const chrome = await import('../shared/tables/chrome/schedule.ts');
    const idx = buildScheduleIndex(zones, chrome.scheduleClasses);

    const covered = new Set(chrome.scheduleClasses.flatMap((c) => c.zones));
    let direct = 0;
    const bridged: string[] = [];
    const unresolved: string[] = [];

    for (let z = 0; z < zones.length; z++) {
      if (idx[z] === -1) unresolved.push(zones[z]!);
      else if (covered.has(zones[z]!)) direct++;
      else bridged.push(zones[z]!);
    }

    // the tzdata-links map must bridge every known spelling variant
    expect(bridged.length).toBeGreaterThanOrEqual(15);
    expect(bridged).toContain('Asia/Kolkata');
    expect(bridged).toContain('Europe/Kyiv');
    expect(bridged).toContain('Asia/Ho_Chi_Minh');

    // unresolved zones must only be the structural gaps (zones Chrome's ICU
    // doesn't enumerate at all: Etc/*, bare UTC) — never a real city zone
    for (const z of unresolved) {
      expect(z.startsWith('Etc/') || z === 'UTC').toBe(true);
    }
  });

  testIfChrome('bridged zones resolve to correct values, not the UTC sentinel', async () => {
    const chrome = await import('../shared/tables/chrome/schedule.ts');
    const idx = buildScheduleIndex(zones, chrome.scheduleClasses);

    const stateOf = (zone: string, ts: number) => {
      const i = idx[zones.indexOf(zone)]!;
      expect(i).toBeGreaterThanOrEqual(0);
      return resolveClass(chrome.scheduleClasses[i]!, ts, chrome.YEAR_START, chrome.STEP_MS);
    };

    // bun name -> class listing only the legacy chrome name
    const kolkata = stateOf('Asia/Kolkata', Date.UTC(2026, 6, 15));
    expect(kolkata.abbr).toBe('IST');
    expect(kolkata.offMin).toBe(330);

    const kyivSummer = stateOf('Europe/Kyiv', Date.UTC(2026, 6, 15));
    expect(kyivSummer.abbr).toBe('EEST');
    expect(kyivSummer.offMin).toBe(180);

    const kyivWinter = stateOf('Europe/Kyiv', Date.UTC(2026, 0, 15));
    expect(kyivWinter.abbr).toBe('EET');
    expect(kyivWinter.offMin).toBe(120);

    // linked zone (Choibalsan -> Ulaanbaatar) rides the same bridge
    const choibalsan = stateOf('Asia/Choibalsan', Date.UTC(2026, 6, 15));
    expect(choibalsan.offMin).toBe(480);
  });
});
