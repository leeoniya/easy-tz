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

// `withAliases` (default true) opts out of legacy-spelled results. The two
// list getters DROP the 20 alias entries — their canonical counterparts are
// always in the list — and the two single-zone getters SUBSTITUTE the
// canonical zone when handed a legacy name, so getTimeZoneAt("Asia/Calcutta",
// ts, false) answers as if "Asia/Kolkata" had been asked for. Either way no
// returned TimeZoneInfo carries an `aliasOf`. Note the substitution means the
// result's `name` can differ from the name passed in.

export type GetTimeZonesAt = (timestamp: number, withAliases?: boolean) => TimeZoneInfo[];

// no-timestamp convenience over GetTimeZonesAt at the current instant
// (Date.now()). On the baked impls (07/10) this is the schedule-only route: it
// never references the baked history eras, so importing only getTimeZones()
// lets shared/history.ts tree-shake out of the consumer's bundle.
export type GetTimeZones = (withAliases?: boolean) => TimeZoneInfo[];

// single-zone / many-timestamps counterpart to GetTimeZonesAt: resolves one
// zone at one instant without building the full response. Exported by the
// first-party impls (04, 07, 08, 10). Returns undefined for an unknown name.
export type GetTimeZoneAt = (name: string, timestamp: number, withAliases?: boolean) => TimeZoneInfo | undefined;

// single-zone counterpart to GetTimeZones (and current-instant counterpart to
// GetTimeZoneAt): one zone at Date.now(). Takes the same schedule-only route as
// GetTimeZones on the baked impls, so a consumer importing only the
// current-instant APIs tree-shakes shared/history.ts out. Returns undefined for
// an unknown name.
export type GetTimeZone = (name: string, withAliases?: boolean) => TimeZoneInfo | undefined;

export interface Impl {
  id: string;
  label: string;
  // strategy/optimization feature matrix, printed as a comparison table by
  // the benchmark; all impls must use the same keys in the same order
  features: Record<string, string>;
  getTimeZonesAt: GetTimeZonesAt;
  // no-arg current-instant convenience (schedule-only on the baked impls);
  // present on this repo's impls, absent on the comparison libraries
  getTimeZones?: GetTimeZones;
  // single-zone resolver, present only on this repo's impls (the comparison
  // libraries expose no such API); the getTimeZoneAt benchmark iterates only
  // impls that define it
  getTimeZoneAt?: GetTimeZoneAt;
  // single-zone current-instant resolver (schedule-only on the baked impls);
  // present on this repo's impls, absent on the comparison libraries
  getTimeZone?: GetTimeZone;
}
