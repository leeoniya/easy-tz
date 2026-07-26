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
    readonly #name: string;

    // luxon asks for the offset and the offset name of the SAME instant back to
    // back while formatting one value, so a single-slot memo halves the lookups
    // for abbreviation-bearing formats. Keyed on the exact ts, so it can't skew
    // a result the way an hour-bucket memo could across a DST transition.
    #ts = NaN;
    #info: TimeZoneInfo | undefined;

    constructor(name: string) {
      super(name);
      this.#name = name;
    }

    #at(ts: number): TimeZoneInfo {
      let info = this.#info;

      if (info === undefined || ts !== this.#ts) {
        this.#ts = ts;
        this.#info = info = getTimeZoneAt(this.#name, ts);
      }

      return info;
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

export const EasyTZZone = makeEasyZoneClass(IANAZone);

// mirrors luxon's own ianaZoneCache: constructing an IANAZone runs
// isValidZone(), which builds an Intl.DateTimeFormat, so instances are reused
const easyZoneCache = new Map<string, InstanceType<typeof EasyTZZone>>();

export function easyZoneFor(name: string): InstanceType<typeof EasyTZZone> {
  let zone = easyZoneCache.get(name);

  if (zone === undefined) {
    easyZoneCache.set(name, (zone = new EasyTZZone(name)));
  }

  return zone;
}

/** The host zone, resolved once — luxon's SystemZone#name rebuilds a formatter on every access. */
export const hostZoneName = new Intl.DateTimeFormat().resolvedOptions().timeZone;

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
export class EasySystemZone extends SystemZone {
  #ts = NaN;
  #info: TimeZoneInfo | undefined;

  #at(ts: number): TimeZoneInfo {
    let info = this.#info;

    if (info === undefined || ts !== this.#ts) {
      this.#ts = ts;
      this.#info = info = getTimeZoneAt(hostZoneName, ts);
    }

    return info;
  }

  override offsetName(ts: number, opts: OffsetNameOpts): string | null {
    return opts.format === 'long' ? super.offsetName(ts, opts) : this.#at(ts).abbr;
  }
}

let easySystem: EasySystemZone | undefined;

export function easySystemZone(): EasySystemZone {
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

  const t0 = Bun.nanoseconds();

  for (let i = 0; i < n; i++) {
    checksum += format(base + i * step).length;
  }

  return { ms: (Bun.nanoseconds() - t0) / 1e6, checksum };
}
