/**
 * Notations souveraines (S&P, Moody's, Fitch) — source : Wikipédia,
 * « List of countries by credit rating » (licence CC BY-SA, réutilisable avec
 * attribution). Écrit public/ratings.json.
 *
 *   node fetch-ratings.mjs   (ou npm run ratings)
 *
 * Fonctionnement : on récupère le HTML rendu de la page via l'API MediaWiki,
 * on lit les TROIS premiers tableaux (S&P, Fitch, Moody's dans cet ordre),
 * on associe chaque pays à son code ISO-2 (via world-countries + quelques alias),
 * et on valide chaque note contre le barème de l'agence. Garde-fou : si trop peu
 * de pays sont récupérés (parsing cassé), on N'ÉCRIT PAS — le fichier existant
 * reste intact. Les notes changent peu (quelques fois par an) : un run mensuel
 * suffit largement.
 *
 * Prérequis : npm install world-countries
 */

import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const worldCountries = require("world-countries/countries.json");

const API = "https://en.wikipedia.org/w/api.php?action=parse&format=json"
  + "&formatversion=2&prop=text&page=List_of_countries_by_credit_rating";
const UA = "AtlasBot/0.1 (+https://timhensenne.github.io/Atlas/)";
const MIN_PER_AGENCY = 50;   // en-dessous, on considère le parsing cassé

// Barèmes : une note valide doit correspondre.
const RE_SP = /^(AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|CCC[+-]?|CC|C|SD|D|RD)$/;
const RE_MOODY = /^(Aaa|Aa[1-3]|A[1-3]|Baa[1-3]|Ba[1-3]|B[1-3]|Caa[1-3]|Ca|C)$/;

// Noms Wikipédia qui ne se résolvent pas seuls → code ISO-2.
const ALIAS = {
  "czechia":"CZ", "czech republic":"CZ", "south korea":"KR", "korea":"KR",
  "democratic republic of the congo":"CD", "dr congo":"CD",
  "republic of the congo":"CG", "congo":"CG",
  "cote d'ivoire":"CI", "côte d'ivoire":"CI", "ivory coast":"CI",
  "cabo verde":"CV", "cape verde":"CV", "viet nam":"VN", "vietnam":"VN",
  "turkiye":"TR", "türkiye":"TR", "turkey":"TR", "north macedonia":"MK",
  "hong kong":"HK", "macao":"MO", "macau":"MO", "taiwan":"TW", "kosovo":"XK",
  "united states":"US", "usa":"US", "united kingdom":"GB", "uk":"GB",
  "east timor":"TL", "timor leste":"TL", "eswatini":"SZ", "swaziland":"SZ",
  "saint vincent and the grenadines":"VC", "brunei darussalam":"BN",
  "laos":"LA", "moldova":"MD", "bolivia":"BO", "tanzania":"TZ", "venezuela":"VE",
  "curacao":"CW", "curaçao":"CW", "saint helena":"SH", "falkland islands":"FK",
  "cayman islands":"KY", "isle of man":"IM", "bermuda":"BM",
  "turks and caicos islands":"TC", "montserrat":"MS",
};

const norm = (s) => String(s || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();

// Table nom → ISO-2 construite depuis world-countries (+ alias).
const NAME2ISO = { ...ALIAS };
for (const c of worldCountries){
  const iso = c.cca2; if (!iso || iso === "-99") continue;
  for (const n of [c.name?.common, c.name?.official, ...(c.altSpellings || [])]){
    const k = norm(n); if (k && !(k in NAME2ISO)) NAME2ISO[k] = iso;
  }
}
const isoOf = (name) => {
  const k = norm(name);
  if (NAME2ISO[k]) return NAME2ISO[k];
  const k2 = k.replace(/ [a-z0-9]{1,2}$/, "").trim();   // retire un éventuel suffixe de note
  return (k2 && NAME2ISO[k2]) || null;
};

// Nettoie une cellule HTML : enlève balises, décode entités, normalise le « − ».
const clean = (html) => html
  .replace(/<style[\s\S]*?<\/style>/gi, "")     // blocs CSS (TemplateStyles) — retirés en entier
  .replace(/<sup[\s\S]*?<\/sup>/gi, "")        // enlève les [refs]
  .replace(/<[^>]+>/g, "")                      // enlève les balises
  .replace(/\[[^\]]*\]/g, "")                   // notes en clair : [a], [1]…
  .replace(/&amp;/g, "&")
  .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")       // espace insécable : nommé ET numérique
  .replace(/&#8722;|\u2212/g, "-")              // − → -
  .replace(/&#\d+;|&[a-z]+;/gi, "")             // autres entités résiduelles → retirées
  .replace(/\s+/g, " ").trim();

// Parse un tableau HTML → [{ country, rating, outlook }].
// Découpage tolérant : ne dépend pas des balises de fermeture (<td>/<tr>), que
// le HTML de Wikipédia omet parfois — c'est ce qui faisait sauter des lignes.
function parseTable(tableHtml, validRe){
  const rows = [];
  const body = (tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i) || [tableHtml])[0];
  for (const chunk of body.split(/<tr\b/i).slice(1)){
    const row = chunk.split(/<\/tr>/i)[0];
    const cells = row.split(/<t[dh]\b/i).slice(1).map((c) => {
      const gt = c.indexOf(">");                       // fin de la balise ouvrante
      const inner = gt >= 0 ? c.slice(gt + 1) : c;
      return clean(inner.split(/<\/t[dh]>/i)[0]);      // contenu avant la fermeture
    });
    if (cells.length < 2) continue;
    const country = cells[0], rating = cells[1], outlook = cells[2] || "";
    if (!country || !validRe.test(rating)) continue;   // saute en-têtes/WD/RD…
    rows.push({ country, rating, outlook });
  }
  return rows;
}

async function main(){
  console.log("\n  Notations souveraines · Wikipédia\n");
  let html;
  try {
    const r = await fetch(API, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    html = j?.parse?.text;
    if (!html) throw new Error("réponse inattendue");
  } catch (e){
    console.error("  ⚠ Échec du chargement Wikipédia :", e.message, "— fichier inchangé.");
    process.exit(0);
  }

  const tables = html.match(/<table[^>]*wikitable[\s\S]*?<\/table>/gi) || [];
  if (tables.length < 3){
    console.error("  ⚠ Moins de 3 tableaux trouvés — structure changée. Fichier inchangé.");
    process.exit(0);
  }
  const sp    = parseTable(tables[0], RE_SP);      // 1er tableau = S&P
  const fitch = parseTable(tables[1], RE_SP);      // 2e = Fitch (même barème)
  const moody = parseTable(tables[2], RE_MOODY);   // 3e = Moody's

  if (sp.length < MIN_PER_AGENCY || fitch.length < MIN_PER_AGENCY || moody.length < MIN_PER_AGENCY){
    console.error(`  ⚠ Parsing trop maigre (S&P ${sp.length}, Fitch ${fitch.length}, Moody's ${moody.length}). Fichier inchangé.`);
    process.exit(0);
  }

  const countries = {};
  const add = (rows, key) => {
    for (const { country, rating, outlook } of rows){
      const iso = isoOf(country); if (!iso) continue;
      (countries[iso] ||= {})[key] = rating;
      if (outlook && /^(Stable|Positive|Negative)$/i.test(outlook))
        countries[iso][key + "O"] = outlook.toLowerCase();
    }
  };
  add(sp, "sp"); add(fitch, "fitch"); add(moody, "moody");

  const out = {
    generatedAt: new Date().toISOString(),
    source: "Wikipedia — List of countries by credit rating (CC BY-SA)",
    countries,
  };
  await mkdir("public", { recursive: true });
  await writeFile("public/ratings.json", JSON.stringify(out));
  console.log(`  ✓ public/ratings.json — ${Object.keys(countries).length} pays`
    + ` (S&P ${sp.length}, Fitch ${fitch.length}, Moody's ${moody.length})\n`);
}

main();
