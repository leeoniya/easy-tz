// Decoders for the packed generated tables (see tools/emitters.ts for the
// encoding). Packing exists purely to shrink MINIFIED bundle size: minifiers
// can't mangle object keys or string contents, so the tables ship as
// delimited strings with a zone-name prefix dictionary, an abbreviation
// dictionary (base36 indices), and offsets as signed minutes. All decoding
// runs once at module load (<1ms) and produces the same in-memory structures
// the impls always used.
//
// Delimiters: '|' between classes/groups, ';' between list items, ','
// between segment values. None occur in IANA zone names or abbreviations.

import { formatOffsetMinutes } from './fmt.ts';

export interface ScheduleClass {
  zones: string[];
  starts: number[];
  abbrs: string[];
}

// "<base36 prefix idx><leaf>" -> full zone name
function decodeZone(prefixes: string[], z: string): string {
  return prefixes[parseInt(z[0]!, 36)]! + z.slice(1);
}

export function decodeGroups(prefixesPacked: string, groupsPacked: string): string[][] {
  const prefixes = prefixesPacked.split('|');

  return groupsPacked.split('|').map((g) => g.split(';').map((z) => decodeZone(prefixes, z)));
}

export function decodeSchedule(
  prefixesPacked: string,
  zonesPacked: string,
  startsPacked: string,
  abbrDictPacked: string,
  abbrsPacked: string
): ScheduleClass[] {
  const prefixes = prefixesPacked.split('|');
  const dict = abbrDictPacked.split(';');
  const zoneLists = zonesPacked.split('|');
  const startLists = startsPacked.split('|');
  const abbrLists = abbrsPacked.split('|');

  return zoneLists.map((zl, i) => ({
    zones: zl.split(';').map((z) => decodeZone(prefixes, z)),
    starts: startLists[i]!.split(',').map(Number),
    abbrs: abbrLists[i]!.split(',').map((a) => dict[parseInt(a, 36)]!),
  }));
}

// per-class ','-joined signed minutes -> "-04:00" style strings
export function decodeOffsets(offsetsPacked: string): string[][] {
  return offsetsPacked.split('|').map((c) => c.split(',').map((m) => formatOffsetMinutes(+m)));
}
