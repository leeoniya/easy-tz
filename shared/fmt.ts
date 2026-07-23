// Shared Intl helpers. All impls cache one Intl.DateTimeFormat per zone,
// since formatter construction is ~100x more expensive than format().
// (Benchmark formatter counts come from shared/intl-count.ts's constructor
// proxy, which also sees library-internal constructions.)

export function fmtCache(
  options: Omit<Intl.DateTimeFormatOptions, 'timeZone'>
): (zone: string) => Intl.DateTimeFormat {
  const cache = new Map<string, Intl.DateTimeFormat>();

  return (zone) => {
    let fmt = cache.get(zone);

    if (fmt == null) {
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

// signed offset minutes -> "-04:00" / "+05:30" / "+00:00". Public API (every
// entry point re-exports it) for rendering the numeric TimeZoneInfo.offset.
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = minutes < 0 ? -minutes : minutes;
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

// generic offset label from minutes: "GMT", "GMT+2", "GMT-3:30". Used for
// historical offsets that don't match a zone's current abbreviations and for
// session-recovered zones (impl 10) — an honest label when no curated abbr
// applies. Distinct from compactGmt, which parses a CLDR "GMT+03:00" string.
export function gmtLabel(offMin: number): string {
  if (offMin === 0) return 'GMT';

  const sign = offMin < 0 ? '-' : '+';
  const abs = offMin < 0 ? -offMin : offMin;
  const h = Math.trunc(abs / 60);
  const m = abs % 60;

  return `GMT${sign}${h}${m > 0 ? `:${String(m).padStart(2, '0')}` : ''}`;
}

// last-resort abbr for zones with no CLDR metazone: "GMT+03:00" -> "GMT+3",
// "GMT+05:30" -> "GMT+5:30", "GMT" -> "GMT". these zones genuinely have no
// common letter abbreviation in modern tzdata. A zero offset normalizes to
// plain "GMT": some CLDR versions emit "GMT" and others "GMT+00:00" for the
// same instant (e.g. Africa/Casablanca during Ramadan in Chrome vs bun).
export function compactGmt(longName: string): string {
  const out = longName.replace(/([+-])0?(\d+):00/, '$1$2').replace(/([+-])0?(\d+):(\d+)/, '$1$2:$3');
  return out === 'GMT+0' || out === 'GMT-0' ? 'GMT' : out;
}
