# timezones-play

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

<pre>
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
</pre>

While swapping a codebase from 295KB `moment` to 68KB `luxon`, I also
wanted to drop the 770KB `moment-timezone` dependency from a time zone picker
component. A
small, fast replacement did not exist for this purpose (see
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
- Bundled data also goes stale silently: wrong offsets after a rule change,
  or "UTC" for zones renamed after the data vintage.

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

| impl | abbr strategy | offset strategy |
|---|---|---|
| `04-live-intl` | `'long'` name -> curated map, initials fallback | derived arithmetically from zone-local wall-clock fields (1 Intl call/zone) |
| `07-baked-rules` | baked into generated year schedule | baked into generated year schedule (zero Intl at runtime) |
| `08-verified-sharing` | same as 04, via rep formatters whose groups are Temporal-verified at first call | same as 04 |
| `10-audited-rules` | baked rule schedule, audited at first call | baked (audited); Temporal-live for recovered zones |

`08-verified-sharing` shares one formatter across zones the generated class
table groups as behavior-identical (188 formatters instead of 445), without
trusting the table: values always come from live Intl, and the groupings are
only a *hint* — at first call each group member's exact offset behavior for the
year is compared against its representative's via Temporal's transition walk
(`getTimeZoneTransition`, no formatters, ~4-5ms once), and diverged members
are split out to format themselves. One-time cost, no per-call overhead.
Without Temporal (Safari, bun, Temporal-less Node builds) it degrades to
exactly impl 04.

`10-audited-rules` is 07's rule schedule with 08's verification pointed at
it: at first call (sound once per process — browsers never hot-swap tzdata)
every zone's current-year behavior predicted by the baked schedule is
audited against Temporal's exact transition walk (~2-5ms, no formatters).
Zones that fail — a policy change in a stale table, unknown zones, irregular
zones outside their generated year — are recovered for the session with live
Temporal offsets and generic GMT-style labels; everything else runs pure
baked at 07's miss cost. Never a wrong offset on Temporal runtimes; without
Temporal it degrades to exactly 07. (It superseded `09-guarded-hybrid`,
which achieved the same protection with a per-call guard and a bundled
live-Intl fallback: ~0.8ms misses and +3.4KB for curated-quality recovery
labels.)

`07-baked-rules` takes that to its logical end: the generator emits
`shared/schedule.ts` — a YEAR-INDEPENDENT schedule fitted by probing three
consecutive years: static states, two-state nth-weekday-of-month rules
("second Sunday of March at 02:00 wall"), and current-year segments for the
few zones whose rules aren't Gregorian (Morocco/Palestine Ramadan rules) —
so a call is pure date math with zero Intl usage, and stays correct across
year boundaries until a country actually changes policy. Regeneration is
needed on tzdata/CLDR changes (and yearly only for the irregular zones).
`tests/schedule.test.ts` asserts output-equality with 04 including
next-year instants; irregular zones clamp outside the generated year.

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

## Layout

- `shared/` — `TimeZoneInfo` type, zone list, Intl helpers, curated
  metazone-name -> abbreviation map, test fixtures
- `impls/NN-*/index.ts` — one directory per implementation attempt;
  `impls/lib-*/index.ts` — wrappers around the third-party comparison
  libraries (registered in `impls/lib-registry.ts`)
- `tools/gen-core.ts` — pure, browser-safe generator core: probes Intl and
  produces the class groupings (impl 08's hints) + the rule schedule (07/10),
  plus an in-runtime verification pass against live Intl
- `tools/gen-classes.ts` — bun CLI: runs the core against bun's own ICU and
  writes the `shared/tables/bun/` variant
- `tools/gen-chrome.ts` — Chrome CLI: bundles the core, evaluates it inside
  chrome-headless-shell (stable), verifies in the same browser session, and
  writes the `shared/tables/chrome/` variant
- `tools/use-tables.ts` (`bun run tables <bun|chrome>`) — instantly switches
  which variant the impls use: `shared/classes.ts` + `shared/schedule.ts`
  are one-line selector re-exports, and both variants coexist on disk
- `tools/emitters.ts` — shared file emitters so both paths produce
  byte-comparable output, stamped with `genMeta` provenance (host + ICU).
  Tables are emitted PACKED (zone-name prefix dictionary, delimited-string
  columns, offsets as signed minutes) and decoded once at module load by
  `shared/decode.ts` — packing cut minified bundles 22-53% since minifiers
  can't compress string contents or object keys
- `tools/audit-abbrs.ts` — audits the curated maps in `shared/abbrs.ts`
  against current CLDR data (drift detection; abbrs themselves are curated
  by hand)
- `comparison.md` — third-party library comparison: 19 candidates
  validated for built-in DST-aware abbreviations, plus correctness/benchmark
  results for the 5 that qualified (see `tools/validate-libs.ts` and the
  informational section of `bun run test`)
- `.cursor/skills/maintain-curated-tz-data/` — agent skill documenting the
  review workflow for the hand-curated files (`shared/abbrs.ts`,
  `shared/zoneLinks.ts`, `shared/fixtures.ts`), watermarked with
  `curation-reviewed:` headers so reviews only scan upstream changes since
  the last pass
- `impls/registry.ts` — list of all impls consumed by tests and the benchmark
  (`impls/lib-registry.ts` holds the comparison-library wrappers)
- `tests/dst.test.ts` — DST boundary tests (`bun test`)
- `bench/bench.ts` — bun performance pass (cold/hit/miss, formatters, rss)
  across all impls + libraries; correctness lives in the test suites

## Running

Requires bun (used for its speed, built-in test runner, and native TS
execution) and typescript 7 (native compiler) for type checking, plus
`@types/bun` / `@types/node` for the test/bench tooling types; bundling and
minification (size assessment, browser-harness bundles) use bun's native
`Bun.build`. The implementations themselves have zero dependencies.

Chrome (headless shell) is the primary generation and benchmarking target;
bun runs transparently underneath as the tool host, the fast test runner,
and the proxy for the no-Temporal (Safari) fallback paths — there are no
separate per-runtime commands to remember.

```sh
bun install --ignore-scripts
bun run browsers:install  # one-time ~100MB chrome-headless-shell download

bun run check    # tsc --noEmit (typescript 7)
bun run test     # ALL correctness: bun unit suite (fast, also covers the
                 # no-Temporal/Safari fallback paths) + chrome correctness
                 # (fixtures, letter abbrs, vs-04 equivalence, incl. "(no-T)"
                 # Safari-fallback rows via deleted Temporal global)
bun run test:tz  # same suite under TZ=UTC, America/Chicago, Pacific/Kiritimati
bun run gen      # regenerate ALL tables: chrome variant (primary, verified
                 # in-browser — the shippable artifact) + bun variant
                 # (supplementary, keeps the local suite fully covered)
bun run bench    # PERFORMANCE ONLY: chrome benchmark (primary) +
                 # supplementary bun pass (whose numbers double as the
                 # Safari-fallback perf proxy). correctness incl. the
                 # no-Temporal fallback paths lives in `bun run test`
bun run size     # minified bundle size per impl (Bun.build, minified)
bun run mem      # memory: fresh subprocess per impl, median of 5 runs,
                 # phase deltas (import / first call / +25 misses) and a
                 # JS-heap vs native (~ICU) split via bun:jsc heapStats
bun run audit    # check shared/abbrs.ts curated maps against current CLDR
bun run build    # shippable bundles per impl into dist/<impl>/: index.mjs
                 # (ESM) + index.iife.js (IIFE installing a global
                 # getTimeZonesAt, with clearCache attached as a property);
                 # unminified for readability, built against the chrome
                 # table variant (minified sizes: `bun run size`)

bun run tables <bun|chrome>  # (plumbing) switch the active table variant;
                             # gen leaves it on bun for local dev, and the
                             # chrome bench flips/restores it automatically
```

Chrome bench notes: it always bundles against the Chrome table variant
(temporarily flipping the selector and restoring it); Chrome coarsens
`performance.now()` to ~100µs, so
cache hits are timed as a 50k-call aggregate and sub-0.1ms misses read as 0;
the JS heap column excludes ICU's native formatter memory, so a
`renderer rss MB` column (Linux `/proc` scan of the renderer process)
captures the native side. RSS deltas approximate peak allocation — freed
pages aren't returned to the OS — so treat them comparatively.

Generated tables carry `genMeta` provenance (generating host + ICU version).
The live-Intl equivalence tests skip with a warning when the executing
runtime doesn't match the tables' provenance — Chrome-generated tables are
instead verified inside the browser during `gen` itself (~195k checks per
run). Notable: bun 1.4 (ICU 75) and Chrome 150 (newer ICU) genuinely
disagree — different zone lists (445 vs 418; Chrome enumerates legacy names
like `Asia/Calcutta`/`Europe/Kiev` and omits `Etc/GMT±n`), different tzdata
(bun's predates Paraguay's 2024 move to permanent -03), and different CLDR
metazone names — so cross-runtime equivalence testing would report pure
noise, which is exactly what the provenance gate prevents.
