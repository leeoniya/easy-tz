export interface TimeZoneInfo {
  // full timezone name, e.g "America/New_York"
  name: string;
  // common timezone abbreviation, e.g. EET or EEST depending on daylight or standard time
  // important: NOT a GMT or offset, like GMT+5
  abbr: string;
  // UTC offset in signed minutes (east of UTC positive, west negative), e.g.
  // -300 for New York EST, +330 for Kolkata, 0 for UTC. This is the raw
  // numeric offset; pass it to formatOffset() for a "-05:00" style string.
  offset: number;
  // set when `name` is a legacy/renamed spelling (tzdata backward link):
  // the modern canonical zone id, e.g. { name: "Asia/Calcutta", aliasOf:
  // "Asia/Kolkata" }. Both names are valid Intl timeZone inputs, and the
  // list always contains both spellings (shared/zones.ts augments whichever
  // side the runtime doesn't enumerate). Pickers: match search text against
  // both, and either display legacy entries as-is or dedupe them — the
  // aliasOf target is guaranteed to be in the list.
  aliasOf?: string;
}

export type GetTimeZonesAt = (timestamp: number) => TimeZoneInfo[];

// single-zone / many-timestamps counterpart to GetTimeZonesAt: resolves one
// zone at one instant without building the full response. Exported by the
// first-party impls (04, 07, 08, 10).
export type GetTimeZoneAt = (name: string, timestamp: number) => TimeZoneInfo;

export interface Impl {
  id: string;
  label: string;
  // strategy/optimization feature matrix, printed as a comparison table by
  // the benchmark; all impls must use the same keys in the same order
  features: Record<string, string>;
  getTimeZonesAt: GetTimeZonesAt;
  // single-zone resolver, present only on this repo's impls (the comparison
  // libraries expose no such API); the getTimeZoneAt benchmark iterates only
  // impls that define it
  getTimeZoneAt?: GetTimeZoneAt;
}
