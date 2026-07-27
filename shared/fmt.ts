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

// The formatter readZoneSample() below expects: a full zone-local wall clock on
// a 24-hour cycle, plus the CLDR long name. Shared with the options so the two
// halves of that contract can't drift — a caller that dropped `hourCycle`, say,
// would silently read midnight as hour 24 and land a day off.
//
// `second` is left to the caller (see readZoneSample).
export const WALL_CLOCK_FIELDS: Omit<Intl.DateTimeFormatOptions, 'timeZone'> = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
  timeZoneName: 'long',
};

export interface ZoneSample {
  longName: string; // CLDR long name, e.g. "Eastern Standard Time"
  offMin: number; // UTC offset in signed minutes
}

// Reads one instant's zone-local wall clock out of `fmt` and reduces it to the
// only two things anyone wants from it: the CLDR long name and the offset,
// derived arithmetically from the difference between the wall clock and the
// instant. Both callers — shared/live.ts (the shipped live path) and
// tools/gen-core.ts (the generator's probe) — must agree on this to the minute
// or the baked tables disagree with the runtime they were generated from.
//
// Writes into a caller-owned `out` because gen-core probes millions of times
// and this is its innermost loop.
//
// `second` is read only if the formatter asked for it, which is what lets the
// two callers keep different formatter options: gen-core probes minute-aligned
// instants and omits the field, leaving it 0. The live path serves arbitrary
// timestamps, where the zone-local seconds have to be carried through so the
// subtraction cancels the sub-minute remainder of `timestamp` instead of
// rounding it into the offset.
export function readZoneSample(fmt: Intl.DateTimeFormat, timestamp: number, out: ZoneSample): void {
  let year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
  let longName = '';

  for (const p of fmt.formatToParts(timestamp)) {
    switch (p.type) {
      case 'year': year = +p.value; break;
      case 'month': month = +p.value; break;
      case 'day': day = +p.value; break;
      case 'hour': hour = +p.value; break;
      case 'minute': minute = +p.value; break;
      case 'second': second = +p.value; break;
      case 'timeZoneName': longName = p.value; break;
    }
  }

  out.longName = longName;
  out.offMin = Math.round((Date.UTC(year, month - 1, day, hour, minute, second) - timestamp) / 60_000);
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
