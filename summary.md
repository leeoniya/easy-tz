# Summary: `getTimeZonesAt()` implementation experiments

_2026-07-12 — bun 1.4.0, typescript 7.0.2, 445 IANA zones_

The project contains three retained implementations of `getTimeZonesAt(timestamp)`, a DST/equivalence test suite (114 tests), and validation, benchmark, bundle-size, and audit tooling. The implementations have zero runtime dependencies; devDependencies (`typescript` for type checking, `@types/bun`/`@types/node` for tooling types, `@swc/core` for the size assessment) were installed with `--ignore-scripts`. Bun is the runtime since it runs TS natively and has a built-in test runner.

## Key findings

- `Intl.DateTimeFormat` alone can't give you real abbreviations — with `timeZoneName: 'short'` the `en` CLDR data only has letter abbreviations for ~113 of 445 zones (mostly North America); everything else comes back as `GMT+3`. The working approach: take the `'long'` name ("Eastern European Summer Time"), derive initials, and correct the cases where the convention breaks (EET, MSK, WAT, …) with a ~1.5KB curated map (`shared/abbrs.ts`). No dependency needed.
- Formatter construction dominates all runtime cost (~100x more expensive than `format()`), so the optimization ladder is: cache formatters per zone → share formatters across behavior-identical zones (only 188 distinct behaviors exist in 2026) → precompute the whole year at build time and use no Intl at all.
- The 43 zones without letter abbreviations (`Etc/GMT±n`, `Asia/Urumqi`, Russian oblast zones, …) genuinely use numeric abbreviations in modern tzdata too, so they fall back to a compact `GMT+3` form; `Europe/Istanbul` → TRT and the Channel Islands → `Europe/London` are special-cased.

## Current implementations

All three memoize the full response per UTC hour bucket in a single global slot (`shared/hourCache.ts`): compute runs at the bucket start, hits return the shared array (treat as immutable), and only same-bucket repeats hit.

| impl | strategy | cold | hit median | miss mean | RSS (1st call + 25 misses) | minified |
|---|---|---|---|---|---|---|
| `04-intl-single-fmt` | one cached formatter + one `formatToParts` per zone; offset derived arithmetically from wall-clock fields | ~63ms | 0.3µs | ~4.0ms | +51MB | 5,100 B |
| `06-class-reps` | 04, but zones with identical (long name, offset) behavior share one representative formatter and parse result, via generated `shared/classes.ts` (445 zones → 188 classes) | ~29ms | 0.1µs | ~1.2ms | +24MB | 11,321 B |
| `07-precomputed` | zero Intl: the whole year's (abbr, offset) segments are baked into generated `shared/schedule.ts` (185 classes, 253 segments); a call is a segment lookup | ~0.7ms | 0.1µs | ~0.03ms | +2.4MB | 20,264 B |

All three: 26/26 fixtures, 402/445 letter abbreviations. The spectrum is bundle size vs runtime cost vs trust: 04 is smallest and needs no generated data; 06 needs the class groupings regenerated on tzdata/CLDR changes; 07 is fastest and leanest at runtime but bakes abbrs/offsets themselves into the bundle, so stale data means wrong (not just slow) results. See "tzdata change frequency" below for how often that trust is tested in practice.

Earlier attempts (naive `timeZoneName: 'short'`, uncorrected long-name initials, a two-formatters-per-zone variant, and a standalone hour-cache wrapper) were evaluated and removed; their useful parts live on as the initials fallback, the test-suite `longOffset` oracle, and `shared/hourCache.ts`.

## tzdata change frequency and staleness exposure

How often does tzdata actually change in ways that would invalidate the
generated tables? From the IANA release history (as of 2026-07-12):

- Overall cadence: ~5 releases/year over the last decade (2015: 7, 2016: 10,
  2017: 3, 2018: 9, 2019: 3, 2020: 6, 2021: 5, 2022: 7, 2023: 4, 2024: 2,
  2025: 3, 2026: 3 so far), trending toward 2-4/year. Most releases only
  touch historical data or future years.
- The dangerous subset — a country changing its offset/DST rules *within the
  current year* — has run at **~1-4 events/year, each touching 1-3 zones**:
  2026: Alberta permanent −06 (eff. Jun 18), Morocco permanent +00 (eff.
  Sep 20); 2024: Kazakhstan +05, Paraguay permanent DST; 2023: Egypt DST
  reintroduction (~1 month notice), Lebanon reversal (*days* of notice);
  2022 (worst recent year): Jordan, Syria, Mexico, Iran, Chile, Fiji.
- Notice can be negative: Alberta's change took effect Jun 18 but the tzdata
  release documenting it (2026c) landed Jul 8 — even live-Intl impls were
  wrong for ~3 weeks because upstream data itself lagged.

Exposure per impl once the runtime's ICU picks up a change:

- **04** — fully self-healing; no generated data. In browsers, end users'
  evergreen ICU updates apply automatically.
- **06** — values self-heal (live Intl); only the *groupings* are frozen. A
  change is harmless when it moves a whole group together (Morocco:
  Casablanca + El_Aaiun share a class) but poisonous when a zone diverges
  from its group: Edmonton is grouped with Boise/Denver/etc., so with a
  stale table it would report MST −07:00 after Nov 1 when Alberta is really
  CST −06:00 — a silently wrong offset.
- **07** — everything is baked; every affected zone is wrong (values
  included) until regenerated and redeployed. Also has a guaranteed annual
  staleness event at year rollover (clamping holds only until the new
  year's first transition, ~mid-February at the earliest).

The equivalence tests (`tests/classes.test.ts`, `tests/schedule.test.ts`)
are the tripwire: they compare 06/07 against live-Intl 04, so an ICU update
that invalidates the tables fails the suite loudly (the 2026c release, four
days before this was written, will do exactly that for Edmonton once this
runtime's ICU catches up — the 2026 tables generated today already bake in
the outdated Alberta and Morocco rules).

> **Update 6 (2026-07-13):** the implementation set has evolved well beyond
> the table above — see README.md and `bun run bench` / `bench:chrome` for
> current standings. Notable: `08-verified-reps` (formatter sharing with
> Temporal-verified grouping hints) superseded and replaced `06-class-reps`
> (same speed, verified instead of trusted); `09-live-offsets` (baked abbrs
> + live Temporal offsets) joined as the portable middle ground; generated
> tables are packed (22-53% smaller minified) and dual-variant
> (bun/Chrome, switchable via `bun run tables`).

## Tooling

- `bun run gen` — regenerates `shared/classes.ts` + `shared/schedule.ts` by probing every zone daily across the current year and binary-searching transitions to 15-min resolution (~1s). **Required on tzdata/CLDR changes and year rollover.**
- `bun run audit` — checks the curated maps in `shared/abbrs.ts` against current CLDR: errors on diverged zone aliases (exit 1), warns on new initials-resolved long names and stale override entries, lists GMT-fallback zones.
- `bun run bench` — fixtures validation + cold (fresh subprocess) / cache-hit loop / cache-miss loop timings per impl, 25 iterations.
- `bun run size` — minified bundle size per impl (swc bundle + minify, no gzip).

## Chrome-aligned generation (scoped reliability)

For the "reliable in latest stable Chrome" scope, tables are generated
*inside* chrome-headless-shell so alignment with Chrome's ICU is guaranteed
by construction: `bun run gen:chrome` bundles the generator core (swc),
evaluates it in the browser (puppeteer-core), verifies both tables against
that same browser's live Intl (~90k checks), and writes the files with
Chrome provenance. `bun run gen` remains the bun-aligned path for local dev.

Key mechanics:

- Generated files export `genMeta` (host + ICU version). Live-Intl
  equivalence tests skip with a warning when the executing runtime doesn't
  match — preventing spurious failures — while Chrome tables get their
  verification in-browser during generation.
- The bun (ICU 75) vs Chrome 150 diff is real and material: 445 vs 418
  enumerated zones (Chrome uses legacy canonical names like `Asia/Calcutta`
  and omits `Etc/GMT±n`), newer tzdata (bun's misses Paraguay's 2024 move to
  permanent -03: bun says PYST/PYT with transitions, Chrome says PYT -03:00
  year-round), and CLDR name changes (`West Kazakhstan Time` -> unified
  Kazakhstan metazone).
- Impl 06 tolerates cross-runtime tables: representatives are re-picked at
  module load from group members the current runtime actually enumerates.
  Impl 07 falls back to UTC for table-unknown zones (tripwire, not silent).

## Verification

- `bun run check` — `tsc` (TS 7) type-checks clean.
- `bun test` — 114 tests pass: 1-minute-before/after checks at both 2026 US and EU transitions, Egypt DST (Cairo EET/EEST), southern-hemisphere Sydney (AEDT in January), half-hour-offset Kolkata, an Intl `'longOffset'` oracle validating every zone's offset, deep output-equality of 06 and 07 against 04 across the year and around every 2026 transition, and hour-bucket cache behavior/perf (hit vs miss loops) for all impls.
- `bun run test:tz` — the full suite passes identically under `TZ=UTC`, `TZ=America/Chicago`, and `TZ=Pacific/Kiritimati`, confirming host-timezone independence.
