// shared/zoneLinks.ts
var zoneLinkPairs = [
  ["Africa/Asmara", "Africa/Asmera"],
  ["America/Argentina/Buenos_Aires", "America/Buenos_Aires"],
  ["America/Argentina/Catamarca", "America/Catamarca"],
  ["America/Argentina/Cordoba", "America/Cordoba"],
  ["America/Argentina/Jujuy", "America/Jujuy"],
  ["America/Argentina/Mendoza", "America/Mendoza"],
  ["America/Atikokan", "America/Coral_Harbour"],
  ["America/Indiana/Indianapolis", "America/Indianapolis"],
  ["America/Kentucky/Louisville", "America/Louisville"],
  ["America/Nuuk", "America/Godthab"],
  ["Asia/Ho_Chi_Minh", "Asia/Saigon"],
  ["Asia/Kathmandu", "Asia/Katmandu"],
  ["Asia/Kolkata", "Asia/Calcutta"],
  ["Asia/Ulaanbaatar", "Asia/Choibalsan"],
  ["Asia/Yangon", "Asia/Rangoon"],
  ["Atlantic/Faroe", "Atlantic/Faeroe"],
  ["Europe/Kyiv", "Europe/Kiev"],
  ["Pacific/Chuuk", "Pacific/Truk"],
  ["Pacific/Kanton", "Pacific/Enderbury"],
  ["Pacific/Pohnpei", "Pacific/Ponape"]
];
var zoneLinks = new Map;
var aliasOfZone = new Map;
for (const [canonical, alias] of zoneLinkPairs) {
  zoneLinks.set(canonical, alias);
  zoneLinks.set(alias, canonical);
  aliasOfZone.set(alias, canonical);
}
function makeInfo(name, abbr, offset) {
  const aliasOf = aliasOfZone.get(name);
  return aliasOf === undefined ? { name, abbr, offset } : { name, abbr, offset, aliasOf };
}

// shared/zones.ts
var runtimeZones = Intl.supportedValuesOf("timeZone");
var zones = (() => {
  const set = new Set(runtimeZones);
  for (const [canonical] of zoneLinkPairs)
    set.add(canonical);
  return set.size === runtimeZones.length ? runtimeZones : [...set].sort();
})();

// shared/hourCache.ts
var HOUR_MS = 3600000;
function hourBucketMemo(compute) {
  let lastBucket = NaN;
  let lastResult = [];
  return {
    get(timestamp) {
      const bucket = Math.floor(timestamp / HOUR_MS);
      if (bucket !== lastBucket) {
        lastResult = compute(bucket * HOUR_MS);
        lastBucket = bucket;
      }
      return lastResult;
    },
    clear() {
      lastBucket = NaN;
      lastResult = [];
    }
  };
}

// shared/abbrs.ts
var zoneAliases = {
  "Europe/Guernsey": "Europe/London",
  "Europe/Jersey": "Europe/London",
  "Europe/Isle_of_Man": "Europe/London",
  "Asia/Famagusta": "Asia/Nicosia",
  "Europe/Kirov": "Europe/Moscow"
};
var zoneAbbrOverrides = {
  "Europe/Istanbul": "TRT"
};
var abbrOverrides = {
  "Central European Standard Time": "CET",
  "Eastern European Standard Time": "EET",
  "Western European Standard Time": "WET",
  "Moscow Standard Time": "MSK",
  "West Africa Standard Time": "WAT",
  "Cape Verde Standard Time": "CVT",
  "Alaska Standard Time": "AKST",
  "Alaska Daylight Time": "AKDT",
  "Hawaii-Aleutian Standard Time": "HST",
  "Hawaii-Aleutian Daylight Time": "HDT",
  "Mexican Pacific Standard Time": "MST",
  "Yukon Time": "MST",
  "St. Pierre & Miquelon Standard Time": "PMST",
  "St. Pierre & Miquelon Daylight Time": "PMDT",
  "Brasilia Standard Time": "BRT",
  "Argentina Standard Time": "ART",
  "Amazon Standard Time": "AMT",
  "Acre Standard Time": "ACT",
  "Chile Standard Time": "CLT",
  "Chile Summer Time": "CLST",
  "Colombia Standard Time": "COT",
  "Peru Standard Time": "PET",
  "Ecuador Time": "ECT",
  "Venezuela Time": "VET",
  "Bolivia Time": "BOT",
  "Paraguay Standard Time": "PYT",
  "Paraguay Summer Time": "PYST",
  "Uruguay Standard Time": "UYT",
  "Guyana Time": "GYT",
  "Suriname Time": "SRT",
  "French Guiana Time": "GFT",
  "Falkland Islands Standard Time": "FKST",
  "Fernando de Noronha Standard Time": "FNT",
  "Galapagos Time": "GALT",
  "Easter Island Standard Time": "EAST",
  "Easter Island Summer Time": "EASST",
  "Azores Standard Time": "AZOT",
  "Azores Summer Time": "AZOST",
  "South Georgia Time": "GST",
  "Iran Standard Time": "IRST",
  "Pakistan Standard Time": "PKT",
  "Nepal Time": "NPT",
  "Afghanistan Time": "AFT",
  "Maldives Time": "MVT",
  "Azerbaijan Standard Time": "AZT",
  "Armenia Standard Time": "AMT",
  "Georgia Standard Time": "GET",
  "Turkmenistan Standard Time": "TMT",
  "Uzbekistan Standard Time": "UZT",
  "Tajikistan Time": "TJT",
  "Kyrgyzstan Time": "KGT",
  "Bhutan Time": "BTT",
  "Hong Kong Standard Time": "HKT",
  "Taipei Standard Time": "CST",
  "Singapore Standard Time": "SGT",
  "Malaysia Time": "MYT",
  "Brunei Darussalam Time": "BNT",
  "Indochina Time": "ICT",
  "Myanmar Time": "MMT",
  "Western Indonesia Time": "WIB",
  "Central Indonesia Time": "WITA",
  "Eastern Indonesia Time": "WIT",
  "East Timor Time": "TLT",
  "Hovd Standard Time": "HOVT",
  "Ulaanbaatar Standard Time": "ULAT",
  "Samara Standard Time": "SAMT",
  "Volgograd Standard Time": "MSK",
  "Yekaterinburg Standard Time": "YEKT",
  "Omsk Standard Time": "OMST",
  "Novosibirsk Standard Time": "NOVT",
  "Krasnoyarsk Standard Time": "KRAT",
  "Irkutsk Standard Time": "IRKT",
  "Yakutsk Standard Time": "YAKT",
  "Vladivostok Standard Time": "VLAT",
  "Magadan Standard Time": "MAGT",
  "Sakhalin Standard Time": "SAKT",
  "Anadyr Standard Time": "ANAT",
  "Petropavlovsk-Kamchatski Standard Time": "PETT",
  "Seychelles Time": "SCT",
  "Réunion Time": "RET",
  "Mauritius Standard Time": "MUT",
  "Indian Ocean Time": "IOT",
  "Christmas Island Time": "CXT",
  "Cocos Islands Time": "CCT",
  "French Southern & Antarctic Time": "TFT",
  "American Samoa Standard Time": "SST",
  "Chamorro Standard Time": "ChST",
  "Fiji Standard Time": "FJT",
  "Papua New Guinea Time": "PGT",
  "Solomon Islands Time": "SBT",
  "Vanuatu Standard Time": "VUT",
  "New Caledonia Standard Time": "NCT",
  "Norfolk Island Standard Time": "NFT",
  "Norfolk Island Daylight Time": "NFDT",
  "Tonga Standard Time": "TOT",
  "Tuvalu Time": "TVT",
  "Gilbert Islands Time": "GILT",
  "Phoenix Islands Time": "PHOT",
  "Line Islands Time": "LINT",
  "Marshall Islands Time": "MHT",
  "Wake Island Time": "WAKT",
  "Chuuk Time": "CHUT",
  "Ponape Time": "PONT",
  "Kosrae Time": "KOST",
  "Palau Time": "PWT",
  "Nauru Time": "NRT",
  "Niue Time": "NUT",
  "Cook Islands Standard Time": "CKT",
  "Tahiti Time": "TAHT",
  "Marquesas Time": "MART",
  "Gambier Time": "GAMT",
  "Tokelau Time": "TKT",
  "Wallis & Futuna Time": "WFT",
  "Chatham Standard Time": "CHAST",
  "Chatham Daylight Time": "CHADT",
  "Davis Time": "DAVT",
  "Mawson Time": "MAWT",
  "Syowa Time": "SYOT",
  "Rothera Time": "ROTT",
  "Vostok Time": "VOST",
  "Dumont-d’Urville Time": "DDUT",
  "Coordinated Universal Time": "UTC"
};

// shared/fmt.ts
function fmtCache(options) {
  const cache = new Map;
  return (zone) => {
    let fmt = cache.get(zone);
    if (fmt === undefined) {
      fmt = new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone });
      cache.set(zone, fmt);
    }
    return fmt;
  };
}
function formatOffsetMinutes(min) {
  const sign = min < 0 ? "-" : "+";
  const abs = min < 0 ? -min : min;
  const hh = String(abs / 60 | 0).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}
function initialsAbbr(longName) {
  if (longName.startsWith("GMT"))
    return null;
  let abbr = "";
  for (const word of longName.split(/[\s\-&’.]+/)) {
    const c = word.charAt(0);
    if (c >= "A" && c <= "Z")
      abbr += c;
  }
  return abbr.length >= 2 ? abbr : null;
}
function compactGmt(longName) {
  const out = longName.replace(/([+-])0?(\d+):00/, "$1$2").replace(/([+-])0?(\d+):(\d+)/, "$1$2:$3");
  return out === "GMT+0" || out === "GMT-0" ? "GMT" : out;
}

// shared/live.ts
var partsFmt = fmtCache({
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
  timeZoneName: "long"
});
var abbrCache = new Map;
function resolveAbbr(longName) {
  let abbr = abbrCache.get(longName);
  if (abbr === undefined) {
    abbr = abbrOverrides[longName] ?? initialsAbbr(longName) ?? compactGmt(longName);
    abbrCache.set(longName, abbr);
  }
  return abbr;
}
var offsetStrCache = new Map;
function liveParts(fmtZone, timestamp, date) {
  const parts = partsFmt(fmtZone).formatToParts(date);
  let year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
  let longName = "";
  for (const p of parts) {
    switch (p.type) {
      case "year":
        year = +p.value;
        break;
      case "month":
        month = +p.value;
        break;
      case "day":
        day = +p.value;
        break;
      case "hour":
        hour = +p.value;
        break;
      case "minute":
        minute = +p.value;
        break;
      case "second":
        second = +p.value;
        break;
      case "timeZoneName":
        longName = p.value;
        break;
    }
  }
  const asUTC = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMin = Math.round((asUTC - timestamp) / 60000);
  let offset = offsetStrCache.get(offsetMin);
  if (offset === undefined) {
    offset = formatOffsetMinutes(offsetMin);
    offsetStrCache.set(offsetMin, offset);
  }
  return { abbr: resolveAbbr(longName), offset };
}
function liveZoneInfo(name, timestamp, date) {
  const r = liveParts(zoneAliases[name] ?? name, timestamp, date);
  return makeInfo(name, zoneAbbrOverrides[name] ?? r.abbr, r.offset);
}

// impls/04-live-intl/index.ts
function compute(timestamp) {
  const date = new Date(timestamp);
  const out = [];
  for (const name of zones) {
    out.push(liveZoneInfo(name, timestamp, date));
  }
  return out;
}
var memo = hourBucketMemo(compute);
var getTimeZonesAt = memo.get;
var clearCache = memo.clear;
export {
  getTimeZonesAt,
  clearCache
};
