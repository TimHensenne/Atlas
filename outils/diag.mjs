/**
 * Pourquoi ces deux articles n'ont-ils pas fusionné ?
 *
 *   node diag.mjs          → toutes les paires suspectes, avec leur score
 *   node diag.mjs 0.30     → descend le plancher d'affichage
 *
 * Rejoue exactement la logique de fetch-news.mjs sur public/articles.json,
 * et affiche le score de recouvrement de chaque paire proche. C'est ce
 * chiffre qui décide, et c'est lui qu'il faut regarder avant de toucher
 * au seuil COVER.
 */

import { readFile } from "node:fs/promises";

const PLANCHER = Number(process.argv[2] || 0.35);

/* ---- copie conforme de la logique de fetch-news.mjs ---- */

const STOP = new Set(`le la les de des du un une et en au aux dans pour sur par avec est sont
que qui se ce son sa ses plus ne pas ont fait apres selon entre tout tous cette
het de een van op met voor zijn dat die der den das ist und im von mit auf
the of to in for on and is are with at as by from this that it its`.split(/\s+/));

const tokens = (title) => new Set(
  title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w))
);

function stem(w) {
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("en")) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

const simTokens = (t) => new Set([...tokens(t)].map(stem));

function entities(title) {
  return new Set(
    (title.match(/[A-ZÀ-Ý][\wÀ-ÿ'’-]{1,}|[A-Z]{2,}/g) || [])
      .map((w) => w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
      .filter((w) => w.length >= 2 && !STOP.has(w))
  );
}

function differentActors(tA, tB) {
  const eA = entities(tA), eB = entities(tB);
  if (!eA.size || !eB.size) return false;
  for (const w of eA) if (eB.has(w)) return false;
  return true;
}

/* ---- diagnostic ---- */

const data = JSON.parse(await readFile(new URL("./public/articles.json", import.meta.url)));
console.log(`\n  articles.json généré le ${new Date(data.generatedAt).toLocaleString("fr-BE")}`);
const ageMin = (Date.now() - new Date(data.generatedAt)) / 60000;
if (ageMin > 60) console.log(`  ⚠ il date de ${Math.floor(ageMin / 60)} h — as-tu relancé npm run news ?`);

for (const [iso, c] of Object.entries(data.countries)) {
  const arts = c.articles || [];
  if (arts.length < 2) continue;

  const byLang = {};
  for (const a of arts) (byLang[a.lang] ||= []).push(a);

  for (const [lang, list] of Object.entries(byLang)) {
    list.forEach((a) => (a._t = simTokens(a.title)));

    const df = new Map();
    for (const a of list) for (const w of a._t) df.set(w, (df.get(w) || 0) + 1);
    const N = list.length || 1;
    const idf = (w) => Math.log((N + 1) / ((df.get(w) || 0) + 1)) + 1;

    const paires = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i]._t, B = list[j]._t;
        let iw = 0, aw = 0, bw = 0;
        for (const w of A) { const x = idf(w); aw += x; if (B.has(w)) iw += x; }
        for (const w of B) bw += idf(w);
        if (!aw || !bw) continue;
        const cover = iw / Math.min(aw, bw);
        if (cover < PLANCHER) continue;
        paires.push({ cover, a: list[i], b: list[j], bloque: differentActors(list[i].title, list[j].title) });
      }
    }

    if (!paires.length) continue;
    paires.sort((x, y) => y.cover - x.cover);
    console.log(`\n  ── ${iso} / ${lang.toUpperCase()} · ${list.length} titres · ${paires.length} paire(s) au-dessus de ${PLANCHER} ──\n`);
    for (const p of paires) {
      const verdict = p.bloque ? "BLOQUÉ (acteurs différents)" : p.cover >= 0.62 ? "aurait fusionné" : "sous le seuil";
      console.log(`  cover ${p.cover.toFixed(3)}  ${verdict}`);
      console.log(`     A  ${p.a.source} · ${p.a.title.slice(0, 66)}`);
      console.log(`     B  ${p.b.source} · ${p.b.title.slice(0, 66)}`);
      if (p.bloque) {
        console.log(`     noms propres  A: ${[...entities(p.a.title)].join(", ") || "—"}`);
        console.log(`                   B: ${[...entities(p.b.title)].join(", ") || "—"}`);
      }
      console.log();
    }
  }
}

console.log(`  Seuil actuel : COVER = 0.62 dans fetch-news.mjs\n`);
