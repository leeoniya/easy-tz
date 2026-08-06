// History-free core of the baked resolver: the year-independent schedule
// (shared/schedule.ts) resolution shared by every baked path. Deliberately has
// NO dependency on shared/history.ts, so a consumer that imports only the
// schedule-only entry point (getTimeZones(), which resolves the current
// instant — always the bake year or later) lets the baked history eras
// tree-shake out of the bundle entirely. shared/bakedHistory.ts layers the
// historical eras on top of this.

import type { TimeZoneInfo } from './types.ts';
import { zones } from './zones.ts';
import { scheduleClasses, YEAR_START, STEP_MS } from './schedule.ts';
import { resolveClass, buildScheduleIndex, type ZoneState } from './rules.ts';
import { makeInfo, zoneLinks } from './zoneLinks.ts';
import { etcZoneInfo } from './etcZones.ts';

// zones-list order -> schedule class index (bridging spelling variants, i.e.
// tzdata backward links; -1 = not covered even after bridging). Resolved once.
export const classIdx = buildScheduleIndex(zones, scheduleClasses);

// zone name -> its index in `zones`. Both canonical and legacy spellings are
// enumerated in `zones`, so most lookups hit directly; the zoneLinks fallback
// bridges any remaining alias exactly as buildScheduleIndex does. Built once.
const nameIdx = new Map<string, number>();
for (let z = 0; z < zones.length; z++) nameIdx.set(zones[z]!, z);

// index of `name` in the zones list (bridging alias spellings); -1 if unknown.
export function zoneIndexOf(name: string): number {
  const z = nameIdx.get(name);

  if (z != null) return z;

  const bridged = zoneLinks.get(name);

  return bridged != null ? nameIdx.get(bridged) ?? -1 : -1;
}

// Fast path in front of makeInfo() for the resolvers below. resolveClass()
// returns a state object OWNED by the decoded schedule (interned for every
// kind, see shared/rules.ts), so a zone's answer is fully determined by
// (zone index, state identity) — while makeInfo() has to re-hash the name
// string, the abbr and the offset through three chained Maps, which was the
// single largest cost in a full-list miss.
//
// Two slots per zone, compared by identity: a zone has one state if it doesn't
// observe DST and two if it does, so after at most two misses a zone never
// misses again. (The four irregular Ramadan-rule zones have three; they just
// fall through to makeInfo sometimes.) Two arrays of two slots cost ~15KB for
// the whole list — a Map per zone would be an order of magnitude more, to hold
// the same one or two entries.
//
// Misses delegate to makeInfo(), so the global pool remains the one source of
// interned identity: a slot here always holds the same frozen instance
// getTimeZoneAt() hands back for that zone and state.
const stateA: (ZoneState | undefined)[] = new Array(zones.length);
const infoA: (TimeZoneInfo | undefined)[] = new Array(zones.length);
const stateB: (ZoneState | undefined)[] = new Array(zones.length);
const infoB: (TimeZoneInfo | undefined)[] = new Array(zones.length);

function zoneStateInfo(z: number, st: ZoneState): TimeZoneInfo {
  if (stateA[z] === st) return infoA[z]!;
  if (stateB[z] === st) return infoB[z]!;

  const info = makeInfo(zones[z]!, st.abbr, st.offMin);

  // keep the two most recent, so a DST zone's pair both stay resident
  stateB[z] = stateA[z];
  infoB[z] = infoA[z];
  stateA[z] = st;
  infoA[z] = info;

  return info;
}

// schedule-only resolution of ONE zone at `timestamp`: the bake-year-onward
// answer, and the fallthrough for historical years whose history defers or is
// absent. `ci` is the zone's schedule class index (-1 = uncovered -> a
// fixed-offset Etc id if the name is one, else the UTC sentinel). The optional
// cache resolves each class at most once across the all-zones loop and reuses
// it (avg ~2.5 zones/class).
//
// `z` is the caller's zones-list index, enabling the identity cache above; the
// all-zones loops pass it, single-zone callers needn't. It is honored only when
// `name` really is zones[z]: a single-zone lookup can arrive under a bridged
// alias spelling, and that answer has to keep the caller's spelling.
//
// Every baked route to an uncovered name passes through here — both single-zone
// APIs on impls 07 and 10 — so it's the one place the Etc/GMT±N fallback has to
// be wired (see shared/etcZones.ts for why those need it).
export function scheduleZoneInfo(
  name: string,
  ci: number,
  timestamp: number,
  schedCache?: (ZoneState | undefined)[],
  z = -1,
): TimeZoneInfo {
  if (ci < 0) return etcZoneInfo(name) ?? makeInfo(name, 'UTC', 0);

  let st = schedCache != null ? schedCache[ci] : undefined;

  if (st == null) {
    st = resolveClass(scheduleClasses[ci]!, timestamp, YEAR_START, STEP_MS);
    if (schedCache != null) schedCache[ci] = st;
  }

  return z >= 0 && zones[z] === name ? zoneStateInfo(z, st) : makeInfo(name, st.abbr, st.offMin);
}

// schedule-only single-zone resolver: the history-free counterpart to
// shared/bakedHistory.ts's getTimeZoneAt(), reached via getTimeZone() at the
// current instant (always the bake year or later, so there is no history to
// consult). Living HERE rather than in bakedHistory.ts is what lets a consumer
// importing only the current-instant APIs drop the baked eras. Unknown names
// return undefined; uncovered fixed-offset Etc ids are still resolved.
export function scheduleGetTimeZoneAt(name: string, timestamp: number): TimeZoneInfo | undefined {
  const z = zoneIndexOf(name);

  return z === -1 ? etcZoneInfo(name) ?? undefined : scheduleZoneInfo(name, classIdx[z]!, timestamp, undefined, z);
}

// full schedule-only response at `timestamp` (no history). Importing only this
// path (via getTimeZones()) keeps shared/history.ts and its baked eras out of
// the bundle. Loops the same per-zone resolver as scheduleZoneInfo, with a
// per-class cache so each class is resolved once and shared across its zones.
export function computeSchedule(timestamp: number): TimeZoneInfo[] {
  const schedCache = new Array<ZoneState | undefined>(scheduleClasses.length);
  const out: TimeZoneInfo[] = new Array(zones.length);

  for (let z = 0; z < zones.length; z++) {
    out[z] = scheduleZoneInfo(zones[z]!, classIdx[z]!, timestamp, schedCache, z);
  }

  return out;
}
