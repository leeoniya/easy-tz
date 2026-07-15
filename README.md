# timezones-play

Experiments in implementing a fast, dependency-free `getTimeZonesAt(timestamp)`:

```ts
interface TimeZoneInfo {
  name: string;   // "America/New_York"
  abbr: string;   // "EST" / "EDT" (not "GMT-5" where avoidable)
  offset: string; // "-05:00"
}

function getTimeZonesAt(timestamp: number): TimeZoneInfo[];
```

Scope: current-year accuracy in modern runtimes; results are independent of
the host timezone (`TZ`). Historical tzdata accuracy is a non-goal.

## Layout

- `shared/` — `TimeZoneInfo` type, zone list, Intl helpers, curated
  metazone-name -> abbreviation map, test fixtures
- `impls/NN-*/index.ts` — one directory per implementation attempt
- `tools/gen-core.ts` — pure, browser-safe generator core: probes Intl and
  produces the class groupings (impl 08's hints) + the rule schedule (07/09),
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
- `comparison.md` — third-party library comparison: 13 candidates
  validated for built-in DST-aware abbreviations, plus correctness/benchmark
  results for the 5 that qualified (see `tools/validate-libs.ts` and the
  informational section of `bun run test`)
- `.cursor/skills/maintain-curated-tz-data/` — agent skill documenting the
  review workflow for the hand-curated files (`shared/abbrs.ts`,
  `shared/zoneLinks.ts`, `shared/fixtures.ts`), watermarked with
  `curation-reviewed:` headers so reviews only scan upstream changes since
  the last pass
- `impls/registry.ts` — list of all impls consumed by tests and the benchmark
- `tests/dst.test.ts` — DST boundary tests (`bun test`)
- `bench/bench.ts` — validation + benchmark summary across all impls

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
Residual risk: a CLDR metazone rename without an offset change passes offset
verification (rare; regenerating tables fixes it). The Chrome bench reports
its init stats and asserts deep output-equality with 04 in-browser.

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

All impls memoize the full response per UTC hour bucket
(`shared/hourCache.ts`): a single global
slot keeps the last bucket's result and is refreshed whenever a timestamp
falls outside it, so only same-bucket repeats hit — suited to clock-driven
queries near "now". The underlying compute always runs at the bucket start,
so DST transitions (hour-aligned in UTC for nearly all zones) resolve
deterministically at bucket boundaries. Cache hits return the same array
reference — treat results as immutable. Hits cost ~0.2µs vs ~1-4ms for a
miss; `tests/cache.test.ts` benches hit and miss loops separately for every
impl.

(Earlier attempts — raw `timeZoneName: 'short'`, uncorrected long-name
initials, a two-formatters-per-zone variant, a standalone hour-cache
wrapper, and `06-class-reps` (trusted formatter sharing, superseded by 08's
verified sharing at near-identical speed) — were evaluated and removed; the
numbering of the survivors is kept. Their useful parts live on as the
initials fallback, the test suite's Intl `'longOffset'` oracle,
`shared/hourCache.ts`, and the class table now consumed by 08.)

Why not just `timeZoneName: 'short'`? CLDR only defines short abbreviations
for a handful of metazones in the `en` locale (mostly North America, 113 of
445 zones); the rest come back as `GMT+3`.

Why a curated map? Initials of the long name ("Eastern European Summer Time"
-> EEST) work for ~80% of metazones but break where the convention drops words
(Eastern European **Standard** Time -> EET, Moscow Standard Time -> MSK,
West Africa Standard Time -> WAT). The map in `shared/abbrs.ts` (~1.5KB)
covers every CLDR metazone where initials are wrong; initials remain the
fallback for unmapped names.

Zones with no CLDR metazone at all (Etc/GMT±n, Asia/Urumqi, Europe/Astrakhan,
...) mostly use numeric abbreviations in modern tzdata too, so they fall back
to a compact `GMT+3` form; a few exceptions are special-cased
(`Europe/Guernsey` et al. alias `Europe/London`, `Europe/Istanbul` -> TRT).

The impl caches one `Intl.DateTimeFormat` per zone — constructing formatters
is ~100x more expensive than calling `format()`, so the first call pays
~50-60ms for ~445 zones and warm calls take single-digit milliseconds.

The class table (`shared/classes.ts`) encodes the fact that only 188
distinct (long name, offset) behaviors exist across the 445 zones in the
current year. It's generated by `bun run gen`
(probing every zone daily, binary-searching transition instants to 15-minute
resolution) and consumed by impl 08 as verified grouping hints. **Generated
tables must be regenerated when tzdata/CLDR changes or the year rolls
over**; `tests/classes.test.ts` validates the table's groups against live
Intl across the year and around every 2026 transition.

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
instead verified inside the browser during `gen` itself (~90k checks per
run). Notable: bun 1.4 (ICU 75) and Chrome 150 (newer ICU) genuinely
disagree — different zone lists (445 vs 418; Chrome enumerates legacy names
like `Asia/Calcutta`/`Europe/Kiev` and omits `Etc/GMT±n`), different tzdata
(bun's predates Paraguay's 2024 move to permanent -03), and different CLDR
metazone names — so cross-runtime equivalence testing would report pure
noise, which is exactly what the provenance gate prevents.
