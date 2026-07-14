# Summary: `getTimeZonesAt()` implementation experiments

_updated 2026-07-13 — bun 1.4.0, chrome-headless-shell 150, typescript 7.0.2_

Four retained implementations of `getTimeZonesAt(timestamp)` spanning a
live-to-baked trust spectrum, a two-stage test suite (151 bun tests + an
in-Chrome correctness stage), and unified generation/benchmark tooling.
Implementations have zero runtime dependencies; devDependencies
(`typescript`, `@types/*`, `puppeteer-core`, `@puppeteer/browsers`)
are installed with `--ignore-scripts`. Chrome (headless shell) is the primary
generation/benchmark target; bun runs transparently as tool host, fast test
runner, and no-Temporal (Safari) fallback proxy.

## Key findings

- `Intl.DateTimeFormat` alone can't give real abbreviations — `en` CLDR only
  has letter abbreviations for ~113 of 445 zones with `timeZoneName:'short'`.
  Fix: derive initials from the `'long'` name and correct the exceptions
  (EET, MSK, WAT, …) with a ~1.5KB curated map (`shared/abbrs.ts`).
- Formatter construction dominates runtime cost (~100x a `format()` call).
  The optimization ladder: cache per zone → share across verified
  behavior-identical groups → bake everything and use no Intl at all.
- DST transitions are expressible as year-independent nth-weekday rules for
  every zone on earth except religious-calendar rules (Morocco, Palestine —
  4 zones). Probing 3 consecutive years lets the generator fit these rules,
  making baked tables survive year rollover.
- Temporal (Chrome/Firefox, not Safari/bun) enables cheap exactness: offset
  queries without formatters, and exact transition-walk verification of
  grouping hints (~2-5ms for all zones).
- Runtimes genuinely disagree: bun (ICU 75) vs Chrome 150 differ in zone
  count (445 vs 418), canonical spellings (`Asia/Kolkata` vs `Asia/Calcutta`
  — bridged by `shared/zoneLinks.ts`), tzdata vintage, and CLDR names.
  Tables must be generated inside the target runtime; provenance (`genMeta`)
  gates which tests may compare them against live Intl.

## Current implementations

All memoize the full response per UTC hour bucket (`shared/hourCache.ts`);
results are shared arrays — treat as immutable. Chrome numbers:

| impl | staleness risk | cold | miss | rss | bundle |
|---|---|---|---|---|---|
| `04-live-intl` | none — always live | ~65ms (~130x) | ~2.6ms | +26MB | 6.0KB |
| `08-verified-sharing` | near-none (rename corner) | ~35ms (~70x) | ~1.1ms | +19MB | 10.2KB |
| `09-guarded-hybrid` | near-none (stale goes live) | ~2ms (~4x) | ~0.7ms | +9MB | 14.8KB |
| `07-baked-rules` | low: few zones/yr until regen | ~0.5ms (1x) | ~0.05ms | +6MB | 10.1KB |

- **04-live-intl** — everything from live Intl (one formatter + one
  `formatToParts` per zone, arithmetic offsets). The baseline, the test
  oracle, and the only impl needing no generated data. Runs anywhere.
- **08-verified-sharing** — live values through formatters shared across
  zone groups whose equivalence is PROVEN at first call via Temporal's
  transition walk (~2-5ms); diverged groups split and self-heal. Re-verifies
  for whatever year it runs in. Without Temporal: identical to 04.
- **09-guarded-hybrid** — baked labels (rule schedule) + live Temporal
  offsets, with a per-call coherence guard: any zone whose baked offset
  disagrees with the live one falls back to live Intl. Never wrong about
  time; staleness degrades cost, not correctness. Zone-name skew bridged;
  unknown zones go live. Without Temporal: identical to 04.
- **07-baked-rules** — zero Intl: static states + nth-weekday rules resolved
  by pure date math (irregular zones clamp outside the generated year).
  Fastest and leanest; wrong (coherently) for affected zones between a
  policy change and regeneration+redeploy. Zone-name skew bridged; unknown
  zones return a UTC sentinel.

The trust/perf asymmetry is the headline: 04→07 buys ~130x cold start while
risk moves only from "none" to "low and bounded" (~1-4 tzdata events/year ×
1-3 zones, window = regen cadence; see next section).

Removed attempts (naive `'short'` names, uncorrected initials,
two-formatters-per-zone, standalone hour-cache, trusted-sharing
`06-class-reps`) live on as the initials fallback, the `longOffset` oracle,
`shared/hourCache.ts`, and 08's class-group hints.

## tzdata change frequency and staleness exposure

From the IANA release history: ~5 releases/year over the last decade,
trending to 2-4/year; the dangerous subset — a country changing rules
*within the current year* — runs at **~1-4 events/year touching 1-3 zones**
(2026: Alberta permanent −06, Morocco permanent +00; 2024: Kazakhstan,
Paraguay; 2023: Egypt, Lebanon with days of notice; 2022 worst: Jordan,
Syria, Mexico, Iran, Chile, Fiji). Notice can be negative: Alberta's change
took effect Jun 18 but tzdata 2026c landed Jul 8 — even live-Intl impls were
wrong ~3 weeks because upstream lagged.

Exposure once the runtime's ICU picks up a change: 04 self-heals; 08
self-heals (verification splits diverged groups); 09's offsets self-heal and
stale labels demote to live formatting; 07 is wrong for affected zones until
regenerated. Year rollover is a non-event for all four (rules hold; only the
4 irregular zones need the January regen). The equivalence tests and the
in-Chrome vs-04 sweeps are the tripwire that makes table staleness loud.

## Tooling (unified; bun runs underneath transparently)

- `bun run gen` — regenerates BOTH table variants: Chrome-aligned (primary,
  verified in-browser, ~195k checks over 3 probed years — the shippable
  artifact) and bun-aligned (keeps the local suite fully covered). ~2.5s per
  variant. Required on tzdata/CLDR changes; January matters only for the 4
  irregular zones.
- `bun run test` — 151 bun tests (DST boundaries, oracle, cache semantics,
  cross-variant zone-name bridge, next-year rule correctness) + the Chrome
  stage: fixtures, letter-abbr coverage, vs-04 deep equality (8,360 checks ×
  5 including no-Temporal Safari-fallback pages), and 2027 rollover checks
  for 07/09.
- `bun run bench` — performance only: Chrome table (cold/hit/miss,
  formatter counts, renderer RSS, bundle KB) + supplementary bun pass
  (Safari-fallback proxy) + the feature comparison matrix.
- `bun run size` / `bun run mem` — bundle sizes; phase-split memory with
  JS-heap vs native (~ICU) attribution.
- `bun run audit` — curated-map drift detection against current CLDR.
- `bun run tables <bun|chrome>` — (plumbing) switch the active variant.
- Curated files (`shared/abbrs.ts`, `shared/zoneLinks.ts`,
  `shared/fixtures.ts`) carry `curation-reviewed` watermarks; the agent
  skill `.cursor/skills/maintain-curated-tz-data/` documents the review
  workflow driven by IANA NEWS diffs since the watermark.

## Verification snapshot

`bun run check` clean; 151/151 bun tests under TZ=UTC / America/Chicago /
Pacific/Kiritimati; Chrome stage all green including rollover (09:
1672/1672, 07: 1656/1656 vs live 04 at 2027 instants); generator
self-verification 0 mismatches across all probed years in both runtimes.
