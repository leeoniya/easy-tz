// Formatting paths compared by bench/luxon-format.ts, in a module the driver
// and its Intl-counting subprocesses can both import.
//
// The question: formatting a column of timestamps in a named IANA zone is
// several times slower through luxon than through moment-timezone, and the
// cost is in the zone lookups rather than the formatting itself. luxon resolves
// a zone from Intl on every call:
//
//   IANAZone.offset(ts)      -> formatToParts() on a per-zone cached formatter
//   IANAZone.offsetName(ts)  -> parseZoneInfo(), which constructs a BRAND NEW
//                               Intl.DateTimeFormat per call — nothing caches it
//
// moment-timezone consults a packed offset table and touches Intl never. easy-tz
// resolves the same two values from baked rules, also without Intl, so a subclass
// that overrides just those two methods keeps every other luxon behavior intact
// (zone identity, token handling, DateTime math) while dropping the per-value
// Intl work.

import { DateTime, IANAZone, SystemZone, type OffsetNameOpts } from 'luxon';
import moment from 'moment-timezone';
import { getTimeZoneAt } from '../impls/07-baked-rules/index.ts';
import type { TimeZoneInfo } from '../shared/types.ts';
import { zones } from '../shared/zones.ts';
import { classIdx } from '../shared/bakedSchedule.ts';
import { scheduleClasses } from '../shared/schedule.ts';
import type { SampleBudget } from '../tools/bench-config.ts';

// Locale is pinned so luxon's ZZZZ token and moment's z token are compared on
// equal terms and the run is reproducible regardless of host locale.
export const LOCALE = 'en-US';

const knownZones = new Set(zones);

// kind-2 schedule classes are the irregular (Ramadan-driven) zones, whose
// transition dates the baked step table only approximates — easy-tz can be up
// to an hour off on these, so they must keep using luxon's exact Intl lookup.
// Derived from the active tables rather than hardcoded, so a re-bake that
// changes the set is picked up automatically.
export const irregularZones = new Set(
  zones.filter((_, i) => {
    const ci = classIdx[i];
    return ci != null && ci !== -1 && scheduleClasses[ci]?.kind === 2;
  })
);

/** Zones easy-tz can answer for exactly, and therefore may take over from Intl. */
export function easyTZCanResolve(name: string): boolean {
  return knownZones.has(name) && !irregularZones.has(name);
}

// luxon asks for the offset and the offset name of the SAME instant back to
// back while formatting one value, so a single-slot memo halves the lookups for
// abbreviation-bearing formats. Keyed on the exact ts, so it can't skew a result
// the way an hour-bucket memo could across a DST transition.
//
// Shared by both zone subclasses below. They extend different luxon bases
// (IANAZone, SystemZone) so there is no common superclass to hang it on, and
// the two copies this replaces are exactly the kind of thing that drifts into
// making one benchmark row measure something the other doesn't.
function zoneMemo(name: string): (ts: number) => TimeZoneInfo {
  let at = NaN;
  let info: TimeZoneInfo | undefined;

  return (ts) => {
    if (info === undefined || ts !== at) {
      at = ts;
      info = getTimeZoneAt(name, ts);
    }

    return info;
  };
}

/**
 * A real luxon IANAZone whose offset and short offset name come from easy-tz's
 * baked rules instead of Intl. Everything else — `type`, `name`, `equals`,
 * validity, and the whole DateTime/Formatter path above it — is inherited
 * untouched, so luxon still treats it as the named IANA zone it is.
 *
 * Built against a supplied IANAZone rather than the imported one so the same
 * implementation can be bound to a patched luxon instance
 * (bench/luxon-upstream.ts) as well as the stock one.
 */
export function makeEasyZoneClass(Base: typeof IANAZone) {
  return class EasyTZZone extends Base {
    readonly #at: (ts: number) => TimeZoneInfo;

    constructor(name: string) {
      super(name);
      this.#at = zoneMemo(name);
    }

    override offset(ts: number): number {
      return this.#at(ts).offset;
    }

    override offsetName(ts: number, opts: OffsetNameOpts): string | null {
      // easy-tz carries only the short abbreviation ("EST"); the long form
      // ("Eastern Standard Time") stays on luxon's Intl path.
      return opts.format === 'long' ? super.offsetName(ts, opts) : this.#at(ts).abbr;
    }
  };
}

const EasyTZZone = makeEasyZoneClass(IANAZone);

// mirrors luxon's own ianaZoneCache: constructing an IANAZone runs
// isValidZone(), which builds an Intl.DateTimeFormat, so instances are reused
const easyZoneCache = new Map<string, InstanceType<typeof EasyTZZone>>();

function easyZoneFor(name: string): InstanceType<typeof EasyTZZone> {
  let zone = easyZoneCache.get(name);

  if (zone === undefined) {
    easyZoneCache.set(name, (zone = new EasyTZZone(name)));
  }

  return zone;
}

/** The host zone, resolved once — luxon's SystemZone#name rebuilds a formatter on every access. */
const hostZoneName = new Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The same treatment for the host zone. luxon's SystemZone already gets its
 * offset from Date#getTimezoneOffset — no Intl, and exact by definition — so
 * only the name lookup needs replacing; it goes through the very same uncached
 * parseZoneInfo() as IANAZone's, which is why an abbreviation-bearing format is
 * slow even on the default zone.
 *
 * `offset` therefore still tracks the live host zone while the abbreviation
 * comes from the baked tables. They agree because those tables are generated
 * from this runtime's ICU, but a process that mutates TZ mid-run would need
 * this instance discarded — the same caveat as luxon's own zone caches.
 */
class EasySystemZone extends SystemZone {
  readonly #at = zoneMemo(hostZoneName);

  override offsetName(ts: number, opts: OffsetNameOpts): string | null {
    return opts.format === 'long' ? super.offsetName(ts, opts) : this.#at(ts).abbr;
  }
}

let easySystem: EasySystemZone | undefined;

function easySystemZone(): EasySystemZone {
  return (easySystem ??= new EasySystemZone());
}

// ---- formats -------------------------------------------------------------
// Two shapes, because they exercise different halves of the zone cost:
// `numeric` needs only offset(), while `abbr` also needs offsetName() — the
// uncached-formatter path. `numeric` is Grafana's default column format.

export type FormatKey = 'numeric' | 'abbr';

const FORMATS: Record<FormatKey, { moment: string; luxon: string }> = {
  numeric: { moment: 'YYYY-MM-DD HH:mm:ss', luxon: 'yyyy-MM-dd HH:mm:ss' },
  abbr: { moment: 'YYYY-MM-DD HH:mm:ss z', luxon: 'yyyy-MM-dd HH:mm:ss ZZZZ' },
};

export const formatKeys = Object.keys(FORMATS) as FormatKey[];

export function patternFor(variant: VariantId, fmt: FormatKey): string {
  return variant === 'moment' ? FORMATS[fmt].moment : FORMATS[fmt].luxon;
}

// ---- variants ------------------------------------------------------------
// `utc` is a context row only: FixedOffsetZone answers both the offset and the
// name without Intl already, so there's nothing for easy-tz to replace.

export type VariantId = 'moment' | 'luxon' | 'luxon-easytz';

export const variantIds: VariantId[] = ['moment', 'luxon', 'luxon-easytz'];

export const SYSTEM = 'system';
export const UTC = 'utc';

export function variantAvailable(variant: VariantId, zone: string): boolean {
  if (variant !== 'luxon-easytz') {
    return true;
  }

  if (zone === UTC) {
    return false;
  }

  return easyTZCanResolve(zone === SYSTEM ? hostZoneName : zone);
}

/** A `(ts) => string` closure holding every per-column setup a real formatter would hoist. */
export function makeFormatter(variant: VariantId, zone: string, fmt: FormatKey): (ts: number) => string {
  const pattern = patternFor(variant, fmt);

  if (variant === 'moment') {
    if (zone === SYSTEM) {
      return (ts) => moment(ts).format(pattern);
    }

    if (zone === UTC) {
      return (ts) => moment.utc(ts).format(pattern);
    }

    return (ts) => moment.tz(ts, zone).format(pattern);
  }

  const luxonZone =
    variant === 'luxon-easytz'
      ? zone === SYSTEM
        ? easySystemZone()
        : easyZoneFor(zone)
      : zone === SYSTEM || zone === UTC
        ? zone
        : IANAZone.create(zone);

  const opts = { zone: luxonZone, locale: LOCALE };

  return (ts) => DateTime.fromMillis(ts, opts).toFormat(pattern);
}

// ---- external fast path --------------------------------------------------
// Recommendation B from the investigation: for the handful of patterns a value
// formatter actually emits in bulk, skip luxon's Formatter (and DateTime) and
// build the string straight from the timestamp plus easy-tz's offset.
//
// This is the ceiling on what can be done from OUTSIDE luxon, and the point of
// measuring it is to size what's left inside — see bench/luxon-upstream.ts.
// Correctness is not assumed: the output is diffed against luxon's there.

const DAY_MS = 86_400_000;

// '00'..'99', so two-digit fields are a array read rather than a pad call
const D2 = Array.from({ length: 100 }, (_, i) => (i < 10 ? '0' : '') + i);

/**
 * Civil fields from an offset-shifted epoch time, using the same Hinnant
 * algorithm as shared/rules.ts — no Date allocation.
 */
function formatCivil(localMs: number, abbr: string | null): string {
  const days = Math.floor(localMs / DAY_MS);
  const secOfDay = Math.floor((localMs - days * DAY_MS) / 1000);

  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);

  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);

  const hour = Math.floor(secOfDay / 3600);
  const minute = Math.floor(secOfDay / 60) % 60;
  const second = secOfDay % 60;

  // luxon's yyyy pads to four; years outside 1000-9999 are not what this path
  // is for, but stay correct rather than silently truncating
  const y = year >= 1000 && year <= 9999 ? String(year) : String(year).padStart(4, '0');
  const stamp = `${y}-${D2[month]}-${D2[day]} ${D2[hour]}:${D2[minute]}:${D2[second]}`;

  return abbr === null ? stamp : `${stamp} ${abbr}`;
}

/**
 * A formatter for `zone`/`fmt` that never enters luxon, or null when easy-tz
 * can't resolve the zone exactly (irregular zones, or `utc` which has no zone
 * cost to avoid) and the caller should stay on luxon.
 */
export function makeFastFormatter(zone: string, fmt: FormatKey): ((ts: number) => string) | null {
  if (zone === UTC) {
    return null;
  }

  const name = zone === SYSTEM ? hostZoneName : zone;

  if (!easyTZCanResolve(name)) {
    return null;
  }

  if (fmt === 'numeric') {
    return (ts) => formatCivil(ts + getTimeZoneAt(name, ts).offset * 60_000, null);
  }

  return (ts) => {
    const info = getTimeZoneAt(name, ts);

    return formatCivil(ts + info.offset * 60_000, info.abbr);
  };
}

// ---- measurement ---------------------------------------------------------

export interface LoopResult {
  ms: number;
  /** summed output length — consumed by the caller so the loop can't be elided */
  checksum: number;
}

export function timeLoop(format: (ts: number) => string, base: number, step: number, n: number): LoopResult {
  let checksum = 0;

  // performance.now() rather than Bun.nanoseconds() so these benches run under
  // node too: luxon's users are overwhelmingly on V8, and bun is JavaScriptCore
  const t0 = performance.now();

  for (let i = 0; i < n; i++) {
    checksum += format(base + i * step).length;
  }

  return { ms: performance.now() - t0, checksum };
}

// Default wall-time budget for ONE timed pass. Paths here span a 20x cost range
// — stock luxon on an abbreviation format constructs an Intl.DateTimeFormat per
// value at ~100µs, against ~5µs for everything else — so timing them all over
// the same value count spends almost the whole benchmark inside the slowest
// column, which is also the column whose number nobody is surprised by. Each
// entry instead gets the number of values that fits this budget, and its result
// is scaled back to `report` values.
//
// This is a resolution knob, not just a speed one: a path whose full pass fits
// under the budget is timed in full, and shortening a pass costs precision.
// Set it above a full pass of everything the caller needs to resolve finely and
// only the outliers get shortened. The default clears a full 10k-value pass on
// the ~5µs/value paths.
const DEFAULT_BUDGET_MS = 75;

// Floor on a timed pass regardless of cost. Below a few hundred values the
// timing is dominated by whatever else the engine is doing: at n=250 the stock
// abbr path reads ~40% high, at n=500 it is back in line with n=2000.
const MIN_PASS = 500;

// Floor on how long a timed pass should RUN, which is the same concern in the
// other direction. The cheapest paths here get through `report` values in
// 10-20ms, and at that scale scheduling jitter rivals the signal — those were
// the rows whose control disagreed by ~11% while the expensive ones sat at 1-2%.
// A path that cheap is given more than `report` values so its pass reaches this
// floor, and the result is scaled back down the same way a shortened pass is
// scaled up. Unlike shortening, this only buys precision: it costs a few hundred
// ms across a whole bench, and the rows it lengthens are the ones that were
// least trustworthy.
const MIN_PASS_MS = 40;

// How long a calibration sample has to run before its rate is worth using. Only
// needs to be right to within a factor that would change the chosen n
// materially, and 4ms is ~40x the clock's resolution — at 8ms the doubling ran
// one extra round per entry, which across both benches' cells cost more than
// the sizing saved.
const CALIBRATE_MS = 4;

// How many values to time `format` over: what it gets through in `budgetMs`,
// bounded below by MIN_PASS and above by `report` — or by whatever exceeds
// `report` if a full pass would be too quick to time (MIN_PASS_MS). Grows a
// sample until it is long enough to extrapolate from, so a cheap path is never
// made to run a long pass just to be measured.
//
// The first sample is thrown away. Read cold it is worthless — first-call costs
// alone put a ~4µs/value path over the threshold, which sizes it like a ~60µs
// one — and by the time the doubling reaches a usable sample the formatter has
// run a few thousand values, which is the warm-up the drivers used to do by
// hand. The best of two samples is taken at the end for the same reason timing
// noise is one-sided: a slow reading is interference, a fast one is not.
function passSize(
  format: (ts: number) => string,
  base: number,
  step: number,
  report: number,
  budgetMs: number
): { n: number; checksum: number } {
  let n = 256;
  let checksum = timeLoop(format, base, step, n).checksum;
  let run = timeLoop(format, base, step, n);

  checksum += run.checksum;

  while (run.ms < CALIBRATE_MS && n < report) {
    n *= 2;
    run = timeLoop(format, base, step, n);
    checksum += run.checksum;
  }

  const again = timeLoop(format, base, step, n);
  const ms = Math.min(run.ms, again.ms);

  checksum += again.checksum;

  const perValue = ms / n;
  const ceiling = Math.max(report, Math.round(MIN_PASS_MS / perValue)); // `report`, or more if that is too quick to time
  const wanted = Math.min(Math.round(budgetMs / perValue), ceiling);

  return { n: Math.max(MIN_PASS, wanted), checksum };
}

// Repeatedly times every entry INTERLEAVED — one pass of each per round, rather
// than all of one entry's passes back to back — and reports each entry's
// FASTEST pass, normalized to `report` values.
//
// Fastest, not median, for the reason tools/bench-config.ts already gives for
// the single-zone sweeps: the slow passes are JIT ramp and ambient interference,
// and both only ever add time. That matters more than usual here, because these
// benches run long enough on a thermally limited host to throttle partway
// through — under which a median tracks the throttling and a minimum does not.
// It is also what lets the pass count come down: a median needs enough samples
// to place a middle, whereas a minimum needs only one clean pass, so three
// passes buy what seven did.
//
// Interleaving still earns its keep alongside the minimum. It spreads each
// entry's passes across the whole measurement window, so a cool moment early or
// a throttled stretch late is offered to every entry rather than to whichever
// happened to be running — and since the reported number is a ratio between
// entries, systematic drift across them is the one error that does not cancel.
//
// Shared by both luxon benches (luxon-format.ts, luxon-upstream.ts), which had
// a copy each. A driver that drifted out of interleaving would still print a
// full table of plausible numbers — the failure mode is silent, so the loop is
// worth having in one place.
//
// There is no separate warm-up pass. bench-config.ts documents why one barely
// helps — both engines allocate type feedback per CALL SITE, so a warm-up loop
// trains different slots than the timed loop, and only re-running the timed loop
// itself tiers it up. The pass sizing above already runs a few thousand values
// per entry getting its rate, which covers what a warm-up would have.
//
// `scaled` names the entries measured over fewer than `report` values, so the
// caller can say so rather than implying every column was timed identically.
// `passes` reports how many rounds the budget allowed, for the same reason the
// Chrome bench prints its own pass count: it is the reader's check that a row
// was not measured once and believed.
// The summed checksum comes back so the caller can keep feeding its sink and
// stop the engine eliding the formatting.
export function interleavedBest<K>(
  entries: { key: K; format: (ts: number) => string }[],
  base: number,
  step: number,
  report: number,
  passBudget: SampleBudget,
  budgetMs = DEFAULT_BUDGET_MS
): { best: Map<K, number>; checksum: number; scaled: K[]; passes: number } {
  const best = new Map<K, number>();
  const scaled: K[] = [];
  let checksum = 0;

  const sized = entries.map(({ key, format }) => {
    const sample = passSize(format, base, step, report, budgetMs);
    const n = sample.n;

    checksum += sample.checksum;

    if (n < report) scaled.push(key);

    return { key, format, n };
  });

  let passes = 0;
  let spent = 0; // per-entry timed ms, which the sizing has made roughly equal

  while (passes < passBudget.max) {
    let round = 0;

    for (const { key, format, n } of sized) {
      const run = timeLoop(format, base, step, n);

      checksum += run.checksum;
      round += run.ms;

      // per-value cost is flat across n for every path here (the expensive one
      // does the same fixed work per value), so this is a unit conversion
      const ms = (run.ms * report) / n;
      const prev = best.get(key);

      if (prev === undefined || ms < prev) best.set(key, ms);
    }

    passes++;
    spent += round / sized.length;

    if (passes >= passBudget.min && spent >= passBudget.budgetMs) break;
  }

  return { best, checksum, scaled, passes };
}
