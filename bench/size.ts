// Bundle size assessment: bundles + minifies each impl's entry with bun's
// native bundler (Bun.build). Reports minified size only (no gzip/brotli).
// Note: sizes run ~2% larger than the previous @swc/core-based measurement.
// Run: bun bench/size.ts

import { impls } from '../impls/registry.ts';
import { libImpls } from '../impls/lib-registry.ts';
import { printTable } from '../tools/print-table.ts';

export async function minifiedSizes(): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();

  for (const impl of [...impls, ...libImpls]) {
    const entry = new URL(`../impls/${impl.id}/index.ts`, import.meta.url).pathname;

    const result = await Bun.build({
      entrypoints: [entry],
      target: 'browser',
      minify: true,
    });

    sizes.set(impl.id, Buffer.byteLength(await result.outputs[0]!.text()));
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
