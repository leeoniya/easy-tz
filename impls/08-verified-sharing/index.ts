// Attempt 8: 04's live-Intl correctness with 06's formatter sharing, made
// safe by RUNTIME VERIFICATION instead of trust. The generated class table
// is treated as a hint: at first call, each group member's offset behavior
// for the current year is compared against its representative's using
// Temporal's exact transition walk (getTimeZoneTransition — no sampling, no
// formatters, ~1-2 Temporal calls per zone). Members that diverged (e.g. a
// zone whose country changed rules after table generation) are split out and
// format themselves — self-healing, one-time, no per-call cost.
//
// Values (offsets + CLDR long names) always come from live Intl at call
// time, so tzdata/CLDR updates in the runtime are picked up automatically;
// only the SHARING is hinted, and the hint is verified before use.
//
// Residual risk: a CLDR change that renames one grouped zone's metazone
// WITHOUT an offset change passes offset verification and shares the wrong
// name until tables are regenerated (rare: grouped zones share a metazone).
//
// Without Temporal (Safari, bun, Temporal-less Node builds): hints are
// ignored entirely and every zone formats itself — identical behavior and cost to impl 04.

import type { TimeZoneInfo } from '../../shared/types.ts';
import { zones } from '../../shared/zones.ts';
import { zoneAliases, zoneAbbrOverrides } from '../../shared/abbrs.ts';
import { classGroups } from '../../shared/classes.ts';
import { hourBucketMemo } from '../../shared/hourCache.ts';
import { liveParts } from '../../shared/live.ts';
import { makeInfo } from '../../shared/zoneLinks.ts';

export interface InitInfo {
  temporal: boolean;
  verifyMs: number;
  sharedZones: number; // zones served by a representative's formatter
  healedZones: number; // group members split out due to offset divergence
  healedAliases: number; // curated aliases dropped due to offset divergence
}

let initInfo: InitInfo | null = null;
let repOf: Map<string, string> | null = null;
let droppedAliases: Set<string> | null = null;

export const getInitInfo = (): InitInfo | null => initInfo;

// exact offset signature for the current year: initial offset + every
// (transition instant, offset) pair, enumerated by Temporal
function yearSignature(zone: string, start: number, end: number): string {
  let zdt = Temporal!.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(zone);
  let sig = zdt.offset;

  for (;;) {
    const next = zdt.getTimeZoneTransition('next');

    if (next === null || next.epochMilliseconds >= end) break;

    sig += `;${next.epochMilliseconds}:${next.offset}`;
    zdt = next;
  }

  return sig;
}

function init(): void {
  const t0 = performance.now();
  const temporal = typeof Temporal !== 'undefined';

  repOf = new Map();
  droppedAliases = new Set();

  let sharedZones = 0;
  let healedZones = 0;
  let healedAliases = 0;

  if (temporal) {
    const year = new Date().getUTCFullYear();
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);
    const runtimeZones = new Set(zones);

    for (const group of classGroups) {
      const present = group.filter((z) => runtimeZones.has(z));

      if (present.length < 2) continue;

      const rep = present[0]!;
      const repSig = yearSignature(rep, start, end);

      for (let i = 1; i < present.length; i++) {
        if (yearSignature(present[i]!, start, end) === repSig) {
          repOf.set(present[i]!, rep);
          sharedZones++;
        } else {
          healedZones++;
        }
      }
    }

    // the curated metazone aliases are hints too — verify them the same way
    for (const [alias, target] of Object.entries(zoneAliases)) {
      if (!runtimeZones.has(alias) || !runtimeZones.has(target)) continue;

      if (yearSignature(alias, start, end) !== yearSignature(target, start, end)) {
        droppedAliases.add(alias);
        healedAliases++;
      }
    }
  }

  initInfo = { temporal, verifyMs: performance.now() - t0, sharedZones, healedZones, healedAliases };
}

// the zone whose live Intl output represents `name`: the curated metazone alias
// (unless it offset-diverged at init) resolved to its verified group
// representative. Shared by the all-zones loop and the single-zone resolver.
function formatZoneOf(name: string): string {
  const aliased = zoneAliases[name] !== undefined && !droppedAliases!.has(name) ? zoneAliases[name]! : name;

  return repOf!.get(aliased) ?? aliased;
}

function compute(timestamp: number): TimeZoneInfo[] {
  if (repOf === null) init();

  const date = new Date(timestamp);
  const out: TimeZoneInfo[] = [];
  const repResults = new Map<string, { abbr: string; offset: string }>();

  for (const name of zones) {
    const fmtZone = formatZoneOf(name);

    let res = repResults.get(fmtZone);

    if (res === undefined) {
      res = liveParts(fmtZone, timestamp, date);
      repResults.set(fmtZone, res);
    }

    out.push(makeInfo(name, zoneAbbrOverrides[name] ?? res.abbr, res.offset));
  }

  return out;
}

const memo = hourBucketMemo(compute);

export const getTimeZonesAt = memo.get;
export const clearCache = memo.clear;

// single-zone resolver (single-zone / many-timestamps use case): resolves just
// `name` via the same representative + override logic the all-zones loop uses.
// The formatter-sharing cache is a per-call all-zones optimization, so it isn't
// needed here — one zone formats once.
export function getTimeZoneAt(name: string, timestamp: number): TimeZoneInfo {
  if (repOf === null) init();

  const res = liveParts(formatZoneOf(name), timestamp, new Date(timestamp));

  return makeInfo(name, zoneAbbrOverrides[name] ?? res.abbr, res.offset);
}
