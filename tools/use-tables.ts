// Switches which generated table variant the impls use, by rewriting the
// selector re-exports in shared/classes.ts and shared/schedule.ts.
// Variants live side by side in shared/tables/{bun,chrome}/ (generate them
// with `bun run gen` and `bun run gen:chrome`), so switching is instant.
//
// Run: bun run tables <bun|chrome>

import { writeFileSync, existsSync } from 'node:fs';

export function selectTables(variant: 'bun' | 'chrome'): void {
  for (const file of ['classes', 'schedule', 'offsets']) {
    const target = new URL(`../shared/tables/${variant}/${file}.ts`, import.meta.url);

    if (!existsSync(target)) {
      console.error(`missing shared/tables/${variant}/${file}.ts — run: bun run gen${variant === 'chrome' ? ':chrome' : ''}`);
      process.exit(1);
    }

    writeFileSync(
      new URL(`../shared/${file}.ts`, import.meta.url),
      `// GENERATED selector — switch variants with: bun run tables <bun|chrome>\nexport * from './tables/${variant}/${file}.ts';\n`
    );
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const variant = process.argv[2];

  if (variant !== 'bun' && variant !== 'chrome') {
    console.error('usage: bun run tables <bun|chrome>');
    process.exit(1);
  }

  selectTables(variant);
  console.log(`shared/{classes,schedule,offsets}.ts now re-export shared/tables/${variant}/`);
}
