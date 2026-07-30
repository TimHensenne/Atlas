/**
 * Le chasseur de flux.
 *
 *   node find-feeds.mjs lesoir.be lalibre.be tijd.be
 *   node find-feeds.mjs lesoir.be --all      (affiche aussi les flux morts)
 *
 * Pour chaque domaine :
 *   1. lit la page d'accueil et en extrait les flux déclarés (<link rel="alternate">)
 *   2. sonde les chemins classiques, au cas où rien n'est déclaré
 *   3. VALIDE chaque candidat : il se parse ? il contient des articles ? récents ?
 *
 * C'est le point important : trouver une URL qui répond ne suffit pas.
 * tijd.be/rss/top_stories.xml répondait très bien — et n'avait rien publié
 * depuis 2020.
 */

import Parser from "rss-parser";

const UA = "AtlasBot/0.1 (+https://ton-domaine.be/about; contact@ton-domaine.be)";
const TOUT = process.argv.includes("--all");
const SECTIONS = process.argv.includes("--sections");
const domaines = process.argv.slice(2).filter((a) => !a.startsWith("--"));

if (!domaines.length) {
  console.error('\nUsage : node find-feeds.mjs lesoir.be lalibre.be tijd.be\n');
  process.exit(1);
}

const parser = new Parser({ timeout: 12_000, headers: { "User-Agent": UA } });

// Les chemins qu'on retrouve chez 90 % des éditeurs. Les derniers visent les
// rubriques éco : un flux thématique vaut mieux qu'un flux généraliste filtré.
// Les noms de rubrique éco, FR et NL. Un flux de rubrique est trié par la
// rédaction : il vaut mieux que n'importe quel filtre appliqué après coup.
const RUBRIQUES = [
  "economie", "eco", "economy", "business", "entreprises", "entreprise",
  "argent", "finance", "finances", "bourse", "marches", "conso",
  "geld", "ondernemen", "bedrijven", "markten", "beurs", "netto", "economisch",
];

// Les gabarits d'URL de rubrique, selon la plateforme de l'éditeur.
const GABARITS = [
  (s) => `/rss/${s}`,
  (s) => `/rss/${s}.xml`,
  (s) => `/${s}/rss`,
  (s) => `/${s}.rss`,
  (s) => `/rss/section/${s}`,
  (s) => `/arc/outboundfeeds/rss/category/${s}/?outputType=xml`,
  (s) => `/feed/${s}`,
];

const CHEMINS = [
  "/rss", "/rss.xml", "/feed", "/feed/", "/feeds", "/rss/feed",
  "/index.rss", "/atom.xml", "/?feed=rss2",
  "/rss/top_stories.xml", "/rss/home.xml", "/rss/all.xml",
  "/arc/outboundfeeds/rss/?outputType=xml",
  "/rss/economie", "/rss/economie.xml", "/economie/rss", "/economie.rss",
  "/rss/economy.xml", "/rss/business.xml",
  "/rss/section/economie", "/nl/rss", "/fr/rss",
];

async function pageFlux(base) {
  try {
    const r = await fetch(base, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!r.ok) return [];
    const html = await r.text();
    const out = [];
    // <link rel="alternate" type="application/rss+xml" href="...">
    const re = /<link[^>]+>/gi;
    for (const tag of html.match(re) || []) {
      if (!/alternate/i.test(tag)) continue;
      if (!/(rss|atom)\+xml/i.test(tag)) continue;
      const h = tag.match(/href=["']([^"']+)["']/i);
      if (h) out.push(new URL(h[1], base).toString());
    }
    return out;
  } catch {
    return [];
  }
}

async function valide(url) {
  try {
    const f = await parser.parseURL(url);
    const items = f.items || [];
    if (!items.length) return { url, ok: false, note: "flux vide" };
    let plusRecent = null;
    for (const it of items) {
      const d = new Date(it.isoDate || it.pubDate || 0);
      if (isNaN(d)) continue;
      const h = (Date.now() - d) / 3600_000;
      if (plusRecent === null || h < plusRecent) plusRecent = h;
    }
    const jours = plusRecent === null ? null : plusRecent / 24;
    return {
      url, ok: jours !== null && jours < 3,
      titre: f.title || "—",
      n: items.length,
      age: plusRecent,
      note: jours === null ? "aucune date" : jours >= 3 ? `ZOMBIE · ${Math.floor(jours)} j` : null,
    };
  } catch (e) {
    return { url, ok: false, note: String(e.message).slice(0, 42) };
  }
}

// 4 à la fois : ni trop lent, ni impoli.
async function enLots(taches, n = 4) {
  const out = [];
  for (let i = 0; i < taches.length; i += n) {
    out.push(...(await Promise.all(taches.slice(i, i + n).map((t) => t()))));
  }
  return out;
}

for (const dom of domaines) {
  console.log(`\n══ ${dom} ══`);

  const bases = [`https://www.${dom}/`, `https://${dom}/`];
  const declares = (await Promise.all(bases.map(pageFlux))).flat();

  if (declares.length) console.log(`   ${declares.length} flux déclaré(s) dans la page d'accueil`);
  else console.log(`   rien de déclaré dans la page d'accueil — on sonde les chemins classiques`);

  const chemins = SECTIONS
    ? RUBRIQUES.flatMap((s) => GABARITS.map((g) => g(s)))
    : CHEMINS;

  const candidats = [...new Set([
    ...declares,
    ...chemins.map((c) => `https://www.${dom}${c}`),
  ])];

  if (SECTIONS) console.log(`   ${chemins.length} gabarits de rubrique sondés — compte une minute`);

  const res = await enLots(candidats.map((u) => () => valide(u)));
  const vivants = res.filter((r) => r.ok).sort((a, b) => a.age - b.age);
  const morts = res.filter((r) => !r.ok);

  if (!vivants.length) {
    console.log(`   ✗ aucun flux vivant trouvé.`);
  } else {
    console.log();
    for (const r of vivants) {
      const h = r.age < 1 ? `${Math.round(r.age * 60)} min` : `${r.age.toFixed(1)} h`;
      console.log(`   ✓ ${r.url}`);
      console.log(`     « ${r.titre.slice(0, 52)} » · ${r.n} items · dernier il y a ${h}`);
    }
  }

  const zombies = morts.filter((r) => r.note?.startsWith("ZOMBIE"));
  if (zombies.length) {
    console.log();
    for (const r of zombies) console.log(`   ⚠ ${r.url}\n     ${r.note} — répond, mais ne publie plus`);
  }

  if (TOUT) {
    console.log();
    for (const r of morts.filter((r) => !r.note?.startsWith("ZOMBIE"))) {
      console.log(`   ✗ ${r.url.replace(`https://www.${dom}`, "")}  ${r.note}`);
    }
  }
}

console.log(`\n  Colle les lignes ✓ dans sources.json, puis : node inspect.mjs "<url>"\n`);
