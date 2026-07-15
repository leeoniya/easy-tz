// shared/zones.ts
var zones = Intl.supportedValuesOf("timeZone");

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

// shared/decode.ts
function decodeZone(prefixes, z) {
  return prefixes[parseInt(z[0], 36)] + z.slice(1);
}
var decodeZones = (prefixes, packed) => packed.split(";").map((z) => decodeZone(prefixes, z));
function decodeGroups(prefixesPacked, groupsPacked) {
  const prefixes = prefixesPacked.split("|");
  return groupsPacked.split("|").map((g) => decodeZones(prefixes, g));
}

// shared/tables/chrome/classes.ts
var P = "America/|Europe/|Asia/|Africa/|Australia/|America/Argentina/|America/Indiana/|Pacific/|Atlantic/|Antarctica/|Indian/|America/North_Dakota/|Arctic/|America/Kentucky/";
var G = "3Abidjan;3Accra;3Bamako;3Banjul;3Bissau;3Conakry;3Dakar;3Freetown;3Lome;3Monrovia;3Nouakchott;3Ouagadougou;3Sao_Tome;0Danmarkshavn;8Reykjavik;8St_Helena|3Addis_Ababa;3Asmera;3Dar_es_Salaam;3Djibouti;3Kampala;3Mogadishu;3Nairobi;aAntananarivo;aComoro;aMayotte|3Algiers;3Tunis|3Bangui;3Brazzaville;3Douala;3Kinshasa;3Lagos;3Libreville;3Luanda;3Malabo;3Ndjamena;3Niamey;3Porto-Novo|3Blantyre;3Bujumbura;3Gaborone;3Harare;3Juba;3Khartoum;3Kigali;3Lubumbashi;3Lusaka;3Maputo;3Windhoek|3Casablanca;3El_Aaiun|3Ceuta;cLongyearbyen;1Amsterdam;1Andorra;1Belgrade;1Berlin;1Bratislava;1Brussels;1Budapest;1Busingen;1Copenhagen;1Gibraltar;1Ljubljana;1Luxembourg;1Madrid;1Malta;1Monaco;1Oslo;1Paris;1Podgorica;1Prague;1Rome;1San_Marino;1Sarajevo;1Skopje;1Stockholm;1Tirane;1Vaduz;1Vatican;1Vienna;1Warsaw;1Zagreb;1Zurich|3Johannesburg;3Maseru;3Mbabane|3Tripoli;1Kaliningrad|0Anchorage;0Juneau;0Metlakatla;0Nome;0Sitka;0Yakutat|0Anguilla;0Antigua;0Aruba;0Barbados;0Blanc-Sablon;0Curacao;0Dominica;0Grenada;0Guadeloupe;0Kralendijk;0Lower_Princes;0Marigot;0Martinique;0Montserrat;0Port_of_Spain;0Puerto_Rico;0Santo_Domingo;0St_Barthelemy;0St_Kitts;0St_Lucia;0St_Thomas;0St_Vincent;0Tortola|0Araguaina;0Bahia;0Belem;0Fortaleza;0Maceio;0Recife;0Santarem;0Sao_Paulo|5La_Rioja;5Rio_Gallegos;5Salta;5San_Juan;5San_Luis;5Tucuman;5Ushuaia;0Buenos_Aires;0Catamarca;0Cordoba;0Jujuy;0Mendoza|0Bahia_Banderas;0Belize;0Chihuahua;0Costa_Rica;0El_Salvador;0Guatemala;0Managua;0Merida;0Mexico_City;0Monterrey;0Regina;0Swift_Current;0Tegucigalpa|0Boa_Vista;0Campo_Grande;0Cuiaba;0Manaus;0Porto_Velho|0Boise;0Cambridge_Bay;0Ciudad_Juarez;0Denver;0Edmonton;0Inuvik|0Cancun;0Cayman;0Coral_Harbour;0Jamaica;0Panama|0Chicago;6Knox;6Tell_City;0Matamoros;0Menominee;bBeulah;bCenter;bNew_Salem;0Ojinaga;0Rankin_Inlet;0Resolute;0Winnipeg|0Coyhaique;0Punta_Arenas;9Palmer|0Creston;0Dawson_Creek;0Fort_Nelson;0Phoenix|0Dawson;0Whitehorse|0Detroit;0Grand_Turk;6Marengo;6Petersburg;6Vevay;6Vincennes;6Winamac;0Indianapolis;0Iqaluit;dMonticello;0Louisville;0Nassau;0New_York;0Port-au-Prince;0Toronto|0Eirunepe;0Rio_Branco|0Glace_Bay;0Goose_Bay;0Halifax;0Moncton;0Thule;8Bermuda|0Godthab;0Scoresbysund|0Hermosillo;0Mazatlan|0Los_Angeles;0Tijuana;0Vancouver|9Casey;4Perth|9Macquarie;4Hobart;4Melbourne;4Sydney|9McMurdo;7Auckland|2Aden;2Baghdad;2Bahrain;2Kuwait;2Qatar;2Riyadh|2Almaty;2Aqtau;2Aqtobe;2Atyrau;2Oral;2Qostanay;2Qyzylorda|2Amman;2Damascus|2Anadyr;2Kamchatka|2Bangkok;2Phnom_Penh;2Saigon;2Vientiane|2Barnaul;2Krasnoyarsk;2Novokuznetsk;2Novosibirsk;2Tomsk|2Calcutta;2Colombo|2Chita;2Khandyga;2Yakutsk|2Dubai;2Muscat|2Famagusta;2Nicosia;1Athens;1Bucharest;1Helsinki;1Kiev;1Mariehamn;1Riga;1Sofia;1Tallinn;1Vilnius|2Gaza;2Hebron|2Jakarta;2Pontianak|2Kuala_Lumpur;2Kuching|2Macau;2Shanghai|2Magadan;2Sakhalin;2Srednekolymsk|2Pyongyang;2Seoul|2Samarkand;2Tashkent|2Ust-Nera;2Vladivostok|8Canary;8Faeroe;8Madeira;1Lisbon|4Adelaide;4Broken_Hill|4Brisbane;4Lindeman|1Astrakhan;1Samara;1Saratov;1Ulyanovsk|1Guernsey;1Isle_of_Man;1Jersey|1Kirov;1Minsk;1Moscow;1Simferopol;1Volgograd|7Guam;7Saipan|7Kwajalein;7Majuro|7Midway;7Pago_Pago";
var classGroups = decodeGroups(P, G);

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

// impls/08-verified-sharing/index.ts
var initInfo = null;
var repOf = null;
var droppedAliases = null;
function yearSignature(zone, start, end) {
  let zdt = Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(zone);
  let sig = zdt.offset;
  for (;; ) {
    const next = zdt.getTimeZoneTransition("next");
    if (next === null || next.epochMilliseconds >= end)
      break;
    sig += `;${next.epochMilliseconds}:${next.offset}`;
    zdt = next;
  }
  return sig;
}
function init() {
  const t0 = performance.now();
  const temporal = typeof Temporal !== "undefined";
  repOf = new Map;
  droppedAliases = new Set;
  let sharedZones = 0;
  let healedZones = 0;
  let healedAliases = 0;
  if (temporal) {
    const year = new Date().getUTCFullYear();
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);
    const runtimeZones = new Set(zones);
    for (const group of classGroups) {
      const present = group.filter((z) => runtimeZones.has(z));
      if (present.length < 2)
        continue;
      const rep = present[0];
      const repSig = yearSignature(rep, start, end);
      for (let i = 1;i < present.length; i++) {
        if (yearSignature(present[i], start, end) === repSig) {
          repOf.set(present[i], rep);
          sharedZones++;
        } else {
          healedZones++;
        }
      }
    }
    for (const [alias, target] of Object.entries(zoneAliases)) {
      if (!runtimeZones.has(alias) || !runtimeZones.has(target))
        continue;
      if (yearSignature(alias, start, end) !== yearSignature(target, start, end)) {
        droppedAliases.add(alias);
        healedAliases++;
      }
    }
  }
  initInfo = { temporal, verifyMs: performance.now() - t0, sharedZones, healedZones, healedAliases };
}
function compute(timestamp) {
  if (repOf === null)
    init();
  const date = new Date(timestamp);
  const out = [];
  const repResults = new Map;
  for (const name of zones) {
    const aliased = zoneAliases[name] !== undefined && !droppedAliases.has(name) ? zoneAliases[name] : name;
    const fmtZone = repOf.get(aliased) ?? aliased;
    let res = repResults.get(fmtZone);
    if (res === undefined) {
      res = liveParts(fmtZone, timestamp, date);
      repResults.set(fmtZone, res);
    }
    out.push(makeInfo(name, zoneAbbrOverrides[name] ?? res.abbr, res.offset));
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
