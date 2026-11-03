import { describe, expect, test } from 'bun:test';
import { historyExcludedZones, irregularZones, resolveHistory, type ScheduleClass } from '../shared/rules.ts';
import { generateTables, generateHistory, verifyTables } from '../tools/gen-core.ts';
import { auditTableSet } from '../tools/abbrfix-core.ts';

const canadianZones = ['America/Edmonton', 'America/Inuvik', 'America/Vancouver', 'America/Winnipeg'];
const omittedZones = ['Africa/Casablanca', 'Africa/El_Aaiun', 'Asia/Gaza', 'Asia/Hebron'];

const irregular = (zones: string[]): Extract<ScheduleClass, { kind: 2 }> => ({
  zones, kind: 2, starts: [0, 6400], abbrs: ['MST', 'MDT'], offMins: [-420, -360],
});

describe('history exclusions are not schedule classifications', () => {
  test('one-off policy changes retain history, even in a shared irregular class', () => {
    const classes = [irregular([...omittedZones, ...canadianZones])];
    expect([...irregularZones(classes)]).toEqual([...omittedZones, ...canadianZones]);
    expect([...historyExcludedZones(classes)]).toEqual(omittedZones);
  });

  test('formerly irregular zones regain history once their schedule is static', () => {
    const classes: ScheduleClass[] = [{ zones: omittedZones, kind: 0, states: [{ abbr: 'GMT', offMin: 0 }] }];
    expect([...historyExcludedZones(classes)]).toEqual([]);
  });

  test('regular DST schedules are not excluded by zone name', () => {
    const classes: ScheduleClass[] = [{
      zones: omittedZones, kind: 1,
      states: [{ abbr: 'EET', offMin: 120 }, { abbr: 'EEST', offMin: 180 }],
      rules: [
        { month: 3, nth: 5, dow: 0, atMin: 120, to: 1 },
        { month: 10, nth: 5, dow: 0, atMin: 180, to: 0 },
      ],
    }];
    expect([...historyExcludedZones(classes)]).toEqual([]);
  });
});

// A synthetic policy change keeps this regression independent of the host's
// tzdata version. Deliberately wrong labels also exercise the correction audit.
test('the generator retains history and audits labels for a newly irregular zone', () => {
  const tables = generateTables();
  const zone = 'America/Edmonton';
  tables.scheduleClasses = tables.scheduleClasses
    .map((c) => ({ ...c, zones: c.zones.filter((z) => z !== zone) }))
    .filter((c) => c.zones.length > 0);
  tables.scheduleClasses.push({ ...irregular([zone]), abbrs: ['NEW', 'NEW'] });
  tables.year = 2026;
  tables.yearStart = Date.UTC(2026, 0, 1);

  // A future-year mismatch must not disappear merely because this is kind 2.
  const verification = verifyTables({ ...tables, years: [2027] });
  expect(verification.mismatches.some((m) => m.zone === zone && m.got.startsWith('NEW '))).toBe(true);

  const history = generateHistory(tables, 2025);
  const eras = history.classes.find((c) => c.zones.includes(zone))?.eras;
  expect(eras).toBeDefined();
  expect(history.boundaries[zone]!.length).toBeGreaterThan(1);

  for (const [ts, offset] of [
    [Date.UTC(2025, 0, 15), -420],
    [Date.UTC(2025, 2, 9, 8, 59), -420],
    [Date.UTC(2025, 2, 9, 9), -360],
    [Date.UTC(2025, 6, 15), -360],
    [Date.UTC(2025, 10, 2, 7, 59), -360],
    [Date.UTC(2025, 10, 2, 8), -420],
  ] as const) {
    expect(resolveHistory(eras!, ts, tables.stepMs)).toBe(offset);
  }

  const fixes = auditTableSet(tables, history);
  expect(fixes.classes.some((c) => c.zones.includes(zone))).toBe(true);
});
