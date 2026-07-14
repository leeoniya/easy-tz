export interface TimeZoneInfo {
  // full timezone name, e.g "America/New_York"
  name: string;
  // common timezone abbreviation, e.g. EET or EEST depending on daylight or standard time
  // important: NOT a GMT or offset, like GMT+5
  abbr: string;
  // UTC offset in the form "-04:00"
  offset: string;
  // set when `name` is a legacy/renamed spelling (tzdata backward link):
  // the modern canonical zone id, e.g. { name: "Asia/Calcutta", aliasOf:
  // "Asia/Kolkata" } in runtimes that enumerate the legacy name. Both names
  // are valid Intl timeZone inputs. Pickers: match search text against both,
  // display `aliasOf ?? name`, and drop the item only if its aliasOf target
  // is itself in the list (rare: runtime enumerates both spellings).
  aliasOf?: string;
}

export type GetTimeZonesAt = (timestamp: number) => TimeZoneInfo[];

export interface Impl {
  id: string;
  label: string;
  // strategy/optimization feature matrix, printed as a comparison table by
  // the benchmark; all impls must use the same keys in the same order
  features: Record<string, string>;
  getTimeZonesAt: GetTimeZonesAt;
}
