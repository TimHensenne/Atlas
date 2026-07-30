/**
 * Inspecteur de flux — l'outil à dégainer dès qu'une source se comporte mal.
 *
 *   node inspect.mjs "https://www.tijd.be/rss/top_stories.xml"
 *
 * Il montre le flux BRUT, avant tout filtre. C'est la différence entre
 * "le script ne marche pas" et "le flux ne contient pas de date, donc
 * mon filtre de fraîcheur jette tout".
 */

import Parser from "rss-parser";

const url = process.argv[2];
if (!url) {
  console.error('Usage : node inspect.mjs "https://exemple.be/rss.xml"');
  process.exit(1);
}

const parser = new Parser({
  timeout: 15_000,
  headers: {
    "User-Agent": "AtlasBot/0.1 (+https://ton-domaine.be/about; contact@ton-domaine.be)",
  },
});

const MAX_AGE_HOURS = 36; // doit rester identique à fetch-news.mjs

try {
  const feed = await parser.parseURL(url);
  const items = feed.items || [];

  console.log(`\n  Titre du flux : ${feed.title || "(aucun)"}`);
  console.log(`  Items bruts   : ${items.length}\n`);

  if (!items.length) {
    console.log("  Le flux est vide. Soit l'URL pointe vers une rubrique inactive,");
    console.log("  soit l'éditeur a changé de format. Ouvre l'URL dans ton navigateur.\n");
    process.exit(0);
  }

  let sansDate = 0, tropVieux = 0, sansLien = 0;

  items.slice(0, 8).forEach((it, i) => {
    const raw = it.isoDate || it.pubDate || it.date;
    const d = raw ? new Date(raw) : null;
    const valide = d && !isNaN(d);
    const ageH = valide ? (Date.now() - d.getTime()) / 3600_000 : null;

    let verdict;
    if (!it.link) { verdict = "REJETÉ · pas de lien"; }
    else if (!valide) { verdict = "GARDÉ · aucune date (le filtre le laisse passer)"; }
    else if (ageH > MAX_AGE_HOURS) { verdict = `REJETÉ · ${ageH.toFixed(0)}h — trop vieux`; }
    else { verdict = `GARDÉ · ${ageH.toFixed(1)}h`; }

    console.log(`  ${String(i + 1).padStart(2)}. ${(it.title || "(sans titre)").slice(0, 62)}`);
    console.log(`      date brute : ${raw || "(absente)"}`);
    console.log(`      ${verdict}\n`);
  });

  // Bilan sur la totalité, pas juste les 8 affichés
  items.forEach((it) => {
    const raw = it.isoDate || it.pubDate || it.date;
    const d = raw ? new Date(raw) : null;
    if (!it.link) sansLien++;
    else if (!d || isNaN(d)) sansDate++;
    else if ((Date.now() - d.getTime()) / 3600_000 > MAX_AGE_HOURS) tropVieux++;
  });

  console.log(`  ── bilan sur ${items.length} items ──`);
  console.log(`  sans lien       : ${sansLien}`);
  console.log(`  sans date       : ${sansDate}`);
  console.log(`  plus de ${MAX_AGE_HOURS}h    : ${tropVieux}`);
  console.log(`  → retenus       : ${items.length - sansLien - tropVieux}\n`);

  // Les champs disponibles varient énormément d'un éditeur à l'autre.
  console.log(`  champs du 1er item : ${Object.keys(items[0]).join(", ")}\n`);
} catch (err) {
  console.error(`\n  ÉCHEC : ${err.message}\n`);
  if (String(err.message).includes("404")) {
    console.error("  404 = mauvaise URL. Ouvre le site, affiche le code source (Ctrl+U),");
    console.error('  cherche "application/rss+xml" — la vraie URL est dans le href.\n');
  }
  if (String(err.message).includes("403")) {
    console.error("  403 = l'éditeur refuse les accès automatisés sur cette URL.");
    console.error("  Cherche son flux officiel ; s'il n'y en a pas, respecte le refus.\n");
  }
  process.exit(1);
}
