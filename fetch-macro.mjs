/**
 * Collecteur macro — 100 % FMI (World Economic Outlook).
 *   node fetch-macro.mjs
 *
 * Le FMI a un avantage décisif sur la Banque mondiale : ses données sont
 * homogènes et RÉCENTES pour ~190 pays, parce qu'elles viennent d'un seul
 * rapport publié deux fois par an. La Banque mondiale, elle, agrège des
 * sources nationales de qualité inégale — d'où des trous et des données de
 * 2021 pour la moitié du monde.
 *
 * À lancer une fois par mois. Écrit public/macro.json.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";

const IMF = "https://www.imf.org/external/datamapper/api/v1";
const UA = "AtlasBot/0.1 (+https://ton-domaine.be/about)";
const YEAR_MAX = new Date().getFullYear();

// Indicateurs FMI. L'ordre = l'ordre d'affichage dans le panneau.
// [code IMF, libellé, format, "clé" = requis pour la règle tout-ou-rien]
const INDIC = [
  ["NGDPD",       "PIB",              "moneyMd", true],
  ["NGDPDPC",     "PIB par habitant", "money",   true],
  ["NGDP_RPCH",   "Croissance",       "pct",     true],
  ["PCPIPCH",     "Inflation",        "pct",     true],
  ["PCPIEPCH",    "Inflation fin d'année", "pct", false],
  ["GGXWDG_NGDP", "Dette publique",   "pct",     true],
  ["GGXCNL_NGDP", "Solde budgétaire", "pct",     false],
  ["BCA_NGDPD",   "Balance courante", "pct",     false],
  ["LUR",         "Chômage",          "pct",     false],
];
// Les 5 indicateurs "clés" (true) doivent TOUS être présents, sinon le pays
// est écarté. Chômage/budget/balance sont des bonus : leur absence n'exclut pas.

// ISO-2 → ISO-3 (le FMI travaille en ISO-3). Table complète.
const ISO3 = {"AF":"AFG","AL":"ALB","DZ":"DZA","AO":"AGO","AR":"ARG","AM":"ARM","AU":"AUS","AT":"AUT","AZ":"AZE","BS":"BHS","BH":"BHR","BD":"BGD","BB":"BRB","BY":"BLR","BE":"BEL","BZ":"BLZ","BJ":"BEN","BT":"BTN","BO":"BOL","BA":"BIH","BW":"BWA","BR":"BRA","BN":"BRN","BG":"BGR","BF":"BFA","BI":"BDI","CV":"CPV","KH":"KHM","CM":"CMR","CA":"CAN","CF":"CAF","TD":"TCD","CL":"CHL","CN":"CHN","CO":"COL","KM":"COM","CG":"COG","CD":"COD","CR":"CRI","CI":"CIV","HR":"HRV","CU":"CUB","CY":"CYP","CZ":"CZE","DK":"DNK","DJ":"DJI","DM":"DMA","DO":"DOM","EC":"ECU","EG":"EGY","SV":"SLV","GQ":"GNQ","ER":"ERI","EE":"EST","SZ":"SWZ","ET":"ETH","FJ":"FJI","FI":"FIN","FR":"FRA","GA":"GAB","GM":"GMB","GE":"GEO","DE":"DEU","GH":"GHA","GR":"GRC","GL":"GRL","GD":"GRD","GT":"GTM","GN":"GIN","GW":"GNB","GY":"GUY","HT":"HTI","HN":"HND","HK":"HKG","HU":"HUN","IS":"ISL","IN":"IND","ID":"IDN","IR":"IRN","IQ":"IRQ","IE":"IRL","IL":"ISR","IT":"ITA","JM":"JAM","JP":"JPN","JO":"JOR","KZ":"KAZ","KE":"KEN","KI":"KIR","KP":"PRK","KR":"KOR","KW":"KWT","KG":"KGZ","LA":"LAO","LV":"LVA","LB":"LBN","LS":"LSO","LR":"LBR","LY":"LBY","LT":"LTU","LU":"LUX","MG":"MDG","MW":"MWI","MY":"MYS","MV":"MDV","ML":"MLI","MT":"MLT","MR":"MRT","MU":"MUS","MX":"MEX","FM":"FSM","MD":"MDA","MN":"MNG","ME":"MNE","MA":"MAR","MZ":"MOZ","MM":"MMR","NA":"NAM","NP":"NPL","NL":"NLD","NZ":"NZL","NI":"NIC","NE":"NER","NG":"NGA","MK":"MKD","NO":"NOR","OM":"OMN","PK":"PAK","PW":"PLW","PA":"PAN","PG":"PNG","PY":"PRY","PE":"PER","PH":"PHL","PL":"POL","PT":"PRT","PR":"PRI","QA":"QAT","RO":"ROU","RU":"RUS","RW":"RWA","WS":"WSM","SM":"SMR","ST":"STP","SA":"SAU","SN":"SEN","RS":"SRB","SC":"SYC","SL":"SLE","SG":"SGP","SK":"SVK","SI":"SVN","SB":"SLB","SO":"SOM","ZA":"ZAF","SS":"SSD","ES":"ESP","LK":"LKA","SD":"SDN","SR":"SUR","SE":"SWE","CH":"CHE","SY":"SYR","TW":"TWN","TJ":"TJK","TZ":"TZA","TH":"THA","TL":"TLS","TG":"TGO","TO":"TON","TT":"TTO","TN":"TUN","TR":"TUR","TM":"TKM","TV":"TUV","UG":"UGA","UA":"UKR","AE":"ARE","GB":"GBR","US":"USA","UY":"URY","UZ":"UZB","VU":"VUT","VE":"VEN","VN":"VNM","YE":"YEM","ZM":"ZMB","ZW":"ZWE","PS":"PSE","XK":"UVK"};

const NAMES = {"AF":"Afghanistan","AL":"Albanie","DZ":"Algérie","AO":"Angola","AR":"Argentine","AM":"Arménie","AU":"Australie","AT":"Autriche","AZ":"Azerbaïdjan","BS":"Bahamas","BH":"Bahreïn","BD":"Bangladesh","BB":"Barbade","BE":"Belgique","BZ":"Belize","BJ":"Bénin","BT":"Bhoutan","BY":"Biélorussie","BO":"Bolivie","BA":"Bosnie-Herzégovine","BW":"Botswana","BR":"Brésil","BN":"Brunei","BG":"Bulgarie","BF":"Burkina Faso","BI":"Burundi","KH":"Cambodge","CM":"Cameroun","CA":"Canada","CF":"Centrafrique","CL":"Chili","CN":"Chine","CY":"Chypre","CO":"Colombie","CG":"Congo","CD":"Congo (RDC)","KR":"Corée du Sud","KP":"Corée du Nord","CR":"Costa Rica","CI":"Côte d'Ivoire","HR":"Croatie","CU":"Cuba","DK":"Danemark","DJ":"Djibouti","DO":"République dominicaine","EG":"Égypte","SV":"Salvador","AE":"Émirats arabes unis","EC":"Équateur","ER":"Érythrée","ES":"Espagne","EE":"Estonie","SZ":"Eswatini","US":"États-Unis","ET":"Éthiopie","FJ":"Fidji","FI":"Finlande","FR":"France","GA":"Gabon","GM":"Gambie","GE":"Géorgie","GH":"Ghana","GR":"Grèce","GL":"Groenland","GT":"Guatemala","GN":"Guinée","GQ":"Guinée équatoriale","GW":"Guinée-Bissau","GY":"Guyana","HT":"Haïti","HN":"Honduras","HK":"Hong Kong","HU":"Hongrie","IN":"Inde","ID":"Indonésie","IQ":"Irak","IR":"Iran","IE":"Irlande","IS":"Islande","IL":"Israël","IT":"Italie","JM":"Jamaïque","JP":"Japon","JO":"Jordanie","KZ":"Kazakhstan","KE":"Kenya","KG":"Kirghizistan","KW":"Koweït","LA":"Laos","LS":"Lesotho","LV":"Lettonie","LB":"Liban","LR":"Liberia","LY":"Libye","LT":"Lituanie","LU":"Luxembourg","MK":"Macédoine du Nord","MG":"Madagascar","MY":"Malaisie","MW":"Malawi","ML":"Mali","MA":"Maroc","MR":"Mauritanie","MX":"Mexique","MD":"Moldavie","MN":"Mongolie","ME":"Monténégro","MZ":"Mozambique","MM":"Myanmar","NA":"Namibie","NP":"Népal","NI":"Nicaragua","NE":"Niger","NG":"Nigeria","NO":"Norvège","NZ":"Nouvelle-Zélande","OM":"Oman","UG":"Ouganda","UZ":"Ouzbékistan","PK":"Pakistan","PA":"Panama","PG":"Papouasie-Nouvelle-Guinée","PY":"Paraguay","NL":"Pays-Bas","PE":"Pérou","PH":"Philippines","PL":"Pologne","PT":"Portugal","PS":"Palestine","QA":"Qatar","RO":"Roumanie","GB":"Royaume-Uni","RU":"Russie","RW":"Rwanda","SA":"Arabie saoudite","RS":"Serbie","SN":"Sénégal","SL":"Sierra Leone","SG":"Singapour","SK":"Slovaquie","SI":"Slovénie","SO":"Somalie","SD":"Soudan","SS":"Soudan du Sud","LK":"Sri Lanka","SE":"Suède","CH":"Suisse","SR":"Suriname","SY":"Syrie","TJ":"Tadjikistan","TZ":"Tanzanie","TD":"Tchad","CZ":"Tchéquie","TH":"Thaïlande","TL":"Timor oriental","TG":"Togo","TT":"Trinité-et-Tobago","TN":"Tunisie","TM":"Turkménistan","TR":"Turquie","UA":"Ukraine","UY":"Uruguay","VU":"Vanuatu","VE":"Venezuela","VN":"Vietnam","YE":"Yémen","ZM":"Zambie","ZW":"Zimbabwe","DE":"Allemagne","ZA":"Afrique du Sud","CV":"Cap-Vert","KM":"Comores","DM":"Dominique","GD":"Grenade","KI":"Kiribati","MV":"Maldives","MT":"Malte","MU":"Maurice","FM":"Micronésie","PW":"Palaos","PR":"Porto Rico","WS":"Samoa","SM":"Saint-Marin","ST":"Sao Tomé-et-Principe","SC":"Seychelles","SB":"Îles Salomon","TW":"Taïwan","TO":"Tonga","TV":"Tuvalu","XK":"Kosovo",};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Un appel FMI = un indicateur pour TOUS les pays d'un coup. C'est la clé de
// la vitesse : 8 requêtes au total, pas 8×190. Le DataMapper accepte ça.
async function imfAll(code, essai = 0) {
  const url = `${IMF}/${code}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA } });
    clearTimeout(t);
    if (!r.ok && essai < 3) { await sleep(500 * (essai + 1)); return imfAll(code, essai + 1); }
    if (!r.ok) return {};
    const j = await r.json();
    return j?.values?.[code] || {};
  } catch (e) {
    clearTimeout(t);
    if (essai < 3) { await sleep(500 * (essai + 1)); return imfAll(code, essai + 1); }
    return {};
  }
}

// Dernière valeur observée (année ≤ courante), depuis la série d'un pays.
function latest(series) {
  if (!series) return null;
  const years = Object.keys(series).map(Number).filter((y) => y <= YEAR_MAX).sort((a, b) => b - a);
  for (const y of years) if (series[y] != null) return { value: series[y], year: y };
  return null;
}

// Nombre d'années d'historique conservées par indicateur (pour les mini-courbes).
const HISTN = 15;

// Historique : les HISTN dernières années observées (≤ année courante).
// Renvoie { hist0, hist:[...] } (valeurs, avec null pour les trous) ou null.
function history(series) {
  if (!series) return null;
  const years = Object.keys(series).map(Number).filter((y) => y <= YEAR_MAX).sort((a, b) => a - b);
  if (!years.length) return null;
  const slice = years.slice(-HISTN);
  return { hist0: slice[0], hist: slice.map((y) => (series[y] != null ? series[y] : null)) };
}

async function run() {
  let sources = {};
  try { sources = JSON.parse(await readFile(new URL("./sources.json", import.meta.url))); } catch {}

  console.log(`\n  Collecte FMI · ${INDIC.length} indicateurs pour tous les pays\n`);

  // 8 requêtes, une par indicateur, chacune couvrant tous les pays.
  const raw = {};
  for (const [code, label] of INDIC) {
    process.stdout.write(`  ${label.padEnd(20)} …`);
    raw[code] = await imfAll(code);
    console.log(` ${Object.keys(raw[code]).length} pays`);
    await sleep(150);
  }

  // Assemblage pays par pays
  const out = {};
  let full = 0, partial = 0;

  for (const [iso, iso3] of Object.entries(ISO3)) {
    const indicators = {};
    let missingKey = false;

    for (const [code, label, fmt, key] of INDIC) {
      const s = raw[code]?.[iso3];
      const d = latest(s);
      if (d) indicators[code] = { label, fmt, ...d, source: "FMI", ...(history(s) || {}) };
      else if (key) missingKey = true;
    }

    // Règle tout-ou-rien : si un indicateur CLÉ manque, on écarte le pays.
    if (missingKey) { partial++; continue; }
    full++;

    out[iso] = {
      name: sources[iso]?.name || NAMES[iso] || iso,
      iso3,
      indicators,
      links: {
        imf: `https://www.imf.org/external/datamapper/profile/${iso3}`,
        worldbank: `https://data.worldbank.org/country/${iso}`,
      },
    };
  }

  // Taux de change USD→EUR, via le WEO du FMI si dispo, sinon valeur récente connue.
  let fx = null;
  try {
    const eurusd = await imfAll("ENDA_XDC_USD_RATE"); // souvent absent → fallback
    const s = latest(eurusd?.["EMU"] || eurusd?.["DEU"]);
    if (s) fx = { usdToEur: s.value, year: s.year };
  } catch {}
  if (!fx) fx = { usdToEur: 0.92, year: YEAR_MAX, approx: true };

  await mkdir(new URL("./public/", import.meta.url), { recursive: true });
  await writeFile(new URL("./public/macro.json", import.meta.url),
    JSON.stringify({ generatedAt: new Date().toISOString(), fx, countries: out }));

  console.log(`\n  ✓ macro.json écrit`);
  console.log(`    ${full} pays complets affichés · ${partial} écartés (données clés manquantes)`);
  console.log(`    taux : 1 USD = ${fx.usdToEur}${fx.approx ? " € (approx.)" : " €"}\n`);
  process.exit(0);
}

run();
