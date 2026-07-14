// Minimal ambient surface for the Temporal API used by the verified/audited
// fast paths (impls 08/10). Temporal ships in modern Chrome/Firefox and
// official Node >= 26 builds (2026), but not Safari, bun, or Node compiled
// without the optional Temporal component (it requires a Rust toolchain at
// build time — this environment's node 26.4 is such a build, hence
// `typeof Temporal === 'undefined'` here). Always feature-detected.

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
