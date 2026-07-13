// Shared Intl helpers. All impls cache one Intl.DateTimeFormat per zone,
// since formatter construction is ~100x more expensive than format().

export function fmtCache(
  options: Omit<Intl.DateTimeFormatOptions, 'timeZone'>
): (zone: string) => Intl.DateTimeFormat {
  const cache = new Map<string, Intl.DateTimeFormat>();

  return (zone) => {
    let fmt = cache.get(zone);

    if (fmt === undefined) {
      fmt = new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone });
      cache.set(zone, fmt);
    }

    return fmt;
  };
}

// a formatter created with only { timeZoneName } still emits a date prefix:
// "7/15/2026, Eastern European Summer Time" -> "Eastern European Summer Time"
export function tzNameFromFormat(formatted: string): string {
  return formatted.slice(formatted.indexOf(', ') + 2);
}

// "GMT+05:30" -> "+05:30", "GMT-04:00" -> "-04:00", "GMT" -> "+00:00"
export function isoOffsetFromLongOffset(longOffset: string): string {
  return longOffset.length === 3 ? '+00:00' : longOffset.slice(3);
}

// offset in minutes -> "-04:00" / "+05:30" / "+00:00"
export function formatOffsetMinutes(min: number): string {
  const sign = min < 0 ? '-' : '+';
  const abs = min < 0 ? -min : min;
  const hh = String((abs / 60) | 0).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

// "Eastern European Summer Time" -> "EEST" (initials of capitalized words).
// returns null for CLDR fallback names like "GMT+03:00" or too-short results.
export function initialsAbbr(longName: string): string | null {
  if (longName.startsWith('GMT')) return null;

  let abbr = '';

  for (const word of longName.split(/[\s\-&’.]+/)) {
    const c = word.charAt(0);

    if (c >= 'A' && c <= 'Z') abbr += c;
  }

  return abbr.length >= 2 ? abbr : null;
}

// last-resort abbr for zones with no CLDR metazone: "GMT+03:00" -> "GMT+3",
// "GMT+05:30" -> "GMT+5:30", "GMT" -> "GMT". these zones genuinely have no
// common letter abbreviation in modern tzdata.
export function compactGmt(longName: string): string {
  return longName.replace(/([+-])0?(\d+):00/, '$1$2').replace(/([+-])0?(\d+):(\d+)/, '$1$2:$3');
}
