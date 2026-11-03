// Browser-bundle entry for the Chrome scripts, covering THIS REPO'S impls
// only (~34KB minified). The comparison libraries live in a separate entry
// (lib-browser-entry.ts) so their ~4MB of bundled tzdata never inflates the
// parse/GC cost of pages measuring our impls. Exposes (via browser-kernel):
//   __bench(implId)      — pure performance measurement (tools/bench-chrome.ts)
//   __validate(implId)   — fixtures + letter-abbr correctness (tools/test-chrome.ts)
//   __verifyVs04(implId) — deep output-equality vs impl 04 (tools/test-chrome.ts)
// plus __implIds, __verifyFuture, __verifyDstAbolition and __verifyRussianHistory.
// Each runs against a fresh page context created by the host script, so cold
// starts are real and impls don't pollute each other.

import { impls } from '../impls/registry.ts';
import { getInitInfo } from '../impls/08-verified-sharing/index.ts';
import { scheduleClasses, YEAR_START } from '../shared/schedule.ts';
import { historyExcludedZones } from '../shared/rules.ts';
import { installKernel, compareResponses, type Vs04 } from './browser-kernel.ts';

export type { BenchResult, BenchOneResult, ValidateResult, Vs04 } from './browser-kernel.ts';

const impl04 = impls.find((i) => i.id === '04-live-intl')!;

installKernel(impls, impl04, (id) => (id === '08-verified-sharing' ? getInitInfo() : null));

(globalThis as { __implIds?: string[] }).__implIds = impls.map((i) => i.id);

// Chrome 156 / tzdata 2026e: fixed expectations, never filtered by schedule class.
(globalThis as { __verifyDstAbolition?: unknown }).__verifyDstAbolition = (implId: string): Vs04 => {
  const other = impls.find((i) => i.id === implId)!;
  const result: Vs04 = { checked: 0, mismatchCount: 0, mismatches: [] };
  const fixtures: [string, number, number][] = [];
  const canada: [string, number][] = [
    ['America/Edmonton', -420], ['America/Inuvik', -420],
    ['America/Vancouver', -480], ['America/Winnipeg', -360],
  ];

  for (const [zone, winter] of canada) {
    const summer = winter + 60;
    const samples: [number, number][] = [
      [Date.UTC(2025, 0, 15, 12), winter], [Date.UTC(2025, 6, 15, 12), summer],
      [Date.UTC(2026, 0, 15, 12), winter], [Date.UTC(2026, 6, 15, 12), summer],
      [Date.UTC(2026, 10, 1, 12), summer],
    ];

    // One hour before and exactly at each 2025 transition (hour-bucket APIs).
    const spring = Date.UTC(2025, 2, 9, 2 - winter / 60);
    const fall = Date.UTC(2025, 10, 2, 2 - summer / 60);
    samples.push([spring - 3600000, winter], [spring, summer], [fall - 3600000, summer], [fall, winter]);

    for (const year of [2027, 2028]) {
      for (const month of [0, 6]) samples.push([Date.UTC(year, month, 15, 12), summer]);
    }

    for (const [ts, offset] of samples) fixtures.push([zone, ts, offset]);
  }

  for (const [zone, ts, offset] of fixtures) {
    const abbr = impl04.getTimeZoneAt!(zone, ts)!.abbr;
    const responses = [
      ['single', other.getTimeZoneAt!(zone, ts)],
      ['all', other.getTimeZonesAt(ts).find((z) => z.name === zone)],
    ] as const;

    for (const [api, actual] of responses) {
      result.checked++;
      if (actual?.name === zone && actual.offset === offset && actual.abbr === abbr) continue;
      result.mismatchCount++;
      if (result.mismatches.length < 10) {
        result.mismatches.push(`${zone} @ ${new Date(ts).toISOString()} ${api}: expected ${abbr} ${offset}, got ${actual?.abbr} ${actual?.offset}`);
      }
    }
  }

  return result;
};

// Fixed labels catch stale generated corrections as well as missing mappings.
// Baked history keeps generic labels where no modern offset matches; live
// implementations still use the specific historical name in those cases.
(globalThis as { __verifyRussianHistory?: unknown }).__verifyRussianHistory = (implId: string): Vs04 => {
  const other = impls.find((i) => i.id === implId)!;
  const baked = implId === '07-baked-rules' || implId === '10-audited-rules';
  const result: Vs04 = { checked: 0, mismatchCount: 0, mismatches: [] };
  const fixtures: [zone: string, ts: number, offset: number, bakedAbbr: string, liveAbbr?: string][] = [
    // Equal offsets with different labels exercise the per-zone corrections.
    ['Asia/Kamchatka', Date.UTC(2000, 0, 15, 12), 720, 'PETT'],
    ['Asia/Anadyr', Date.UTC(2000, 0, 15, 12), 720, 'ANAT'],
    ['Asia/Kamchatka', Date.UTC(2010, 6, 15, 12), 720, 'PETST'],
    ['Asia/Novosibirsk', Date.UTC(2000, 6, 15, 12), 420, 'NOVST'],
    ['Asia/Sakhalin', Date.UTC(2000, 6, 15, 12), 660, 'SAKST'],
    ['Europe/Samara', Date.UTC(2010, 6, 15, 12), 240, 'SAMST'],
    // Correct offsets, intentionally generic baked labels (not missing fixes).
    ['Asia/Kamchatka', Date.UTC(2000, 6, 15, 12), 780, 'GMT+13', 'PETST'],
    ['Asia/Anadyr', Date.UTC(2000, 6, 15, 12), 780, 'GMT+13', 'ANAST'],
    ['Asia/Magadan', Date.UTC(2000, 6, 15, 12), 720, 'GMT+12', 'MAGST'],
    ['Europe/Samara', Date.UTC(2000, 6, 15, 12), 300, 'GMT+5', 'SAMST'],
  ];

  for (const [zone, ts, offset, bakedAbbr, liveAbbr = bakedAbbr] of fixtures) {
    const abbr = baked ? bakedAbbr : liveAbbr;
    const responses = [
      ['single', other.getTimeZoneAt!(zone, ts)],
      ['all', other.getTimeZonesAt(ts).find((z) => z.name === zone)],
    ] as const;

    for (const [api, actual] of responses) {
      result.checked++;
      if (actual?.name === zone && actual.offset === offset && actual.abbr === abbr) continue;
      result.mismatchCount++;
      if (result.mismatches.length < 10) {
        result.mismatches.push(`${zone} @ ${new Date(ts).toISOString()} ${api}: expected ${abbr} ${offset}, got ${actual?.abbr} ${actual?.offset}`);
      }
    }
  }

  return result;
};

// Beyond the bake year, only the known Morocco/Palestine approximations
// may be skipped. A one-off policy change still needs to match live 04.
(globalThis as { __verifyFuture?: unknown }).__verifyFuture = (implId: string, skipExcluded: boolean) => {
  const other = impls.find((i) => i.id === implId)!;
  const excluded = historyExcludedZones(scheduleClasses);
  const bakeYear = new Date(YEAR_START).getUTCFullYear();
  const year = bakeYear + 1;

  // Winter, summer, and two samples near the northern spring transitions.
  const instants = [
    Date.UTC(year, 0, 15, 12),
    Date.UTC(year, 6, 15, 12),
    Date.UTC(year, 2, 14, 8),
    Date.UTC(year, 2, 28, 2),
  ];

  return {
    ...compareResponses(impl04, other, implId, instants, skipExcluded ? (z) => excluded.has(z) : undefined),
    bakeYear,
    year,
  };
};
