# 🌐 easy-tz

Experiments in implementing a fast, dependency-free `getTimeZonesAt(timestamp)`. Scope: current-year accuracy in modern runtimes, plus validated
historical offsets back to 1995 for the baked impls (`07`/`10`); results are
independent of the host timezone (`TZ`). Pre-1995 accuracy is a non-goal.

```ts
function getTimeZonesAt(timestamp: number, withAliases?: boolean): TimeZoneInfo[];
function getTimeZoneAt(name: string, timestamp: number, withAliases?: boolean): TimeZoneInfo; // one zone, many timestamps
function getTimeZones(withAliases?: boolean): TimeZoneInfo[];           // all zones now; schedule-only, history tree-shakes out
function getTimeZone(name: string, withAliases?: boolean): TimeZoneInfo; // one zone now;  schedule-only, history tree-shakes out
function formatOffset(minutes: number): string; // -300 -> "-05:00"

interface TimeZoneInfo {
  name: string;     // "America/New_York"
  abbr: string;     // "EST" / "EDT" (not "GMT-5" where avoidable)
  offset: number;   // signed minutes east of UTC, e.g. -300 (formatOffset() -> "-05:00")
  aliasOf?: string; // canonical id when `name` is a legacy spelling ("Asia/Kolkata")
}
```

## Why this exists

```
┌──────────────────────────────────────────────────────────────┐
│ Type to search (name, city, abbreviation)                 🔍 │
├──────────────────────────────────────────────────────────────┤
│  Default  UTC, GMT                             [UTC+00:00]  ▲│
│  Browser Time  CDT                             [UTC−05:00]  █│
│  Coordinated Universal Time  UTC, GMT          [UTC+00:00]  █│
│ ──────────────────────────────────────────────────────────  ░│
│  Africa                                                     ░│
│    Abidjan  GMT                                [UTC+00:00]  ░│
│    Accra  GMT                                  [UTC+00:00]  ░│
│    Addis Ababa  EAT                            [UTC+03:00]  ░│
│    Algiers  CET                                [UTC+01:00]  ░│
│    Asmara  EAT                                 [UTC+03:00]  ▼│
└──────────────────────────────────────────────────────────────┘
```

While swapping a codebase from 295KB `moment` to 68KB `luxon`, I also
wanted to drop the 770KB `moment-timezone` dependency from a time zone picker
component. A small, fast replacement did not exist for this purpose (see
[comparison.md](comparison.md) for the full 19-library evaluation):

- `Intl` provides offsets, but not reliable abbreviations: `en` CLDR only
  defines short names for a handful of mostly North American metazones, so
  Intl-backed formatters (luxon, date-fns, dayjs) emit "GMT+2"-style labels
  for most of the world.
- Relying on `Intl` at runtime is also slow to initialize and memory-heavy:
  constructing a formatter per zone is ~100x the cost of calling one, so the
  first full-list call pays tens of milliseconds and tens of MB of ICU state.
- Libraries with real abbreviations built in (moment-timezone,
  timezone-support, timezonecomplete, bigeasy/timezone) bundle full tzdata —
  0.3-1.8 MB minified — carrying deep pre-modern transition data (sub-minute
  19th-century offsets, every pre-1970 regime) this use case doesn't need.
  The baked impls here instead bake a bounded, offsets-only 1995+ window (see
  [Historical coverage](#historical-coverage-1995)).

My [first attempt](https://github.com/leeoniya/timezones) split the
difference with a generated offset→abbreviation lookup plus live Intl
offsets. The implementations here further explore the full live-to-baked spectrum,
ending in `07-baked-rules`: vs moment-timezone it cuts cold start ~40x
(22.9ms → 0.6ms) and memory ~2.5x (22.6MB → 9.1MB) at ~3% of the bundle size
(768KB → 24.3KB), while passing all 62 edge-case fixtures and improving
abbreviation coverage for 159 zones where modern tzdata dropped letter
abbreviations (Santiago CLT/CLST, Kathmandu NPT, Chatham CHAST/CHADT,
Kiritimati LINT, Lord Howe LHST/LHDT, Istanbul TRT, …).

## Implementations

Ordered fastest to slowest — which is also most-baked to most-live: each
step down trusts the generated data less (adding runtime rigor and cost),
until `04-live-intl` ships no generated data at all.

| impl | trust model | cold ms | miss ms | rss MB | bundle KB |
|---|---|--:|--:|--:|--:|
| `07-baked-rules` | trusts baked tables completely | 0.6 | <0.1 | 9.1 | 24.3 |
| `10-audited-rules` | baked tables, Temporal-audited at first call; failing zones recovered live | 3.7 | <0.1 | 10.4 | 26.4 |
| `08-verified-sharing` | live Intl values; baked data only hints formatter sharing, Temporal-verified at first call | 24.7 | 0.7 | 20.2 | 12.0 |
| `04-live-intl` | fully live — no generated data to trust | 44.5 | 1.4 | 27.0 | 7.6 |

Full-list `getTimeZonesAt()`, measured on chrome-headless-shell (the primary
target) via `bun run bench`. `cold` is the first call; `miss` an hour-bucket
recompute; `hit` (not shown) is ~0.01-0.03µs on cache repeats. `bundle` is
minified, not gzipped (`07`/`10` carry the [1995+ history eras](#historical-coverage-1995);
gzip roughly halves them: `07` ≈ 11.7KB).

### Single-zone lookups

`getTimeZoneAt(name, timestamp)` resolves one zone without building the full
list — the single-zone / many-timestamps counterpart. Same ordering; each
column is the total wall time to sweep `America/New_York` across 10,000
timestamps (6h step), once in a current (projected) year and once in a
historical one:

| impl | 10k cur ms | 10k hist ms | formatters |
|---|--:|--:|--:|
| `07-baked-rules` | 3.4 | 3.0 | 0 |
| `10-audited-rules` | 3.6 | 17.9 | 0 |
| `08-verified-sharing` | 35.5 | 33.4 | 1 |
| `04-live-intl` | 35.7 | 35.6 | 1 |

Baked history costs `07` nothing extra — ~3ms for the whole 10k-instant sweep
whether the instants are past or present. On a Temporal runtime `10` resolves
the past live (Temporal is authoritative for history), hence its heavier
historical sweep (17.9ms vs 3.6ms); the live impls build one formatter for the
zone and reuse it across the whole sweep either way.

### Schedule-only route (`getTimeZones()` / `getTimeZone()`)

The two current-instant entry points take no timestamp — they answer
`Date.now()`, which is always the bake year or later, so they never need the
historical eras. On the baked impls (`07`/`10`) both are wired through a
history-free code path (`shared/bakedSchedule.ts`, with the eager history
decode marked `/*@__PURE__*/`), so a bundler that sees you import **only**
current-instant APIs drops the entire 1995+ history table. Measured on the
shipped `dist/` (consumer bundle, minified):

| import | `07` KB | `10` KB |
|---|--:|--:|
| `getTimeZonesAt` (history-capable) | 22.9 | 24.5 |
| `getTimeZoneAt` (history-capable) | 22.7 | 24.2 |
| `getTimeZones` (schedule-only) | 11.1 | 12.5 |
| `getTimeZone` (schedule-only) | 10.9 | 12.2 |

Roughly halved — the ~12KB of baked eras tree-shake away. Import
`getTimeZonesAt`/`getTimeZoneAt` anywhere and the history comes back. On the
live impls (`04`/`08`) there's no history to shed; `getTimeZones()` is just
`getTimeZonesAt(Date.now())` sharing the same hour-bucket memo, and
`getTimeZone()` is `getTimeZoneAt(name, Date.now())`.

The four resolvers are a 2x2 grid — all zones or one, at a given instant or
now — and every cell agrees with the others by construction: they funnel
through one per-zone core (`tests/single-zone.test.ts`,
`tests/get-timezones.test.ts` pin this for every zone).

<details>
<summary><b>Implementation details</b> — strategies and per-impl notes</summary>

| impl | abbr strategy | offset strategy |
|---|---|---|
| `07-baked-rules` | baked into generated year schedule | baked into generated year schedule (zero Intl at runtime) |
| `10-audited-rules` | 07's baked schedule, audited at first call | baked (audited); Temporal-live for recovered zones |
| `08-verified-sharing` | same as 04, via rep formatters whose groups are Temporal-verified at first call | same as 04 |
| `04-live-intl` | `'long'` name -> curated map, initials fallback | derived arithmetically from zone-local wall-clock fields (1 Intl call/zone) |

`07-baked-rules` trusts the generated data completely: the generator emits
`shared/schedule.ts` — a YEAR-INDEPENDENT schedule fitted by probing three
consecutive years: static states, two-state nth-weekday-of-month rules
("second Sunday of March at 02:00 wall"), and current-year segments for the
few zones whose rules aren't Gregorian (Morocco/Palestine Ramadan rules) —
so a call is pure date math with zero Intl usage, and stays correct across
year boundaries until a country actually changes policy. Fastest cold start
and smallest memory of the four, but least resilient: a stale table means
wrong answers until regeneration (needed on tzdata/CLDR changes, and yearly
only for the irregular zones). `tests/schedule.test.ts` asserts
output-equality with 04 including next-year instants; irregular zones clamp
outside the generated year.

How exposed is that in practice — measured against 04, not against perfect
data? The events are real but rare: weighting the last decade of tzdb
releases (2016-2026) by who's affected, a future-effective rule change hit
a 2M+ metro zone in 7 of 11 years — Cairo twice (2016 DST cancel on 3 days'
notice, 2023 reintroduction), Istanbul (2016), Casablanca and Pyongyang
(2018), Brazil's DST-observing zones incl. São Paulo and Rio (2019), the
2022 cluster (Mexico City, Tehran, Amman, Damascus, Santiago), Almaty and
Asunción (2024), Calgary/Edmonton (2026) — ~1.5-2 major zones/year, heavily
clustered; 2021 and 2025 touched only small-population zones (Samoa, South
Sudan, Chilean Aysén). But 04 is not current at the effective date either:
its data rides announcement -> tzdb release (days-weeks, sometimes negative
— Alberta 2026 shipped 3 weeks after taking effect; Egypt 2016 gave 3 days)
-> ICU/Chrome pickup (a stable cycle or two on a 4-week cadence) -> each
user's browser actually updating. That shared upstream pipeline is
weeks-to-months; 07's *additional* exposure is only how long
regen+redeploy lags the generating Chrome's update, which for any app that
deploys monthly-or-better rounds to zero. It can even invert: baked output
doesn't depend on the user's runtime, so a freshly regenerated table serves
correct post-change data to browsers whose own ICU is still stale — where
04 is wrong. The one structural exception is predictable, not
event-driven: the Ramadan-rule zones (Casablanca/El Aaiun and Gaza/Hebron —
all of Morocco and Palestine, ~40M people) clamp outside their generated
year, so skipping the January regen gets them wrong for the ~month-long
Ramadan window every single year, no policy change required.

`10-audited-rules` builds on 07, adding a first-call audit for rigor: once
per process (sound — browsers never hot-swap tzdata) every zone's
current-year behavior predicted by the baked schedule is checked against
Temporal's exact transition walk (~2-5ms, no formatters). Zones that fail —
a policy change in a stale table, unknown zones, irregular zones outside
their generated year — are recovered for the session with live Temporal
offsets and generic GMT-style labels; everything else runs pure baked at
07's miss cost. Never a wrong offset on Temporal runtimes; without Temporal
(Safari, bun, Temporal-less Node builds) it degrades to exactly 07. (It
superseded `09-guarded-hybrid`, which achieved the same protection with a
per-call guard and a bundled live-Intl fallback: ~0.8ms misses and +3.4KB
for curated-quality recovery labels.)

`08-verified-sharing` applies the same verify-at-first-call idea but flips
the trust model: values always come from live Intl, and the generated class
table is demoted to a *hint* about which zones can share one formatter (180
formatters instead of 433, cutting 04's cold start by ~40%). At
first call each group member's exact offset behavior for the year is
compared against its representative's via Temporal's transition walk
(`getTimeZoneTransition`, no formatters, ~4-5ms once), and diverged members
are split out to format themselves. One-time cost, no per-call overhead; a
stale table can only cost speed, never correctness. Without Temporal it
degrades to exactly impl 04.

`04-live-intl` is the fully live baseline: no generated data at all — a
curated long-name -> abbreviation map plus one Intl formatter per zone,
with offsets derived arithmetically from zone-local wall-clock fields.
Slowest cold start and heaviest memory (one formatter per zone forces the
full ICU cost), but nothing can go stale except the small curated abbr map;
it's the reference the other three are tested against.

### Historical coverage (1995+)

The baked impls answer timestamps *before* the bake year (back to 1995), not
just projecting the current rules backward. `07` (and `10` on non-Temporal
runtimes) resolves them through validated historical offset **eras** in
`shared/history.ts` — a compact, offsets-only encoding of each zone's past
DST regimes (e.g. the pre-2007 US rule, decree-driven one-off years). Offsets
are exact; the label reuses the schedule class's abbreviation when the offset
matches one of its states (the common "same abbreviations, different DST
dates" case, like EST/EDT before 2007) and otherwise falls back to a
GMT-style label — historical CLDR abbreviations aren't baked. On a Temporal
runtime, `10` instead resolves the past live (Temporal is authoritative for
history), and the live impls (`04`/`08`) always get history straight from
Intl, so none of them need the baked eras.

This window is deliberately bounded: `tools/sweep-validity.ts` checks every
zone against the runtime's own ICU for each year from 1995 to the bake year
(plus a couple ahead), and the eras are what makes those years exact. It's
also the bulk of what makes `07`/`10` larger than `04`/`08` — a few KB of
era data buys zero-Intl historical correctness. Pre-1995 timestamps clamp to
the earliest era rather than erroring, but aren't validated.

All impls memoize the full response per UTC hour bucket
(`shared/hourCache.ts`): a single global
slot keeps the last bucket's result and is refreshed whenever a timestamp
falls outside it, so only same-bucket repeats hit — suited to clock-driven
queries near "now". The underlying compute always runs at the bucket start,
so DST transitions (hour-aligned in UTC for nearly all zones) resolve
deterministically at bucket boundaries. Cache hits return the same array
reference — treat results as immutable. Hits cost ~0.01-0.3µs vs a miss's
~0.7-5ms (live impls) or <0.1ms (baked impls); `tests/cache.test.ts`
benches hit and miss loops separately for every impl.

</details>

## Install

```sh
npm install @leeoniya/easy-tz
```

## Usage

```ts
import { getTimeZonesAt, getTimeZoneAt, getTimeZones, getTimeZone, formatOffset } from '@leeoniya/easy-tz';

const zones = getTimeZonesAt(Date.now());
// [
//   { name: 'Africa/Abidjan',     abbr: 'GMT', offset: 0 },
//   ...
//   { name: 'America/New_York',   abbr: 'EDT', offset: -240 },
//   ...
// ] — every IANA zone the runtime knows, sorted by name

// same list at the CURRENT instant, no timestamp arg. On the baked root this
// is the schedule-only route: import ONLY this and the 1995+ history table
// tree-shakes out (~halves the bundle — see Schedule-only route above).
getTimeZones();

// resolve a SINGLE zone — the one-zone / many-timestamps counterpart, with
// no full-list allocation. Unknown names resolve to a UTC sentinel.
getTimeZoneAt('America/New_York', Date.now());
// { name: 'America/New_York', abbr: 'EDT', offset: -240 }

// the single-zone getters also accept the fixed-offset ids that ICU accepts
// but doesn't enumerate (Chrome lists none of them), so they're absent from
// the list above: UTC, Etc/UTC, and Etc/GMT+1..+12 / Etc/GMT-1..-14. Note the
// POSIX sign inversion — Etc/GMT+5 is UTC-05:00, not +05:00.
getTimeZoneAt('Etc/GMT+5', Date.now());
// { name: 'Etc/GMT+5', abbr: 'GMT-5', offset: -300 }

// same single zone at the CURRENT instant, no timestamp arg — schedule-only
// like getTimeZones(), so a picker that only ever asks about "now" can import
// just these two and ship neither the history table nor a timestamp.
getTimeZone('America/New_York');
// { name: 'America/New_York', abbr: 'EDT', offset: -240 }

// all four take a trailing `withAliases` (default true). Pass false to keep
// legacy spellings out of the results entirely — see Aliases below.
getTimeZones(false);                          // drops the 20 aliasOf entries
getTimeZone('Asia/Calcutta', false);          // { name: 'Asia/Kolkata', abbr: 'IST', offset: 330 }

formatOffset(-240); // "-04:00" — render offset minutes as an ISO-style string
```

The root import is `07-baked-rules` — fastest and smallest, pure baked data
(see [Implementations](#implementations)). The other impls are available as
subpath imports with the same API, in increasing order of runtime
verification (and cost):

```ts
import { getTimeZonesAt } from '@leeoniya/easy-tz/10-audited-rules';    // baked, Temporal-audited at first call
import { getTimeZonesAt } from '@leeoniya/easy-tz/08-verified-sharing'; // live values, verified sharing
import { getTimeZonesAt } from '@leeoniya/easy-tz/04-live-intl';        // fully live baseline
```

Full-list results are memoized per UTC hour bucket and returned by reference —
treat them as immutable. The single-zone resolvers aren't memoized and don't
need to be: every `TimeZoneInfo` is an interned, frozen instance shared across
calls, so resolving one zone allocates nothing. Every entry also exports
`clearCache()`, which drops that memo so the next call recomputes (first-call
init/verification work is not redone); it exists for test/bench harnesses and
for recovering from accidental mutation of a returned array.

### Aliases (`withAliases`)

Twenty IANA ids are legacy spellings of another zone — `Asia/Calcutta` for
`Asia/Kolkata`, `America/Buenos_Aires` for `America/Argentina/Buenos_Aires`,
and so on. Runtimes disagree about which spelling they enumerate (Chrome lists
several of the legacy ones, bun lists the modern ones), so the response always
contains **both**, with the legacy entry tagged `aliasOf`. That keeps search
matching on either spelling working, but it puts near-duplicates in a picker.

Passing `withAliases: false` opts out of legacy-spelled results everywhere:

```ts
getTimeZonesAt(ts, false);  // 20 fewer entries — the aliasOf ones are dropped
getTimeZones(false);        // same, at the current instant

// the single-zone getters can't drop anything, so they substitute instead:
// a legacy name resolves as its canonical zone
getTimeZoneAt('Asia/Calcutta', ts, false);
// { name: 'Asia/Kolkata', abbr: 'IST', offset: 330 }
```

No result ever carries an `aliasOf` when the flag is off. Note the asymmetry
the substitution implies: the returned `name` is the canonical spelling, not
the one you passed, so don't use it to key a map by the requested id.
Canonical, unknown and fixed-offset names are unaffected.

Both paths are cheap enough to use freely. Dropping entries doesn't break the
by-reference contract — the filtered array is derived once per hour bucket
alongside the full one and shares its `TimeZoneInfo` instances, so repeat calls
return the same array. And because instances are interned by name,
`getTimeZoneAt('Asia/Calcutta', ts, false)` returns the very same object as
`getTimeZoneAt('Asia/Kolkata', ts)`.
