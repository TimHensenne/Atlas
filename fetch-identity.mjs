// fetch-identity.mjs
// Régénère public/countries.json : les champs stables (capitale, monnaie,
// superficie, langues, indicatif) viennent du jeu de données world-countries
// (npm, hors ligne), et la POPULATION est récupérée en direct auprès de la
// Banque mondiale (indicateur SP.POP.TOTL, valeur la plus récente).
//
// À lancer manuellement (`node fetch-identity.mjs` ou `npm run identity`) ou
// automatiquement via une tâche planifiée (voir .github/workflows).
//
// Prérequis : npm install world-countries

import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const worldCountries = require("world-countries/countries.json");

// La Banque mondiale identifie les pays par code ISO3 ; quelques codes diffèrent
// de ceux de world-countries.
const WB_ALIAS = { UNK: "XKX" };   // Kosovo

// Régions et sous-régions en français (valeurs de world-countries).
const REGION_FR = {
  "Africa":"Afrique", "Americas":"Amériques", "Asia":"Asie",
  "Europe":"Europe", "Oceania":"Océanie", "Antarctic":"Antarctique",
};


// Noms des langues en français (codes ISO 639-3 de world-countries).
// Repli sur le nom anglais pour les langues rares sans équivalent normalisé.
const LANG_FR = {
  afr:"Afrikaans",
  amh:"Amharique",
  ara:"Arabe",
  arc:"Araméen",
  aym:"Aymara",
  aze:"Azéri",
  bar:"Bavarois",
  bel:"Biélorusse",
  ben:"Bengali",
  ber:"Berbère",
  bis:"Bichelamar",
  bjz:"Belizean Creole",
  bos:"Bosnien",
  bul:"Bulgare",
  bwg:"Chibarwe",
  cal:"Carolinian",
  cat:"Catalan",
  ces:"Tchèque",
  cha:"Chamorro",
  ckb:"Kurde central",
  cnr:"Monténégrin",
  crs:"Créole seychellois",
  dan:"Danois",
  deu:"Allemand",
  div:"Maldivien",
  dzo:"Dzongkha",
  ell:"Grec moderne",
  eng:"Anglais",
  est:"Estonien",
  fao:"Féroïen",
  fas:"Persan",
  fij:"Fidjien",
  fil:"Filipino",
  fin:"Finnois",
  fra:"Français",
  gil:"Gilbertin",
  gle:"Irlandais",
  glv:"Mannois",
  grn:"Guarani",
  gsw:"Suisse allemand",
  hat:"Créole haïtien",
  heb:"Hébreu",
  her:"Héréro",
  hgm:"Khoekhoe",
  hif:"Hindi fidjien",
  hin:"Hindi",
  hmo:"Hiri motu",
  hrv:"Croate",
  hun:"Hongrois",
  hye:"Arménien",
  ind:"Indonésien",
  isl:"Islandais",
  ita:"Italien",
  jam:"Créole jamaïcain",
  jpn:"Japonais",
  kal:"Groenlandais",
  kat:"Géorgien",
  kaz:"Kazakh",
  kck:"Kalanga",
  khi:"Khoisan",
  khm:"Khmer",
  kin:"Kinyarwanda",
  kir:"Kirghiz",
  kon:"Kikongo",
  kor:"Coréen",
  kwn:"Kwangali",
  lao:"Lao",
  lat:"Latin",
  lav:"Letton",
  lin:"Lingala",
  lit:"Lituanien",
  loz:"Lozi",
  ltz:"Luxembourgeois",
  lua:"Luba-Kasaï",
  mah:"Marshallais",
  mey:"Hassaniya",
  mfe:"Créole mauricien",
  mkd:"Macédonien",
  mlg:"Malgache",
  mlt:"Maltais",
  mon:"Mongol",
  mri:"Maori de Nouvelle-Zélande",
  msa:"Malais",
  mya:"Birman",
  nau:"Nauruan",
  nbl:"Nrebele",
  ndc:"Ndau",
  nde:"Sindebele",
  ndo:"Ndonga",
  nep:"Népalais",
  nfr:"Guernésiais",
  niu:"Niuean",
  nld:"Néerlandais",
  nno:"Nynorsk",
  nob:"Bokmål",
  nor:"Norvégien",
  nrf:"Normand",
  nso:"Northern Sotho",
  nya:"Chichewa",
  nzs:"New Zealand Sign Language",
  pap:"Papiamento",
  pau:"Palauan",
  pih:"Norfuk",
  pol:"Polonais",
  por:"Portugais",
  pov:"Upper Guinea Creole",
  prs:"Dari",
  pus:"Pachto",
  que:"Quechua",
  rar:"Rarotongien",
  roh:"Romanche",
  ron:"Roumain",
  run:"Kirundi",
  rus:"Russe",
  sag:"Sango",
  sin:"Cingalais",
  slk:"Slovaque",
  slv:"Slovène",
  smi:"Sami",
  smo:"Samoan",
  sna:"Shona",
  som:"Somali",
  sot:"Sotho du Sud",
  spa:"Espagnol",
  sqi:"Albanais",
  srp:"Serbe",
  ssw:"Swati",
  swa:"Swahili",
  swe:"Suédois",
  tam:"Tamoul",
  tet:"Tetum",
  tgk:"Tadjik",
  tha:"Thaï",
  tir:"Tigrigna",
  tkl:"Tokelauan",
  toi:"Tonga",
  ton:"Tongien",
  tpi:"Tok Pisin",
  tsn:"Tswana",
  tso:"Tsonga",
  tuk:"Turkmène",
  tur:"Turc",
  tvl:"Tuvaluan",
  ukr:"Ukrainien",
  urd:"Ourdou",
  uzb:"Ouzbek",
  ven:"Venda",
  vie:"Vietnamien",
  xho:"Xhosa",
  zdj:"Comorien",
  zho:"Chinois",
  zib:"Zimbabwean Sign Language",
  zul:"Zoulou"
};

// Capitales dont le nom diffère en français (exonymes). Repli sur le nom
// anglais/international pour toutes les autres.
const CAP_FR = {
  "Abu Dhabi":"Abou Dabi", "Addis Ababa":"Addis-Abeba", "Algiers":"Alger",
  "Ashgabat":"Achgabat", "Athens":"Athènes", "Baghdad":"Bagdad", "Baku":"Bakou",
  "Beijing":"Pékin", "Beirut":"Beyrouth", "Bern":"Berne", "Bishkek":"Bichkek",
  "Bogotá":"Bogota", "Brasília":"Brasilia", "Brussels":"Bruxelles",
  "Bucharest":"Bucarest", "Cairo":"Le Caire", "Copenhagen":"Copenhague",
  "Damascus":"Damas", "Dhaka":"Dacca", "Dushanbe":"Douchanbé",
  "El Aaiún":"Laâyoune", "Guatemala City":"Guatemala", "Hanoi":"Hanoï",
  "Havana":"La Havane", "Jerusalem":"Jérusalem", "Kabul":"Kaboul",
  "Kathmandu":"Katmandou", "Kuwait City":"Koweït", "Kyiv":"Kiev",
  "Lisbon":"Lisbonne", "London":"Londres", "Manila":"Manille",
  "Mexico City":"Mexico", "Mogadishu":"Mogadiscio", "Moscow":"Moscou",
  "Muscat":"Mascate", "Nicosia":"Nicosie", "Panama City":"Panama",
  "Riyadh":"Riyad", "Sana'a":"Sanaa", "Santo Domingo":"Saint-Domingue",
  "Seoul":"Séoul", "Singapore":"Singapour", "Tashkent":"Tachkent",
  "Tbilisi":"Tbilissi", "Tehran":"Téhéran", "Ulan Bator":"Oulan-Bator",
  "Vatican City":"Cité du Vatican", "Vienna":"Vienne", "Warsaw":"Varsovie",
  "Washington D.C.":"Washington"
};

// Monnaie en français via l'API intégrée Intl (aucune dépendance).
const curDN = new Intl.DisplayNames(["fr"], { type: "currency" });
const cap1 = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;


// Population, total — valeur la plus récente (mrv=1), tous pays en une requête.
const WB_URL =
  "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&mrv=1&per_page=400";

async function fetchPopulation(){
  const pop = {};              // ISO3 -> population
  let updated = null;
  try {
    const r = await fetch(WB_URL);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const meta = Array.isArray(j) ? j[0] : null;
    const rows = Array.isArray(j) ? j[1] : [];
    updated = meta && meta.lastupdated || null;
    for (const row of rows || []){
      if (row && row.countryiso3code && row.value != null){
        pop[row.countryiso3code] = Number(row.value);
      }
    }
  } catch (e){
    console.error("⚠ Banque mondiale injoignable, population laissée vide :", e.message);
  }
  return { pop, updated };
}

async function main(){
  const { pop, updated } = await fetchPopulation();

  const out = {};
  let withPop = 0;
  for (const c of worldCountries){
    const iso = c.cca2;
    if (!iso || iso === "-99") continue;
    const cur = c.currencies ? Object.values(c.currencies)[0] : null;
    const idd = c.idd && c.idd.root
      ? c.idd.root + (c.idd.suffixes && c.idd.suffixes.length === 1 ? c.idd.suffixes[0] : "")
      : null;
    const iso3 = WB_ALIAS[c.cca3] || c.cca3;
    const population = pop[iso3] ?? null;
    if (population != null) withPop++;
    const cap = (c.capital && c.capital[0]) || null;
    const curCode = c.currencies ? Object.keys(c.currencies)[0] : null;
    // Entre parenthèses : le code ISO 4217 (DZD, EUR…), pas le symbole — les
    // symboles exotiques s'affichent mal selon les polices, le code est sûr.
    const sym = curCode ? ` (${curCode})` : "";
    // monnaie FR : Intl.DisplayNames, repli sur le nom anglais si non résolu
    let curFrName = cur ? cur.name : null;
    if (curCode) { const n = curDN.of(curCode); if (n && n !== curCode) curFrName = cap1(n); }
    out[iso] = {
      cap,
      capFr: cap ? (CAP_FR[cap] || cap) : null,
      cur:   cur ? (cur.name + sym) : null,
      curFr: curFrName ? (curFrName + sym) : null,
      code:  curCode || null,
      area:  typeof c.area === "number" ? c.area : null,
      lang:   c.languages ? Object.values(c.languages).join(", ") : null,
      langFr: c.languages ? Object.entries(c.languages).map(([code, en]) => LANG_FR[code] || en).join(", ") : null,
      call: idd,
      pop:  population,
      reg:   c.region || null,
      regFr: c.region ? (REGION_FR[c.region] || c.region) : null,
      tz:    Array.isArray(c.timezones) && c.timezones.length ? c.timezones[0] : null,
      tld:   Array.isArray(c.tld) && c.tld.length ? c.tld[0] : null,
      bord:  Array.isArray(c.borders) ? c.borders.length : 0,
      gent:   c.demonyms?.eng?.m || null,
      gentFr: c.demonyms?.fra?.m || null,
    };
  }

  await mkdir("public", { recursive: true });
  await writeFile("public/countries.json", JSON.stringify(out));
  console.log(
    `✓ public/countries.json — ${Object.keys(out).length} pays, ` +
    `${withPop} avec population live` +
    (updated ? ` (Banque mondiale, maj ${updated})` : " (population vide : source injoignable)")
  );
}

main();
