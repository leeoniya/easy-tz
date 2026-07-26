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
const CORE: PatchKey[] = ['numFast', 'parseFormatCache', 'zoneInfoCache', 'localeIntern'];
const LATER: PatchKey[] = ['tokenLoop', 'intRoundTo', 'padStart2', 'tsToObjMath'];
const ALL_PATCHES: PatchKey[] = [...CORE, ...LATER];
const LETTER = new Map(ALL_PATCHES.map((k, i) => [k, 'ABCDEFGH'[i]!]));

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
  luxonPath('luxon ABCDEFGH', ALL_PATCHES, false, 'luxon (stock)'),
  luxonPath('easytz zone', [], true, undefined),
  luxonPath('easytz zone (control)', [], true, 'easytz zone'),
  ...[...CORE, ...LATER]
    .filter((k) => k !== 'zoneInfoCache')
    .map((k) => luxonPath(`easytz +${LETTER.get(k)!} ${k}`, [k], true, 'easytz zone')),
  luxonPath('easytz zone ABCDEFGH', ALL_PATCHES, true, 'easytz zone'),
  {
    id: 'easytz fast path',
    patches: [],
    easyZone: true,
    base: 'easytz zone ABCDEFGH',
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
console.log(`runtime: bun ${Bun.version}, tables: ${genMeta.host}, host ICU ${process.versions.icu ?? '?'}`);
console.log(`${ZONE}, ${N} values/pass, median of ${REPS} interleaved passes\n`);

async function pkgVersion(name: string): Promise<string> {
  const pkg = (await Bun.file(new URL(`../node_modules/${name}/package.json`, import.meta.url)).json()) as {
    version: string;
  };

  return pkg.version;
}

console.log('candidate upstream patches:\n');
printTable(
  ['patch', 'change'],
  ALL_PATCHES.map((k) => [`${LETTER.get(k)!} ${k}`, patchWhat.get(k)!])
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
      ? `\nall ${ALL_PATCHES.length} patches are output-identical to stock luxon; the only differences are the\nintended easy-tz abbreviations.`
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
      cell('luxon ABCDEFGH'),
      cell('easytz zone ABCDEFGH'),
      cell('easytz fast path'),
    ];
  });

  console.log(`\nsummary — ratio vs moment (lower is better)\n`);
  printTable(
    ['format', 'stock luxon', 'easytz zone', 'upstream only', 'easytz + upstream', 'external fast path'],
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

  const noise = Math.max(
    ...[num, abbr].map((ms) => Math.abs(ms.get('luxon (stock)')! - ms.get('luxon (stock, control)')!) / ms.get('luxon (stock)')!)
  );

  const ratio = (ms: Map<string, number>, id: string) => (ms.get(id)! / ms.get('moment')!).toFixed(2);

  console.log(`
findings (noise floor, from the control row: ~${(noise * 100).toFixed(0)}%)

C is the one that matters and is barely an optimization: parseZoneInfo built a
fresh Intl.DateTimeFormat per value, so any pattern containing a zone name paid
formatter construction per formatted value. Routing it through luxon's existing
getCachedDTF saves ${saved(abbr, 'luxon +C zoneInfoCache')} of that format's cost — ${(abbr.get('luxon (stock)')! / abbr.get('moment')!).toFixed(1)}× moment down to
${(abbr.get('luxon +C zoneInfoCache')! / abbr.get('moment')!).toFixed(1)}× — as a one-line change.

The other seven are all allocation-shaving, and none is individually dramatic.
Measured against the easy-tz zone (numeric): B ${saved(num, 'easytz +B parseFormatCache')}, A ${saved(num, 'easytz +A numFast')}, D ${saved(num, 'easytz +D localeIntern')}, G ${saved(num, 'easytz +G padStart2')},
H ${saved(num, 'easytz +H tsToObjMath')}, F ${saved(num, 'easytz +F intRoundTo')}, E ${saved(num, 'easytz +E tokenLoop')}, against a ${saved(num, 'easytz zone (control)')} noise floor. They stack rather than
overlap: together they take that path from ${ratio(num, 'easytz zone')}× moment to ${ratio(num, 'easytz zone ABCDEFGH')}×, and stock luxon
from ${ratio(num, 'luxon (stock)')}× to ${ratio(num, 'luxon ABCDEFGH')}× — without touching a public API or changing a byte of
output.

E and F are the two to drop. Skipping the token switch for punctuation and
skipping roundTo for integers both looked obvious in a profile and both turn out
to cost about what they save. H is the only patch that rewrites logic rather than
adding a cache, so it carries the most review risk for ${saved(num, 'easytz +H tsToObjMath')}; it is verified against
Date's own getters over 200k random instants across the full range, but it is
still the first one to cut if a reviewer pushes back.

What is left after all eight is structural. Profiling the patched build puts
~⅓ of a numeric format in tokenToString plus stringifyTokens: the token list is
cached by B, but each token is still re-dispatched through a ~70-case switch per
value, and formatDateTimeFromString allocates eight closures per call to do it.
Resolving each token to a handler once per pattern — compiling the format rather
than interpreting it — is the natural next step and would subsume A, E, F and G.
That is a real change to Formatter's structure, not a memoization, so it is
noted here rather than attempted.

Externally, easy-tz alone still beats all eight patches (${ratio(num, 'easytz zone')}× / ${ratio(abbr, 'easytz zone')}× vs
${ratio(num, 'luxon ABCDEFGH')}× / ${ratio(abbr, 'luxon ABCDEFGH')}×), and the two compose to ${ratio(num, 'easytz zone ABCDEFGH')}× / ${ratio(abbr, 'easytz zone ABCDEFGH')}× — faster than moment on
both. Skipping the Formatter entirely for known patterns is another ${(num.get('easytz zone')! / num.get('easytz fast path')!).toFixed(0)}× beyond
that, so the upstream patches are worth filing on their own merits rather than
as a dependency of this work.

Recommended to file: C on its own (largest win, one line, hardest to argue
with), then A, B, D and G as a small allocation-reduction set. Skip E and F.`);
}

if (sink < 0) throw new Error('unreachable');
