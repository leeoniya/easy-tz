// Bundle size assessment: bundles + minifies each impl's entry with bun's
// native bundler (Bun.build). Always measures the CHROME table variant — the
// tables actually shipped in dist/ (see tools/build-dist.ts) — regardless of
// which variant is currently active, then restores it. Reports minified size
// only (no gzip/brotli).
// Note: sizes run ~2% larger than the previous @swc/core-based measurement.
// Run: bun bench/size.ts

import { impls } from '../impls/registry.ts';
import { libImpls } from '../impls/lib-registry.ts';
import { printTable } from '../tools/print-table.ts';
import { selectTables } from '../tools/use-tables.ts';
import { activeVariant } from '../tools/table-files.ts';

export async function minifiedSizes(): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();

  // Bun.build reads sources fresh from disk, so temporarily selecting the
  // shipped (chrome) tables here doesn't disturb impl modules already loaded in
  // the running process (e.g. the bench's own runtime timings on bun tables).
  const previous = activeVariant() ?? 'bun';
  selectTables('chrome');

  try {
    for (const impl of [...impls, ...libImpls]) {
      const entry = new URL(`../impls/${impl.id}/index.ts`, import.meta.url).pathname;

      const result = await Bun.build({
        entrypoints: [entry],
        target: 'browser',
        minify: true,
      });

      sizes.set(impl.id, Buffer.byteLength(await result.outputs[0]!.text()));
    }
  } finally {
    selectTables(previous);
  }

  return sizes;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const sizes = await minifiedSizes();

  printTable(
    ['impl', 'minified'],
    [...sizes].map(([id, b]) => [id, `${b} B (${(b / 1024).toFixed(2)} KB)`])
  );
}
