// Builds shippable bundles of getTimeZonesAt() for every impl into
// dist/<impl-id>/ (the npm package's `files`/`exports` surface):
//   index.mjs      — ESM:  export { getTimeZonesAt, getTimeZoneAt, getTimeZones, getTimeZone, clearCache, formatOffset }
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
import type { TimeZoneInfo } from '../shared/types.ts';
import { selectTables } from './use-tables.ts';
import { activeVariant } from './table-files.ts';
import { printTable } from './print-table.ts';

const distUrl = new URL('../dist/', import.meta.url);
// generated entries live OUTSIDE dist/ (which is committed) so a failed
// build can't leave scratch files behind for git to pick up
const entriesDir = mkdtempSync(join(tmpdir(), 'tz-dist-'));

// bundle entries are generated re-export files. Writes the UNMINIFIED bundle to
// dist/ (kept readable) and returns the MINIFIED size — built in-memory only to
// report the number consumers actually ship; the minified bundle is never
// written to disk.
async function buildEsm(implId: string): Promise<number> {
  const implPath = new URL(`../impls/${implId}/index.ts`, import.meta.url).pathname;
  const entry = join(entriesDir, `${implId}.ts`);

  writeFileSync(entry, `export { getTimeZonesAt, getTimeZoneAt, getTimeZones, getTimeZone, clearCache, formatOffset } from '${implPath}';\n`);

  // shipped bundle: readable, written to dist/
  const readable = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'esm' });
  await Bun.write(new URL(`${implId}/index.mjs`, distUrl).pathname, await readable.outputs[0]!.text());

  // minified: measured only (mirrors `bun run size`), not persisted
  const minified = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'esm', minify: true });

  return Buffer.byteLength(await minified.outputs[0]!.text());
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
 *
 * \`withAliases: false\` omits the legacy-spelled entries (those with an
 * \`aliasOf\`); their canonical counterparts are always in the list, so the
 * result is the deduped canonical set. Filtered lists are memoized and
 * returned by reference too, and share the same TimeZoneInfo instances.
 */
export declare function getTimeZonesAt(timestamp: number, withAliases?: boolean): TimeZoneInfo[];

/**
 * A single zone's DST-correct abbreviation and UTC offset at \`timestamp\`
 * (epoch ms) — the single-zone / many-timestamps counterpart to
 * getTimeZonesAt(). Not memoized (each call is allocation-light), so it suits
 * sweeping one zone across many instants.
 *
 * Accepts any name the list contains, plus the fixed-offset ids ICU accepts
 * but doesn't enumerate: \`UTC\`, \`Etc/UTC\`, and \`Etc/GMT+1\`..\`+12\` /
 * \`Etc/GMT-1\`..\`-14\` (POSIX sign inversion — \`Etc/GMT+5\` is UTC-05:00).
 * Any other unknown name resolves to a UTC sentinel.
 *
 * \`withAliases: false\` resolves a legacy \`name\` as its canonical zone, so
 * the result never carries an \`aliasOf\` — note that its \`name\` is then the
 * canonical spelling, not the one passed in. Canonical, fixed-offset and
 * unknown names are unaffected.
 */
export declare function getTimeZoneAt(name: string, timestamp: number, withAliases?: boolean): TimeZoneInfo;

/**
 * All zones at the current instant (Date.now()) — a no-timestamp convenience
 * over getTimeZonesAt(). On the baked impls (07/10) this is the schedule-only
 * route: it never touches the baked historical eras, so importing ONLY
 * getTimeZones() lets a bundler tree-shake the history tables out entirely
 * (the current instant is always the bake year or later). Same hour-bucket
 * memoization and \`withAliases\` behavior as getTimeZonesAt().
 */
export declare function getTimeZones(withAliases?: boolean): TimeZoneInfo[];

/**
 * One zone at the current instant (Date.now()) — the single-zone counterpart
 * to getTimeZones(), and the no-timestamp counterpart to getTimeZoneAt().
 * On the baked impls (07/10) it takes the same schedule-only route, so
 * importing only getTimeZone()/getTimeZones() lets a bundler tree-shake the
 * history tables out entirely. Same name and \`withAliases\` handling as
 * getTimeZoneAt(), including the fixed-offset Etc ids. Not memoized — the
 * result is an interned instance, so each call allocates nothing.
 */
export declare function getTimeZone(name: string, withAliases?: boolean): TimeZoneInfo;

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

// The published TimeZoneInfo above is hand-written rather than derived from
// shared/types.ts, because consumers deserve docs written for them rather than
// this repo's internal notes. The cost is that the two can drift, and a .d.ts
// that omits a field is a lie the type checker tells every consumer — so the
// shapes are reconciled here instead.
//
// The Record turns "TimeZoneInfo gained a field" into a compile error, and the
// comparison turns "the .d.ts describes a field that no longer exists" into a
// failed build.
const infoFields: Record<keyof TimeZoneInfo, true> = { name: true, abbr: true, offset: true, aliasOf: true };

const declaredFields = [...dtsSource.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!).toSorted();
const actualFields = Object.keys(infoFields).toSorted();

if (declaredFields.join(',') !== actualFields.join(',')) {
  console.error(
    `dist .d.ts is out of sync with shared/types.ts TimeZoneInfo:\n` +
      `  declared in .d.ts: ${declaredFields.join(', ')}\n` +
      `  actual type:       ${actualFields.join(', ')}`
  );
  process.exit(1);
}

const previousVariant = activeVariant() ?? 'bun';

rmSync(distUrl, { recursive: true, force: true });

selectTables('chrome');

try {
  const rows: string[][] = [];

  for (const impl of impls) {
    const minBytes = await buildEsm(impl.id);

    await Bun.write(new URL(`${impl.id}/index.d.ts`, distUrl).pathname, dtsSource);

    rows.push([impl.id, (minBytes / 1024).toFixed(1)]);
  }

  console.log('dist/<impl>/{index.mjs,index.d.ts} — chrome tables. index.mjs ships unminified');
  console.log('(readable); "min KB" is measured in-memory (what ships minified), not written.\n');
  printTable(['impl', 'min KB'], rows);
} finally {
  rmSync(entriesDir, { recursive: true, force: true });
  selectTables(previousVariant);
}
