import { zoneLinkPairs } from './zoneLinks.ts';

// IANA zone list as enumerated by the runtime's own tz database.
// computed once at module load; the list does not change at runtime.
// table generation (tools/gen-core.ts) probes THIS list so generated
// tables reflect exactly what the runtime enumerates.
export const runtimeZones: readonly string[] = Intl.supportedValuesOf('timeZone');

// the list impls iterate (and getTimeZonesAt returns): the runtime list
// plus BOTH spellings of every tzdata backward link the runtime enumerates
// only one side of — the modern canonical (Chrome lists Asia/Calcutta but
// not Asia/Kolkata) and the legacy alias (bun lists Asia/Kolkata but not
// Asia/Calcutta). All of these are valid Intl timeZone inputs; impls 07/10
// bridge them to their table class via zoneLinks (buildScheduleIndex), and
// legacy entries carry aliasOf metadata (makeInfo). Sorted, no duplicates;
// identical to runtimeZones (by reference) on runtimes that already
// enumerate both spellings.
export const zones: readonly string[] = (() => {
  const set = new Set(runtimeZones);

  for (const [canonical, alias] of zoneLinkPairs) {
    set.add(canonical);
    set.add(alias);
  }

  return set.size === runtimeZones.length ? runtimeZones : [...set].sort();
})();
