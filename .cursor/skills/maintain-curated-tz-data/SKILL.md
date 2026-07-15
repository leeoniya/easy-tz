---
name: maintain-curated-tz-data
description: >-
  Maintain the hand-curated timezone data files in this repo that no script
  can regenerate: abbreviation overrides, zone aliases, zone-name link pairs,
  and DST test fixtures. Use when tzdata/CLDR/ICU updates land, when the
  audit or equivalence tests report drift, when a bench "vs 04" column or
  "healed" count is nonzero, or when the user asks to review/update curated
  maps, abbreviations, aliases, links, or fixtures.
---

# Maintaining Curated Timezone Data

Generated tables (`shared/tables/*`, via `bun run gen` — regenerates both the chrome and bun variants) are
deterministic. Three files are NOT — they encode human judgment and must be
reviewed when upstream data changes:

| file | manual content |
|---|---|
| `shared/abbrs.ts` | `abbrOverrides` (CLDR long name → common abbr where the initials heuristic is wrong, e.g. "Eastern European Standard Time" → EET); `zoneAliases` (no-metazone zones borrowing a behavior-identical reference zone, e.g. Channel Islands → Europe/London); `zoneAbbrOverrides` (zone-level abbrs with no CLDR metazone at all, e.g. Europe/Istanbul → TRT) |
| `shared/zoneLinks.ts` | `zoneLinkPairs` as `[canonical, alias]` — tzdata backward-link spelling variants (Asia/Kolkata ↔ Asia/Calcutta). Direction matters: `aliasOf` metadata and picker dedupe rely on element 0 being the modern canonical id |
| `shared/fixtures.ts` | expected abbr/offset values at specific 2026 instants; expectations legitimately go stale (tests fail) when countries change rules mid-year |

All three files carry a `curation-reviewed:` header watermark (date + data
versions reviewed through). Update it as the last step of every review.

## Step 1: Reduce the search space — what changed since the watermark?

Do NOT re-derive the whole dataset. Only inspect changes newer than the
watermark in the file headers.

1. Read the watermarks in `shared/abbrs.ts` and `shared/zoneLinks.ts`.
2. Current runtime data versions:
   - `node -p "process.versions"` → `tz`, `cldr`, `icu`
   - `bun -e "console.log(process.versions.icu)"` (bun lags; tables track it)
   - Chrome version: `genMeta` in `shared/tables/chrome/*` after `bun run gen`
3. tzdata changes since watermark: fetch
   `https://data.iana.org/time-zones/tzdb/NEWS` and read only releases newer
   than the watermark version. Relevant sections: "Changes to future
   timestamps" (rule changes → fixtures, groups), "New Zone"/"new zones"
   (→ zoneLinks n/a, live-fallback covers), "Link"/"renamed"/"moved to
   backward" (→ `zoneLinkPairs`, `aliasOf` direction).
4. CLDR changes matter only if `process.versions.cldr` differs from the
   watermark (2 releases/year): new/renamed metazone long names change
   `abbrOverrides` keys. The audit (below) finds these empirically — no need
   to read CLDR changelogs first.

## Step 2: Run the detectors (existing tooling)

```bash
bun run audit        # ERRORs: diverged zoneAliases (fix or remove) — exit 1
                     # WARNs: new initials-resolved long names (verify each);
                     #        stale abbrOverrides keys (prune)
                     # INFO:  GMT-fallback zones (candidates for new
                     #        zoneAliases / zoneAbbrOverrides entries)
bun run gen                         # regenerate both table variants
bun run test                        # bun suite + Chrome stage: fixtures,
                                    # oracle, table validation; the "vs 04"
                                    # column must be full (e.g. 8360/8360)
                                    # and "08 init ... healed" > 0 means a
                                    # group diverged mid-year
bun run test:tz                     # bun suite under 3 host TZs
```

New spelling divergences between runtimes (feeds `zoneLinkPairs`):

```bash
bun -e "const a=new Set(Intl.supportedValuesOf('timeZone')); console.log(JSON.stringify([...a]))" > /tmp/bun-zones.json
# compare against shared/tables/chrome/schedule.ts zone strings, or run the
# same one-liner inside chrome-headless-shell via tools/browser.ts helpers
```

## Step 3: Update rules per file

- **`abbrOverrides`** — add an entry only when a real, commonly used
  abbreviation exists (tzdata output or established usage). Never invent
  initials-style abbreviations; zones without letter abbreviations correctly
  fall back to compact GMT form. Key must be the exact CLDR long name the
  runtime emits (the audit WARN list shows candidates verbatim).
- **`zoneAliases`** — only for zones with NO CLDR metazone whose current-year
  behavior is identical to the reference zone. An audit ERROR means the pair
  diverged: remove it or find a new reference. (Impl 08 also verifies these
  at runtime via Temporal and drops divergent ones — `healedAliases` in its
  init stats is the signal.)
- **`zoneAbbrOverrides`** — zone-level, for well-known abbrs with no metazone
  (TRT). These are baked into the schedule table at generation, so regenerate
  after editing.
- **`zoneLinkPairs`** — source of truth is tzdata's `backward` file. Keep
  `[canonical, alias]` order (canonical = modern id). Add a pair when a NEWS
  entry announces a rename/link, or when the runtime zone-list diff shows a
  spelling divergence.
- **`fixtures.ts`** — change expected values ONLY when reality changed, and
  cite the tzdata release in a comment (e.g. Alberta permanent −06 per
  2026c). Never adjust a fixture just to make a failing test pass — a
  failure usually means the tables need regeneration, not the fixture.

## Step 4: Close the loop

1. Re-run everything in Step 2 until green (audit exit 0, tests pass, vs 04
   full, healed counts 0 — or explained by a known upstream lag).
2. Update the `curation-reviewed:` watermark headers (date, tzdata version
   reviewed through, CLDR version, Chrome version).
3. If fixtures or abbrs changed, note the upstream cause in the commit/PR.

## Worked examples (from this repo's history)

- **Turkey Time**: Europe/Istanbul has no CLDR metazone (long name is
  "GMT+03:00") but TRT is well-established → `zoneAbbrOverrides` entry, and
  a fixture pins it.
- **Channel Islands**: Guernsey/Jersey/Isle_of_Man have no metazone but are
  behavior-identical to Europe/London → `zoneAliases`, giving them GMT/BST.
- **Choibalsan direction bug**: `['Asia/Choibalsan','Asia/Ulaanbaatar']` was
  wrong — Ulaanbaatar is canonical (Choibalsan became a link in tzdata
  2024a). Symptom: `aliasOf` pointed the wrong way. Check NEWS wording
  ("Link X Y" makes X the target, Y the alias) when unsure.
- **Alberta (tzdata 2026c)**: mid-year move to permanent −06/CST. Expected
  blast radius when a runtime's ICU picks it up: 08 init reports healed > 0
  (Edmonton splits from the Denver group), schedule/classes equivalence
  fails until `bun run gen` re-runs, and any Edmonton fixture needs a
  cited update. Morocco (same release) changes offsets only — groups move
  together, so only tables and fixtures are affected, not curated maps.
