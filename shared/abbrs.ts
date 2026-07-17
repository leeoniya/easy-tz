// curation-reviewed: 2026-07-16 | IANA NEWS through tzdata 2026c | CLDR 48
// (node 26.4) / ICU 75.1 (bun 1.4) | chrome-headless-shell 151.0.7922.34
// | letter abbrs cross-checked against tzdata via moment-timezone (audit);
// moment-timezone data PRs reviewed through 2026c (#1148) — no new links
// NOTE: 'American Samoa Standard Time' shows as stale in the bun audit (ICU
// 75 says 'Samoa Standard Time') but is live on CLDR 48 (node ICU 78,
// Chrome 150+) — keep it
// Maintained by hand — see .cursor/skills/maintain-curated-tz-data/SKILL.md
//
// Curated map of CLDR "long" metazone names (en locale) -> common tzdata-style
// abbreviations, for names where the initials heuristic is wrong or ambiguous.
// Names whose initials already produce the common abbreviation (e.g.
// "Eastern Daylight Time" -> EDT, "Japan Standard Time" -> JST,
// "Australian Eastern Standard Time" -> AEST) are intentionally omitted.
// ~1.5KB of data; covers the full CLDR metazone set observed in 2026.
// CLDR has no metazone for these zones (Intl reports "GMT+01:00" style long
// names), but tzdata gives them real letter abbreviations identical to a
// nearby reference zone, so we borrow that zone's CLDR name. The remaining
// no-metazone zones (Europe/Istanbul, Africa/Casablanca, Asia/Urumqi,
// Etc/GMT±n, ...) use numeric abbreviations in modern tzdata as well, so the
// compact GMT fallback matches tzdata for them.
export const zoneAliases: Record<string, string> = {
  'Europe/Guernsey': 'Europe/London',
  'Europe/Jersey': 'Europe/London',
  'Europe/Isle_of_Man': 'Europe/London',
  // Northern Cyprus rejoined EU DST rules in Oct 2017 but CLDR never assigned
  // a metazone; tzdata labels it EET/EEST, identical to Nicosia
  'Asia/Famagusta': 'Asia/Nicosia',
  // Kirov oblast observes Moscow time (no CLDR metazone); tzdata labels it MSK
  'Europe/Kirov': 'Europe/Moscow',
};

// zone-level abbr overrides for zones with a well-known letter abbreviation
// but no CLDR metazone at all
export const zoneAbbrOverrides: Record<string, string> = {
  'Europe/Istanbul': 'TRT',
};

export const abbrOverrides: Record<string, string> = {
  // Europe
  'Central European Standard Time': 'CET',
  'Eastern European Standard Time': 'EET',
  'Western European Standard Time': 'WET',
  'Moscow Standard Time': 'MSK',

  // Africa
  'West Africa Standard Time': 'WAT',
  'Cape Verde Standard Time': 'CVT',

  // North America
  'Alaska Standard Time': 'AKST',
  'Alaska Daylight Time': 'AKDT',
  'Hawaii-Aleutian Standard Time': 'HST',
  'Hawaii-Aleutian Daylight Time': 'HDT',
  'Mexican Pacific Standard Time': 'MST',
  'Yukon Time': 'MST',
  'St. Pierre & Miquelon Standard Time': 'PMST',
  'St. Pierre & Miquelon Daylight Time': 'PMDT',

  // South America
  'Brasilia Standard Time': 'BRT',
  'Argentina Standard Time': 'ART',
  'Amazon Standard Time': 'AMT',
  'Acre Standard Time': 'ACT',
  'Chile Standard Time': 'CLT',
  'Chile Summer Time': 'CLST',
  'Colombia Standard Time': 'COT',
  'Peru Standard Time': 'PET',
  'Ecuador Time': 'ECT',
  'Venezuela Time': 'VET',
  'Bolivia Time': 'BOT',
  'Paraguay Standard Time': 'PYT',
  'Paraguay Summer Time': 'PYST',
  'Uruguay Standard Time': 'UYT',
  'Guyana Time': 'GYT',
  'Suriname Time': 'SRT',
  'French Guiana Time': 'GFT',
  'Falkland Islands Standard Time': 'FKST',
  'Fernando de Noronha Standard Time': 'FNT',
  'Galapagos Time': 'GALT',
  'Easter Island Standard Time': 'EAST',
  'Easter Island Summer Time': 'EASST',

  // Atlantic
  'Azores Standard Time': 'AZOT',
  'Azores Summer Time': 'AZOST',
  'South Georgia Time': 'GST',

  // Middle East / Central & South Asia
  'Iran Standard Time': 'IRST',
  'Pakistan Standard Time': 'PKT',
  'Nepal Time': 'NPT',
  'Afghanistan Time': 'AFT',
  'Maldives Time': 'MVT',
  'Azerbaijan Standard Time': 'AZT',
  'Armenia Standard Time': 'AMT',
  'Georgia Standard Time': 'GET',
  'Turkmenistan Standard Time': 'TMT',
  'Uzbekistan Standard Time': 'UZT',
  'Tajikistan Time': 'TJT',
  'Kyrgyzstan Time': 'KGT',
  'Bhutan Time': 'BTT',

  // East / Southeast Asia
  'Hong Kong Standard Time': 'HKT',
  'Taipei Standard Time': 'CST',
  'Singapore Standard Time': 'SGT',
  'Malaysia Time': 'MYT',
  'Brunei Darussalam Time': 'BNT',
  'Indochina Time': 'ICT',
  'Myanmar Time': 'MMT',
  'Western Indonesia Time': 'WIB',
  'Central Indonesia Time': 'WITA',
  'Eastern Indonesia Time': 'WIT',
  'East Timor Time': 'TLT',
  'Hovd Standard Time': 'HOVT',
  'Ulaanbaatar Standard Time': 'ULAT',

  // Russia (east of Moscow)
  'Samara Standard Time': 'SAMT',
  // Volgograd rejoined Moscow time 2020-12-27 (tzdata 2020e): a distinct
  // "Volgograd time" no longer exists, tzdata labels the zone MSK. Newer
  // CLDR (48 / Chrome 150) merged the metazone into Moscow; this entry only
  // fires on older CLDR (ICU 75 / bun) that still emits the long name
  'Volgograd Standard Time': 'MSK',
  'Yekaterinburg Standard Time': 'YEKT',
  'Omsk Standard Time': 'OMST',
  'Novosibirsk Standard Time': 'NOVT',
  'Krasnoyarsk Standard Time': 'KRAT',
  'Irkutsk Standard Time': 'IRKT',
  'Yakutsk Standard Time': 'YAKT',
  'Vladivostok Standard Time': 'VLAT',
  'Magadan Standard Time': 'MAGT',
  'Sakhalin Standard Time': 'SAKT',
  'Anadyr Standard Time': 'ANAT',
  'Petropavlovsk-Kamchatski Standard Time': 'PETT',

  // Indian Ocean
  'Seychelles Time': 'SCT',
  'Réunion Time': 'RET',
  'Mauritius Standard Time': 'MUT',
  'Indian Ocean Time': 'IOT',
  'Christmas Island Time': 'CXT',
  'Cocos Islands Time': 'CCT',
  'French Southern & Antarctic Time': 'TFT',

  // Pacific
  // CLDR 48+ (Chrome 150) renamed the Pago_Pago/Midway metazone to
  // "American Samoa Standard Time" (initials would give ASST); older CLDR
  // (bun/ICU 75) still says "Samoa Standard Time" whose initials already
  // yield SST, the established tzdata abbreviation for -11
  'American Samoa Standard Time': 'SST',
  'Chamorro Standard Time': 'ChST',
  'Fiji Standard Time': 'FJT',
  'Papua New Guinea Time': 'PGT',
  'Solomon Islands Time': 'SBT',
  'Vanuatu Standard Time': 'VUT',
  'New Caledonia Standard Time': 'NCT',
  'Norfolk Island Standard Time': 'NFT',
  'Norfolk Island Daylight Time': 'NFDT',
  'Tonga Standard Time': 'TOT',
  'Tuvalu Time': 'TVT',
  'Gilbert Islands Time': 'GILT',
  'Phoenix Islands Time': 'PHOT',
  'Line Islands Time': 'LINT',
  'Marshall Islands Time': 'MHT',
  'Wake Island Time': 'WAKT',
  'Chuuk Time': 'CHUT',
  'Ponape Time': 'PONT',
  'Kosrae Time': 'KOST',
  'Palau Time': 'PWT',
  'Nauru Time': 'NRT',
  'Niue Time': 'NUT',
  'Cook Islands Standard Time': 'CKT',
  'Tahiti Time': 'TAHT',
  'Marquesas Time': 'MART',
  'Gambier Time': 'GAMT',
  'Tokelau Time': 'TKT',
  'Wallis & Futuna Time': 'WFT',
  'Chatham Standard Time': 'CHAST',
  'Chatham Daylight Time': 'CHADT',

  // Antarctica
  'Davis Time': 'DAVT',
  'Mawson Time': 'MAWT',
  'Syowa Time': 'SYOT',
  'Rothera Time': 'ROTT',
  'Vostok Time': 'VOST',
  'Dumont-d’Urville Time': 'DDUT',

  // Misc
  'Coordinated Universal Time': 'UTC',
};
