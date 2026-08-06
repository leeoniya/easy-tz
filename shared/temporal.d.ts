// Minimal ambient surface for the Temporal API used by the verified/audited
// fast paths (impls 08/10). Temporal ships in modern Chrome/Firefox, current
// Bun 1.4, and official Node >= 26 builds that include the optional component,
// but not Safari. Always feature-detected.

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
