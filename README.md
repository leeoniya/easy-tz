# easy-tz

Experiments in implementing a fast, dependency-free `getTimeZonesAt(timestamp)`. Scope: current-year accuracy in modern runtimes; results are independent of
the host timezone (`TZ`). Historical tzdata accuracy is a non-goal.

```ts
function getTimeZonesAt(timestamp: number): TimeZoneInfo[];

interface TimeZoneInfo {
  name: string;     // "America/New_York"
  abbr: string;     // "EST" / "EDT" (not "GMT-5" where avoidable)
  offset: string;   // "-05:00"
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
  0.3-1.8 MB minified — carrying deep historical transition data this use
  case doesn't need.

My [first attempt](https://github.com/leeoniya/timezones) split the
difference with a generated offset→abbreviation lookup plus live Intl
offsets. The implementations here further explore the full live-to-baked spectrum,
ending in `07-baked-rules`: vs moment-timezone it cuts cold start ~80x
(24.8ms → 0.3ms) and memory ~3x (22MB → 6.5MB) at ~1.3% of the bundle size
(773.5KB → 10.2KB), while passing all 62 edge-case fixtures and improving
abbreviation coverage for 159 zones where modern tzdata dropped letter
abbreviations (Santiago CLT/CLST, Kathmandu NPT, Chatham CHAST/CHADT,
Kiritimati LINT, Lord Howe LHST/LHDT, Istanbul TRT, …).

## Implementations

Ordered fastest to slowest — which is also most-baked to most-live: each
step down trusts the generated data less (adding runtime rigor and cost),
until `04-live-intl` ships no generated data at all.

| impl | trust model | cold ms | miss ms | rss MB | bundle KB |
|---|---|--:|--:|--:|--:|
| `07-baked-rules` | trusts baked tables completely | 0.3 | <0.1 | 6.5 | 10.2 |
| `10-audited-rules` | baked tables, Temporal-audited at first call; failing zones recovered live | 2.3 | <0.1 | 7.4 | 11.7 |
| `08-verified-sharing` | live Intl values; baked data only hints formatter sharing, Temporal-verified at first call | 22.2 | 0.6 | 18.4 | 10.6 |
| `04-live-intl` | fully live — no generated data to trust | 38.9 | 1.4 | 25.6 | 6.3 |

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
table is demoted to a *hint* about which zones can share one formatter (188
formatters instead of 445, cutting 04's cold start roughly in half). At
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

All impls memoize the full response per UTC hour bucket
(`shared/hourCache.ts`): a single global
slot keeps the last bucket's result and is refreshed whenever a timestamp
falls outside it, so only same-bucket repeats hit — suited to clock-driven
queries near "now". The underlying compute always runs at the bucket start,
so DST transitions (hour-aligned in UTC for nearly all zones) resolve
deterministically at bucket boundaries. Cache hits return the same array
reference — treat results as immutable. Hits cost ~0.1-0.3µs vs a miss's
~1-4ms (live impls) or ~0.05-0.1ms (baked impls); `tests/cache.test.ts`
benches hit and miss loops separately for every impl.

</details>

## Install

```sh
npm install @leeoniya/easy-tz
```

## Usage

```ts
import { getTimeZonesAt } from '@leeoniya/easy-tz';

const zones = getTimeZonesAt(Date.now());
// [
//   { name: 'Africa/Abidjan',     abbr: 'GMT', offset: '+00:00' },
//   ...
//   { name: 'America/New_York',   abbr: 'EDT', offset: '-04:00' },
//   ...
// ] — every IANA zone the runtime knows, sorted by name
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

Results are memoized per UTC hour bucket and returned by reference — treat
them as immutable. Every entry also exports `clearCache()`, which drops
that memo so the next call recomputes (first-call init/verification work is
not redone); it exists for test/bench harnesses and for recovering from
accidental mutation of a returned array.
