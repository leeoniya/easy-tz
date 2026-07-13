// Bundle size assessment: bundles each impl's entry with @swc/core (spack)
// and minifies with swc's minifier. Reports minified size only (no gzip/brotli).
// Run: bun bench/size.ts

import { bundle, minify } from '@swc/core';
import { impls } from '../impls/registry.ts';

const rows: { id: string; minifiedB: number }[] = [];

for (const impl of impls) {
  const entry = new URL(`../impls/${impl.id}/index.ts`, import.meta.url).pathname;

  const out = await bundle({
    entry: { main: entry },
    // output/module are required by the types but unused: bundle() returns
    // code in-memory and never writes to disk
    output: { name: 'main', path: '.' },
    module: {},
    mode: 'production',
    target: 'browser',
    options: { jsc: { parser: { syntax: 'typescript' }, target: 'esnext' } },
  });

  const minified = await minify(out['main']!.code, {
    module: true,
    compress: true,
    mangle: true,
  });

  rows.push({ id: impl.id, minifiedB: Buffer.byteLength(minified.code) });
}

const headers = ['impl', 'minified'];
const cells = rows.map((r) => [r.id, `${r.minifiedB} B (${(r.minifiedB / 1024).toFixed(2)} KB)`]);
const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i]!.length)));

const line = (c: string[]) => c.map((v, i) => v.padEnd(widths[i]!)).join('  ');

console.log(line(headers));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const c of cells) console.log(line(c));
