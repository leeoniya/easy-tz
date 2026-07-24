// Persistent cache for the Intl probes in tools/gen-core.ts — the dominant
// cost of generation:
//   'history'  — generateHistory()'s per-zone 1995+ offset probe (~22s cold)
//   'schedule' — generateTables()'s 3-year (name, offset) probe (~2s cold)
//
// Each kind is keyed by a runtime CONTENT fingerprint (gen-core
// probeFingerprint / scheduleFingerprint): a matching fingerprint means every
// cached zone-year is valid verbatim, so a re-gen only probes what's new (a
// rolled bake year; a widened window). Any change to the runtime's tzdata (or,
// for the schedule, its CLDR names or the bake year) flips the fingerprint and
// the whole cache is ignored — a full, correct re-probe — so a cache can only
// ever speed a correct run, never change its output. A missing/corrupt/
// wrong-schema file simply misses and is rewritten.
//
// Committed per (kind, variant) so a same-runtime re-gen on another machine or
// CI skips probing too. bun-only (node:fs); the Chrome variant round-trips its
// seeds through the page (tools/gen-chrome.ts), keeping I/O on this side.
//
// On disk, `segs` is grouped by zone (the name appears once, not once per year)
// with one year per line, so files stay small AND diff cleanly:
//   "America/Indiana/Marengo":{
//   "1997":"0:-300",
//   "1998":"0:-300"
//   },
// In memory ProbeCache stays a flat "zone|year" -> encoded map (gen-core's
// shape); grouping/flattening happens only here.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { ProbeCache } from './gen-core.ts';

// bump when the on-disk shape changes, to auto-invalidate old files
const SCHEMA = 2;

type Variant = 'bun' | 'chrome';
type Kind = 'history' | 'schedule';

interface CacheFile {
  schema: number;
  fingerprint: string;
  from: number; // window bounds are informational (which range was probed)
  to: number;
  segs: Record<string, Record<string, string>>; // zone -> year -> encoded segs
}

const dirUrl = new URL('./probe-cache/', import.meta.url);
const fileUrl = (kind: Kind, variant: Variant) => new URL(`${kind}-${variant}.json`, dirUrl);

export function loadProbeCache(kind: Kind, variant: Variant): ProbeCache | null {
  try {
    const data = JSON.parse(readFileSync(fileUrl(kind, variant), 'utf8')) as CacheFile;

    if (data.schema !== SCHEMA) return null;

    // flatten zone -> year -> segs back to the in-memory "zone|year" -> segs
    const segs: Record<string, string> = {};

    for (const zone in data.segs) {
      const byYear = data.segs[zone]!;

      for (const year in byYear) segs[`${zone}|${year}`] = byYear[year]!;
    }

    return { fingerprint: data.fingerprint, segs };
  } catch {
    return null; // absent / corrupt / wrong schema -> full probe, then rewrite
  }
}

// grouped by zone (sorted), one year per line (sorted): a runtime change or a
// single new year produces a minimal, reviewable diff rather than reshuffling
export function saveProbeCache(kind: Kind, variant: Variant, cache: ProbeCache, from: number, to: number): void {
  mkdirSync(dirUrl, { recursive: true });

  const byZone = new Map<string, [string, string][]>();

  for (const key of Object.keys(cache.segs)) {
    const cut = key.lastIndexOf('|');
    const zone = key.slice(0, cut);
    const year = key.slice(cut + 1);
    let years = byZone.get(zone);

    if (years == null) {
      years = [];
      byZone.set(zone, years);
    }

    years.push([year, cache.segs[key]!]);
  }

  const zoneBlocks = [...byZone.keys()].sort().map((zone) => {
    const years = byZone
      .get(zone)!
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([y, v]) => `${JSON.stringify(y)}:${JSON.stringify(v)}`);

    return `${JSON.stringify(zone)}:{\n${years.join(',\n')}\n}`;
  });

  const body =
    '{\n' +
    `"schema":${SCHEMA},\n` +
    `"fingerprint":${JSON.stringify(cache.fingerprint)},\n` +
    `"from":${from},\n` +
    `"to":${to},\n` +
    `"segs":{\n${zoneBlocks.join(',\n')}\n}\n` +
    '}\n';

  writeFileSync(fileUrl(kind, variant), body);
}
