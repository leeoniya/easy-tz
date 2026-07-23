import { describe, test, expect } from 'bun:test';
import { formatOffset } from '../shared/offsetFormat.ts';
import { formatOffset as formatOffsetBaked } from '../shared/offsetFormatBaked.ts';
import { formatOffset as buildOffset } from '../shared/fmt.ts';
import { offsetStrings } from '../shared/offsets.ts';

// The public formatOffset() is an O(1) read from the pre-baked offset->string
// lookup (shared/tables/<variant>/offsets.ts) with an on-the-fly fallback. These
// pin the two contracts that keeps sound: every baked string equals what the
// fallback would build (so the fast path can never disagree with the slow one),
// and offsets outside the baked set still format correctly.

describe('formatOffset lookup', () => {
  test('every baked string matches the formatter (fast path == fallback)', () => {
    expect(offsetStrings.size).toBeGreaterThan(0);

    for (const [minutes, str] of offsetStrings) {
      expect(str).toBe(buildOffset(minutes));
      expect(formatOffset(minutes)).toBe(str);
    }
  });

  test('common offsets resolve to ISO strings', () => {
    expect(formatOffset(0)).toBe('+00:00');
    expect(formatOffset(-300)).toBe('-05:00'); // New York EST
    expect(formatOffset(330)).toBe('+05:30'); // Kolkata
    expect(formatOffset(-210)).toBe('-03:30'); // St. John's
    expect(formatOffset(840)).toBe('+14:00'); // Kiritimati
  });

  test('offsets outside the baked set fall back to on-the-fly formatting (live impls)', () => {
    // -90 (-01:30) and 37 are not tzdata offsets, so absent from the lookup;
    // the fallback must still format them (and agree with the builder)
    expect(offsetStrings.has(-90)).toBe(false);
    expect(formatOffset(-90)).toBe('-01:30');
    expect(formatOffset(37)).toBe(buildOffset(37));
  });

  test('baked-impl variant returns baked strings, else "" (no formatter shipped)', () => {
    // 07/10 only ever produce offsets in the set, so hits are identical to the
    // live variant; a miss returns '' rather than pulling the formatter in
    expect(formatOffsetBaked(-300)).toBe('-05:00');
    expect(formatOffsetBaked(0)).toBe('+00:00');
    expect(formatOffsetBaked(-90)).toBe('');
    expect(formatOffsetBaked(37)).toBe('');
  });
});
