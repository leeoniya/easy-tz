// Table set layout: generated variants live side by side in
// shared/tables/{bun,chrome}/, and the ACTIVE tables that impls import
// (shared/classes.ts + shared/schedule.ts) are one-line selector re-exports.
// Because selectors are re-exports, regenerating a variant automatically
// refreshes the active view when that variant is selected; generators never
// change WHICH variant is active (switch with: bun run tables <bun|chrome>).

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { selectTables } from './use-tables.ts';

export type Variant = 'bun' | 'chrome';

export function activeVariant(): Variant | null {
  const selector = new URL('../shared/classes.ts', import.meta.url);

  if (!existsSync(selector)) return null;

  const m = /\.\/tables\/(bun|chrome)\/classes\.ts/.exec(readFileSync(selector, 'utf8'));

  return m === null ? null : (m[1] as Variant);
}

export function writeTableSet(
  variant: Variant,
  files: { classes: string; schedule: string; offsets: string }
): Variant {
  const dir = new URL(`../shared/tables/${variant}/`, import.meta.url);

  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('classes.ts', dir), files.classes);
  writeFileSync(new URL('schedule.ts', dir), files.schedule);
  writeFileSync(new URL('offsets.ts', dir), files.offsets);

  // create/normalize selectors when absent or still in the legacy
  // single-file format; otherwise leave the active choice alone
  if (activeVariant() === null) selectTables(variant);

  return activeVariant()!;
}
