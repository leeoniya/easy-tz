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
import { resolveClass, buildScheduleIndex, type ScheduleClass, type ZoneState } from './rules.ts';
import { gmtLabel } from './fmt.ts';
import { makeInfo, zoneLinks } from './zoneLinks.ts';

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

// label for an offset given a schedule class: the class's abbr for that offset
// when it has one, else a generic GMT label. History-independent (reads only
// the schedule class), so the historical labelers below share it.
export function historyAbbr(cls: ScheduleClass, offMin: number): string {
  if (cls.kind === 0) {
    if (cls.states[0].offMin === offMin) return cls.states[0].abbr;
  } else if (cls.kind === 1) {
    for (const st of cls.states) if (st.offMin === offMin) return st.abbr;
  } else {
    for (let i = 0; i < cls.offMins.length; i++) if (cls.offMins[i] === offMin) return cls.abbrs[i]!;
  }

  return gmtLabel(offMin);
}

// schedule-only resolution of ONE zone at `timestamp`: the bake-year-onward
// answer, and the fallthrough for historical years whose history defers or is
// absent. `ci` is the zone's schedule class index (-1 = uncovered -> UTC
// sentinel). The optional cache resolves each class at most once across the
// all-zones loop and reuses it (avg ~2.5 zones/class).
export function scheduleZoneInfo(
  name: string,
  ci: number,
  timestamp: number,
  schedCache?: (ZoneState | undefined)[],
): TimeZoneInfo {
  if (ci < 0) return makeInfo(name, 'UTC', 0);

  let st = schedCache != null ? schedCache[ci] : undefined;

  if (st == null) {
    st = resolveClass(scheduleClasses[ci]!, timestamp, YEAR_START, STEP_MS);
    if (schedCache != null) schedCache[ci] = st;
  }

  return makeInfo(name, st.abbr, st.offMin);
}

// full schedule-only response at `timestamp` (no history). Importing only this
// path (via getTimeZones()) keeps shared/history.ts and its baked eras out of
// the bundle. Loops the same per-zone resolver as scheduleZoneInfo, with a
// per-class cache so each class is resolved once and shared across its zones.
export function computeSchedule(timestamp: number): TimeZoneInfo[] {
  const schedCache = new Array<ZoneState | undefined>(scheduleClasses.length);
  const out: TimeZoneInfo[] = new Array(zones.length);

  for (let z = 0; z < zones.length; z++) {
    out[z] = scheduleZoneInfo(zones[z]!, classIdx[z]!, timestamp, schedCache);
  }

  return out;
}
