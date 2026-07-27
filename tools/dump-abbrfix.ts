// Dumps a variant's historical abbreviation corrections
// (shared/tables/<variant>/abbrfix.ts) as markdown.
//
// The packed table is unreadable by design, and a correction is meaningless
// without the answer it replaces, so every row pairs the CORRECTED label with
// the one the offset-keyed path would otherwise serve — recomputed here from
// the same variant's schedule + history tables, exactly as shared/bakedHistory
// would resolve it with the overlay switched off.
//
// Spans are stored per PAYLOAD, not per zone: zones with an identical
// correction list share one (Argentina's collapse to a single entry), so the
// row count here is below the per-zone total quoted in the table header.
//
//   bun tools/dump-abbrfix.ts                    # active variant, all spans
//   bun tools/dump-abbrfix.ts --variant chrome
//   bun tools/dump-abbrfix.ts --zone America/    # substring filter
//   bun tools/dump-abbrfix.ts --by-zone          # one row per zone, not payload
//   bun tools/dump-abbrfix.ts --summary          # category breakdown only
//   bun tools/dump-abbrfix.ts > abbrfix.md

import { readFileSync } from 'node:fs';
import { resolveHistory, resolveClass, buildScheduleIndex, type ScheduleClass, type HistoryClass, type AbbrFixClass } from '../shared/rules.ts';
import { historyAbbr } from '../shared/bakedSchedule.ts';
import { gmtLabel } from '../shared/fmt.ts';
import { zones } from '../shared/zones.ts';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);

  return i === -1 ? null : (argv[i + 1] ?? '');
};

const has = (name: string) => argv.includes(`--${name}`);

// default to whatever `bun run tables` last selected, so the dump matches the
// tables the tests and benches are currently running against
const activeVariant = (): string =>
  /tables\/(\w+)\//.exec(readFileSync(new URL('../shared/abbrfix.ts', import.meta.url), 'utf8'))?.[1] ?? 'chrome';

const variant = flag('variant') ?? activeVariant();
const zoneFilter = flag('zone');

const { abbrFixClasses, genMeta, ABBRFIX_FROM } = (await import(`../shared/tables/${variant}/abbrfix.ts`)) as {
  abbrFixClasses: AbbrFixClass[];
  genMeta: { host: string; icu: string | null; generated: string };
  ABBRFIX_FROM: number;
};

const { scheduleClasses, YEAR_START, STEP_MS } = (await import(`../shared/tables/${variant}/schedule.ts`)) as {
  scheduleClasses: ScheduleClass[];
  YEAR_START: number;
  STEP_MS: number;
};

const { historyClasses, HISTORY_TO } = (await import(`../shared/tables/${variant}/history.ts`)) as {
  historyClasses: HistoryClass[];
  HISTORY_TO: number;
};

const classIdx = buildScheduleIndex(zones, scheduleClasses);
const histIdx = buildScheduleIndex(zones, historyClasses);
const zoneIdx = new Map(zones.map((z, i) => [z, i]));

// the offset the corrections are keyed on: the historical era's where one is
// live, else the schedule class's (same rule as tools/abbrfix-core.ts)
function offsetAt(zone: string, ts: number): number {
  const z = zoneIdx.get(zone);

  if (z == null) return 0;

  const hi = histIdx[z]!;
  const off = hi === -1 ? null : resolveHistory(historyClasses[hi]!.eras, ts, STEP_MS);

  return off ?? resolveClass(scheduleClasses[classIdx[z]!]!, ts, YEAR_START, STEP_MS).offMin;
}

// what bakedZoneInfo() would serve at `ts` with the overlay switched off
function uncorrected(zone: string, ts: number): { abbr: string; defer: boolean } {
  const z = zoneIdx.get(zone);

  if (z == null) return { abbr: '?', defer: false };

  const ci = classIdx[z]!;
  const hi = histIdx[z]!;
  const off = hi === -1 ? null : resolveHistory(historyClasses[hi]!.eras, ts, STEP_MS);

  // no era, or an era that defers: the modern schedule class answers
  if (off === null) return { abbr: resolveClass(scheduleClasses[ci]!, ts, YEAR_START, STEP_MS).abbr, defer: true };

  return { abbr: ci < 0 ? gmtLabel(off) : historyAbbr(scheduleClasses[ci]!, off), defer: false };
}

// every label a modern schedule class can still emit: a correction naming
// anything outside this set restores an identity the zone has since left
const liveLabels = new Set<string>();

for (const c of scheduleClasses) {
  if (c.kind === 2) for (const a of c.abbrs) liveLabels.add(a);
  else for (const s of c.states) liveLabels.add(s.abbr);
}

interface RangeRow {
  zones: string[];
  fromYear: number;
  toYear: number;
  offMin: number;
  was: string;
  now: string;
  defer: boolean;
  retired: boolean;
}

interface SpanRow {
  zones: string[];
  from: number;
  to: number;
  days: number;
  was: string;
  now: string;
  defer: boolean;
  retired: boolean;
}

const ranges: RangeRow[] = [];
const spans: SpanRow[] = [];

// a range record carries no timestamp, so find the first instant in its years
// that actually resolves to the keyed offset — that's where the pre-overlay
// answer this record replaces can be read off
function sampleAt(zone: string, fromYear: number, toYear: number, offMin: number): number | null {
  for (let ts = Date.UTC(fromYear, 0, 1); ts < Date.UTC(toYear + 1, 0, 1); ts += 86_400_000) {
    if (offsetAt(zone, ts) === offMin) return ts;
  }

  return null;
}

for (const c of abbrFixClasses) {
  const zs = zoneFilter == null ? c.zones : c.zones.filter((z) => z.includes(zoneFilter));

  if (zs.length === 0) continue;

  // the payload is shared, so the pre-overlay answer is identical for every zone
  // on it; the first is representative
  const rep = zs[0]!;
  const fan = <T extends { zones: string[] }>(row: Omit<T, 'zones'>, out: T[]) => {
    if (has('by-zone')) for (const z of zs) out.push({ ...row, zones: [z] } as T);
    else out.push({ ...row, zones: zs } as T);
  };

  for (let i = 0; i < c.fromYear.length; i++) {
    const offMin = c.offs[i]!;
    const now = c.abbrs[i]!;
    const at = sampleAt(rep, c.fromYear[i]!, c.toYear[i]!, offMin);
    const u = at == null ? { abbr: '?', defer: false } : uncorrected(rep, at);

    fan<RangeRow>(
      { fromYear: c.fromYear[i]!, toYear: c.toYear[i]!, offMin, was: u.abbr, now, defer: u.defer, retired: !liveLabels.has(now) },
      ranges
    );
  }

  for (let i = 0; i < c.spanFrom.length; i++) {
    const from = c.spanFrom[i]!;
    const to = c.spanTo[i]!;
    const now = c.spanAbbrs[i]!;
    const u = uncorrected(rep, from);

    fan<SpanRow>(
      { from, to, days: (to - from) / 86_400_000, was: u.abbr, now, defer: u.defer, retired: !liveLabels.has(now) },
      spans
    );
  }
}

const byZone = (a: { zones: string[] }, b: { zones: string[] }) => a.zones[0]!.localeCompare(b.zones[0]!);

ranges.sort((a, b) => byZone(a, b) || a.fromYear - b.fromYear || a.offMin - b.offMin);
spans.sort((a, b) => byZone(a, b) || a.from - b.from);

// Valid GitHub markdown, padded to fixed column widths so the same output is
// readable straight in a terminal. Renderers strip the padding; nothing else
// downstream cares about it.
const md = (headers: string[], body: string[][], align: ('l' | 'r')[]) => {
  // the delimiter row needs 3 chars minimum to stay valid markdown
  const w = headers.map((h, i) => Math.max(3, h.length, ...body.map((r) => r[i]!.length)));
  const pad = (s: string, i: number) => (align[i] === 'r' ? s.padStart(w[i]!) : s.padEnd(w[i]!));
  const rule = w.map((n, i) => (align[i] === 'r' ? `${'-'.repeat(n - 1)}:` : `:${'-'.repeat(n - 1)}`));

  console.log(`| ${headers.map(pad).join(' | ')} |`);
  console.log(`| ${rule.join(' | ')} |`);
  for (const r of body) console.log(`| ${r.map(pad).join(' | ')} |`);
};

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const dur = (d: number) => (d >= 365 ? `${(d / 365).toFixed(1)}y` : `${Math.round(d)}d`);
const zoneCell = (zs: string[]) => (zs.length === 1 ? `\`${zs[0]}\`` : `\`${zs[0]}\` +${zs.length - 1}`);

const offCell = (m: number) => {
  const s = m < 0 ? '-' : '+';
  const a = Math.abs(m);

  return `${s}${String(Math.trunc(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};

console.log(`# abbrfix — ${variant} tables\n`);
console.log(`Historical abbreviation corrections for ${ABBRFIX_FROM}–${HISTORY_TO - 1}, layered over the`);
console.log(`offset-only history eras. \`was\` is what the offset-keyed path serves without the`);
console.log(`overlay; \`now\` is what live Intl reports and what ships. Only the LABEL differs —`);
console.log(`the offset itself already agrees with Intl.\n`);
console.log(`Records are keyed by (year range, offset), not by timestamp: the wrong label is`);
console.log(`itself a function of the offset, so a record need only say "in these years this`);
console.log(`offset means X". The Spans table holds the residue — years where one offset`);
console.log(`carries two identities and no range can describe it.\n`);
console.log(`\`+N\` after a zone means N further zones share that correction list and are`);
console.log(`omitted; pass --by-zone to list them.\n`);
console.log(`Generated by \`${genMeta.host}\`${genMeta.icu == null ? '' : ` (ICU ${genMeta.icu})`} on ${genMeta.generated.slice(0, 10)}.\n`);

const zoneSet = new Set([...ranges, ...spans].flatMap((r) => r.zones));
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// count payloads still represented after filtering, not the table's total
const payloads = abbrFixClasses.filter((c) => c.zones.some((z) => zoneSet.has(z))).length;

console.log(
  `${plural(ranges.length, 'range record')} · ${plural(spans.length, 'fallback span')} · ` +
    `${plural(zoneSet.size, 'zone')} · ${plural(payloads, 'shared payload')}` +
    (zoneFilter == null ? '' : ` · filtered to \`${zoneFilter}\``) +
    '\n'
);

if (ranges.length === 0 && spans.length === 0) {
  console.log('No corrections match.');
  process.exit(0);
}

const noteCell = (r: { retired: boolean; defer: boolean }) =>
  [r.retired ? 'retired label' : '', r.defer ? 'defer era' : ''].filter(Boolean).join(', ') || '—';

if (has('summary')) {
  const all = [...ranges, ...spans];
  const bucket = (label: string, sel: (r: { retired: boolean; defer: boolean; now: string }) => boolean): string[] => {
    const m = all.filter(sel);

    return [label, String(m.length), `${((m.length / all.length) * 100).toFixed(0)}%`];
  };

  console.log('## Categories\n');
  md(
    ['category', 'records', 'share'],
    [
      bucket('restores a retired label', (r) => r.retired),
      bucket('both labels still in use', (r) => !r.retired),
      bucket('corrects to a vague GMT±N', (r) => r.now.startsWith('GMT')),
      bucket('defer era (schedule answers)', (r) => r.defer),
    ],
    ['l', 'r', 'r']
  );

  const pairs = new Map<string, number>();

  for (const r of all) {
    const k = `\`${r.was}\` → \`${r.now}\``;

    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }

  console.log('\n## Most common corrections\n');
  md(
    ['correction', 'records'],
    [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => [k, String(n)]),
    ['l', 'r']
  );
} else {
  if (ranges.length > 0) {
    console.log('## Range records\n');
    md(
      ['zone', 'years', 'offset', 'was', 'now', 'note'],
      ranges.map((r) => [
        zoneCell(r.zones),
        r.fromYear === r.toYear ? String(r.fromYear) : `${r.fromYear}–${r.toYear}`,
        offCell(r.offMin),
        `\`${r.was}\``,
        `\`${r.now}\``,
        noteCell(r),
      ]),
      ['l', 'l', 'r', 'r', 'r', 'l']
    );
  }

  if (spans.length === 0) process.exit(0);

  console.log(`\n## Fallback spans\n`);
  md(
    ['zone', 'from', 'to', 'span', 'was', 'now', 'note'],
    spans.map((r) => [
      zoneCell(r.zones),
      day(r.from),
      day(r.to),
      dur(r.days),
      `\`${r.was}\``,
      `\`${r.now}\``,
      noteCell(r),
    ]),
    ['l', 'l', 'l', 'r', 'r', 'r', 'l']
  );
}
