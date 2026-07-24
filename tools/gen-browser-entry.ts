// Browser-bundle entry for tools/gen-chrome.ts: exposes the generator core
// as globalThis.__gen so the host can invoke it via page.evaluate.

import { generateTables, verifyTables, generateHistory, type ProbeCache } from './gen-core.ts';

// seeds are the committed chrome probe caches passed in from the host
// (tools/gen-chrome.ts); each is trusted only if its fingerprint matches this
// browser's runtime, else that stage re-probes
(globalThis as { __gen?: unknown }).__gen = (
  scheduleSeed: ProbeCache | null = null,
  historySeed: ProbeCache | null = null
) => {
  const tables = generateTables(scheduleSeed);
  const verification = verifyTables(tables);
  const history = verification.mismatches.length === 0 ? generateHistory(tables, undefined, historySeed) : null;
  return { tables, verification, history };
};
