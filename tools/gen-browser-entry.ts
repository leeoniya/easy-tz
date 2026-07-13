// Browser-bundle entry for tools/gen-chrome.ts: exposes the generator core
// as globalThis.__gen so the host can invoke it via page.evaluate.

import { generateTables, verifyTables } from './gen-core.ts';

(globalThis as { __gen?: unknown }).__gen = () => {
  const tables = generateTables();
  const verification = verifyTables(tables);
  return { tables, verification };
};
