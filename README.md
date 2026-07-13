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
  produces the class groupings (impl 06) + resolved year schedule (impl 07),
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
  columns, abbr dictionary with base36 indices, offsets as signed minutes in
  a separate `offsets.ts` so impl 09 doesn't bundle them) and decoded once
  at module load by `shared/decode.ts` — this cut minified bundles 22-53%
  (07: 18.8 -> 8.8KB, 09: 21.9 -> 13.4KB) since minifiers can't compress
  string contents or object keys
- `tools/audit-abbrs.ts` — audits the curated maps in `shared/abbrs.ts`
  against current CLDR data (drift detection; abbrs themselves are curated
  by hand)
- `impls/registry.ts` — list of all impls consumed by tests and the benchmark
- `tests/dst.test.ts` — DST boundary tests (`bun test`)
- `bench/bench.ts` — validation + benchmark summary across all impls

## Implementations

| impl | abbr strategy | offset strategy |
|---|---|---|
| `04-intl-single-fmt` | `'long'` name -> curated map, initials fallback | derived arithmetically from zone-local wall-clock fields (1 Intl call/zone) |
| `07-precomputed` | baked into generated year schedule | baked into generated year schedule (zero Intl at runtime) |
| `08-verified-reps` | same as 04, via rep formatters whose groups are Temporal-verified at first call | same as 04 |
| `09-live-offsets` | baked from generated schedule table | live via Temporal (never stale, zero formatters) |

`08-verified-reps` shares one formatter across zones the generated class
table groups as behavior-identical (188 formatters instead of 445), without
trusting the table: values always come from live Intl, and the groupings are
only a *hint* — at first call each group member's exact offset behavior for the
year is compared against its representative's via Temporal's transition walk
(`getTimeZoneTransition`, no formatters, ~4-5ms once), and diverged members
are split out to format themselves. One-time cost, no per-call overhead.
Without Temporal (Safari, bun, node 26) it degrades to exactly impl 04.
Residual risk: a CLDR metazone rename without an offset change passes offset
verification (rare; regenerating tables fixes it). `bench:chrome` reports
its init stats and asserts deep output-equality with 04 in-browser.

`09-live-offsets` ("07 with live offsets") inverts 08's trade: abbreviations
come baked from the schedule table (segment-resolved by date), but offsets
come live from Temporal — zero formatters on the fast path, ~2ms cold start,
and it can never report a wrong TIME in any Temporal-capable browser no
matter how stale the table. Zone-name canonicalization skew across runtimes
(Chrome's `Asia/Calcutta` vs bun's `Asia/Kolkata`) is bridged by the ~0.5KB
tzdata-links map in `shared/zoneLinks.ts`; zones missing from the table even
after bridging (e.g. genuinely new zones like `America/Coyhaique`) and
non-Temporal runtimes (Safari) fall back to live Intl formatting (04's
path). Residual risk: under tzdata skew the label can go stale while the
offset stays correct ("MST" next to a correct "-06:00").

All impls memoize the full response per UTC hour bucket
(`shared/hourCache.ts`): a single global
slot keeps the last bucket's result and is refreshed whenever a timestamp
falls outside it, so only same-bucket repeats hit — suited to clock-driven
queries near "now". The underlying compute always runs at the bucket start,
so DST transitions (hour-aligned in UTC for nearly all zones) resolve
deterministically at bucket boundaries. Cache hits return the same array
reference — treat results as immutable. Hits cost ~0.2µs vs ~1-4ms for a
miss; `tests/cache.test.ts` benches hit and miss loops separately for both
impls.

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
current year. It's generated by `bun run gen` / `bun run gen:chrome`
(probing every zone daily, binary-searching transition instants to 15-minute
resolution) and consumed by impl 08 as verified grouping hints. **Generated
tables must be regenerated when tzdata/CLDR changes or the year rolls
over**; `tests/classes.test.ts` validates the table's groups against live
Intl across the year and around every 2026 transition.

`07-precomputed` takes that to its logical end: the generator also emits
`shared/schedule.ts` — every class's (abbr, offset) segments with transition
instants for the whole year — so a call is pure data lookup with zero Intl
usage. Cold start ~0.7ms, miss ~0.03ms, ~2MB RSS (vs ~63ms / ~4ms / ~50MB
for 04), at ~20KB minified. Same regeneration caveat as 06, but stronger:
abbrs/offsets themselves are baked in, not just groupings.
`tests/schedule.test.ts` asserts output-equality with 04. Out-of-year
timestamps clamp to the year's first/last segment.

## Running

Requires bun (used for its speed, built-in test runner, and native TS
execution) and typescript 7 (native compiler) for type checking, plus
`@types/bun` / `@types/node` for the test/bench tooling types and `@swc/core`
for the bundle size assessment. The implementations themselves have zero
dependencies.

```sh
bun install --ignore-scripts

bun run check    # tsc --noEmit (typescript 7)
bun test         # DST boundary + consistency tests
bun run test:tz  # same suite under TZ=UTC, America/Chicago, Pacific/Kiritimati
bun run bench    # validation + perf summary of all impls, 25 iterations each
bun run size     # minified bundle size per impl (swc bundle + minify)
bun run mem      # memory: fresh subprocess per impl, median of 5 runs,
                 # phase deltas (import / first call / +25 misses) and a
                 # JS-heap vs native (~ICU) split via bun:jsc heapStats
bun run gen      # regenerate shared/tables/bun/ against bun's ICU
bun run audit    # check shared/abbrs.ts curated maps against current CLDR

# Chrome-aligned tables (the artifacts you'd ship for Chrome-stable scope):
bun run browsers:install  # one-time ~100MB chrome-headless-shell download
bun run gen:chrome        # regenerate shared/tables/chrome/ + verify in Chrome
bun run bench:chrome      # CPU bench inside stable Chrome (fresh page per impl)

bun run tables <bun|chrome>  # switch the active table variant (instant; no
                             # re-probing). generators only write their own
                             # variant and never change the active selection
```

`bench:chrome` always bundles against the Chrome variant (temporarily
flipping the selector and restoring it), and `bench` warns if the active
variant isn't bun-generated — so neither benchmark requires manual swapping.

`bench:chrome` notes: run `gen:chrome` first so table-based impls bench
against aligned data; Chrome coarsens `performance.now()` to ~100µs, so
cache hits are timed as a 50k-call aggregate and sub-0.1ms misses read as 0;
the JS heap column excludes ICU's native formatter memory, so a
`renderer rss MB` column (Linux `/proc` scan of the renderer process)
captures the native side. RSS deltas approximate peak allocation — freed
pages aren't returned to the OS — so treat them comparatively.

Generated tables carry `genMeta` provenance (generating host + ICU version).
The live-Intl equivalence tests skip with a warning when the executing
runtime doesn't match the tables' provenance — Chrome-generated tables are
instead verified inside the browser by `gen:chrome` itself (~90k checks per
run). Notable: bun 1.4 (ICU 75) and Chrome 150 (newer ICU) genuinely
disagree — different zone lists (445 vs 418; Chrome enumerates legacy names
like `Asia/Calcutta`/`Europe/Kiev` and omits `Etc/GMT±n`), different tzdata
(bun's predates Paraguay's 2024 move to permanent -03), and different CLDR
metazone names — so cross-runtime equivalence testing would report pure
noise, which is exactly what the provenance gate prevents.
