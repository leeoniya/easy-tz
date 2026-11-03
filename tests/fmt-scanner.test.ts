import { describe, expect, test } from 'bun:test';
import { abbrOverrides } from '../shared/abbrs.ts';
import { readZoneSample, type ZoneSample } from '../shared/fmt.ts';

describe('Russian abbreviation overrides', () => {
  // Literal CLDR vocabulary keeps these independent of the host ICU/tzdata.
  // Summer values follow tzdata 2014j's letter abbreviations, not standard time.
  test.each([
    ['Moscow', 'MSK', 'MSD'],
    ['Samara', 'SAMT', 'SAMST'],
    ['Volgograd', 'MSK', 'VOLST'], // Preserve the existing modern standard override.
    ['Yekaterinburg', 'YEKT', 'YEKST'],
    ['Omsk', 'OMST', 'OMSST'],
    ['Novosibirsk', 'NOVT', 'NOVST'],
    ['Krasnoyarsk', 'KRAT', 'KRAST'],
    ['Irkutsk', 'IRKT', 'IRKST'],
    ['Yakutsk', 'YAKT', 'YAKST'],
    ['Vladivostok', 'VLAT', 'VLAST'],
    ['Magadan', 'MAGT', 'MAGST'],
    ['Sakhalin', 'SAKT', 'SAKST'],
    ['Anadyr', 'ANAT', 'ANAST'],
    ['Petropavlovsk-Kamchatski', 'PETT', 'PETST'],
    ['Kamchatka', 'PETT', 'PETST'],
  ])('%s keeps standard and summer labels distinct', (name, standard, summer) => {
    expect(abbrOverrides[`${name} Standard Time`]).toBe(standard);
    expect(abbrOverrides[`${name} Summer Time`]).toBe(summer);
  });
});

function fakeFormatter(parts: Intl.DateTimeFormatPart[]) {
  const formatted = parts.map((part) => part.value).join('');
  let formatCalls = 0;
  let partsCalls = 0;

  return {
    fmt: {
      format() {
        formatCalls++;
        return formatted;
      },
      formatToParts() {
        partsCalls++;
        return parts;
      },
    } as unknown as Intl.DateTimeFormat,
    calls: () => ({ formatCalls, partsCalls }),
  };
}

describe('readZoneSample format scanner', () => {
  test('scans the live path with seconds after validating once', () => {
    const timestamp = Date.UTC(2026, 0, 15, 12, 34, 56);
    const fake = fakeFormatter([
      { type: 'month', value: '1' },
      { type: 'literal', value: '/' },
      { type: 'day', value: '15' },
      { type: 'literal', value: '/' },
      { type: 'year', value: '2026' },
      { type: 'literal', value: ', ' },
      { type: 'hour', value: '07' },
      { type: 'literal', value: ':' },
      { type: 'minute', value: '34' },
      { type: 'literal', value: ':' },
      { type: 'second', value: '56' },
      { type: 'literal', value: ' ' },
      { type: 'timeZoneName', value: 'Eastern Standard Time' },
    ]);
    const out: ZoneSample = { longName: '', offMin: 0 };

    readZoneSample(fake.fmt, timestamp, out);
    expect(out).toEqual({ longName: 'Eastern Standard Time', offMin: -300 });
    expect(fake.calls()).toEqual({ formatCalls: 1, partsCalls: 1 });

    readZoneSample(fake.fmt, timestamp, out);
    expect(out).toEqual({ longName: 'Eastern Standard Time', offMin: -300 });
    expect(fake.calls()).toEqual({ formatCalls: 2, partsCalls: 1 });
  });

  test('scans the generator path without seconds after validating once', () => {
    const timestamp = Date.UTC(2026, 6, 15, 12, 34);
    const fake = fakeFormatter([
      { type: 'month', value: '7' },
      { type: 'literal', value: '/' },
      { type: 'day', value: '15' },
      { type: 'literal', value: '/' },
      { type: 'year', value: '2026' },
      { type: 'literal', value: ', ' },
      { type: 'hour', value: '18' },
      { type: 'literal', value: ':' },
      { type: 'minute', value: '04' },
      { type: 'literal', value: ' ' },
      { type: 'timeZoneName', value: 'India Standard Time' },
    ]);
    const out: ZoneSample = { longName: '', offMin: 0 };

    readZoneSample(fake.fmt, timestamp, out);
    readZoneSample(fake.fmt, timestamp, out);

    expect(out).toEqual({ longName: 'India Standard Time', offMin: 330 });
    expect(fake.calls()).toEqual({ formatCalls: 2, partsCalls: 1 });
  });

  test('keeps using formatToParts for an unsupported field layout', () => {
    const timestamp = Date.UTC(2026, 0, 15, 12);
    const fake = fakeFormatter([
      { type: 'year', value: '2026' },
      { type: 'literal', value: '-' },
      { type: 'month', value: '01' },
      { type: 'literal', value: '-' },
      { type: 'day', value: '15' },
      { type: 'literal', value: ' ' },
      { type: 'hour', value: '12' },
      { type: 'literal', value: ':' },
      { type: 'minute', value: '00' },
      { type: 'literal', value: ' ' },
      { type: 'timeZoneName', value: 'Coordinated Universal Time' },
    ]);
    const out: ZoneSample = { longName: '', offMin: 0 };

    readZoneSample(fake.fmt, timestamp, out);
    readZoneSample(fake.fmt, timestamp, out);

    expect(out).toEqual({ longName: 'Coordinated Universal Time', offMin: 0 });
    expect(fake.calls()).toEqual({ formatCalls: 1, partsCalls: 2 });
  });
});
