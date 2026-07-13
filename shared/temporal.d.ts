// Minimal ambient surface for the Temporal API used by impl 08's verified
// fast path. Temporal ships in modern Chrome/Firefox (2026) but not Safari,
// bun, or node 26, so it's always feature-detected before use.

interface TemporalZonedDateTime {
  offset: string;
  epochMilliseconds: number;
  getTimeZoneTransition(direction: 'next'): TemporalZonedDateTime | null;
}

// eslint-disable-next-line no-var
declare var Temporal:
  | {
      Instant: {
        fromEpochMilliseconds(ms: number): {
          toZonedDateTimeISO(timeZone: string): TemporalZonedDateTime;
        };
      };
    }
  | undefined;
