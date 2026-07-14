// curation-reviewed: 2026-07-14 | IANA NEWS through tzdata 2026c (no fixture
// zones affected: Alberta/Morocco changes don't touch the zones below);
// tzdata cross-check via moment-timezone added Famagusta/Kirov/Troll coverage
// Maintained by hand — see .cursor/skills/maintain-curated-tz-data/SKILL.md
//
// Expected abbreviations/offsets for 2026, straddling DST boundaries in
// several distinct regions. Transition instants for 2026:
//   US: Mar 8 07:00 UTC (EST -> EDT), Nov 1 06:00 UTC (EDT -> EST)
//   EU: Mar 29 01:00 UTC (CET -> CEST), Oct 25 01:00 UTC (CEST -> CET)
// Cairo (Egypt DST) and Sydney (southern hemisphere) use mid-season instants.
//
// Instants are chosen to be hour-bucket safe: getTimeZonesAt() memoizes per
// UTC hour and evaluates at the bucket start, so a fixture's truth must not
// change between the bucket start and the instant itself. Nearly all
// transitions land on whole UTC hours; the one exception is Lord Howe's
// spring-forward (15:30Z, from the +10:30 base offset), whose "after"
// fixture therefore sits in the NEXT bucket (16:01Z). The 15:30-16:00Z
// quantization window is documented by a dedicated test in
// tests/cache.test.ts.

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

  // exact transition instants — transitions are inclusive of the instant
  // itself (an off-by-one in rule comparison passes every ±1min fixture)
  { zone: 'America/New_York', ts: utc(3, 8, 7, 0), abbr: 'EDT', offset: '-04:00', desc: 'exact spring-forward instant' },
  { zone: 'Europe/Berlin', ts: utc(3, 29, 1, 0), abbr: 'CEST', offset: '+02:00', desc: 'exact spring-forward instant' },

  // Sydney's own transitions (Apr 5 / Oct 4 at 16:00 UTC) — the southern
  // DST period spans the year boundary, exercising rule wrap-around
  { zone: 'Australia/Sydney', ts: utc(4, 4, 15, 59), abbr: 'AEDT', offset: '+11:00', desc: '1 min before fall-back' },
  { zone: 'Australia/Sydney', ts: utc(4, 4, 16, 1), abbr: 'AEST', offset: '+10:00', desc: '1 min after fall-back' },
  { zone: 'Australia/Sydney', ts: utc(10, 3, 15, 59), abbr: 'AEST', offset: '+10:00', desc: '1 min before spring-forward' },
  { zone: 'Australia/Sydney', ts: utc(10, 3, 16, 1), abbr: 'AEDT', offset: '+11:00', desc: '1 min after spring-forward' },
  { zone: 'Australia/Sydney', ts: utc(12, 31, 23, 59), abbr: 'AEDT', offset: '+11:00', desc: 'DST across New Year (wrap)' },

  // negative DST modeling — tzdata treats Irish Standard Time (summer) as
  // the baseline with a negative winter save; CLDR reports it sanely
  { zone: 'Europe/Dublin', ts: utc(1, 15), abbr: 'GMT', offset: '+00:00', desc: 'winter (negative-DST zone)' },
  { zone: 'Europe/Dublin', ts: utc(7, 15), abbr: 'IST', offset: '+01:00', desc: 'summer (negative-DST zone)' },

  // half-hour offset WITH DST, negative side (Newfoundland)
  { zone: 'America/St_Johns', ts: utc(1, 15), abbr: 'NST', offset: '-03:30', desc: 'half-hour + DST, winter' },
  { zone: 'America/St_Johns', ts: utc(7, 15), abbr: 'NDT', offset: '-02:30', desc: 'half-hour + DST, summer' },

  // 45-minute offsets, one static and one with DST on top
  { zone: 'Asia/Kathmandu', altZone: 'Asia/Katmandu', ts: utc(7, 15), abbr: 'NPT', offset: '+05:45', desc: '45-min offset' },
  { zone: 'Pacific/Chatham', ts: utc(1, 15), abbr: 'CHADT', offset: '+13:45', desc: '45-min offset + southern DST' },
  { zone: 'Pacific/Chatham', ts: utc(7, 15), abbr: 'CHAST', offset: '+12:45', desc: '45-min offset + southern DST' },

  // extreme ends of the offset range
  { zone: 'Pacific/Kiritimati', ts: utc(7, 15), abbr: 'LINT', offset: '+14:00', desc: 'max offset' },
  { zone: 'Pacific/Pago_Pago', ts: utc(7, 15), abbr: 'SST', offset: '-11:00', desc: 'far negative offset' },

  // Morocco: permanent +01 EXCEPT during Ramadan (non-Gregorian rule — the
  // canonical "irregular" schedule class). Ramadan 2026 ≈ Feb 18 - Mar 19.
  { zone: 'Africa/Casablanca', ts: utc(2, 10), abbr: 'GMT+1', offset: '+01:00', desc: 'before Ramadan window' },
  { zone: 'Africa/Casablanca', ts: utc(3, 1), abbr: 'GMT', offset: '+00:00', desc: 'inside Ramadan window' },
  { zone: 'Africa/Casablanca', ts: utc(4, 1), abbr: 'GMT+1', offset: '+01:00', desc: 'after Ramadan window' },

  // Greenland: transitions in lockstep with the EU at 01:00 UTC, which is
  // 23:00 SATURDAY local — the local transition day differs from the
  // nominal "last Sunday". Note the abbr quirk we intentionally pin: CLDR's
  // "Greenland Standard Time" and "Greenland Summer Time" BOTH initialize
  // to GST, so only the offset distinguishes the seasons. The established
  // WGT/WGST can't be keyed by long name without mislabeling
  // America/Scoresbysund (East Greenland, same CLDR metazone).
  { zone: 'America/Nuuk', altZone: 'America/Godthab', ts: utc(3, 29, 0, 59), abbr: 'GST', offset: '-02:00', desc: '1 min before spring-forward (local Saturday)' },
  { zone: 'America/Nuuk', altZone: 'America/Godthab', ts: utc(3, 29, 1, 1), abbr: 'GST', offset: '-01:00', desc: '1 min after spring-forward' },

  // Chile: transitions at 24:00 local Saturday (tzdata "Sat >= N 24:00") —
  // easy to fit as the wrong weekday off by one day
  { zone: 'America/Santiago', ts: utc(4, 5, 2, 59), abbr: 'CLST', offset: '-03:00', desc: '1 min before fall-back (24:00-local rule)' },
  { zone: 'America/Santiago', ts: utc(4, 5, 3, 1), abbr: 'CLT', offset: '-04:00', desc: '1 min after fall-back' },
  { zone: 'America/Santiago', ts: utc(9, 6, 3, 59), abbr: 'CLT', offset: '-04:00', desc: '1 min before spring-forward' },
  { zone: 'America/Santiago', ts: utc(9, 6, 4, 1), abbr: 'CLST', offset: '-03:00', desc: '1 min after spring-forward' },

  // no-metazone zones borrowing a reference zone's CLDR names (zoneAliases):
  // Famagusta = Nicosia (EU rules since Oct 2017), Kirov = Moscow time
  { zone: 'Asia/Famagusta', ts: utc(1, 15), abbr: 'EET', offset: '+02:00', desc: 'no CLDR metazone, aliased to Nicosia' },
  { zone: 'Asia/Famagusta', ts: utc(7, 15), abbr: 'EEST', offset: '+03:00', desc: 'no CLDR metazone, aliased to Nicosia' },
  { zone: 'Europe/Kirov', ts: utc(7, 15), abbr: 'MSK', offset: '+03:00', desc: 'no CLDR metazone, aliased to Moscow' },

  // Antarctica/Troll: the world's only TWO-hour DST delta (+00 <-> +02),
  // transitioning on the EU instants; tzdata uses numeric abbrs, so the
  // compact-GMT labels are the correct convention here
  { zone: 'Antarctica/Troll', ts: utc(3, 29, 0, 59), abbr: 'GMT', offset: '+00:00', desc: '2-hour DST delta, before spring-forward' },
  { zone: 'Antarctica/Troll', ts: utc(3, 29, 1, 1), abbr: 'GMT+2', offset: '+02:00', desc: '2-hour DST delta, after spring-forward' },
  { zone: 'Antarctica/Troll', ts: utc(10, 25, 0, 59), abbr: 'GMT+2', offset: '+02:00', desc: '2-hour DST delta, before fall-back' },
  { zone: 'Antarctica/Troll', ts: utc(10, 25, 1, 1), abbr: 'GMT', offset: '+00:00', desc: '2-hour DST delta, after fall-back' },

  // Lord Howe Island: the world's only 30-minute DST delta (+10:30/+11:00).
  // Fall-back lands on a whole UTC hour (Apr 4 15:00Z); spring-forward is
  // MID-HOUR (Oct 3 15:30Z, from the half-hour base), so the "after"
  // instant sits in the next bucket (see header note).
  { zone: 'Australia/Lord_Howe', ts: utc(4, 4, 14, 59), abbr: 'LHDT', offset: '+11:00', desc: '30-min DST delta, before fall-back' },
  { zone: 'Australia/Lord_Howe', ts: utc(4, 4, 15, 1), abbr: 'LHST', offset: '+10:30', desc: '30-min DST delta, after fall-back' },
  { zone: 'Australia/Lord_Howe', ts: utc(10, 3, 15, 29), abbr: 'LHST', offset: '+10:30', desc: 'before mid-hour spring-forward (15:30Z)' },
  { zone: 'Australia/Lord_Howe', ts: utc(10, 3, 16, 1), abbr: 'LHDT', offset: '+11:00', desc: 'after mid-hour spring-forward (next bucket)' },
];
