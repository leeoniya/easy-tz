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
  | 'tsToObjMath';

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

const PATCHES: Patch[] = [
  numFast,
  parseFormatCache,
  zoneInfoCache,
  localeIntern,
  tokenLoop,
  intRoundTo,
  padStart2,
  tsToObjMath,
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
