// Builds shippable bundles of getTimeZonesAt() for every impl into
// dist/<impl-id>/:
//   index.mjs      — ESM:  export { getTimeZonesAt, clearCache }
//   index.iife.js  — IIFE: installs globalThis.getTimeZonesAt (clearCache is
//                    attached as a property: getTimeZonesAt.clearCache())
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

// bundle entries are generated files: re-export for ESM, global install for
// IIFE (Bun.build has no globalName option, so the entry does the assignment)
function entrySource(implId: string, format: 'esm' | 'iife'): string {
  const implPath = new URL(`../impls/${implId}/index.ts`, import.meta.url).pathname;

  return format === 'esm'
    ? `export { getTimeZonesAt, clearCache } from '${implPath}';\n`
    : `import { getTimeZonesAt, clearCache } from '${implPath}';\n` +
      `getTimeZonesAt.clearCache = clearCache;\n` +
      `globalThis.getTimeZonesAt = getTimeZonesAt;\n`;
}

async function buildVariant(implId: string, format: 'esm' | 'iife', outFile: string): Promise<number> {
  const entry = join(entriesDir, `${implId}.${format}.ts`);
  writeFileSync(entry, entrySource(implId, format));

  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format,
  });

  const code = await result.outputs[0]!.text();
  await Bun.write(new URL(outFile, distUrl).pathname, code);

  return Buffer.byteLength(code);
}

const previousVariant = activeVariant() ?? 'bun';

rmSync(distUrl, { recursive: true, force: true });

selectTables('chrome');

try {
  const rows: string[][] = [];

  for (const impl of impls) {
    const esmBytes = await buildVariant(impl.id, 'esm', `${impl.id}/index.mjs`);
    const iifeBytes = await buildVariant(impl.id, 'iife', `${impl.id}/index.iife.js`);

    rows.push([impl.id, (esmBytes / 1024).toFixed(1), (iifeBytes / 1024).toFixed(1)]);
  }

  console.log('dist/<impl>/{index.mjs,index.iife.js} — unminified (readable), chrome tables\n');
  printTable(['impl', 'esm KB', 'iife KB'], rows);
} finally {
  rmSync(entriesDir, { recursive: true, force: true });
  selectTables(previousVariant);
}
