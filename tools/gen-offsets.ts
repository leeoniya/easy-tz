// Derives the pre-baked offset->string lookup (shared/tables/<variant>/offsets.ts)
// from each variant's ALREADY-GENERATED schedule + history tables — the set of
// distinct UTC offsets those tables can ever produce. It reads the committed
// tables rather than re-probing Intl, so it never introduces schedule/history
// drift and can be re-run anytime the tables change.
//
// Run standalone (bun tools/gen-offsets.ts) or via `bun run gen` (tools/gen-all.ts),
// which regenerates the tables first, then refreshes this from them.

import { writeFileSync } from 'node:fs';
import { emitOffsetsTs, type GenMeta } from './emitters.ts';
import type { ScheduleClass, HistoryClass } from '../shared/rules.ts';

// every distinct offset the schedule (current/future) and history (past) tables
// can resolve to, ascending — exactly the offsets a baked impl's TimeZoneInfo.offset
// can take, which is what the lookup needs to cover on the fast path
function collectOffsets(scheduleClasses: ScheduleClass[], historyClasses: HistoryClass[]): number[] {
  const set = new Set<number>();

  for (const c of scheduleClasses) {
    if (c.kind === 0) set.add(c.states[0].offMin);
    else if (c.kind === 1) for (const s of c.states) set.add(s.offMin);
    else for (const o of c.offMins) set.add(o);
  }

  for (const c of historyClasses) {
    for (const e of c.eras) for (const o of e.offs) set.add(o);
  }

  return [...set].sort((a, b) => a - b);
}

for (const variant of ['bun', 'chrome'] as const) {
  const { scheduleClasses } = await import(`../shared/tables/${variant}/schedule.ts`);
  const { historyClasses } = await import(`../shared/tables/${variant}/history.ts`);

  const offsets = collectOffsets(scheduleClasses, historyClasses);
  const meta: GenMeta = {
    host: `derived from ${variant} schedule + history tables`,
    icu: null,
    generated: new Date().toISOString(),
  };

  writeFileSync(
    new URL(`../shared/tables/${variant}/offsets.ts`, import.meta.url),
    emitOffsetsTs(offsets, meta)
  );

  console.log(`wrote shared/tables/${variant}/offsets.ts (${offsets.length} distinct offsets)`);
}
