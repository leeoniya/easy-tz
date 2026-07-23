// Browser-bundle entry for tools/gen-chrome.ts: exposes the generator core
// as globalThis.__gen so the host can invoke it via page.evaluate.

import { generateTables, verifyTables, generateHistory } from './gen-core.ts';

(globalThis as { __gen?: unknown }).__gen = () => {
  const tables = generateTables();
  const verification = verifyTables(tables);
  const history = verification.mismatches.length === 0 ? generateHistory(tables) : null;
  return { tables, verification, history };
};
