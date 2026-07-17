import { zoneLinkPairs } from './zoneLinks.ts';

// IANA zone list as enumerated by the runtime's own tz database.
// computed once at module load; the list does not change at runtime.
// table generation (tools/gen-core.ts) probes THIS list so generated
// tables reflect exactly what the runtime enumerates.
export const runtimeZones: readonly string[] = Intl.supportedValuesOf('timeZone');

// the list impls iterate (and getTimeZonesAt returns): the runtime list
// plus every modern canonical id from the tzdata backward links that the
// runtime enumerates only under a legacy spelling (e.g. Chrome lists
// Asia/Calcutta but not Asia/Kolkata). All of these are valid Intl
// timeZone inputs, and impls 07/10 bridge them to their table class via
// zoneLinks. Sorted, no duplicates; identical to runtimeZones (by
// reference) on runtimes that already enumerate every canonical id.
export const zones: readonly string[] = (() => {
  const set = new Set(runtimeZones);

  for (const [canonical] of zoneLinkPairs) set.add(canonical);

  return set.size === runtimeZones.length ? runtimeZones : [...set].sort();
})();
