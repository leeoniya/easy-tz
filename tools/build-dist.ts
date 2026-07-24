// Builds shippable bundles of getTimeZonesAt() for every impl into
// dist/<impl-id>/ (the npm package's `files`/`exports` surface):
//   index.mjs      — ESM:  export { getTimeZonesAt, getTimeZoneAt, clearCache, formatOffset }
//   index.d.ts     — types (same tiny surface every impl)
// Bundled with Bun.build (target browser) UNMINIFIED so the output stays
// human-readable (minified sizes are reported by `bun run size`), against
// the CHROME table variant — the primary shipping target — with the active
// selector flipped temporarily and restored, same as the bench/test harness.
//
// Run: bun run build

import { rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { impls } from '../impls/registry.ts';
import { selectTables } from './use-tables.ts';
import { activeVariant } from './table-files.ts';
import { printTable } from './print-table.ts';

const distUrl = new URL('../dist/', import.meta.url);
// generated entries live OUTSIDE dist/ (which is committed) so a failed
// build can't leave scratch files behind for git to pick up
const entriesDir = mkdtempSync(join(tmpdir(), 'tz-dist-'));

// bundle entries are generated re-export files
async function buildEsm(implId: string): Promise<number> {
  const implPath = new URL(`../impls/${implId}/index.ts`, import.meta.url).pathname;
  const entry = join(entriesDir, `${implId}.ts`);

  writeFileSync(entry, `export { getTimeZonesAt, getTimeZoneAt, clearCache, formatOffset } from '${implPath}';\n`);

  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'esm',
  });

  const code = await result.outputs[0]!.text();
  await Bun.write(new URL(`${implId}/index.mjs`, distUrl).pathname, code);

  return Buffer.byteLength(code);
}

const dtsSource = `export interface TimeZoneInfo {
  /** IANA zone id, e.g. "America/New_York" */
  name: string;
  /** DST-aware abbreviation, e.g. "EST" / "EDT" (not "GMT-5" where avoidable) */
  abbr: string;
  /** UTC offset at the requested instant, in signed minutes (east positive,
   * west negative): -300 for New York EST, 330 for Kolkata, 0 for UTC.
   * Use formatOffset(offset) for a "-05:00" style string. */
  offset: number;
  /** canonical id when \`name\` is a legacy spelling ("Asia/Kolkata") */
  aliasOf?: string;
}

/**
 * All IANA zones known to the runtime (sorted by name) with their
 * DST-correct abbreviation and UTC offset at \`timestamp\` (epoch ms).
 * Results are memoized per UTC hour bucket and returned by reference —
 * treat them as immutable.
 */
export declare function getTimeZonesAt(timestamp: number): TimeZoneInfo[];

/**
 * A single zone's DST-correct abbreviation and UTC offset at \`timestamp\`
 * (epoch ms) — the single-zone / many-timestamps counterpart to
 * getTimeZonesAt(). Unknown zone names resolve to a UTC sentinel. Not
 * memoized (each call is allocation-light), so it suits sweeping one zone
 * across many instants.
 */
export declare function getTimeZoneAt(name: string, timestamp: number): TimeZoneInfo;

/**
 * Drops the hour-bucket memo so the next call recomputes (first-call
 * init/verification work is NOT redone). Only needed when the result
 * arrays were mutated or in test/bench harnesses.
 */
export declare function clearCache(): void;

/**
 * Formats a signed-minutes UTC offset (a TimeZoneInfo.offset) as an
 * ISO-style string: 0 -> "+00:00", -300 -> "-05:00", 330 -> "+05:30".
 */
export declare function formatOffset(minutes: number): string;
`;

const previousVariant = activeVariant() ?? 'bun';

rmSync(distUrl, { recursive: true, force: true });

selectTables('chrome');

try {
  const rows: string[][] = [];

  for (const impl of impls) {
    const esmBytes = await buildEsm(impl.id);

    await Bun.write(new URL(`${impl.id}/index.d.ts`, distUrl).pathname, dtsSource);

    rows.push([impl.id, (esmBytes / 1024).toFixed(1)]);
  }

  console.log('dist/<impl>/{index.mjs,index.d.ts} — unminified (readable), chrome tables\n');
  printTable(['impl', 'esm KB'], rows);
} finally {
  rmSync(entriesDir, { recursive: true, force: true });
  selectTables(previousVariant);
}
