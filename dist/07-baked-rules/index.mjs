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
var internPool = new Map;
var POOL_NAME_CAP = 4096;
function freezeInfo(name, abbr, offset) {
  const aliasOf = aliasOfZone.get(name);
  return Object.freeze(aliasOf == null ? { name, abbr, offset } : { name, abbr, offset, aliasOf });
}
function makeInfo(name, abbr, offset) {
  let byOffset = internPool.get(name);
  if (byOffset == null) {
    if (internPool.size >= POOL_NAME_CAP)
      return freezeInfo(name, abbr, offset);
    internPool.set(name, byOffset = new Map);
  }
  let byAbbr = byOffset.get(offset);
  if (byAbbr == null)
    byOffset.set(offset, byAbbr = new Map);
  let info = byAbbr.get(abbr);
  if (info == null)
    byAbbr.set(abbr, info = freezeInfo(name, abbr, offset));
  return info;
}

// shared/zones.ts
var runtimeZones = Intl.supportedValuesOf("timeZone");
var zones = (() => {
  const set = new Set(runtimeZones);
  for (const [canonical, alias] of zoneLinkPairs) {
    set.add(canonical);
    set.add(alias);
  }
  return set.size === runtimeZones.length ? runtimeZones : [...set].sort();
})();

// shared/decode.ts
function decodeZone(prefixes, z) {
  return prefixes[parseInt(z[0], 36)] + z.slice(1);
}
var decodeZones = (prefixes, packed) => packed.split(";").map((z) => decodeZone(prefixes, z));
function decodeSchedule(prefixesPacked, staticsPacked, rulesPacked, irregularsPacked) {
  const prefixes = prefixesPacked.split("|");
  const out = [];
  if (staticsPacked !== "") {
    for (const c of staticsPacked.split("|")) {
      const [zs, abbr, offMin] = c.split("~");
      out.push({ zones: decodeZones(prefixes, zs), kind: 0, states: [{ abbr, offMin: +offMin }] });
    }
  }
  if (rulesPacked !== "") {
    for (const c of rulesPacked.split("|")) {
      const [zs, s0, s1, r0, r1] = c.split("~");
      const state = (s) => {
        const cut = s.lastIndexOf(",");
        return { abbr: s.slice(0, cut), offMin: +s.slice(cut + 1) };
      };
      const rule = (r) => {
        const [month, nth, dow, atMin, to] = r.split(",").map(Number);
        return { month, nth, dow, atMin, to };
      };
      out.push({
        zones: decodeZones(prefixes, zs),
        kind: 1,
        states: [state(s0), state(s1)],
        rules: [rule(r0), rule(r1)]
      });
    }
  }
  if (irregularsPacked !== "") {
    for (const c of irregularsPacked.split("|")) {
      const [zs, starts, abbrs, offMins] = c.split("~");
      out.push({
        zones: decodeZones(prefixes, zs),
        kind: 2,
        starts: starts.split(",").map(Number),
        abbrs: abbrs.split(","),
        offMins: offMins.split(",").map(Number)
      });
    }
  }
  return out;
}
function decodeHistory(zoneList, pairsPacked, tuplesPacked, erasPacked, classesPacked, fromYearBase) {
  if (classesPacked === "")
    return [];
  const pairs = pairsPacked.split("|").map((p) => p.split(",").map((v) => +v * 15));
  const dict = erasPacked.split("|");
  const tupleRule = (i, to) => {
    const o = i * 5;
    return {
      month: parseInt(tuplesPacked[o], 36),
      nth: parseInt(tuplesPacked[o + 1], 36),
      dow: parseInt(tuplesPacked[o + 2], 36),
      atMin: parseInt(tuplesPacked.slice(o + 3, o + 5), 36) * 15,
      to
    };
  };
  const decodeEra = (fromYear, p) => {
    const type = p[0];
    const payload = p.slice(1);
    if (type === "d")
      return { fromYear, kind: 3, offs: [], rules: null, steps: null };
    if (type === "s")
      return { fromYear, kind: 0, offs: [+payload * 15], rules: null, steps: null };
    if (type === "r") {
      const [qA, qB] = pairs[parseInt(payload.slice(0, 2), 36)];
      return {
        fromYear,
        kind: 1,
        offs: [qA, qB],
        rules: [
          tupleRule(parseInt(payload.slice(2, 4), 36), 1),
          tupleRule(parseInt(payload.slice(4, 6), 36), 0)
        ],
        steps: null
      };
    }
    const steps = [];
    const offs = [];
    for (const seg of payload.split(",")) {
      steps.push(parseInt(seg.slice(0, 3), 36));
      offs.push(+seg.slice(3) * 15);
    }
    return { fromYear, kind: 2, offs, rules: null, steps };
  };
  return classesPacked.split("|").map((c) => {
    const cut = c.indexOf("~");
    const zs = c.slice(0, cut);
    const es = c.slice(cut + 1);
    const zones2 = [];
    for (let i = 0;i < zs.length; i += 2) {
      zones2.push(zoneList[parseInt(zs.slice(i, i + 2), 36)]);
    }
    const eras = [];
    for (let i = 0;i < es.length; i += 3) {
      eras.push(decodeEra(fromYearBase + parseInt(es[i], 36), dict[parseInt(es.slice(i + 1, i + 3), 36)]));
    }
    return { zones: zones2, eras };
  });
}

// shared/tables/chrome/schedule.ts
var YEAR_START = 1767225600000;
var STEP_MS = 900000;
var P = "America/|Asia/|Europe/|Africa/|Pacific/|Indian/|Antarctica/|Australia/|Atlantic/|America/Argentina/|America/Indiana/|America/North_Dakota/|Arctic/|America/Kentucky/";
var S = "3Abidjan;3Accra;3Bamako;3Banjul;3Bissau;3Conakry;3Dakar;3Freetown;3Lome;3Monrovia;3Nouakchott;3Ouagadougou;3Sao_Tome;0Danmarkshavn;8Reykjavik;8St_Helena~GMT~0|3Addis_Ababa;3Asmera;3Dar_es_Salaam;3Djibouti;3Kampala;3Mogadishu;3Nairobi;5Antananarivo;5Comoro;5Mayotte~EAT~180|3Algiers;3Tunis~CET~60|3Bangui;3Brazzaville;3Douala;3Kinshasa;3Lagos;3Libreville;3Luanda;3Malabo;3Ndjamena;3Niamey;3Porto-Novo~WAT~60|3Blantyre;3Bujumbura;3Gaborone;3Harare;3Juba;3Khartoum;3Kigali;3Lubumbashi;3Lusaka;3Maputo;3Windhoek~CAT~120|3Johannesburg;3Maseru;3Mbabane~SAST~120|3Tripoli;2Kaliningrad~EET~120|0Anguilla;0Antigua;0Aruba;0Barbados;0Blanc-Sablon;0Curacao;0Dominica;0Grenada;0Guadeloupe;0Kralendijk;0Lower_Princes;0Marigot;0Martinique;0Montserrat;0Port_of_Spain;0Puerto_Rico;0Santo_Domingo;0St_Barthelemy;0St_Kitts;0St_Lucia;0St_Thomas;0St_Vincent;0Tortola~AST~-240|0Araguaina;0Bahia;0Belem;0Fortaleza;0Maceio;0Recife;0Santarem;0Sao_Paulo~BRT~-180|9La_Rioja;9Rio_Gallegos;9Salta;9San_Juan;9San_Luis;9Tucuman;9Ushuaia;0Buenos_Aires;0Catamarca;0Cordoba;0Jujuy;0Mendoza~ART~-180|0Asuncion~PYT~-180|0Bahia_Banderas;0Belize;0Chihuahua;0Costa_Rica;0El_Salvador;0Guatemala;0Managua;0Merida;0Mexico_City;0Monterrey;0Regina;0Swift_Current;0Tegucigalpa~CST~-360|0Boa_Vista;0Campo_Grande;0Cuiaba;0Manaus;0Porto_Velho~AMT~-240|0Bogota~COT~-300|0Cancun;0Cayman;0Coral_Harbour;0Jamaica;0Panama~EST~-300|0Caracas~VET~-240|0Cayenne~GFT~-180|0Coyhaique;0Punta_Arenas;6Palmer~GMT-3~-180|0Creston;0Dawson;0Dawson_Creek;0Fort_Nelson;0Hermosillo;0Mazatlan;0Phoenix;0Whitehorse~MST~-420|0Eirunepe;0Rio_Branco~ACT~-300|0Guayaquil~ECT~-300|0Guyana~GYT~-240|0La_Paz~BOT~-240|0Lima~PET~-300|0Montevideo~UYT~-180|0Noronha~FNT~-120|0Paramaribo~SRT~-180|6Casey;7Perth~AWST~480|6Davis~DAVT~420|6DumontDUrville~DUT~600|6Mawson~MAWT~300|6Rothera~ROTT~-180|6Syowa~SYOT~180|6Vostok~VOST~300|1Aden;1Baghdad;1Bahrain;1Kuwait;1Qatar;1Riyadh~AST~180|1Almaty;1Aqtau;1Aqtobe;1Atyrau;1Oral;1Qostanay;1Qyzylorda~KT~300|1Amman;1Damascus~GMT+3~180|1Anadyr;1Kamchatka~KST~720|1Ashgabat~TMT~300|1Baku~AZT~240|1Bangkok;1Phnom_Penh;1Saigon;1Vientiane~ICT~420|1Barnaul;1Krasnoyarsk;1Novokuznetsk;1Novosibirsk;1Tomsk~KRAT~420|1Bishkek~KGT~360|1Brunei~BT~480|1Calcutta;1Colombo~IST~330|1Chita;1Khandyga;1Yakutsk~YAKT~540|1Dhaka~BST~360|1Dili~TLT~540|1Dubai;1Muscat~GST~240|1Dushanbe~TJT~300|1Hong_Kong~HKT~480|1Hovd~KST~420|1Irkutsk~IRKT~480|1Jakarta;1Pontianak~WIB~420|1Jayapura~WIT~540|1Kabul~AFT~270|1Karachi~PKT~300|1Katmandu~NPT~345|1Kuala_Lumpur;1Kuching~MYT~480|1Macau;1Shanghai~CST~480|1Magadan;1Sakhalin;1Srednekolymsk~MAGT~660|1Makassar~WITA~480|1Manila~PST~480|1Omsk~OMST~360|1Pyongyang;1Seoul~KST~540|1Rangoon~MMT~390|1Samarkand;1Tashkent~UZT~300|1Singapore~SGT~480|1Taipei~TST~480|1Tbilisi~GET~240|1Tehran~IRST~210|1Thimphu~BTT~360|1Tokyo~JST~540|1Ulaanbaatar~ULAT~480|1Urumqi~GMT+6~360|1Ust-Nera;1Vladivostok~VLAT~600|1Yekaterinburg~YEKT~300|1Yerevan~AMT~240|8Cape_Verde~CVT~-60|8South_Georgia~GST~-120|8Stanley~FKST~-180|7Brisbane;7Lindeman~AEST~600|7Darwin~ACST~570|7Eucla~ACWST~525|2Astrakhan;2Samara;2Saratov;2Ulyanovsk~SAMT~240|2Istanbul~TRT~180|2Kirov;2Minsk;2Moscow;2Simferopol;2Volgograd~MSK~180|5Chagos~IOT~360|5Christmas~CXT~420|5Cocos~CCT~390|5Kerguelen~TFT~300|5Mahe~SCT~240|5Maldives~MVT~300|5Mauritius~MUT~240|5Reunion~RET~240|4Apia~SST~780|4Bougainville~GMT+11~660|4Efate~VUT~660|4Enderbury~PHOT~780|4Fakaofo~TKT~780|4Fiji~FJT~720|4Funafuti~TVT~720|4Galapagos~GALT~-360|4Gambier~GAMT~-540|4Guadalcanal~SBT~660|4Guam;4Saipan~ChST~600|4Honolulu~HST~-600|4Kiritimati~LINT~840|4Kosrae~KOST~660|4Kwajalein;4Majuro~MHT~720|4Marquesas~MART~-570|4Midway;4Pago_Pago~SST~-660|4Nauru~NRT~720|4Niue~NUT~-660|4Noumea~NCT~660|4Palau~PWT~540|4Pitcairn~PT~-480|4Ponape~PT~660|4Port_Moresby~PGT~600|4Rarotonga~CKT~-600|4Tahiti~TAHT~-600|4Tarawa~GILT~720|4Tongatapu~TOT~780|4Truk~CHUT~600|4Wake~WAKT~720|4Wallis~WFT~720";
var R = "3Cairo~EET,120~EEST,180~4,5,5,0,1~10,5,5,0,0|3Ceuta;cLongyearbyen;2Amsterdam;2Andorra;2Belgrade;2Berlin;2Bratislava;2Brussels;2Budapest;2Busingen;2Copenhagen;2Gibraltar;2Ljubljana;2Luxembourg;2Madrid;2Malta;2Monaco;2Oslo;2Paris;2Podgorica;2Prague;2Rome;2San_Marino;2Sarajevo;2Skopje;2Stockholm;2Tirane;2Vaduz;2Vatican;2Vienna;2Warsaw;2Zagreb;2Zurich~CET,60~CEST,120~3,5,0,120,1~10,5,0,180,0|0Adak~HST,-600~HDT,-540~3,2,0,120,1~11,1,0,120,0|0Anchorage;0Juneau;0Metlakatla;0Nome;0Sitka;0Yakutat~AKST,-540~AKDT,-480~3,2,0,120,1~11,1,0,120,0|0Boise;0Cambridge_Bay;0Ciudad_Juarez;0Denver;0Edmonton;0Inuvik~MST,-420~MDT,-360~3,2,0,120,1~11,1,0,120,0|0Chicago;aKnox;aTell_City;0Matamoros;0Menominee;bBeulah;bCenter;bNew_Salem;0Ojinaga;0Rankin_Inlet;0Resolute;0Winnipeg~CST,-360~CDT,-300~3,2,0,120,1~11,1,0,120,0|0Detroit;0Grand_Turk;aMarengo;aPetersburg;aVevay;aVincennes;aWinamac;0Indianapolis;0Iqaluit;dMonticello;0Louisville;0Nassau;0New_York;0Port-au-Prince;0Toronto~EST,-300~EDT,-240~3,2,0,120,1~11,1,0,120,0|0Glace_Bay;0Goose_Bay;0Halifax;0Moncton;0Thule;8Bermuda~AST,-240~ADT,-180~3,2,0,120,1~11,1,0,120,0|0Godthab;0Scoresbysund~GST,-120~GST,-60~3,5,6,1380,1~10,5,0,0,0|0Havana~CST,-300~CDT,-240~3,2,0,0,1~11,1,0,60,0|0Los_Angeles;0Tijuana;0Vancouver~PST,-480~PDT,-420~3,2,0,120,1~11,1,0,120,0|0Miquelon~PMST,-180~PMDT,-120~3,2,0,120,1~11,1,0,120,0|0Santiago~CLST,-180~CLT,-240~4,1,0,0,1~9,1,0,0,0|0St_Johns~NST,-210~NDT,-150~3,2,0,120,1~11,1,0,120,0|6Macquarie;7Hobart;7Melbourne;7Sydney~AEDT,660~AEST,600~4,1,0,180,1~10,1,0,120,0|6McMurdo;4Auckland~NZDT,780~NZST,720~4,1,0,180,1~9,5,0,120,0|6Troll~GMT,0~GMT+2,120~3,5,0,60,1~10,5,0,180,0|1Beirut~EET,120~EEST,180~3,5,0,0,1~10,5,0,0,0|1Famagusta;1Nicosia;2Athens;2Bucharest;2Helsinki;2Kiev;2Mariehamn;2Riga;2Sofia;2Tallinn;2Vilnius~EET,120~EEST,180~3,5,0,180,1~10,5,0,240,0|1Jerusalem~IST,120~IDT,180~3,4,5,120,1~10,5,0,120,0|8Azores~AZOT,-60~AZOST,0~3,5,0,0,1~10,5,0,60,0|8Canary;8Faeroe;8Madeira;2Lisbon~WET,0~WEST,60~3,5,0,60,1~10,5,0,120,0|7Adelaide;7Broken_Hill~ACDT,630~ACST,570~4,1,0,180,1~10,1,0,120,0|7Lord_Howe~LHDT,660~LHST,630~4,1,0,120,1~10,1,0,120,0|2Chisinau~EET,120~EEST,180~3,5,0,120,1~10,5,0,180,0|2Dublin~GMT,0~IST,60~3,5,0,60,1~10,5,0,120,0|2Guernsey;2Isle_of_Man;2Jersey;2London~GMT,0~BST,60~3,5,0,60,1~10,5,0,120,0|4Chatham~CHADT,825~CHAST,765~4,1,0,225,1~9,5,0,165,0|4Easter~EASST,-300~EAST,-360~4,1,6,1320,1~9,1,6,1320,0|4Norfolk~NFDT,720~NFT,660~4,1,0,180,1~10,1,0,120,0";
var I = "3Casablanca;3El_Aaiun~0,4328,7688~GMT+1,GMT,GMT+1~60,0,60|1Gaza;1Hebron~0,8256,28412~EET,EEST,EET~120,180,120";
var scheduleClasses = decodeSchedule(P, S, R, I);

// shared/tables/chrome/history.ts
var HISTORY_FROM = 1995;
var HISTORY_TO = 2026;
var Z = scheduleClasses.flatMap((c) => c.zones);
var P2 = "8,12|4,8|8,4|-40,-36|-36,-32|-8,-12|-12,-16|-28,-24|-24,-20|-12,-8|-32,-28|-20,-16|-16,-12|-16,-20|-4,0|-14,-10|44,32|44,40|52,48|24,28|48,52|16,20|20,24|12,16|36,40|28,32|32,36|40,44|44,48|14,18|0,4|42,38|39,35|44,42|36,32|56,52|55,51|-20,-24";
var T = "4550095500a150094500915008550083500b1500350089500c5100095508a500c4100891008a500822000a100023000a110031000a200025000b100055100750003200033000a3000550006300031500410009100042000340005100895008b120032008b530035000950005200083000450009200053000820003562g9462kb1008a462k3462ga562k41001a500132001b1001a2004a1004a5004b2004b10044500854000a2008a100841004a5000c100495004811003200ga100g3300ca150c3200ca10013500c85008415009350471400955043540035500a4504a3504a55044160c4110ca120g4120ca130g4130ca140g4140ca150g4100ca110g4150ca160g3500ka500o3500ga500k3500aa500a4160041100a120035100a1300a14004140041200a1600b1600a5500a500g456089560835608956003350093100415089150842508a1504421049510435504a110441304943043550893008920089400861000433009220034300334009360034600941009420034100943003320093400344009460034500940009320034200944009300033300935003310093300336003500443000430083100c310089500ga40083510cb200g4100g3300fa100b9500b3262ga262g9562g4162g5162g8362g4562g9162g5262g8262g9262g2500c1400ca30081300c130081200cb2008c300815008";
var E = "r000001|r000002|r000003|r000004|r000005|r000006|w0008,8t412,gfo8,ins12,k7o8|s8|w0008,9zs12,d3o8,fp412,juc8|d|r000007|r010809|w0008,12g12|s12|w00012,2ac8|w00012,mic8|w0000,0044|w0004,0040|w0008,k7s4|w0004,6vw8|w0008,n9c4|w0004,6g08|r010a0b|r01080c|r020d0e|r030d0f|r040d0f|w000-12,l9o-8|r050g0h|r050i0j|r050k0l|r050i0h|r050m0l|r050i0l|r050i0n|w000-8,3ew-12|w000-12,lsc-8|w000-8,3hk-12|w000-12,b9o-16,cog-12|w000-12,qwc-8|w000-8,5k8-12|r060o0p|w000-8,1hk-12,51o-16,l4g-12|r060q0l|w000-12,b9o-16,c5s-12|r050r0s|w000-8,5ew-12|r060t0u|r060m0h|r060v0h|r060k0h|r060w0x|r060w0s|r060q0s|r060y0h|r060z0h|r050i0s|w000-12,lcc-8|w000-8,45k-12|s-28|r070d0f|r071011|w000-28,6x0-20,mgs-24|r080d0f|w000-16,kds-12|w000-12,48c-16,kts-12,lcc-16|w000-28,6x0-24|r080d0n|w000-24,m8w-28|r060i0s|r060g0h|r060i0j|r060k0l|r060i0h|r060m0l|r060i0l|r060i0n|r060i12|r060m0s|w000-12,3ho-16|s-24|w000-24,728-20|w000-20,6zg-16,fso-20,m0s-24|r081011|w000-24,2bk-20|w000-16,pcs-18|s-18|w000-18,8zg-16|w000-24,m0w-28|w000-28,6uc-24|r071314|r06150l|r060r16|r060w0l|r060r0l|r061718|r06190x|r06191a|r061b1c|r06171c|r060w1a|w000-12,3f0-16|w000-16,mog-12|r091d1e|w000-12,00c0|r0a0d0f|r0a131f|w000-32,4zs-28|r0b0d0f|w000-20,cz8-16|s-16|w000-16,n74-20|w000-32,4x4-28|w000-12,kdo-8|w000-8,488-12,kto-8,luw-12|w000-12,l70-8|r0c0d0f|r091d1g|r091h1i|r091d1i|w000-12,684-8|r0c1j1k|r0c1l1m|r0c1l1f|w000-20,4ws-16|w000-16,mrc-20|r08190h|r0b0w1n|r0b0w1o|r0b151p|r0b0w1p|w000-20,6gk-16|w000-16,mb8-20|r0b0q1p|r0b0r1p|r0b0r1q|r0b0w1r|s-20|w000-20,mbg-24|w000-24,54w-20|w000-24,54w-16,mrc-20|w000-20,6ws-16,mgo-24|w000-24,6u8-20|w000-8,31k-12|w000-20,00k-24|r080y0h|r081s1o|r061t16|s-32|w000-32,mjs-36|w000-36,558-32|w000-32,1fs-36,52k-32,mp4-36|r090d0f|w000-12,jf0-8|r05081u|r05131v|w000-8,4wg-12|w000-8,kdk-4|w000-4,484-8,ktk-4,lc4-8|w000-8,l6w-4|w000-4,3hg-8|r07131f|w000-28,5d0-24|w000-28,72c-24|w000-28,5ac-24|r0b1w0f|r0b0w1x|w000-20,m8s-24|w000-8,488-12,kto-8,lc8-12|w000-24,6rk-20|w000-20,mrg-24|w000-16,cz4-12|s-12|r0d0f1y|r050i12|r050m0s|r0e151z|r0e151p|w000-4,m84-8|r0f1j1k|r0f1l1m|r0f1l1f|r080a20|r080d0c|w00032,lgo44|w00044,4n032|w00032,m7c44|w00044,3tw32|w00032,lts44|s44|r0g2122|r0g2324|r0g2526|r0g0q26|w00044,4xs32|w00028,lgs20|w00020,53k28|w00028,m7g20|w00020,3u828|r0h271v|r0h2728|s24|w00024,lgw20|r0i231v|r0i2311|s0|s28|w00028,pzg20|r0j0809|r0j080c|w00024,4fc20|r00292a|r002b2c|r002d2c|r002e2c|r002e2f|r002e2g|r00292c|r002e2h|r00292h|w0008,6l412|w00012,q508|w0008,42g12|r0k0809|r0k080c|w00048,mf044|w00044,69o48|r0l0809|r0l080c|w00016,6fs20|r0m0809|r0m080c|w00020,mfs16|r0n2i22|r0n2j2k|r0n2l2m|r0n2n2o|r0n2p2q|r0n2r2s|r0n2t2u|r0l2v2w|r0l2x2y|w00028,67g32,av428,jow24|w00024,6a828|w00028,m2424|w00024,6cw28|r001516|r0m0y16|r0m0w16|r0m2z30|w00020,6ae24|r0o0809|r0o080c|w00036,69w40|s40|w00040,m1s32|s32|w00032,6co36|w00022,aq226,m4o24|w00024,7oq22|r00310h|r003233|r003435|r003436|r003702|r000w0j|r003835|r002939|r003103|r002e07|r00293a|r002e3b|r00293b|w0008,65412|w00024,ckk28,r0k24|w00032,j8g36|r00153c|w0008,6dg12|w00012,mas8|r0p1516|r0p3d3e|r0p3f3e|r0p3f3g|r0q0809|r0q080c|w00032,6a036|s36|w00036,m1w32|r002e0x|r003h3i|r003h1a|r003h0x|r003j3k|r003l3m|r003n3o|r003p3q|r003p3m|r003r3s|r003j1u|r003t1v|r003t3u|r003t11|r003t3v|r003j1v|r003t3w|r003t0f|r0m0w0h|r0m3x3a|r0m3y0n|w00036,6hw40,m1w36,r0c40|r0r080c|r0r083z|w00040,m1s36|r0p0809|r0p080c|w00028,6a432|w00032,m2028|r0s0809|r0s080c|s48|w00048,m1k40|w00040,8f444|w00028,mfk24|w00024,f6828|w00036,gpo34|s34|w00034,95o36|w00020,6fo24|w00024,q7c20|w00044,m1s40|w00040,69s44|w00044,m1o40|w00040,6cg44|w00048,m1k44|r0l1516|w00016,6nk20|w00020,m2416|r0l151x|w00016,6fk20,d6416,mik12|w00012,6ak16|r0t4003|r0t4142|r0t4344|r0t0z45|r0t4647|r0t4849|r0t4a4b|r0t4c4d|r0t0r4e|r0t4f4g|r0t3h4h|r0t4i4j|r0t4k4l|r0t4m3i|w00028,6ks32,8vg28,m4w24|w00024,b0w28|r0q1516|r0q3d3e|r0q3f3e|r0q3f3g|r0s083z|r0r0809|w00020,6ac24|w00024,m2820|w00012,67w16|r0u4n11|r064o1a|r064o4h|r064p0e|r0v270f|r0v2r0f|r0v4q0f|w00035,ov939|r0w270f|w00039,6f935|r0x4r0f|r0x080f|r0x0828|r0x0d0f|r0h270f|r0h2r0f|w00032,ovc36|r0y270f|w00036,6fc32|r0h4q0f|r0n0809|r0n080c|w00016,m2g12|w00012,6d816|r00274s|r00151x|r0u4n4t|r004n11|r004n0f|r00273c|r004u3c|r00274v|r000809|r00080c|w0008,6ao12|w00012,m2k8|r00083c|s16|w0004,m840|w00016,mfw12|w00012,p1816|r0n153c|w00012,m2s8|w0008,6io16,m2g12|w0008,m044|w0004,6dg8|w00012,m7w16|w00016,qqg12|w00020,r0s24|w00016,m5420|w00020,6fo16|s-44|w000-44,jvw-40|w000-40,6s8-44,jqw-40,qx456|r0z4w09|w00056,6uw52|w00040,qps44|r104x4y|r104x4z|r115051|r111d51|r115052|r115351|r115455|r115657|r115859|r11535a|w000-44,qx852|w00048,mhk52|r0i5b1f|w00052,46w48|w00048,ok852|r0i274t|r0i4q4t|r0i5c5d|r0i5e0f|r0i5f1f|r0i5e1f|r0i5g1f|r0i5g5h|r0i5g5i|w00052,15k48|w00048,r0044|s46|w00046,key44|w00044,kkc48|w00044,osc48|w00048,4f044|s-34|w000-34,8ma-32|w00052,kms56|r0z231f|r0z5j1f|w00056,1w052|w00052,mxg56|w00056,10452";
var H = "80~000401500901a00b02c03d04e05f06g07j08k07s09t0au09|8182838485868788898a8b8c8d8e8f8g8h8i8j8k8l8m8n8o8p8q8r8s8t8u8v8w8x~00b109|17~00950c60dq0er09|18~00950c60dm0fn09|0c~009n0go0hp09|1h~00910i20j309h0ki0lj09|0r~009a0mb0ne09|1d~00on09|8y~00pc09|8z90929394~00qc09|26~00r10s20t30u40v50w60x70y80z909h10i11j09|2e2f2m~009912a09c13d14e09|2g2o~009c13d14e09|2h~009915a09c13d14e09|2i~009915a09c13d16e17f09|2j~009918a09c13d19e1af09|2k~00991ba09c13d14e09|2q~01c11d21c31e71f91ga1hf1ii1ju09|27~01k10s20t30u40v50w60x70y80z909g1lh1mi09|2r~01n11o61p71of1qg1rs09|34~00941s51t609|9598999a~01oc09|2l2n~009c13d19e1af09|96~01o41u51v61w71oc09|35~01x11y21z32042152262372481x925a1xb24c22d1xh26i1xk26l1xn24o27p09|3a~02811r22932a41r62b71rk2cl09|3f~009c2dd2el2fm09|9b9f9h~01rc09|2t~00911r32g41o61p71or2hs09|97~02811r32g41o61p71of09r2is09|3h~01h11722j32k42l51h617b1hc17d2je2mf2lg2nh2oi2pj2ok09l2qm2ro2sp1fr2ss1ft2su09|36~01x11y21z32042152262372482t92ua1xb24c22d1xh26i1xk26l1xn24o27p09|0d~02v12w209|3l3r~02xc2yp2zq09|9n9x9y9za1~030c09|3s3t~009d31e32i33j09|3n~02xc2yk34l09|29~009435536637711809|a2a4a6a7~038c09|a8~02v13943a73bc3ad39f3ai39l3ao39q3bs3ct09|a3~03dc3eg3fh09|9o~030c09k3gl32n3ho09|2w~009b3ic09|aa~03j13k23j33l53m93na32b3oc3pd3qe3pg3rh3si09|3o~00911o409|9c9d~03tb3uc09|9p9r9u~03tb30c09|9q9s~03tb3uc3vd09|9t~03tb3uc3wd09|9v~03043x53y630c09|9w~01r53y630c09|abad~02xc09|2a~00r13z209435536637711809|2x~03t240309a41b42c09|9e~02811r62b71rf09|3p~00911o61p71os09|2p~009943a09c13d14e09|2y2z30~00911r62b71rs09|91~044k45l09n46o47p09|ae~048c09|a5~03dc09|3y~009949a4ab4bk4cl09|3z~00944d54e64f74g809|9g~01oc4hf4ig09|9i~01o84j91rc09|9j~02811r32g41o61p71of4hr4ks09|a0~04l33ta4mc3th09l3tm09|3i3j~01h11722j32k42l51h617b1hc17d2je2mf2lg2nh2oi2pj2ok09l2qm09|9k~01r53y64n71rc09|2b~00943554o637711809|9l~01r53y64n71rb4pc4qd09|2c~032d4re09|af~01h11722j32k42l51h617b1hc17d2je2mf2lg2nh2oi2pj2ok4sl2qm2ro2sp09r2ss09t2su09|1z~00954t609|2d~01k10s20t30u40v50w60x70y81k94ua1kb0yc0wd1kh4vi1kk4vl1kn0yo11p09|a9~04w14xt4yu09|ag~04zc50g51h09|33~009b52c09|ac~02xf09|9m~053b1rc09|41~009e54f55g56h57i09l58m59n5ao5bp5cq5ds5et09|43~009e5ff5gg5hh5ii09|ah~05j55k65jb09c5jd09f59g09|45~05le5mf09|alam~05nc5od09|an~05pa09|48~05qs5rt09|4f~05s15ta5lt5uu09|4m~05v45w55x75y85z960a61b62g63h64i65j62l63m62r66s09|4o4p~067168f69g6ah09|4g4j~06b16c96da09|4h~06e16fa09|4i~06e16f46g56c96da09|4a~06h16i26j36k46l56h66m76i86j96la6nb6hc6md09|4r~00916o26pl09|4w~06q15tg6rh09j6sk5ll6tm09|ao~06u409|51~06v16w26xa6yb09|55~06z170g71h72j73k74l75m09|54~00917625lb77c09|4n~07817927a37b47c57867d77987e97ca7fb7gc7hd7ie7jf7kh7jr7ls09|58~009e7mf09|59~07457n609|ap~06u37o409l7pm7qn09|5e~07r40967s77tc09k7um09|5f~07v17wg7xh7yj7zk09|b0~080181282383484585686787888989a8ab8bc8cd8be8df8eg8fh8gi8hj09o8hp09t8hu09|5k~00978i809d8je8kf09|56~06z17088l98mg8nh72j8ok09|4x~08p18qg8rh74j8sk09|5q~08t18ug6ah8vj8wk72l8xm09|aq~06u37o409|4y~08p18qf8yg6rh09|4z~05s15tg6rh09j6sk5ll8zm09|5v~05s15tg6rh5qj6sk09|5w~009k90l91n92o09|4k~06e16f993a5lt5uu09|4l~06e16f993a5ln94o09|5r~08t18u29538mg96h09j97k72l98m09|5s~08t18ug6ah8vj99k09|63~09a19b29c39d99ea9fb09|64~09g19h29i39j49k59l69m79n89i99oa9pb09d9qe9jf9kg9ph9ri9nj9ik9jl9sm9gn9mo9np9tq9kr9ps09|50~08p18q79u85tg6rh09j6sk5ll9vm09|67~09w40969x79yc09k9zm09|69~08t18uga0h59j97k09|6a~0a118mg96h59j97k09|57~06z170g71h72j8ok09|6b~06e16fga2h5lja3k09|6c~0a410926ch09|b1~04w109|b2b3b4~0a5109|6f~0a61a72a66a8g09|b6~0a9baaca9d09|b7~0ab1a9baaca9d09|6j~009baccadeaef09|ai~05j55k65jb09c5jd09|b8~0af1ag5ah6agbaicagd09|aj~0aj55k6ajbakcajd09|42~009balcameanf09|ak~0ao1aj55k6ajbakcajd09|6k6n~0ap1aqg9fh09jark0dlasm09|aratav~0at109|asb9ax~06u1au209|babbbcbdbe~0av109|6o~0aw1axcaygazhayjazkb0l7pm09|1i~0b11b2gb3h0djb4k09|au~0b11b5209|6p6r~0ap1aqg9fhb6jark09|b5~00b1b7209|6q~0b11b2gb3h09|aw~0b1209507609|6l~06b16cfb8g9fh09|6m~0ap1aqg9fh09jark0dlb9m09|6s~0ap1ba2bb3ayjbck09|ay~0b11b23b5409507709|az~0b11b23bd4be507809|6t~0ap1aqg9fhb6jark09nbfob6pbgq09|6u~0bh109|70~009dbiebjf09|72~0bkfblgbmhbnqbor09|73~072jbpk09|bf~0bqcbrd09|bg~0bs2bt3bu4bv5bsdbtebsfbvgbwhbxk3tlbyo09rbzs09|76~0bkgc0h09|77~0093c14c25c3609ec4fc5gc6hc7ic8jc9kcancboccpcdqcer09|7g~08v3cf409|bh~0cgkchl59ocip09|7o~0091cj2ck309|7q~0cl3cm409|7w~0094cn5co6cp7cq809lcrmcsn09";
var historyClasses = decodeHistory(Z, P2, T, E, H, HISTORY_FROM);

// shared/rules.ts
function buildScheduleIndex(zoneList, classes) {
  const idxOf = new Map;
  for (let i = 0;i < classes.length; i++) {
    for (const z of classes[i].zones)
      idxOf.set(z, i);
  }
  return zoneList.map((z) => idxOf.get(z) ?? idxOf.get(zoneLinks.get(z) ?? "") ?? -1);
}
function ruleInstant(year, rule, offBeforeMin) {
  let day;
  if (rule.nth === 5) {
    const daysInMonth = new Date(Date.UTC(year, rule.month, 0)).getUTCDate();
    const lastDow = new Date(Date.UTC(year, rule.month - 1, daysInMonth)).getUTCDay();
    day = daysInMonth - (lastDow - rule.dow + 7) % 7;
  } else {
    const firstDow = new Date(Date.UTC(year, rule.month - 1, 1)).getUTCDay();
    day = 1 + (rule.dow - firstDow + 7) % 7 + (rule.nth - 1) * 7;
  }
  return Date.UTC(year, rule.month - 1, day) + (rule.atMin - offBeforeMin) * 60000;
}
function ruleCycleIndex(off0, off1, r1, r2, year, ts) {
  const t1 = ruleInstant(year, r1, r1.to === 0 ? off1 : off0);
  const t2 = ruleInstant(year, r2, r2.to === 0 ? off1 : off0);
  if (ts < t1)
    return r2.to;
  if (ts < t2)
    return r1.to;
  return r2.to;
}
function segmentIndex(starts, ts, anchor, stepMs) {
  const step = Math.max(0, Math.floor((ts - anchor) / stepMs));
  let i = starts.length - 1;
  while (i > 0 && starts[i] > step)
    i--;
  return i;
}
function resolveClass(cls, ts, yearStart, stepMs) {
  if (cls.kind === 0)
    return cls.states[0];
  if (cls.kind === 1) {
    const [r1, r2] = cls.rules;
    const year = new Date(ts).getUTCFullYear();
    return cls.states[ruleCycleIndex(cls.states[0].offMin, cls.states[1].offMin, r1, r2, year, ts)];
  }
  const i = segmentIndex(cls.starts, ts, yearStart, stepMs);
  return { abbr: cls.abbrs[i], offMin: cls.offMins[i] };
}
function resolveHistory(eras, ts, stepMs) {
  const year = new Date(ts).getUTCFullYear();
  let e = eras[0];
  for (const era of eras) {
    if (era.fromYear <= year)
      e = era;
    else
      break;
  }
  if (e.kind === 3)
    return null;
  if (e.kind === 0)
    return e.offs[0];
  if (e.kind === 1) {
    const [r1, r2] = e.rules;
    return e.offs[ruleCycleIndex(e.offs[0], e.offs[1], r1, r2, year, ts)];
  }
  return e.offs[segmentIndex(e.steps, ts, Date.UTC(e.fromYear, 0, 1), stepMs)];
}

// shared/fmt.ts
function gmtLabel(offMin) {
  if (offMin === 0)
    return "GMT";
  const sign = offMin < 0 ? "-" : "+";
  const abs = offMin < 0 ? -offMin : offMin;
  const h = Math.trunc(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""}`;
}

// shared/bakedHistory.ts
var classIdx = buildScheduleIndex(zones, scheduleClasses);
var histIdx = buildScheduleIndex(zones, historyClasses);
var HISTORY_TO_MS = Date.UTC(HISTORY_TO, 0, 1);
var nameIdx = new Map;
for (let z = 0;z < zones.length; z++)
  nameIdx.set(zones[z], z);
function historyAbbr(cls, offMin) {
  if (cls.kind === 0) {
    if (cls.states[0].offMin === offMin)
      return cls.states[0].abbr;
  } else if (cls.kind === 1) {
    for (const st of cls.states)
      if (st.offMin === offMin)
        return st.abbr;
  } else {
    for (let i = 0;i < cls.offMins.length; i++)
      if (cls.offMins[i] === offMin)
        return cls.abbrs[i];
  }
  return gmtLabel(offMin);
}
function bakedZoneInfo(name, ci, hi, timestamp, historical, schedCache, histCache) {
  if (historical && hi !== -1) {
    let off = histCache != null ? histCache[hi] : undefined;
    if (off === undefined) {
      off = resolveHistory(historyClasses[hi].eras, timestamp, STEP_MS);
      if (histCache != null)
        histCache[hi] = off;
    }
    if (off !== null) {
      const abbr = ci < 0 ? gmtLabel(off) : historyAbbr(scheduleClasses[ci], off);
      return makeInfo(name, abbr, off);
    }
  }
  if (ci < 0)
    return makeInfo(name, "UTC", 0);
  let st = schedCache != null ? schedCache[ci] : undefined;
  if (st == null) {
    st = resolveClass(scheduleClasses[ci], timestamp, YEAR_START, STEP_MS);
    if (schedCache != null)
      schedCache[ci] = st;
  }
  return makeInfo(name, st.abbr, st.offMin);
}
function computeBaked(timestamp) {
  const historical = timestamp < HISTORY_TO_MS;
  const schedCache = new Array(scheduleClasses.length);
  const histCache = historical ? new Array(historyClasses.length) : undefined;
  const out = new Array(zones.length);
  for (let z = 0;z < zones.length; z++) {
    out[z] = bakedZoneInfo(zones[z], classIdx[z], histIdx[z], timestamp, historical, schedCache, histCache);
  }
  return out;
}

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

// shared/tables/chrome/offsets.ts
var offsetStrings = new Map([
  [-660, "-11:00"],
  [-600, "-10:00"],
  [-570, "-09:30"],
  [-540, "-09:00"],
  [-510, "-08:30"],
  [-480, "-08:00"],
  [-420, "-07:00"],
  [-360, "-06:00"],
  [-300, "-05:00"],
  [-270, "-04:30"],
  [-240, "-04:00"],
  [-210, "-03:30"],
  [-180, "-03:00"],
  [-150, "-02:30"],
  [-120, "-02:00"],
  [-60, "-01:00"],
  [0, "+00:00"],
  [60, "+01:00"],
  [120, "+02:00"],
  [180, "+03:00"],
  [210, "+03:30"],
  [240, "+04:00"],
  [270, "+04:30"],
  [300, "+05:00"],
  [330, "+05:30"],
  [345, "+05:45"],
  [360, "+06:00"],
  [390, "+06:30"],
  [420, "+07:00"],
  [480, "+08:00"],
  [510, "+08:30"],
  [525, "+08:45"],
  [540, "+09:00"],
  [570, "+09:30"],
  [585, "+09:45"],
  [600, "+10:00"],
  [630, "+10:30"],
  [660, "+11:00"],
  [690, "+11:30"],
  [720, "+12:00"],
  [765, "+12:45"],
  [780, "+13:00"],
  [825, "+13:45"],
  [840, "+14:00"]
]);

// shared/offsetFormatBaked.ts
function formatOffset(minutes) {
  return offsetStrings.get(minutes) ?? "";
}

// impls/07-baked-rules/index.ts
var memo = hourBucketMemo(computeBaked);
var getTimeZonesAt = memo.get;
var clearCache = memo.clear;
export {
  getTimeZonesAt,
  formatOffset,
  clearCache
};
