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

import type { ScheduleClass, Rule, ZoneState } from './rules.ts';

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
