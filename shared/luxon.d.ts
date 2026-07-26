// luxon@3.7.2 ships no type declarations of its own — they live in the separate
// @types/luxon package, which this repo deliberately doesn't install. Minimal
// ambient surface for what bench/luxon-format.ts uses, including enough of the
// Zone/IANAZone shape to subclass IANAZone and override its offset lookups.

declare module 'luxon' {
  export interface OffsetNameOpts {
    format: 'short' | 'long';
    locale?: string;
  }

  export abstract class Zone {
    get type(): string;
    get name(): string;
    get isUniversal(): boolean;
    get isValid(): boolean;
    /** UTC offset at `ts` in signed minutes (east positive) */
    offset(ts: number): number;
    /** e.g. "EST" (short) or "Eastern Standard Time" (long); null if unavailable */
    offsetName(ts: number, opts: OffsetNameOpts): string | null;
    formatOffset(ts: number, format: 'narrow' | 'short' | 'techie'): string;
    equals(other: Zone): boolean;
  }

  export class IANAZone extends Zone {
    static create(name: string): IANAZone;
    static isValidZone(zone: string): boolean;
    static resetCache(): void;
    constructor(name: string);
  }

  export class FixedOffsetZone extends Zone {
    static get utcInstance(): FixedOffsetZone;
    static instance(offset: number): FixedOffsetZone;
  }

  export class SystemZone extends Zone {
    static get instance(): SystemZone;
  }

  export interface DateTimeOpts {
    zone?: string | Zone;
    locale?: string;
  }

  export class DateTime {
    static fromMillis(ms: number, opts?: DateTimeOpts): DateTime;
    get ts(): number;
    get zone(): Zone;
    get zoneName(): string;
    get offset(): number;
    get isValid(): boolean;
    get invalidReason(): string | null;
    setZone(zone: string | Zone): DateTime;
    toFormat(fmt: string, opts?: Record<string, unknown>): string;
    toISO(): string | null;
  }

  export const Settings: {
    defaultZone: string | Zone;
    defaultLocale: string;
  };
}
