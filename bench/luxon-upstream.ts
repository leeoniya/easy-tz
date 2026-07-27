// How much of luxon's formatting cost can be removed from outside the library,
// and how much needs a change inside it?
//
// bench/luxon-format.ts answered the zone half: sourcing offsets and
// abbreviations from easy-tz instead of Intl takes a named-zone column from
// ~3x moment to ~1.4x (and ~23x to ~1.4x once the pattern includes an
// abbreviation). This bench asks what the remaining ~1.4x is made of.
//
// Profiling the post-easy-tz path (node --cpu-prof) put it in luxon's own
// formatting machinery rather than anything zone-related:
//
//   tokenToString / stringifyTokens   ~24%   walking the token list
//   parseFormat (+ its regex)         ~15%   re-tokenizing the pattern per call
//   PolyNumberFormatter / num         ~13%   per-token formatter allocation
//   garbage collector                  ~9%   consequence of the above
//   Locale construction                ~6%   a fresh Locale per toFormat()
//
// Two ways to attack that, measured side by side here:
//
//   external  a fast path that skips luxon for the patterns a value formatter
//             emits in bulk (recommendation B) — the ceiling from outside
//   upstream  four patches to luxon itself, all pure memoization or provable
//             short-circuits (see bench/luxon-patches.ts)
//
// Run: bun bench/luxon-upstream.ts

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { printTable } from '../tools/print-table.ts';
import { genMeta, YEAR_START } from '../shared/schedule.ts';
import { loadLuxon, patchWhat, type LuxonModule, type PatchKey } from './luxon-patches.ts';
import {
  LOCALE,
  formatKeys,
  makeEasyZoneClass,
  makeFastFormatter,
  makeFormatter,
  patternFor,
  timeLoop,
  type FormatKey,
} from './luxon-format-kernel.ts';

const N = 20_000;
const REPS = 7;
const WARMUP = 2_000;
const STEP_MS = 60_000;

const BAKE_YEAR = new Date(YEAR_START).getUTCFullYear();
const BASE_TS = Date.UTC(BAKE_YEAR, 0, 1);
const ZONE = 'America/New_York';

// A-D were found by profiling stock luxon, E-H by re-profiling the A-D build.
// A-H are all caches or short-circuits; I is the structural one, and it makes B
// and E redundant by construction (it parses each pattern once and folds
// punctuation into literal runs), which the ACDFGHI row below checks.
const CORE: PatchKey[] = ['numFast', 'parseFormatCache', 'zoneInfoCache', 'localeIntern'];
const LATER: PatchKey[] = ['tokenLoop', 'intRoundTo', 'padStart2', 'tsToObjMath'];
const CACHES: PatchKey[] = [...CORE, ...LATER];
const ALL_PATCHES: PatchKey[] = [...CACHES, 'compileFormat'];
// J and K are the zone lookup rather than the formatter, so they only appear on
// the stock-zone rows: the easy-tz rows override offset() and never reach them.
// K anchors on J's fast path, so the order here is also the apply order.
const OFFSET: PatchKey[] = ['offsetScan', 'offsetInterval'];
const UPSTREAM: PatchKey[] = [...ALL_PATCHES, ...OFFSET];
const LETTER = new Map(UPSTREAM.map((k, i) => [k, 'ABCDEFGHIJK'[i]!]));
const NO_B_OR_E: PatchKey[] = ALL_PATCHES.filter((k) => k !== 'parseFormatCache' && k !== 'tokenLoop');

// ---- paths under test ----------------------------------------------------

interface Path {
  id: string;
  /** patches applied to the luxon instance, for the report */
  patches: readonly PatchKey[];
  /** false when the zone still comes from Intl */
  easyZone: boolean;
  /** id of the row this one is an increment over, for the savings column */
  base: string | undefined;
  make: (fmt: FormatKey) => Promise<(ts: number) => string>;
}

function luxonPath(id: string, patches: readonly PatchKey[], easyZone: boolean, base?: string): Path {
  return {
    id,
    patches,
    easyZone,
    base,
    make: async (fmt) => {
      const lux: LuxonModule = await loadLuxon(patches);
      const pattern = patternFor('luxon', fmt);
      const zone = easyZone ? new (makeEasyZoneClass(lux.IANAZone))(ZONE) : lux.IANAZone.create(ZONE);
      const opts = { zone, locale: LOCALE };

      return (ts) => lux.DateTime.fromMillis(ts, opts).toFormat(pattern);
    },
  };
}

// Where each patch is attributed matters. All of them save a roughly fixed
// number of ms per value, so measuring one against stock luxon buries it under
// the Intl offset lookup that dominates that build — several patches came out
// at or below the noise floor there. Measured against the easy-tz zone, where
// that lookup is already gone, the same absolute saving is a large enough share
// of the remaining total to resolve. C is the exception: its entire purpose is
// the Intl zone-name path that easy-tz bypasses, so it is only meaningful
// against stock.
const paths: Path[] = [
  {
    id: 'moment',
    patches: [],
    easyZone: false,
    base: undefined,
    make: (fmt) => Promise.resolve(makeFormatter('moment', ZONE, fmt)),
  },
  luxonPath('luxon (stock)', [], false, undefined),
  // Control: the same unpatched module measured a second time, so its "saved"
  // figure is pure measurement noise and calibrates the rest of the column.
  luxonPath('luxon (stock, control)', [], false, 'luxon (stock)'),
  luxonPath('luxon +C zoneInfoCache', ['zoneInfoCache'], false, 'luxon (stock)'),
  luxonPath('luxon ABCDEFGHI', ALL_PATCHES, false, 'luxon (stock)'),
  // J and K attack what is left once the formatter is fixed: the per-value Intl
  // call in offset(). Attributed against the A-I build, which is the only place
  // they are the dominant remaining cost.
  luxonPath('luxon +J offsetScan', ['offsetScan'], false, 'luxon (stock)'),
  luxonPath('luxon +JK offsetInterval', OFFSET, false, 'luxon +J offsetScan'),
  luxonPath('luxon ABCDEFGHIJ', [...ALL_PATCHES, 'offsetScan'], false, 'luxon ABCDEFGHI'),
  luxonPath('luxon ABCDEFGHIJK', UPSTREAM, false, 'luxon ABCDEFGHIJ'),
  luxonPath('luxon ABCDEFGHIJK (control)', UPSTREAM, false, 'luxon ABCDEFGHIJK'),
  luxonPath('easytz zone', [], true, undefined),
  luxonPath('easytz zone (control)', [], true, 'easytz zone'),
  ...ALL_PATCHES.filter((k) => k !== 'zoneInfoCache').map((k) =>
    luxonPath(`easytz +${LETTER.get(k)!} ${k}`, [k], true, 'easytz zone')
  ),
  luxonPath('easytz ABCDEFGH (caches)', CACHES, true, 'easytz zone'),
  luxonPath('easytz ABCDEFGHI (all)', ALL_PATCHES, true, 'easytz ABCDEFGH (caches)'),
  // second control, at the scale of the fastest luxon rows: relative noise is
  // larger down here than it is at the stock row's ~10x slower timings, so the
  // B/E redundancy question below has to be judged against this, not against the
  // control up top
  luxonPath('easytz ABCDEFGHI (control)', ALL_PATCHES, true, 'easytz ABCDEFGHI (all)'),
  luxonPath('easytz ACDFGHI (no B/E)', NO_B_OR_E, true, 'easytz ABCDEFGHI (all)'),
  {
    id: 'easytz fast path',
    patches: [],
    easyZone: true,
    base: 'easytz ABCDEFGHI (all)',
    make: (fmt) => {
      const fast = makeFastFormatter(ZONE, fmt);

      if (fast === null) {
        throw new Error(`no fast path for ${ZONE}/${fmt}`);
      }

      return Promise.resolve(fast);
    },
  },
];

// ---- measurement --------------------------------------------------------

const median = (xs: number[]) => xs.toSorted((a, b) => a - b)[xs.length >> 1]!;

let sink = 0;

/** All paths for one format, timed round-robin so drift lands on everyone equally. */
async function measureAll(fmt: FormatKey): Promise<Map<string, number>> {
  const built = [];

  for (const path of paths) {
    const format = await path.make(fmt);
    sink += timeLoop(format, BASE_TS - WARMUP * STEP_MS, STEP_MS, WARMUP).checksum;
    built.push({ id: path.id, format });
  }

  const times = new Map<string, number[]>(built.map((b) => [b.id, []]));

  for (let r = 0; r < REPS; r++) {
    for (const { id, format } of built) {
      const run = timeLoop(format, BASE_TS, STEP_MS, N);
      sink += run.checksum;
      times.get(id)!.push(run.ms);
    }
  }

  return new Map([...times].map(([id, xs]) => [id, median(xs)]));
}

console.log(`luxon ${await pkgVersion('luxon')} vs moment ${await pkgVersion('moment')}`);
console.log(`runtime: ${runtime()}, tables: ${genMeta.host}, host ICU ${process.versions.icu ?? '?'}`);
console.log(`${ZONE}, ${N} values/pass, median of ${REPS} interleaved passes\n`);

async function pkgVersion(name: string): Promise<string> {
  const path = new URL(`../node_modules/${name}/package.json`, import.meta.url);
  const pkg = JSON.parse(await readFile(path, 'utf8')) as { version: string };

  return pkg.version;
}

/**
 * Which engine these numbers came off. Worth printing rather than assuming:
 * bun is JavaScriptCore and node is V8, and the patches here turn on allocation
 * and inline-cache behaviour that the two do not have to agree about.
 */
function runtime(): string {
  const versions = process.versions as Record<string, string | undefined>;

  return versions['bun'] === undefined
    ? `node ${versions['node']!} (V8 ${versions['v8']!})`
    : `bun ${versions['bun']} (JavaScriptCore)`;
}

console.log('candidate upstream patches:\n');
printTable(
  ['patch', 'change'],
  UPSTREAM.map((k) => [`${LETTER.get(k)!} ${k}`, patchWhat.get(k)!])
);
console.log();

// ---- timing per format ---------------------------------------------------

const results = new Map<FormatKey, Map<string, number>>();

for (const fmt of formatKeys) {
  const ms = await measureAll(fmt);
  results.set(fmt, ms);

  const base = ms.get('moment')!;

  const rows = paths.map((p) => {
    const t = ms.get(p.id)!;
    const over = p.base === undefined ? undefined : ms.get(p.base)!;

    return [
      p.id,
      t.toFixed(1),
      `${(t / base).toFixed(2)}×`,
      over === undefined ? '—' : `${(((over - t) / over) * 100).toFixed(0)}%`,
      p.base ?? '—',
    ];
  });

  console.log(`${fmt} format (${patternFor('moment', fmt)}) — ms per ${N} values\n`);
  printTable(['path', 'ms', 'vs moment', 'saved', 'over'], rows);
  console.log();
}

// ---- agreement ----------------------------------------------------------
// The patches are supposed to be behavior-preserving, so every patched path
// must match stock luxon byte for byte. The easy-tz paths are expected to differ
// on abbreviations (easy-tz supplies a tzdata-style abbreviation where ICU
// returns a "GMT-5" fallback — established in bench/luxon-format.ts), so those
// rows are informational rather than a pass/fail.

{
  const PARITY_N = 20_000;
  const PARITY_STEP = 3_600_000;
  const rows: (string[] | null)[] = [];
  let patchedMismatches = 0;

  for (const fmt of formatKeys) {
    const reference = await luxonPath('ref', [], false).make(fmt);

    for (const path of paths) {
      if (path.id === 'luxon (stock)' || path.id === 'luxon (stock, control)') continue;

      const format = await path.make(fmt);
      let diff = 0;

      for (let i = 0; i < PARITY_N; i++) {
        const ts = BASE_TS + i * PARITY_STEP;

        if (format(ts) !== reference(ts)) diff++;
      }

      const expected = path.easyZone && fmt === 'abbr' ? 'by design' : 'must be 0';

      if (expected === 'must be 0') patchedMismatches += diff;

      rows.push([`${fmt} / ${path.id}`, String(diff), expected]);
    }

    if (fmt !== formatKeys.at(-1)) rows.push(null);
  }

  console.log(`output vs stock luxon — mismatching values out of ${PARITY_N} (hourly)\n`);
  printTable(['format / path', 'mismatches', 'expectation'], rows);

  console.log(
    patchedMismatches === 0
      ? `\nall ${UPSTREAM.length} patches are output-identical to stock luxon; the only differences are the\nintended easy-tz abbreviations.`
      : `\nFAIL: ${patchedMismatches} unexpected mismatch(es) — a patch changed behavior.`
  );
}

// ---- summary ------------------------------------------------------------

{
  const rows = formatKeys.map((fmt) => {
    const ms = results.get(fmt)!;
    const base = ms.get('moment')!;
    const cell = (id: string) => `${(ms.get(id)! / base).toFixed(2)}×`;

    return [
      patternFor('moment', fmt),
      cell('luxon (stock)'),
      cell('easytz zone'),
      cell('luxon ABCDEFGHI'),
      cell('luxon ABCDEFGHIJK'),
      cell('easytz ABCDEFGHI (all)'),
      cell('easytz fast path'),
    ];
  });

  console.log(`\nsummary — ratio vs moment (lower is better)\n`);
  printTable(
    [
      'format',
      'stock luxon',
      'easytz zone',
      'upstream A-I',
      'upstream A-K',
      'easytz + upstream',
      'external fast path',
    ],
    rows
  );
}

// ---- findings ------------------------------------------------------------

{
  const abbr = results.get('abbr')!;
  const num = results.get('numeric')!;
  /** saving of a row over its own baseline row, as the table reports it */
  const saved = (ms: Map<string, number>, id: string) => {
    const over = ms.get(paths.find((p) => p.id === id)!.base!)!;

    return `${(((over - ms.get(id)!) / over) * 100).toFixed(0)}%`;
  };

  const noiseBetween = (a: string, b: string) =>
    Math.max(...[num, abbr].map((ms) => Math.abs(ms.get(a)! - ms.get(b)!) / ms.get(a)!));

  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

  /**
   * Every patch except C, ranked by what it saves on the easy-tz numeric path
   * and bucketed against the noise floor. Computed rather than asserted in
   * prose, because the ranking is not the same on V8 and JavaScriptCore.
   */
  function tiers(): string {
    const zone = num.get('easytz zone')!;
    const floor = Math.abs(zone - num.get('easytz zone (control)')!) / zone;

    const ranked = ALL_PATCHES.filter((k) => k !== 'zoneInfoCache')
      .map((k) => ({
        label: `${LETTER.get(k)!} ${k}`,
        save: (zone - num.get(`easytz +${LETTER.get(k)!} ${k}`)!) / zone,
      }))
      .sort((a, b) => b.save - a.save);

    const bucket = (s: number) =>
      s >= Math.max(3 * floor, 0.04) ? 'worth keeping' : s >= Math.max(1.5 * floor, 0.02) ? 'marginal' : 'at noise';

    const lines = ['worth keeping', 'marginal', 'at noise'].map((name) => {
      const hits = ranked.filter((r) => bucket(r.save) === name);

      return `  ${`${name}:`.padEnd(16)}${hits.length === 0 ? '—' : hits.map((r) => `${r.label} ${pct(r.save)}`).join(', ')}`;
    });

    return lines.join('\n');
  }
  const noise = noiseBetween('luxon (stock)', 'luxon (stock, control)');
  const noiseMid = noiseBetween('easytz zone', 'easytz zone (control)');
  const noiseFast = noiseBetween('easytz ABCDEFGHI (all)', 'easytz ABCDEFGHI (control)');

  const ratio = (ms: Map<string, number>, id: string) => (ms.get(id)! / ms.get('moment')!).toFixed(2);

  console.log(`
findings (noise floor from the three control rows, fastest rows being the
noisiest: ~${pct(noise)} at the stock timings, ~${pct(noiseMid)} at the easy-tz zone, ~${pct(noiseFast)} at the fully patched)

C is the one that matters and is barely an optimization: parseZoneInfo built a
fresh Intl.DateTimeFormat per value, so any pattern containing a zone name paid
formatter construction per formatted value. Routing it through luxon's existing
getCachedDTF saves ${saved(abbr, 'luxon +C zoneInfoCache')} of that format's cost — ${(abbr.get('luxon (stock)')! / abbr.get('moment')!).toFixed(1)}× moment down to
${(abbr.get('luxon +C zoneInfoCache')! / abbr.get('moment')!).toFixed(1)}× — as a one-line change.

I is the biggest single patch: ${saved(num, 'easytz +I compileFormat')} of the numeric format against the easy-tz zone,
more than any one cache. Compiling a pattern to handlers once removes three costs
together — the ~70-case switch per token per value, the eight closures
formatDateTimeFromString built per call, and the Intl options object literals its
branches allocated — and folds punctuation into literal runs so separators cost a
concat. It is not a substitute for the caches, though: those still come to
${saved(num, 'easytz ABCDEFGH (caches)')} between them, and I adds ${saved(num, 'easytz ABCDEFGHI (all)')} on top of all of them.

The rest are individually modest, and which of them are worth keeping is engine
dependent — bench:luxon-cross-engine runs this under both and diffs the two.
Sorted by what they save here, against the easy-tz zone on the numeric format
with a ~${pct(noiseMid)} noise floor:

${tiers()}

I should also make B and E redundant by construction, since it parses each pattern
once and folds punctuation into literal runs. The ACDFGHI row supports that:
dropping both moves numeric by ${saved(num, 'easytz ACDFGHI (no B/E)')} (positive meaning faster without them), against
~${pct(noiseFast)} noise at that timing scale, and the sign is not stable across runs. Keep B
if it is already written; do not write it for I's sake.

C, J and I are the shippable core on any engine. Of the rest, cross-engine puts
A, B and D above the floor on both V8 and JavaScriptCore, and leaves E, G and H
helping one engine and not the other — a single run of this file cannot tell
those apart, so do not read the buckets above as a ship list on their own. H is
the only patch that rewrites logic rather than adding a cache, and is verified
against Date's own getters over 200k random instants across the full range.

J and K answer "can luxon reach moment without easy-tz", and on a zone-less
pattern the answer is yes with room to spare. A-I fix the formatter and stop at
${ratio(num, 'luxon ABCDEFGHI')}× moment, because by then nearly everything left is the one Intl call
per value in offset(). J makes that call cheaper (${saved(num, 'luxon +J offsetScan')} off stock on its own, and
3.7× on the offset call measured in isolation) by reading dtf.format() digits
instead of formatToParts. K then removes most of the calls outright. Either one
alone beats the entire A-I formatter effort on this format, J and K together get
there without any of A-I (${ratio(num, 'luxon +JK offsetInterval')}×), and A-K lands at ${ratio(num, 'luxon ABCDEFGHIJK')}× — no tzdata, no
easy-tz, no API change.

The abbreviated format is the opposite story: J is worth ${saved(abbr, 'luxon +J offsetScan')} there and A-K only
reaches ${ratio(abbr, 'luxon ABCDEFGHIJK')}×, because what dominates once C caches the formatter is
parseZoneInfo still calling Intl per value for the name itself. Nothing here
fixes that, and easy-tz (${ratio(abbr, 'easytz ABCDEFGHI (all)')}×) remains the only thing that does.

K is the one with a precondition rather than a proof from first principles: it
assumes no two transitions fall inside one 2-day probe window. The tightest gap
in all of tzdata is 6.92 days (America/Cambridge_Bay, Oct-Nov 2000) across all
219232 transitions moment-timezone ships, so the margin is 3.5×, and the failure
mode if tzdata ever tightened past it is a stale offset rather than a crash.
J has no such precondition and is worth filing regardless.

Stacked, all of it takes the easy-tz path from ${ratio(num, 'easytz zone')}× moment to ${ratio(num, 'easytz ABCDEFGHI (all)')}× and stock
luxon from ${ratio(num, 'luxon (stock)')}× to ${ratio(num, 'luxon ABCDEFGHIJK')}×, without touching a public API or changing a byte
of output — verified across every token in the switch, all macro tokens, four
zones and four locales including a non-gregory calendar with non-latn digits.

That reverses the case for easy-tz depending on the pattern. On numeric, the
full upstream build (${ratio(num, 'luxon ABCDEFGHIJK')}×) now edges out easy-tz plus A-I (${ratio(num, 'easytz ABCDEFGHI (all)')}×), so a luxon
that carried J and K would leave easy-tz nothing to win on zone-less patterns.
On abbreviations easy-tz is still ahead by an order of magnitude (${ratio(abbr, 'easytz ABCDEFGHI (all)')}× vs ${ratio(abbr, 'luxon ABCDEFGHIJK')}×),
and skipping the Formatter entirely for known patterns is a further ${(num.get('easytz ABCDEFGHI (all)')! / num.get('easytz fast path')!).toFixed(1)}× beyond
even that.

Recommended to file, in order: C and J first — both are self-contained, neither
needs a design argument, and between them they take stock luxon from ${ratio(num, 'luxon (stock)')}× to
${ratio(num, 'luxon +J offsetScan')}× on numeric and ${ratio(abbr, 'luxon (stock)')}× to ${ratio(abbr, 'luxon +C zoneInfoCache')}× on abbreviations. Then K, which needs the
tzdata-gap argument accepted. Then I, the largest formatter win but a structural
change that needs maintainer buy-in. Then whichever of the rest clear the bar on
both engines. B is redundant once I lands.`);
}

// ---- machine-readable results -------------------------------------------
// bench/luxon-cross-engine.ts runs this file under node and bun and diffs the
// two, since the small patches do not rank the same on V8 and JavaScriptCore.

{
  const versions = process.versions as Record<string, string | undefined>;
  const tag = versions['bun'] === undefined ? 'node' : 'bun';

  await mkdir(new URL('../.tmp/', import.meta.url), { recursive: true });
  await writeFile(
    new URL(`../.tmp/luxon-upstream-${tag}.json`, import.meta.url),
    JSON.stringify(
      {
        runtime: runtime(),
        icu: process.versions.icu ?? null,
        ms: Object.fromEntries([...results].map(([fmt, ms]) => [fmt, Object.fromEntries(ms)])),
      },
      null,
      2
    )
  );
}

if (sink < 0) throw new Error('unreachable');
