# `getTimeZonesAt()` — third-party library comparison

- **Goal:** return `{ name, abbr, offset }` for every IANA zone at an arbitrary timestamp,
  where `abbr` is a real, DST-aware abbreviation (EET vs EEST) — not a GMT/UTC offset label.
- **Qualification check:** Europe/Kyiv at 2026-01-15 (winter, expect `EET`) and 2026-07-15
  (summer, expect `EEST`), reproducible via `bun tools/validate-libs.ts`.
- Versions were pinned; all packages installed with `--ignore-scripts`.

## Table 1 — considered candidates

Qualified libraries (✅) first; disqualified (❌) below.

| library | why considered | winter / summer | verdict |
|---|---|---|---|
| `leeoniya-timezones@2cd74a8` | purpose-built for exactly this API: generates a compact offset→abbr lookup from pinned tzdb source at build time, resolves offsets via live Intl at runtime | EET / EEST | ✅ **Qualified.** Same hybrid shape as this repo's generated-table impls but with tzdata-style abbreviations; by far the smallest and fastest of the qualified libraries (20.6 KB vs 328-1781 KB). |
| `moment-timezone@0.6.2` | the historical default for timezone work; bundles full tzdata | EET / EEST | ✅ **Qualified.** Real tzdata abbreviations built-in. Tied-best fixture score of the libraries. |
| `timezone-support@3.1.0` | lightweight tzdata lookup library, purpose-built for zone conversion | EET / EEST | ✅ **Qualified**, with stale data: bundled tzdata is 2022-vintage — Cairo reports EET +02:00 in July 2026 (predates Egypt's 2023 DST reintroduction) and `America/Ciudad_Juarez` is unknown. |
| `timezonecomplete@5.15.1` | TS-first datetime library with tzdata-backed zone math | EET / EEST | ✅ **Qualified**, with bugs: browser use requires explicitly importing the separate `tzdata` package (+213 KB; errors otherwise); abbreviation lags the offset at transition boundaries ("EST −04:00" one minute after spring-forward); Cairo wrong despite current data. |
| `timezone@1.0.23` (bigeasy) | venerable pure-function strftime-style formatter; per-region data loading | EET / EEST | ✅ **Qualified**, with 2019-vintage data: modern zone names (`Europe/Kyiv`) are unknown and silently return "UTC"; every rule change since 2019 is missing. Full data set is the largest bundle tested (1.8 MB), though regional subsetting is supported. |
| `luxon@3.7.2` | moment's official successor; common recommendation | GMT+2 / GMT+3 | ❌ Disqualified: `toFormat('ZZZZ')` delegates to Intl `short` names — no abbreviations outside CLDR's (mostly North American) coverage. |
| `date-fns@4.4.0` + `@date-fns/tz@1.5.0` | most popular modular date library + first-party tz package | GMT+2 / GMT+3 | ❌ Disqualified: `format(…, 'zzz')` is an Intl `short` passthrough, same coverage gap as luxon. |
| `dayjs@1.11.21` (+utc, +timezone, +advancedFormat) | tiny moment-compatible API; smallest footprint of the general-purpose libs | GMT+2 / GMT+3 | ❌ Disqualified: `format('z')` is an Intl `short` passthrough. |
| `@tubular/time@3.10.9` | ships its own compressed tzdata; `z` format token | GMT+2 / GMT+3 | ❌ Disqualified: real letters only for North-American-style zones (EST/EDT work); elsewhere emits GMT±n even with `initTimezoneLarge()`. |
| `@vvo/tzdb@6.198.0` | purpose-built timezone-picker dataset with an `abbreviation` field | EET (static) | ❌ Disqualified twice over: `abbreviation` is the fixed standard-time value regardless of DST (New York in July: "EST" beside an EDT offset), and `getTimeZones()` has no timestamp parameter ("now" only). Notably its `abbreviations` export is a 272-entry curated long-name→abbr map — the same artifact this repo maintains in `shared/abbrs.ts`. |
| `spacetime@7.13.0` | small immutable datetime library with built-in zone data | (none) | ❌ Disqualified: exposes zone names and offsets only; no abbreviation API. |
| `@js-joda/core@5.6.5` + `@js-joda/timezone@2.22.0` | java.time port; rigorous zone rule engine | error | ❌ Disqualified: core throws "Pattern using (localized) text not implemented" for `zzz` — localized text lives in a separate plugin (next row). |
| &nbsp;&nbsp;+ `@js-joda/locale_en-us@4.15.3` | the plugin that makes `zzz` format at all | Europe/Kyiv / Europe/Kyiv | ❌ Disqualified: emits CLDR *generic* names with no standard/daylight distinction (New York: "ET" in both seasons) and falls back to the raw zone id where CLDR has no short generic name. |

## Table 2 — correctness & benchmarks (qualified libraries vs this repo's impls)

Methodology:

- **fixtures** — 62 expectations: DST boundaries across Europe/America/Africa/Asia/Australia
  plus tricky edge cases: the world's only 30-min DST delta (Lord Howe) and only 2-hour delta
  (Troll), 45-min offsets (Kathmandu, Chatham), negative DST (Dublin), the Ramadan-based rule
  (Casablanca), Saturday-local (Nuuk) and 24:00-local (Santiago) transitions, exact transition
  instants, the ±offset extremes (Kiritimati +14, Pago Pago −11), and no-CLDR-metazone zones
  curated via aliases (Famagusta→EET/EEST, Kirov→MSK).
- **vs 04** — deep output-equality against live-Intl impl `04-live-intl` at 20 instants × 418
  zones.
- **Benchmarks** — chrome-headless-shell 150 on an idle machine outside the dev sandbox
  (consistent with the anchors in `impls/registry.ts` / `summary.md`). Cold is the median over
  5 fresh page contexts. This repo's impls and the libraries are bundled separately so the
  libraries' ~4MB of tzdata never inflates our impls' pages.
- **bundle KB** — `Bun.build` minified, no gzip.
- Reproducible via `bun run test` / `bun run bench` / `bun run size`.

This repo's implementations (🔷) vs qualified libraries (📦).

| impl | fixtures | vs 04 | notable failures | cold ms | miss ms | rss MB | bundle KB |
|---|--:|--:|---|--:|--:|--:|--:|
| 🔷 `04-live-intl` | **62/62** | baseline | — | 38.9 | 1.4 | 25.6 | 6.3 |
| 🔷 `08-verified-sharing` | **62/62** | **8360/8360** | — | 22.2 | 0.6 | 18.4 | 10.6 |
| 🔷 `10-audited-rules` | **62/62** | **8360/8360** | — | 2.3 | 0.0 | 7.4 | 11.7 |
| 🔷 `07-baked-rules` | **62/62** | **8360/8360** | — | 0.3 | 0.0 | 6.5 | 10.2 |
| 📦 `lib-leeoniya-timezones` | 39/62 | 4958/8360 | best library score, tied with moment at a fraction of the size; 22 of 23 misses are abbr *convention* (tzdata numerics "+03"/"+1030" where CLDR/our curation has TRT/LHST), zero wrong offsets; the one genuine quirk: inside the Casablanca Ramadan window the label falls back to "+01" beside the (correct) +00:00 offset — the generated lookup lacks that zone's Ramadan entry | 7.5 | 0.3 | 10.3 | 20.6 |
| 📦 `lib-moment-timezone` | 39/62 | 4956/8360 | all 23 misses are abbr *convention*, zero wrong offsets — even Lord Howe, Troll, Ramadan, Nuuk, and exact instants are right; tzdata numerics ("+1030", "−03") where CLDR has names | 24.8 | 0.8 | 22.0 | 773.5 |
| 📦 `lib-timezone-support` | 37/62 | 4878/8360 | as moment, plus stale 2022 data now caught twice: Cairo **EET +02:00 in July** and Nuuk **−03/−02** (true −02/−01; predates Greenland's base-offset move) — both wrong offsets; Ciudad_Juarez unknown | 22.8 | 0.2 | 16.3 | 753.5 |
| 📦 `lib-timezonecomplete` | 31/62 | 4777/8360 | label/offset incoherence at 8 boundary fixtures incl. the *exact* transition instant ("EST −04:00"), and the label can also *lead* the offset (Lord Howe pre-transition: "UTC+1100" beside +10:30); Cairo wrong despite current data; "UTC+0300"-style numerics | 164.0 | 68.6 | 28.1 | 327.6 |
| 📦 `lib-bigeasy-timezone` | 37/62 | 4723/8360 | 2019 data: zones named after 2019 silently return "UTC +00:00" — now caught twice (Europe/Kyiv, America/Nuuk, renamed 2020); Cairo pre-2023 rules | 22.4 | 14.9 | 10.8 | 1781.4 |

Reading notes:

- **Most misses are convention, not bugs.** The libraries' vs-04 scores (~56-59%) and most
  fixture misses are a legitimate convention split — modern tzdata removed most invented
  abbreviations in 2017 (numeric "+05", "+1030"), while this repo's output follows
  CLDR/user-facing names ("PKT", "LHST"); Istanbul TRT and the Famagusta/Kirov aliases are
  curated choices on our side.
- **The mechanics are universally right.** All five libraries compute the tricky *mechanics*
  correctly (30-min and 2-hour DST deltas, 45-min offsets, negative DST, the Ramadan rule,
  24:00-local and exact-instant transitions) wherever their data vintage covers the zone.
- **The genuine defects the edge cases surfaced or confirmed:**
  - stale bundled data producing wrong *offsets* (timezone-support: Cairo + Nuuk);
  - silent "UTC" for zones newer than the bundled data (bigeasy: Kyiv + Nuuk);
  - transition-boundary label/offset incoherence in both directions (timezonecomplete, incl.
    at the exact transition instant);
  - a stale label beside a correct offset when a generated lookup lacks an offset entry
    (`leeoniya-timezones`: Casablanca inside Ramadan).
- **Data-quality standouts:** moment-timezone and `leeoniya-timezones` emerged cleanest —
  misses are abbreviation convention, never a wrong offset (modulo the single Casablanca label
  above).
- **Performance standout:** `leeoniya-timezones` — its generated-lookup-plus-live-Intl-offsets
  design is the same hybrid shape as this repo's `08`/`10` impls, and it lands between them on
  cold start and bundle size while using tzdata (not CLDR) abbreviation conventions.
- Chrome timer quantization (~100µs) makes the baked impls' sub-0.1ms misses read as 0.0.
- Generated 2026-07-14 (fixtures expanded 26 → 55 and library findings updated same day);
  updated 2026-07-15: fixtures 55 → 62 (Troll, Famagusta, Kirov), added `leeoniya-timezones`,
  and re-ran all benchmarks on an idle machine.
