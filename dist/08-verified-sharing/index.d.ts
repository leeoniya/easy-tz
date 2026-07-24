export interface TimeZoneInfo {
  /** IANA zone id, e.g. "America/New_York" */
  name: string;
  /** DST-aware abbreviation, e.g. "EST" / "EDT" (not "GMT-5" where avoidable) */
  abbr: string;
  /** UTC offset at the requested instant, in signed minutes (east positive,
   * west negative): -300 for New York EST, 330 for Kolkata, 0 for UTC.
   * Use formatOffset(offset) for a "-05:00" style string. */
  offset: number;
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
 * A single zone's DST-correct abbreviation and UTC offset at `timestamp`
 * (epoch ms) — the single-zone / many-timestamps counterpart to
 * getTimeZonesAt(). Unknown zone names resolve to a UTC sentinel. Not
 * memoized (each call is allocation-light), so it suits sweeping one zone
 * across many instants.
 */
export declare function getTimeZoneAt(name: string, timestamp: number): TimeZoneInfo;

/**
 * Drops the hour-bucket memo so the next call recomputes (first-call
 * init/verification work is NOT redone). Only needed when the result
 * arrays were mutated or in test/bench harnesses.
 */
export declare function clearCache(): void;

/**
 * Formats a signed-minutes UTC offset (a TimeZoneInfo.offset) as an
 * ISO-style string: 0 -> "+00:00", -300 -> "-05:00", 330 -> "+05:30".
 */
export declare function formatOffset(minutes: number): string;
