// Candidate upstream optimizations for luxon, expressed as textual patches
// against the ESM bundle luxon actually ships (build/es6/luxon.mjs, which is
// unminified and byte-identical to src at every site touched here).
//
// Why patch the bundle rather than vendor a fork: the patch text below IS the
// proposed upstream diff, small enough to read in one sitting, and applying it
// at bench time means nothing third-party gets committed. Each edit asserts that
// its anchor matched exactly once, so a luxon upgrade that moves the code fails
// loudly instead of silently measuring nothing.
//
// Every patch is pure memoization or a provable short-circuit: no API changes,
// no behavior changes. bench/luxon-upstream.ts verifies that by diffing output
// against stock luxon.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export type PatchKey =
  | 'numFast'
  | 'parseFormatCache'
  | 'zoneInfoCache'
  | 'localeIntern'
  | 'tokenLoop'
  | 'intRoundTo'
  | 'padStart2'
  | 'tsToObjMath'
  | 'compileFormat'
  | 'offsetScan'
  | 'offsetInterval';

interface Edit {
  find: string;
  replace: string;
}

interface Patch {
  key: PatchKey;
  /** one-line summary for report tables */
  what: string;
  edits: Edit[];
}

// ---- A: Formatter.num allocates four objects per numeric token ------------
// toFormat() never sets forceSimple, so every numeric token takes the slow
// branch: an opts spread, a PolyNumberFormatter, a rest-destructure and an
// Object.keys array. For a latn-digit locale that formatter then just calls
// padStart, so all four allocations are dead weight. `yyyy-MM-dd HH:mm:ss` has
// six numeric tokens, so this is ~24 throwaway objects per formatted value.
//
// signDisplay is only ever passed by Duration formatting, never by any DateTime
// token, so the fast path can't miss a sign-sensitive case.
const numFast: Patch = {
  key: 'numFast',
  what: 'Formatter.num: skip the per-token formatter allocation for latn locales',
  edits: [
    {
      find: `  num(n, p = 0, signDisplay = undefined) {
    // we get some perf out of doing this here, annoyingly
    if (this.opts.forceSimple) {
      return padStart(n, p);
    }

    const opts = { ...this.opts };`,
      replace: `  num(n, p = 0, signDisplay = undefined) {
    // we get some perf out of doing this here, annoyingly
    if (this.opts.forceSimple) {
      return padStart(n, p);
    }

    // UPSTREAM-A: when the locale renders latn digits and this formatter carries
    // no number-affecting options, PolyNumberFormatter provably falls through to
    // padStart. Do that directly rather than allocating an options object, a
    // formatter, a rest object and a key array for every numeric token.
    if (signDisplay === undefined) {
      if (this.simpleNumsCached === undefined) {
        const { padTo: _padTo, floor: _floor, ...otherOpts } = this.opts;
        this.simpleNumsCached = Object.keys(otherOpts).length === 0 && this.loc.fastNumbers;
      }

      if (this.simpleNumsCached) {
        const fixed = this.opts.floor ? Math.floor(n) : roundTo(n, 3);
        return padStart(fixed, p > 0 ? p : this.opts.padTo || 0);
      }
    }

    const opts = { ...this.opts };`,
    },
  ],
};

// ---- B: the format string is re-tokenized on every call -------------------
// parseFormat() walks the pattern character by character, allocating a token
// object per run and running /^\s+$/ per token, on every single toFormat(). The
// result is a pure function of the string and no caller mutates it (the only
// consumers are stringifyTokens, which reads, and expandMacroTokens, which maps
// into a fresh array).
const parseFormatCache: Patch = {
  key: 'parseFormatCache',
  what: 'Formatter.parseFormat: memoize format-string tokenization',
  edits: [
    {
      find: `class Formatter {
  static create(locale, opts = {}) {
    return new Formatter(locale, opts);
  }

  static parseFormat(fmt) {`,
      replace: `// UPSTREAM-B: format strings are overwhelmingly reused (one pattern, a whole
// column of values), but parseFormat re-tokenized on every call. Bounded so a
// caller generating unique format strings can't grow it without limit.
const parseFormatCache = new Map();
const PARSE_FORMAT_CACHE_MAX = 1000;

class Formatter {
  static create(locale, opts = {}) {
    return new Formatter(locale, opts);
  }

  static parseFormat(fmt) {
    let cached = parseFormatCache.get(fmt);

    if (cached === undefined) {
      cached = Formatter.parseFormatUncached(fmt);

      if (parseFormatCache.size < PARSE_FORMAT_CACHE_MAX) {
        parseFormatCache.set(fmt, cached);
      }
    }

    return cached;
  }

  static parseFormatUncached(fmt) {`,
    },
  ],
};

// ---- C: parseZoneInfo builds a new Intl.DateTimeFormat per call -----------
// Nothing caches it, so any format carrying a zone name (ZZZZ/ZZZZZ, or the
// offsetNameShort/offsetNameLong getters) pays a formatter construction per
// value. Profiling puts this at ~73% of the total cost of formatting a column
// with an abbreviation. The formatter depends only on (locale, offsetFormat,
// timeZone), and luxon already has a DTF cache with exactly those semantics —
// getCachedDTF, which Locale.resetCache() clears.
//
// Upstream caveat: in src, parseZoneInfo lives in impl/util.js while
// getCachedDTF lives in impl/locale.js, and locale.js imports util.js — so a
// real PR has to move parseZoneInfo into locale.js (or the cache into util.js)
// to avoid a circular import. The shipped bundle is flat, so measuring it here
// is valid either way.
const zoneInfoCache: Patch = {
  key: 'zoneInfoCache',
  what: 'parseZoneInfo: reuse the existing DTF cache instead of building one per call',
  edits: [
    {
      find: `  const parsed = new Intl.DateTimeFormat(locale, modified)
    .formatToParts(date)
    .find((m) => m.type.toLowerCase() === "timezonename");`,
      replace: `  // UPSTREAM-C: was \`new Intl.DateTimeFormat(locale, modified)\` — one formatter
  // construction per value, uncached, and the single most expensive thing in
  // luxon's formatting path whenever the pattern includes a zone name.
  const parsed = getCachedDTF(locale, modified)
    .formatToParts(date)
    .find((m) => m.type.toLowerCase() === "timezonename");`,
    },
  ],
};

// ---- D: the Locale is rebuilt twice per formatted value -------------------
// Two separate wastes, which only pay off fixed together:
//
//   * datetime.js calls Locale.fromObject on each fromMillis/fromObject/setZone,
//     so every DateTime allocates a Locale — parseLocaleString and
//     intlConfigString re-run, four cache objects are allocated, and the
//     fastNumbers memo starts empty again. That last part is self-defeating:
//     weekdaysCache/monthsCache/eraCache/fastNumbersCached exist precisely to be
//     reused, and a per-DateTime Locale guarantees they never are.
//
//   * toFormat() then calls loc.redefaultToEN(), and clone()'s "return this"
//     fast path can never fire there because the spread always adds
//     defaultToEN. Profiling the patched build attributes ~7% of a numeric
//     format to that one call.
//
// Locales are immutable value objects apart from those memo fields, so identical
// ones can be shared. Both the intern and the redefaultToEN memo have to notice
// mutations to the Settings fields that create() falls back to, so both go
// through one generation check — four identity compares, which is what makes
// this cheaper than the work it replaces. An earlier attempt that built a string
// cache key covering every field measured slower than no cache at all.
const localeIntern: Patch = {
  key: 'localeIntern',
  what: 'Locale: intern Locales and memoize redefaultToEN instead of rebuilding per value',
  edits: [
    {
      find: `  static create(locale, numberingSystem, outputCalendar, weekSettings, defaultToEN = false) {
    const specifiedLocale = locale || Settings.defaultLocale;`,
      replace: `  static create(locale, numberingSystem, outputCalendar, weekSettings, defaultToEN = false) {
    // UPSTREAM-D: see bench/luxon-patches.ts. Only the plain shape is interned —
    // no numbering system, output calendar or week settings — which is the
    // overwhelmingly common one and keeps the key to a single concat. Anything
    // else falls through to the original uncached path.
    localeSettingsGen();

    const cacheKey =
      numberingSystem || outputCalendar || weekSettings
        ? null
        : defaultToEN
          ? "!" + (locale || "")
          : locale || "";

    if (cacheKey !== null) {
      const interned = localeCache.get(cacheKey);

      if (interned !== undefined) {
        return interned;
      }
    }

    const specifiedLocale = locale || Settings.defaultLocale;`,
    },
    {
      find: `    return new Locale(localeR, numberingSystemR, outputCalendarR, weekSettingsR, specifiedLocale);
  }`,
      replace: `    const built = new Locale(localeR, numberingSystemR, outputCalendarR, weekSettingsR, specifiedLocale);

    if (cacheKey !== null && localeCache.size < LOCALE_CACHE_MAX) {
      localeCache.set(cacheKey, built);
    }

    return built;
  }`,
    },
    {
      find: `  redefaultToEN(alts = {}) {
    return this.clone({ ...alts, defaultToEN: true });
  }`,
      replace: `  redefaultToEN(alts = {}) {
    // UPSTREAM-D: toFormat() lands here on every call with no alts at all.
    if (Object.getOwnPropertyNames(alts).length === 0) {
      const gen = localeSettingsGen();

      if (this.redefaultedToENGen !== gen) {
        this.redefaultedToENGen = gen;
        this.redefaultedToEN = this.clone({ defaultToEN: true });
      }

      return this.redefaultedToEN;
    }

    return this.clone({ ...alts, defaultToEN: true });
  }`,
    },
    {
      find: `  static resetCache() {
    sysLocaleCache = null;
    intlDTCache.clear();`,
      replace: `  static resetCache() {
    sysLocaleCache = null;
    localeCache.clear();
    localeGen++;
    intlDTCache.clear();`,
    },
    {
      find: `const fallbackWeekSettings = {`,
      replace: `const localeCache = new Map();
const LOCALE_CACHE_MAX = 1000;

// Bumped whenever a Settings field that Locale.create() falls back to changes,
// so the intern above and the redefaultToEN memo below both invalidate. Reading
// the four getters and comparing is far cheaper than the Locale it saves, and
// unlike a string cache key it allocates nothing.
let localeGen = 0;
const localeGenSnapshot = [undefined, undefined, undefined, undefined];

function localeSettingsGen() {
  if (
    localeGenSnapshot[0] !== Settings.defaultLocale ||
    localeGenSnapshot[1] !== Settings.defaultNumberingSystem ||
    localeGenSnapshot[2] !== Settings.defaultOutputCalendar ||
    localeGenSnapshot[3] !== Settings.defaultWeekSettings
  ) {
    localeGenSnapshot[0] = Settings.defaultLocale;
    localeGenSnapshot[1] = Settings.defaultNumberingSystem;
    localeGenSnapshot[2] = Settings.defaultOutputCalendar;
    localeGenSnapshot[3] = Settings.defaultWeekSettings;
    localeCache.clear();
    localeGen++;
  }

  return localeGen;
}

const fallbackWeekSettings = {`,
    },
  ],
};

// ---- E: punctuation runs go through the whole token machinery -------------
// parseFormat only marks a token literal when it was bracketed or is pure
// whitespace, so the "-" and ":" in `yyyy-MM-dd HH:mm:ss` are ordinary tokens:
// each one walks tokenToString's ~70-case switch, misses, calls maybeMacro, and
// does a macro-dictionary lookup — four times per value here — only to be
// returned unchanged. A token containing no ASCII letters can't match any switch
// case or macro name, so its output is provably itself.
//
// Recorded as a separate field rather than by widening `literal`, because
// literal also drives the parser (buildRegex/unitForToken) and duration's
// realTokens reduction. Pairs with B, which makes the classification a
// once-per-pattern cost.
const tokenLoop: Patch = {
  key: 'tokenLoop',
  what: 'parseFormat/stringifyTokens: emit letterless tokens verbatim, drop the iterator',
  edits: [
    {
      find: `    if (currentFull.length > 0) {
      splits.push({ literal: bracketed || /^\\s+$/.test(currentFull), val: currentFull });
    }

    return splits;`,
      replace: `    if (currentFull.length > 0) {
      splits.push({ literal: bracketed || /^\\s+$/.test(currentFull), val: currentFull });
    }

    // UPSTREAM-E: a token with no ASCII letters matches no switch case and no
    // macro name, so formatting it is the identity. Flag it once here instead of
    // rediscovering that per value.
    for (const token of splits) {
      if (!token.literal && !/[A-Za-z]/.test(token.val)) {
        token.verbatim = true;
      }
    }

    return splits;`,
    },
    {
      find: `function stringifyTokens(splits, tokenToString) {
  let s = "";
  for (const token of splits) {
    if (token.literal) {
      s += token.val;
    } else {
      s += tokenToString(token.val);
    }
  }
  return s;
}`,
      replace: `function stringifyTokens(splits, tokenToString) {
  // UPSTREAM-E: indexed loop (no iterator allocation per format) and a verbatim
  // check so punctuation skips tokenToString entirely.
  let s = "";
  for (let i = 0; i < splits.length; i++) {
    const token = splits[i];
    if (token.literal || token.verbatim) {
      s += token.val;
    } else {
      s += tokenToString(token.val);
    }
  }
  return s;
}`,
    },
  ],
};

// ---- F: roundTo on values that are already integers -----------------------
// PolyNumberFormatter's non-Intl branch runs roundTo(i, 3) on every number it
// pads, and every numeric DateTime token is an integer. For an integer and
// digits >= 0 all four rounding modes are the identity, so the multiply, the
// Math call and the divide are pure overhead.
const intRoundTo: Patch = {
  key: 'intRoundTo',
  what: 'roundTo: return integers unchanged instead of scaling and rounding them',
  edits: [
    {
      find: `function roundTo(number, digits, rounding = "round") {
  const factor = 10 ** digits;`,
      replace: `function roundTo(number, digits, rounding = "round") {
  // UPSTREAM-F: every rounding mode is the identity on an integer once digits is
  // non-negative, and that is what every DateTime numeric token arrives as.
  if (digits >= 0 && Number.isInteger(number)) {
    return number;
  }

  const factor = 10 ** digits;`,
    },
  ],
};

// ---- G: padStart builds a string to pad a two-digit number -----------------
// Month, day, hour, minute and second all pad to two digits, so the common case
// is a small non-negative integer being stringified and then padded. A table
// covers it without touching either string.
const padStart2: Patch = {
  key: 'padStart2',
  what: 'padStart: table lookup for the two-digit case',
  edits: [
    {
      find: `function padStart(input, n = 2) {
  const isNeg = input < 0;`,
      replace: `// UPSTREAM-G: "00".."99", for the pad-to-two case that dominates date formatting
const PAD_TO_2 = Array.from({ length: 100 }, (_, i) => (i < 10 ? "0" : "") + i);

function padStart(input, n = 2) {
  if (n === 2 && Number.isInteger(input) && input >= 0 && input < 100) {
    return PAD_TO_2[input];
  }

  const isNeg = input < 0;`,
    },
  ],
};

// ---- H: tsToObj allocates a Date to read seven fields ----------------------
// Every DateTime construction calls this to derive its civil fields, allocating
// a Date purely to call getUTC* on it. The same arithmetic runs without the
// allocation — this repo already does it in shared/rules.ts for the same reason.
//
// The riskiest of the set, since it is core civil-date derivation rather than a
// cache, so bench/luxon-upstream.ts checks it against Date's own getters across
// a wide timestamp range rather than trusting the format-level diff.
const tsToObjMath: Patch = {
  key: 'tsToObjMath',
  what: 'tsToObj: integer civil-date math instead of allocating a Date',
  edits: [
    {
      find: `function tsToObj(ts, offset) {
  ts += offset * 60 * 1000;

  const d = new Date(ts);

  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds(),
  };
}`,
      replace: `function tsToObj(ts, offset) {
  ts += offset * 60 * 1000;

  // UPSTREAM-H: was \`new Date(ts)\` plus seven getUTC* calls. Same result, no
  // allocation (Howard Hinnant's civil_from_days, valid for any Gregorian year).
  const days = Math.floor(ts / 86400000);
  const msOfDay = ts - days * 86400000;

  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const month = mp < 10 ? mp + 3 : mp - 9;

  return {
    year: yoe + era * 400 + (month <= 2 ? 1 : 0),
    month,
    day: doy - Math.floor((153 * mp + 2) / 5) + 1,
    hour: Math.floor(msOfDay / 3600000),
    minute: Math.floor(msOfDay / 60000) % 60,
    second: Math.floor(msOfDay / 1000) % 60,
    millisecond: msOfDay % 1000,
  };
}`,
    },
  ],
};

// ---- I: compile the format instead of interpreting it ----------------------
// The structural one, and the only patch here that is not a cache or a
// short-circuit. Everything above leaves the shape of formatDateTimeFromString
// alone: per formatted value it builds eight closures over `dt`, then walks the
// token list calling a ~70-case string switch per token, and re-allocates the
// Intl options object literals inside the branches it happens to take.
//
// None of that depends on the value being formatted. Resolving each token to a
// handler once per pattern turns formatting into a walk over a prebuilt array.
// The representation is alternating literal/handler runs —
//   lits[0] + fns[0]() + lits[1] + fns[1]() + ... + lits[n]
// so literal text is concatenated rather than dispatched, and adjacent literals
// collapse at compile time. That subsumes B (parseFormat now runs once per
// pattern) and E (punctuation and unknown tokens fold into the literal runs,
// which is what the interpreter's default branch effectively did anyway).
//
// The two locale-derived flags stay per call, passed as arguments rather than
// baked into the program, so the cache can be keyed on the format string alone.
//
// Implemented by delegating from the original method and leaving its body in
// place as formatDateTimeFromStringInterpreted: it keeps the patch readable and
// the two implementations diffable. A real PR would delete it.
const compileFormat: Patch = {
  key: 'compileFormat',
  what: 'Formatter: compile a format string to handlers once, instead of a switch per token per value',
  edits: [
    {
      find: `  formatDateTimeFromString(dt, fmt) {
    const knownEnglish = this.loc.listingMode() === "en",`,
      replace: `  formatDateTimeFromString(dt, fmt) {
    // UPSTREAM-I: see bench/luxon-patches.ts
    return cfRun(this, dt, fmt);
  }

  formatDateTimeFromStringInterpreted(dt, fmt) {
    const knownEnglish = this.loc.listingMode() === "en",`,
    },
    {
      find: `const macroTokenToFormatOpts = {`,
      replace: `// ---- UPSTREAM-I: compiled format programs ----------------------------------
// A format string compiles to alternating literal/handler runs. Handlers take
// (formatter, dateTime, knownEnglish, useDateTimeFormatter) so that a program
// depends on the pattern alone and can be shared across locales and formatters.

const cfPrograms = new Map();
const CF_CACHE_MAX = 1000;

const cfExtract = (f, dt, opts, field) => f.loc.extract(dt, opts, field);

function cfOffset(format) {
  return (f, dt) => {
    if (dt.isOffsetFixed && dt.offset === 0 && f.opts.allowZ) {
      return "Z";
    }

    return dt.isValid ? dt.zone.formatOffset(dt.ts, format) : "";
  };
}

function cfMonth(length, standalone) {
  // hoisted: the interpreter rebuilt this literal on every value
  const opts = standalone ? { month: length } : { month: length, day: "numeric" };

  return (f, dt, en) => (en ? monthForDateTime(dt, length) : cfExtract(f, dt, opts, "month"));
}

function cfWeekday(length, standalone) {
  const opts = standalone
    ? { weekday: length }
    : { weekday: length, month: "long", day: "numeric" };

  return (f, dt, en) => (en ? weekdayForDateTime(dt, length) : cfExtract(f, dt, opts, "weekday"));
}

function cfEra(length) {
  const opts = { era: length };

  return (f, dt, en) => (en ? eraForDateTime(dt, length) : cfExtract(f, dt, opts, "era"));
}

const CF_DAY_NUM = { day: "numeric" };
const CF_DAY_2D = { day: "2-digit" };
const CF_MONTH_NUM_DAY = { month: "numeric", day: "numeric" };
const CF_MONTH_2D_DAY = { month: "2-digit", day: "numeric" };
const CF_MONTH_NUM = { month: "numeric" };
const CF_MONTH_2D = { month: "2-digit" };
const CF_YEAR_NUM = { year: "numeric" };
const CF_YEAR_2D = { year: "2-digit" };
const CF_DAYPERIOD = { hour: "numeric", hourCycle: "h12" };

// null prototype: token text comes from user format strings, so an inherited
// property must not be mistaken for a handler
const cfHandlers = Object.assign(Object.create(null), {
  // ms
  S: (f, dt) => f.num(dt.millisecond),
  u: (f, dt) => f.num(dt.millisecond, 3),
  SSS: (f, dt) => f.num(dt.millisecond, 3),
  // seconds
  s: (f, dt) => f.num(dt.second),
  ss: (f, dt) => f.num(dt.second, 2),
  // fractional seconds
  uu: (f, dt) => f.num(Math.floor(dt.millisecond / 10), 2),
  uuu: (f, dt) => f.num(Math.floor(dt.millisecond / 100)),
  // minutes
  m: (f, dt) => f.num(dt.minute),
  mm: (f, dt) => f.num(dt.minute, 2),
  // hours
  h: (f, dt) => f.num(dt.hour % 12 === 0 ? 12 : dt.hour % 12),
  hh: (f, dt) => f.num(dt.hour % 12 === 0 ? 12 : dt.hour % 12, 2),
  H: (f, dt) => f.num(dt.hour),
  HH: (f, dt) => f.num(dt.hour, 2),
  // offset
  Z: cfOffset("narrow"),
  ZZ: cfOffset("short"),
  ZZZ: cfOffset("techie"),
  ZZZZ: (f, dt) => dt.zone.offsetName(dt.ts, { format: "short", locale: f.loc.locale }),
  ZZZZZ: (f, dt) => dt.zone.offsetName(dt.ts, { format: "long", locale: f.loc.locale }),
  // zone
  z: (f, dt) => dt.zoneName,
  // meridiems
  a: (f, dt, en) =>
    en ? meridiemForDateTime(dt) : cfExtract(f, dt, CF_DAYPERIOD, "dayperiod"),
  // dates
  d: (f, dt, en, useDTF) => (useDTF ? cfExtract(f, dt, CF_DAY_NUM, "day") : f.num(dt.day)),
  dd: (f, dt, en, useDTF) => (useDTF ? cfExtract(f, dt, CF_DAY_2D, "day") : f.num(dt.day, 2)),
  // weekdays - standalone
  c: (f, dt) => f.num(dt.weekday),
  ccc: cfWeekday("short", true),
  cccc: cfWeekday("long", true),
  ccccc: cfWeekday("narrow", true),
  // weekdays - format
  E: (f, dt) => f.num(dt.weekday),
  EEE: cfWeekday("short", false),
  EEEE: cfWeekday("long", false),
  EEEEE: cfWeekday("narrow", false),
  // months - standalone
  L: (f, dt, en, useDTF) =>
    useDTF ? cfExtract(f, dt, CF_MONTH_NUM_DAY, "month") : f.num(dt.month),
  LL: (f, dt, en, useDTF) =>
    useDTF ? cfExtract(f, dt, CF_MONTH_2D_DAY, "month") : f.num(dt.month, 2),
  LLL: cfMonth("short", true),
  LLLL: cfMonth("long", true),
  LLLLL: cfMonth("narrow", true),
  // months - format
  M: (f, dt, en, useDTF) => (useDTF ? cfExtract(f, dt, CF_MONTH_NUM, "month") : f.num(dt.month)),
  MM: (f, dt, en, useDTF) =>
    useDTF ? cfExtract(f, dt, CF_MONTH_2D, "month") : f.num(dt.month, 2),
  MMM: cfMonth("short", false),
  MMMM: cfMonth("long", false),
  MMMMM: cfMonth("narrow", false),
  // years
  y: (f, dt, en, useDTF) => (useDTF ? cfExtract(f, dt, CF_YEAR_NUM, "year") : f.num(dt.year)),
  yy: (f, dt, en, useDTF) =>
    useDTF ? cfExtract(f, dt, CF_YEAR_2D, "year") : f.num(dt.year.toString().slice(-2), 2),
  yyyy: (f, dt, en, useDTF) =>
    useDTF ? cfExtract(f, dt, CF_YEAR_NUM, "year") : f.num(dt.year, 4),
  yyyyyy: (f, dt, en, useDTF) =>
    useDTF ? cfExtract(f, dt, CF_YEAR_NUM, "year") : f.num(dt.year, 6),
  // eras
  G: cfEra("short"),
  GG: cfEra("long"),
  GGGGG: cfEra("narrow"),
  // week dates
  kk: (f, dt) => f.num(dt.weekYear.toString().slice(-2), 2),
  kkkk: (f, dt) => f.num(dt.weekYear, 4),
  W: (f, dt) => f.num(dt.weekNumber),
  WW: (f, dt) => f.num(dt.weekNumber, 2),
  n: (f, dt) => f.num(dt.localWeekNumber),
  nn: (f, dt) => f.num(dt.localWeekNumber, 2),
  ii: (f, dt) => f.num(dt.localWeekYear.toString().slice(-2), 2),
  iiii: (f, dt) => f.num(dt.localWeekYear, 4),
  // ordinal, quarter, epoch
  o: (f, dt) => f.num(dt.ordinal),
  ooo: (f, dt) => f.num(dt.ordinal, 3),
  q: (f, dt) => f.num(dt.quarter),
  qq: (f, dt) => f.num(dt.quarter, 2),
  X: (f, dt) => f.num(Math.floor(dt.ts / 1000)),
  x: (f, dt) => f.num(dt.ts),
});

function cfCompile(fmt) {
  const lits = [];
  const fns = [];
  let lit = "";

  for (const token of Formatter.parseFormat(fmt)) {
    if (token.literal) {
      lit += token.val;
      continue;
    }

    const handler = cfHandlers[token.val];

    if (handler !== undefined) {
      lits.push(lit);
      lit = "";
      fns.push(handler);
      continue;
    }

    const macroOpts = Formatter.macroTokenToFormatOpts(token.val);

    if (macroOpts) {
      lits.push(lit);
      lit = "";
      fns.push((f, dt) => f.formatWithSystemDefault(dt, macroOpts));
      continue;
    }

    // the interpreter's default branch returned an unrecognized token verbatim,
    // so it is nothing but literal text
    lit += token.val;
  }

  lits.push(lit);

  return { lits, fns };
}

function cfRun(f, dt, fmt) {
  let program = cfPrograms.get(fmt);

  if (program === undefined) {
    program = cfCompile(fmt);

    if (cfPrograms.size < CF_CACHE_MAX) {
      cfPrograms.set(fmt, program);
    }
  }

  const { lits, fns } = program;
  const en = f.loc.listingMode() === "en";
  const useDTF = f.loc.outputCalendar && f.loc.outputCalendar !== "gregory";

  let s = lits[0];

  for (let i = 0; i < fns.length; i++) {
    s += fns[i](f, dt, en, useDTF) + lits[i + 1];
  }

  return s;
}

const macroTokenToFormatOpts = {`,
    },
  ],
};

// ---- J: IANAZone.offset decodes Intl output the expensive way -------------
// Once A-I land, this is essentially all that is left between luxon and moment
// on a zone-less pattern: every formatted value calls offset(), and offset()
// costs a formatToParts (an array of seven {type, value} objects), six parseInt
// calls on those strings, a wrapper Date and a second Date inside objToLocalTS.
//
// dtf.format() hands back the same six numbers in one string. Reading them with
// charCodeAt and converting with integer civil math produces a bit-identical
// answer while allocating nothing but that string. The field layout is read
// once per zone from formatToParts rather than assumed, and any zone that does
// not come back in the expected order keeps the original path, so a different
// ICU layout degrades instead of decoding fields into the wrong slots.
const offsetScan: Patch = {
  key: 'offsetScan',
  what: 'IANAZone.offset: read dtf.format() digits instead of formatToParts + parseInt',
  edits: [
    {
      find: `const dtfCache = new Map();`,
      replace: `const dtfCache = new Map();
const scanCache = new Map();

/** days since the epoch for a proleptic-gregorian date (Howard Hinnant) */
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = ((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) | 0;
  const doe = yoe * 365 + ((yoe / 4) | 0) - ((yoe / 100) | 0) + doy + d - 1;
  return era * 146097 + doe - 719468;
}

function makeScanner(zoneName) {
  const dtf = makeDTF(zoneName);
  const layout = [];

  for (const part of dtf.formatToParts(Date.UTC(2020, 5, 15, 12, 34, 56))) {
    if (part.type !== "era" && typeToPos[part.type] !== undefined) layout.push(part.type);
  }

  if (layout.join() !== "month,day,year,hour,minute,second") return null;

  return (t) => {
    const s = dtf.format(t);
    let month = 0,
      day = 0,
      year = 0,
      hour = 0,
      minute = 0,
      second = 0,
      run = 0,
      acc = -1,
      bc = false;

    for (let i = 0; i <= s.length; i++) {
      const c = i < s.length ? s.charCodeAt(i) : 0;

      if (c >= 48 && c <= 57) {
        acc = (acc < 0 ? 0 : acc * 10) + (c - 48);
      } else {
        if (c === 66) bc = true;
        if (acc >= 0) {
          if (run === 0) month = acc;
          else if (run === 1) day = acc;
          else if (run === 2) year = acc;
          else if (run === 3) hour = acc;
          else if (run === 4) minute = acc;
          else second = acc;
          run++;
          acc = -1;
        }
      }
    }

    if (run !== 6) return NaN;
    if (bc) year = -Math.abs(year) + 1;
    if (hour === 24) hour = 0;

    const asUTC = (daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second) * 1000;

    // integer math has no trouble here, but objToLocalTS goes through Date.UTC,
    // which overflows to NaN past the Date range — match that rather than
    // start returning offsets stock luxon does not
    if (!(Math.abs(asUTC) <= 8.64e15)) return NaN;

    const over = t % 1000;

    return (asUTC - (t - (over >= 0 ? over : 1000 + over))) / 60000;
  };
}

function zoneScanner(zoneName) {
  let scan = scanCache.get(zoneName);
  if (scan === undefined) scanCache.set(zoneName, (scan = makeScanner(zoneName)));
  return scan;
}`,
    },
    {
      find: `  offset(ts) {
    if (!this.valid) return NaN;
    const date = new Date(ts);

    if (isNaN(date)) return NaN;

    const dtf = makeDTF(this.name);`,
      replace: `  offset(ts) {
    if (!this.valid) return NaN;

    const scan = zoneScanner(this.name);

    if (scan !== null) {
      const t = Math.trunc(ts);
      if (!(Math.abs(t) <= 8.64e15)) return NaN;
      return scan(t);
    }

    const date = new Date(ts);

    if (isNaN(date)) return NaN;

    const dtf = makeDTF(this.name);`,
    },
  ],
};

// ---- K: offset() re-derives the same offset for every value ---------------
// Requires J (it anchors on J's fast path). Offsets only change at transitions,
// so a value that falls inside an interval already known to be transition-free
// needs no Intl call at all.
//
// The interval is exact, not a heuristic. Probes are spaced 2 days apart, and
// the shortest window in which any zone's offset changes and returns to where
// it started is 6.96 days (America/Boa_Vista, Oct 2000; measured over all 68214
// transitions the runtime's own ICU reports, via tools/tz-transition-gap.ts).
// Departing and returning inside a probe pair is the only way two agreeing
// probes could be wrong, so a shorter window proves the span transition-free.
//
// How far to fan out is decided by what the previous interval actually
// returned, which keeps the cache from betting on workloads it isn't getting:
// a sequential reader earns a wide fan within a few misses, while random access
// settles at no probing at all and pays exactly what J alone would.
const offsetInterval: Patch = {
  key: 'offsetInterval',
  what: 'IANAZone.offset: cache the transition-free interval around the value (needs J)',
  edits: [
    {
      find: `const scanCache = new Map();`,
      replace: `const scanCache = new Map();
const intervalCache = new Map();

// well under the 6.96d change-and-return bound, leaving room for it to tighten
const PROBE_MS = 2 * 86400000;
const MAX_REACH = 256;
const MAX_TS = 8.64e15;

function intervalOffset(zoneName, scan, t) {
  let st = intervalCache.get(zoneName);

  if (st === undefined) intervalCache.set(zoneName, (st = { lo: 1, hi: 0, off: 0, reach: 0, hits: 0, misses: 0 }));

  if (t >= st.lo && t <= st.hi) {
    st.hits++;
    return st.off;
  }

  const off = scan(t);
  const forward = t > st.hi;

  st.off = off;
  st.lo = t;
  st.hi = t;

  for (let k = 1; k <= st.reach; k++) {
    const p = t + (forward ? k : -k) * PROBE_MS;
    if (!(Math.abs(p) <= MAX_TS) || scan(p) !== off) break;
    if (forward) st.hi = p;
    else st.lo = p;
  }

  st.misses++;
  // probe budget = what the last interval paid back; a miss streak (random
  // access) decays it to zero, with an occasional single probe to notice if
  // the caller has started walking in order after all
  st.reach = st.hits > 0 ? Math.min(st.hits, MAX_REACH) : (st.misses & 15) === 0 ? 1 : 0;
  st.hits = 0;

  return off;
}`,
    },
    {
      find: `      const t = Math.trunc(ts);
      if (!(Math.abs(t) <= 8.64e15)) return NaN;
      return scan(t);`,
      replace: `      const t = Math.trunc(ts);
      if (!(Math.abs(t) <= 8.64e15)) return NaN;
      return intervalOffset(this.name, scan, t);`,
    },
  ],
};

const PATCHES: Patch[] = [
  numFast,
  parseFormatCache,
  zoneInfoCache,
  localeIntern,
  tokenLoop,
  intRoundTo,
  padStart2,
  tsToObjMath,
  compileFormat,
  offsetScan,
  offsetInterval,
];

export const patchWhat = new Map(PATCHES.map((p) => [p.key, p.what]));

const BUNDLE = new URL('../node_modules/luxon/build/es6/luxon.mjs', import.meta.url);
const OUT_DIR = new URL('../.tmp/luxon/', import.meta.url);

export type LuxonModule = typeof import('luxon');

const loaded = new Map<string, Promise<LuxonModule>>();

/**
 * A luxon module instance with the given patches applied. Each distinct patch
 * set gets its own file and therefore its own module instance, so the internal
 * caches of one variant can't warm another's.
 */
export function loadLuxon(keys: readonly PatchKey[]): Promise<LuxonModule> {
  const id = keys.length === 0 ? 'stock' : [...keys].sort().join('+');
  let mod = loaded.get(id);

  if (mod === undefined) {
    loaded.set(id, (mod = build(id, keys)));
  }

  return mod;
}

async function build(id: string, keys: readonly PatchKey[]): Promise<LuxonModule> {
  let src = await readFile(BUNDLE, 'utf8');

  for (const key of keys) {
    const patch = PATCHES.find((p) => p.key === key);

    if (patch === undefined) {
      throw new Error(`unknown patch: ${key}`);
    }

    for (const [i, edit] of patch.edits.entries()) {
      const hits = src.split(edit.find).length - 1;

      if (hits !== 1) {
        throw new Error(
          `patch "${key}" edit ${i + 1}/${patch.edits.length} matched its anchor ${hits} time(s), expected exactly 1 — luxon's source moved, update bench/luxon-patches.ts`
        );
      }

      src = src.replace(edit.find, edit.replace);
    }
  }

  await mkdir(OUT_DIR, { recursive: true });

  const out = new URL(`${id}.mjs`, OUT_DIR);
  await writeFile(out, src);

  return (await import(pathToFileURL(out.pathname).href)) as LuxonModule;
}
