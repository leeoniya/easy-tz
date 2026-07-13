// Audits the curated maps in shared/abbrs.ts against the runtime's current
// CLDR data, so drift is caught when tzdata/CLDR/ICU changes. Abbreviations
// themselves need human curation (no runtime API provides them) — this
// script tells you exactly what to look at:
//
//   ERROR  zoneAliases whose alias target no longer matches the zone's
//          offsets (alias would silently produce wrong results)
//   ERROR  zoneAliases / zoneAbbrOverrides referencing unknown zones
//   WARN   CLDR long names now resolved by the initials heuristic (not in
//          abbrOverrides) — verify each derived abbr, add overrides if wrong
//   WARN   abbrOverrides entries for long names no longer observed (stale)
//   INFO   zones falling back to compact GMT abbrs (no CLDR metazone) —
//          candidates for new zoneAliases / zoneAbbrOverrides entries
//
// Exits 1 on ERROR, 0 otherwise. Run: bun run audit
//
// Long names are collected at semi-monthly instants across the current year,
// which covers every seasonal metazone variant (DST periods all span months).

import { zones } from '../shared/zones.ts';
import { abbrOverrides, zoneAliases, zoneAbbrOverrides } from '../shared/abbrs.ts';
import { fmtCache, tzNameFromFormat, initialsAbbr, compactGmt } from '../shared/fmt.ts';

const YEAR = new Date().getUTCFullYear();

const samples: Date[] = [];

for (let m = 0; m < 12; m++) {
  for (const d of [1, 15]) samples.push(new Date(Date.UTC(YEAR, m, d, 12)));
}

const longFmt = fmtCache({ timeZoneName: 'long' });
const offsetFmt = fmtCache({ timeZoneName: 'longOffset' });

// long name -> zones observed using it at some point in the year
const observed = new Map<string, Set<string>>();

for (const z of zones) {
  for (const d of samples) {
    const name = tzNameFromFormat(longFmt(z).format(d));
    (observed.get(name) ?? observed.set(name, new Set()).get(name)!).add(z);
  }
}

let errors = 0;
const report: string[] = [];

// --- zoneAliases: unknown zones, or offset behavior diverged from target ---
const known = new Set(zones);

for (const [src, target] of Object.entries(zoneAliases)) {
  if (!known.has(src) || !known.has(target)) {
    errors++;
    report.push(`ERROR zoneAliases: unknown zone in '${src}' -> '${target}'`);
    continue;
  }

  for (const d of samples) {
    const srcOff = tzNameFromFormat(offsetFmt(src).format(d));
    const tgtOff = tzNameFromFormat(offsetFmt(target).format(d));

    if (srcOff !== tgtOff) {
      errors++;
      report.push(
        `ERROR zoneAliases: '${src}' (${srcOff}) diverged from '${target}' (${tgtOff}) at ${d.toISOString()}`
      );
      break;
    }
  }
}

// --- zoneAbbrOverrides: unknown zones ---
for (const z of Object.keys(zoneAbbrOverrides)) {
  if (!known.has(z)) {
    errors++;
    report.push(`ERROR zoneAbbrOverrides: unknown zone '${z}'`);
  }
}

// --- long names by resolution path ---
const viaInitials: string[] = [];
const viaGmt: string[] = [];

for (const name of [...observed.keys()].sort()) {
  if (name in abbrOverrides) continue;

  const initials = initialsAbbr(name);

  if (initials !== null) viaInitials.push(`${name} -> ${initials}`);
  else viaGmt.push(name);
}

if (viaInitials.length > 0) {
  report.push(`WARN ${viaInitials.length} long names resolved by initials heuristic (verify each):`);
  for (const line of viaInitials) report.push(`  ${line}`);
}

// --- stale overrides ---
const stale = Object.keys(abbrOverrides).filter((name) => !observed.has(name));

if (stale.length > 0) {
  report.push(`WARN ${stale.length} abbrOverrides entries no longer observed in ${YEAR} (stale?):`);
  for (const name of stale) report.push(`  ${name} -> ${abbrOverrides[name]}`);
}

// --- zones with GMT-style fallback abbrs ---
const aliased = new Set(Object.keys(zoneAliases));
const overridden = new Set(Object.keys(zoneAbbrOverrides));
const gmtZones: string[] = [];

for (const name of viaGmt) {
  for (const z of observed.get(name)!) {
    if (!aliased.has(z) && !overridden.has(z)) gmtZones.push(`${z} (${compactGmt(name)})`);
  }
}

if (gmtZones.length > 0) {
  const uniq = [...new Set(gmtZones)].sort();
  report.push(`INFO ${uniq.length} zones use compact GMT abbrs (no CLDR metazone; expected for Etc/* etc.):`);
  for (const z of uniq) report.push(`  ${z}`);
}

console.log(`audited ${zones.length} zones, ${observed.size} distinct long names in ${YEAR}\n`);
console.log(report.join('\n'));
console.log(`\n${errors} error(s)`);

if (errors > 0) process.exit(1);
