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
                 # (ESM) + index.d.ts; unminified for readability, built
                 # against the chrome table variant (minified sizes:
                 # `bun run size`)

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
