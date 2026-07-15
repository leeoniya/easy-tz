export interface TimeZoneInfo {
  /** IANA zone id, e.g. "America/New_York" */
  name: string;
  /** DST-aware abbreviation, e.g. "EST" / "EDT" (not "GMT-5" where avoidable) */
  abbr: string;
  /** UTC offset at the requested instant, e.g. "-05:00" */
  offset: string;
  /** canonical id when `name` is a legacy spelling ("Asia/Kolkata") */
  aliasOf?: string;
}

/**
 * All IANA zones known to the runtime (sorted by name) with their
 * DST-correct abbreviation and UTC offset at `timestamp` (epoch ms).
 * Results are memoized per UTC hour bucket and returned by reference —
 * treat them as immutable.
 */
export declare function getTimeZonesAt(timestamp: number): TimeZoneInfo[];

/**
 * Drops the hour-bucket memo so the next call recomputes (first-call
 * init/verification work is NOT redone). Only needed when the result
 * arrays were mutated or in test/bench harnesses.
 */
export declare function clearCache(): void;
