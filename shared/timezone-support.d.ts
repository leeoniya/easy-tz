// timezone-support@3.1.0 ships type declarations, but its package.json
// "exports" map doesn't expose them for the ESM entry, so TS can't resolve
// them. Minimal ambient surface for what this repo uses.

declare module 'timezone-support' {
  export interface TimeZoneOffset {
    abbreviation?: string;
    offset?: number; // minutes WEST of UTC (JS getTimezoneOffset convention)
  }

  export interface TimeZoneRef {
    name: string;
  }

  export function findTimeZone(name: string): TimeZoneRef;
  export function getZonedTime(date: Date, timeZone: TimeZoneRef): { zone?: TimeZoneOffset };
}
