// The tail both generators share (tools/gen-classes.ts, tools/gen-chrome.ts):
// emit all four files from one meta, write the set, and report what went in.
// They differ only in the variant, whether the host has an ICU version to name,
// and how the verification pass is described — everything else is the same
// numbers out of the same three stat blocks, which is exactly the kind of
// summary that rots when it exists twice.

import { emitClassesTs, emitScheduleTs, emitHistoryTs, emitAbbrFixTs, type GenMeta } from './emitters.ts';
import { writeTableSet, type Variant } from './table-files.ts';
import type { GeneratedTables, GeneratedHistory, Verification } from './gen-core.ts';
import type { AbbrFixResult } from './abbrfix-core.ts';

export function writeAndReport(
  variant: Variant,
  meta: GenMeta,
  tables: GeneratedTables,
  history: GeneratedHistory,
  abbrfix: AbbrFixResult,
  verification: Verification,
  // how the tables were checked: "self-verified" against this runtime's own
  // Intl, or "in-browser verified" inside the browser they describe
  verifiedLabel: string
): void {
  const active = writeTableSet(variant, {
    classes: emitClassesTs(tables, meta),
    schedule: emitScheduleTs(tables, meta),
    history: emitHistoryTs(history, tables, meta),
    abbrfix: emitAbbrFixTs(abbrfix, tables, history.fromYear, history.toYear, meta),
  });

  const s = tables.stats;
  const h = history.stats;
  const a = abbrfix.stats;
  const icu = meta.icu == null ? '' : `, icu ${meta.icu}`; // browsers don't expose one

  console.log(
    `wrote shared/tables/${variant}/{classes,schedule,history,abbrfix}.ts (host: ${meta.host}${icu}, active variant: ${active}):\n` +
      `  ${s.zones} zones -> ${s.sigClasses} classes / ${s.schedClasses} schedule classes (${s.staticClasses} static, ${s.ruleClasses} rule, ${s.irregularClasses} irregular w/ ${s.irregularZones} zones), ${s.probedZoneYears} zone-years probed in ${s.probeMs}ms via ${s.probeStrategy}\n` +
      `  history ${history.fromYear}-${history.toYear - 1}: ${h.zones} zones (${h.coveredZones} schedule-covered) -> ${h.classes} classes (${h.staticEras} static, ${h.ruleEras} rule, ${h.rawYears} raw, ${h.deferEras} defer eras), ${h.probedZoneYears} zone-years probed in ${h.probeMs}ms via ${h.probeStrategy}\n` +
      `  abbr corrections: ${a.zones} zones -> ${abbrfix.classes.length} shared payloads, ${a.spans} spans -> ${a.ranges} (year range, offset) records + ${a.fallbackSpans} spans, audited in ${a.auditMs}ms\n` +
      `  ${verifiedLabel}: ${verification.checks} checks at ${verification.instants} instants, 0 mismatches`
  );
}
