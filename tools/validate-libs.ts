// Validates the QUALIFIED third-party libraries' built-in timezone
// abbreviation support: winter/summer output for an EET/EEST zone
// (Europe/Kyiv, 2026), with no help from this repo's strategies.
//
// The full 12-candidate evaluation (including the disqualified libraries:
// luxon / date-fns / dayjs / @js-temporal/polyfill — Intl 'short'
// passthroughs emitting "GMT+2"; @tubular/time — GMT±n outside North
// America; @vvo/tzdb — static standard-time abbrs, no timestamp API;
// spacetime — no abbreviation API; @js-joda — errors without the locale
// plugin, generic non-DST names with it) is recorded in comparison.html.
// Those packages were uninstalled after evaluation; this script keeps the
// qualifying probes reproducible.
//
// Run: bun tools/validate-libs.ts

import { printTable } from './print-table.ts';

const WINTER = Date.UTC(2026, 0, 15, 12);
const SUMMER = Date.UTC(2026, 6, 15, 12);
const ZONE = 'Europe/Kyiv';

type Probe = () => [winter: string, summer: string];

const results: string[][] = [];

async function probe(name: string, fn: () => Promise<Probe>): Promise<void> {
  try {
    const p = await fn();
    const [w, s] = p();
    results.push([name, w, s]);
  } catch (e) {
    results.push([name, `error: ${(e as Error).message.slice(0, 40)}`, '-']);
  }
}

await probe('moment-timezone@0.6.2', async () => {
  const moment = (await import('moment-timezone')).default;
  return () => [moment.tz(WINTER, ZONE).zoneAbbr(), moment.tz(SUMMER, ZONE).zoneAbbr()];
});

await probe('timezone-support@3.1.0', async () => {
  const { findTimeZone, getZonedTime } = await import('timezone-support');
  const tz = findTimeZone(ZONE);
  return () => [getZonedTime(new Date(WINTER), tz).zone!.abbreviation!, getZonedTime(new Date(SUMMER), tz).zone!.abbreviation!];
});

await probe('timezonecomplete@5.15.1', async () => {
  const tc = await import('timezonecomplete');
  const zone = tc.zone(ZONE);
  return () => [
    new tc.DateTime(WINTER, tc.utc()).toZone(zone).format('zzz'),
    new tc.DateTime(SUMMER, tc.utc()).toZone(zone).format('zzz'),
  ];
});

await probe('timezone@1.0.23 (bigeasy)', async () => {
  const timezone = (await import('timezone')).default;
  const zonesData = (await import('timezone/zones')).default;
  const tz = timezone(zonesData);
  // 2019-vintage data predates the Kyiv spelling; its data knows Europe/Kiev
  const zone = 'Europe/Kiev';
  return () => [tz(WINTER, '%Z', zone), tz(SUMMER, '%Z', zone)];
});

console.log(`zone: ${ZONE}, winter: 2026-01-15, summer: 2026-07-15 (expected EET / EEST)\n`);
printTable(['library', 'winter', 'summer'], results, true);
