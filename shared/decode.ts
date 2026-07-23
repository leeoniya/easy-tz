// Decoders for the packed generated tables (see tools/emitters.ts for the
// encoding). Packing exists purely to shrink MINIFIED bundle size: minifiers
// can't mangle object keys or string contents, so the tables ship as
// delimited strings with a zone-name prefix dictionary and offsets as signed
// minutes. All decoding runs once at module load (<1ms) and produces the
// structures consumed by shared/rules.ts.
//
// Delimiters: '|' between classes/groups, '~' between class fields, ';'
// between zones, ',' between values. None occur in IANA zone names or
// abbreviations.

import type { ScheduleClass, Rule, ZoneState, HistoryClass, HistoryEra } from './rules.ts';

// "<base36 prefix idx><leaf>" -> full zone name
function decodeZone(prefixes: string[], z: string): string {
  return prefixes[parseInt(z[0]!, 36)]! + z.slice(1);
}

const decodeZones = (prefixes: string[], packed: string): string[] =>
  packed.split(';').map((z) => decodeZone(prefixes, z));

export function decodeGroups(prefixesPacked: string, groupsPacked: string): string[][] {
  const prefixes = prefixesPacked.split('|');

  return groupsPacked.split('|').map((g) => decodeZones(prefixes, g));
}

export function decodeSchedule(
  prefixesPacked: string,
  staticsPacked: string,
  rulesPacked: string,
  irregularsPacked: string
): ScheduleClass[] {
  const prefixes = prefixesPacked.split('|');
  const out: ScheduleClass[] = [];

  if (staticsPacked !== '') {
    for (const c of staticsPacked.split('|')) {
      const [zs, abbr, offMin] = c.split('~');
      out.push({ zones: decodeZones(prefixes, zs!), kind: 0, states: [{ abbr: abbr!, offMin: +offMin! }] });
    }
  }

  if (rulesPacked !== '') {
    for (const c of rulesPacked.split('|')) {
      const [zs, s0, s1, r0, r1] = c.split('~');

      const state = (s: string): ZoneState => {
        const cut = s.lastIndexOf(',');
        return { abbr: s.slice(0, cut), offMin: +s.slice(cut + 1) };
      };

      const rule = (r: string): Rule => {
        const [month, nth, dow, atMin, to] = r.split(',').map(Number);
        return { month: month!, nth: nth!, dow: dow!, atMin: atMin!, to: to! as 0 | 1 };
      };

      out.push({
        zones: decodeZones(prefixes, zs!),
        kind: 1,
        states: [state(s0!), state(s1!)],
        rules: [rule(r0!), rule(r1!)],
      });
    }
  }

  if (irregularsPacked !== '') {
    for (const c of irregularsPacked.split('|')) {
      const [zs, starts, abbrs, offMins] = c.split('~');

      out.push({
        zones: decodeZones(prefixes, zs!),
        kind: 2,
        starts: starts!.split(',').map(Number),
        abbrs: abbrs!.split(','),
        offMins: offMins!.split(',').map(Number),
      });
    }
  }

  return out;
}

// history tables. Zone names are NOT repeated: zones are 2-char base36
// indices into the schedule table's decoded zone enumeration (see
// emitHistoryTs for the ordering contract). Era payloads live in a '|'-
// delimited dictionary (they repeat heavily across classes — e.g. the US
// 1987-2006 rule era serves dozens of classes); each class references them
// as fixed-width 3-char '<fromYear-fromYearBase, base36><dictIdx, 2ch b36>'
// codes. Offsets and wall minutes are quarter-hour units (x15 -> minutes).
//
// Two more shared dictionaries factor the rule payloads (the bulk of the
// data), so a rule payload is a fixed, comma-free 7 chars:
//   pairsPacked   '|'-delimited 'qA,qB' offset pairs; ~38 distinct across
//                 hundreds of rule spans, so a 2-char index beats inlining
//   tuplesPacked  fixed 5-char 'm,n,d,at' rule tuples with NO delimiters:
//                 [month 1ch][nth 1ch][dow 1ch][at 2ch] base36
// Payloads:
//   s<off>                                      static span
//   r<pair 2ch b36><t1 2ch b36><t2 2ch b36>      rule span; pair -> offset
//       pair, t1/t2 -> tuples; to flags implicit by construction: rule 1
//       switches to offs[1], rule 2 back to offs[0]
//   w<step 3ch b36><off>(,<step><off>)*          raw single year, 15-min steps
//   d                                            defer span: the zone's
//       schedule class is exact here; resolveHistory returns null
export function decodeHistory(
  zoneList: readonly string[],
  pairsPacked: string,
  tuplesPacked: string,
  erasPacked: string,
  classesPacked: string,
  fromYearBase: number
): HistoryClass[] {
  if (classesPacked === '') return [];

  const pairs = pairsPacked.split('|').map((p) => p.split(',').map((v) => +v * 15));
  const dict = erasPacked.split('|');

  // fixed 5-char tuples, no delimiters: [m][n][d][at 2ch]
  const tupleRule = (i: number, to: 0 | 1): Rule => {
    const o = i * 5;
    return {
      month: parseInt(tuplesPacked[o]!, 36),
      nth: parseInt(tuplesPacked[o + 1]!, 36),
      dow: parseInt(tuplesPacked[o + 2]!, 36),
      atMin: parseInt(tuplesPacked.slice(o + 3, o + 5), 36) * 15,
      to,
    };
  };

  const decodeEra = (fromYear: number, p: string): HistoryEra => {
    const type = p[0]!;
    const payload = p.slice(1);

    if (type === 'd') return { fromYear, kind: 3, offs: [], rules: null, steps: null };

    if (type === 's') return { fromYear, kind: 0, offs: [+payload * 15], rules: null, steps: null };

    if (type === 'r') {
      const [qA, qB] = pairs[parseInt(payload.slice(0, 2), 36)]!;

      return {
        fromYear,
        kind: 1,
        offs: [qA!, qB!],
        rules: [
          tupleRule(parseInt(payload.slice(2, 4), 36), 1),
          tupleRule(parseInt(payload.slice(4, 6), 36), 0),
        ],
        steps: null,
      };
    }

    const steps: number[] = [];
    const offs: number[] = [];

    for (const seg of payload.split(',')) {
      steps.push(parseInt(seg.slice(0, 3), 36));
      offs.push(+seg.slice(3) * 15);
    }

    return { fromYear, kind: 2, offs, rules: null, steps };
  };

  return classesPacked.split('|').map((c) => {
    const cut = c.indexOf('~');
    const zs = c.slice(0, cut);
    const es = c.slice(cut + 1);

    const zones: string[] = [];

    for (let i = 0; i < zs.length; i += 2) {
      zones.push(zoneList[parseInt(zs.slice(i, i + 2), 36)]!);
    }

    const eras: HistoryEra[] = [];

    for (let i = 0; i < es.length; i += 3) {
      eras.push(decodeEra(fromYearBase + parseInt(es[i]!, 36), dict[parseInt(es.slice(i + 1, i + 3), 36)]!));
    }

    return { zones, eras };
  });
}
