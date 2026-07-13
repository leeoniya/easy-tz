// curation-reviewed: 2026-07-13 | IANA NEWS through tzdata 2026c (no fixture
// zones affected: Alberta/Morocco changes don't touch the zones below)
// Maintained by hand — see .cursor/skills/maintain-curated-tz-data/SKILL.md
//
// Expected abbreviations/offsets for 2026, straddling DST boundaries in
// several distinct regions. Transition instants for 2026:
//   US: Mar 8 07:00 UTC (EST -> EDT), Nov 1 06:00 UTC (EDT -> EST)
//   EU: Mar 29 01:00 UTC (CET -> CEST), Oct 25 01:00 UTC (CEST -> CET)
// Cairo (Egypt DST) and Sydney (southern hemisphere) use mid-season instants.

export interface Fixture {
  zone: string;
  // some runtimes enumerate a different canonical name for the same zone
  // (e.g. Chrome lists Asia/Calcutta instead of Asia/Kolkata)
  altZone?: string;
  ts: number;
  abbr: string;
  offset: string;
  desc: string;
}

const utc = (m: number, d: number, h = 0, min = 0) => Date.UTC(2026, m - 1, d, h, min);

export const fixtures: Fixture[] = [
  // America — across both US transitions
  { zone: 'America/New_York', ts: utc(3, 8, 6, 59), abbr: 'EST', offset: '-05:00', desc: '1 min before spring-forward' },
  { zone: 'America/New_York', ts: utc(3, 8, 7, 1), abbr: 'EDT', offset: '-04:00', desc: '1 min after spring-forward' },
  { zone: 'America/New_York', ts: utc(11, 1, 5, 59), abbr: 'EDT', offset: '-04:00', desc: '1 min before fall-back' },
  { zone: 'America/New_York', ts: utc(11, 1, 6, 1), abbr: 'EST', offset: '-05:00', desc: '1 min after fall-back' },
  { zone: 'America/Los_Angeles', ts: utc(1, 15), abbr: 'PST', offset: '-08:00', desc: 'winter' },
  { zone: 'America/Los_Angeles', ts: utc(7, 15), abbr: 'PDT', offset: '-07:00', desc: 'summer' },

  // Europe — across both EU transitions
  { zone: 'Europe/Berlin', ts: utc(3, 29, 0, 59), abbr: 'CET', offset: '+01:00', desc: '1 min before spring-forward' },
  { zone: 'Europe/Berlin', ts: utc(3, 29, 1, 1), abbr: 'CEST', offset: '+02:00', desc: '1 min after spring-forward' },
  { zone: 'Europe/Berlin', ts: utc(10, 25, 0, 59), abbr: 'CEST', offset: '+02:00', desc: '1 min before fall-back' },
  { zone: 'Europe/Berlin', ts: utc(10, 25, 1, 1), abbr: 'CET', offset: '+01:00', desc: '1 min after fall-back' },
  { zone: 'Europe/Athens', ts: utc(1, 15), abbr: 'EET', offset: '+02:00', desc: 'winter' },
  { zone: 'Europe/Athens', ts: utc(7, 15), abbr: 'EEST', offset: '+03:00', desc: 'summer' },
  { zone: 'Europe/London', ts: utc(1, 15), abbr: 'GMT', offset: '+00:00', desc: 'winter' },
  { zone: 'Europe/London', ts: utc(7, 15), abbr: 'BST', offset: '+01:00', desc: 'summer' },

  // Africa — Egypt observes DST (since 2023), South Africa does not
  { zone: 'Africa/Cairo', ts: utc(1, 15), abbr: 'EET', offset: '+02:00', desc: 'winter' },
  { zone: 'Africa/Cairo', ts: utc(7, 15), abbr: 'EEST', offset: '+03:00', desc: 'summer (Egypt DST)' },
  { zone: 'Africa/Johannesburg', ts: utc(1, 15), abbr: 'SAST', offset: '+02:00', desc: 'no DST' },
  { zone: 'Africa/Johannesburg', ts: utc(7, 15), abbr: 'SAST', offset: '+02:00', desc: 'no DST' },

  // Europe/Asia boundary — no CLDR metazone, zone-level override
  { zone: 'Europe/Istanbul', ts: utc(1, 15), abbr: 'TRT', offset: '+03:00', desc: 'no DST since 2016' },
  { zone: 'Europe/Istanbul', ts: utc(7, 15), abbr: 'TRT', offset: '+03:00', desc: 'no DST since 2016' },

  // Asia — no DST, incl. a half-hour offset
  { zone: 'Asia/Tokyo', ts: utc(1, 15), abbr: 'JST', offset: '+09:00', desc: 'no DST' },
  { zone: 'Asia/Tokyo', ts: utc(7, 15), abbr: 'JST', offset: '+09:00', desc: 'no DST' },
  { zone: 'Asia/Kolkata', altZone: 'Asia/Calcutta', ts: utc(1, 15), abbr: 'IST', offset: '+05:30', desc: 'half-hour offset' },
  { zone: 'Asia/Kolkata', altZone: 'Asia/Calcutta', ts: utc(7, 15), abbr: 'IST', offset: '+05:30', desc: 'half-hour offset' },

  // Australia — southern hemisphere (DST in January, standard in July)
  { zone: 'Australia/Sydney', ts: utc(1, 15), abbr: 'AEDT', offset: '+11:00', desc: 'southern summer' },
  { zone: 'Australia/Sydney', ts: utc(7, 15), abbr: 'AEST', offset: '+10:00', desc: 'southern winter' },
];
