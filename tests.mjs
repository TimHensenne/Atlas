// Atlas — tests d'invariants. Usage : `node tests.mjs` (depuis la racine du
// repo) ou `node tests.mjs <chemin/index.html> <dossier/données>`.
// Le script extrait les fonctions critiques DU FICHIER LIVRÉ (public/index.html)
// et les exécute sur les vraies données : si le code et les données divergent
// des règles ci-dessous, il sort en erreur (exit 1). À lancer avant chaque push,
// en complément de `node --check`.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const htmlPath = process.argv[2] || "public/index.html";
const dataDir  = process.argv[3] || "public";
const html = readFileSync(htmlPath, "utf8");
const J = (f) => JSON.parse(readFileSync(join(dataDir, f), "utf8"));
const macro = J("macro.json"), ident = J("countries.json"), ratings = J("ratings.json");

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log("  ✓ " + label);
  else { failures++; console.error("  ✗ " + label); }
};
const section = (t) => console.log("\n" + t);

// ── Extraction de fonctions depuis le module (comptage d'accolades) ──
function extract(startMarker){
  const i = html.indexOf(startMarker);
  if (i < 0) return null;
  const open = html.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < html.length; j++){
    if (html[j] === "{") depth++;
    else if (html[j] === "}"){ depth--; if (depth === 0) return html.slice(i, j + 1); }
  }
  return null;
}
const parts = {
  fmtMoney:       extract("const fmtMoney = (usd, unit) =>"),
  indRank:        extract("function indRank(iso, key)"),
  sovereignRisk:  extract("function sovereignRisk(iso)"),
  ratingCat:      extract("function ratingCat(r)"),
  worstRatingCat: extract("function worstRatingCat(iso)"),
  niceTicks:      extract("function niceTicks(min, max, n)"),
  yAxisUnit:      extract("function yAxisUnit(fmt, ticks)"),
};

section("Extraction du code livré");
for (const [k, v] of Object.entries(parts)) ok(!!v, `fonction ${k} trouvée dans ${htmlPath}`);
if (failures){ console.error("\nExtraction incomplète — arrêt."); process.exit(1); }

const build = (langV, curV) => new Function(
  "macro", "ident", "ratings",
  `let lang=${JSON.stringify(langV)}, currency=${JSON.stringify(curV)};
   ${parts.fmtMoney};
   ${parts.indRank}
   ${parts.sovereignRisk}
   ${parts.ratingCat}
   ${parts.worstRatingCat}
   ${parts.niceTicks}
   ${parts.yAxisUnit}
   return { fmtMoney, indRank, sovereignRisk, ratingCat, worstRatingCat, niceTicks, yAxisUnit };`
)(macro, ident, ratings);
const FR = build("fr", "USD"), EN = build("en", "USD");

// ── 1. Score de risque : bornes et structure, sur TOUS les pays ──
section("Score de risque souverain");
let n = 0, withScore = 0, bad = [];
for (const iso of Object.keys(macro.countries)){
  n++;
  const r = FR.sovereignRisk(iso);
  if (r === null) continue;
  withScore++;
  const okOne = Number.isInteger(r.score) && r.score >= 0 && r.score <= 100
    && r.band && r.band.fr && r.band.c
    && Array.isArray(r.pillars) && r.pillars.length === 6
    && r.pillars.every(p => isFinite(p.risk) && p.risk >= 0 && p.risk <= 100
        && typeof p.disp === "string" && p.disp.length > 0 && p.fr && p.en)
    && Number.isInteger(r.adjust) && r.adjust >= 0 && r.adjust <= 10;
  if (!okOne) bad.push(iso);
}
ok(bad.length === 0, `structure valide (score 0-100, 6 piliers, ajust ≤10) pour ${withScore}/${n} pays notés${bad.length ? " — KO: " + bad.slice(0,5) : ""}`);
ok(withScore > 100, `couverture raisonnable (${withScore} pays avec score)`);
const sCH = FR.sovereignRisk("CH")?.score, sEG = FR.sovereignRisk("EG")?.score;
ok(sCH != null && sCH < 35, `ancre : Suisse en zone basse (${sCH})`);
ok(sEG != null && sEG > 40, `ancre : Égypte en zone haute (${sEG})`);

// ── 2. Cohérence code ↔ carte ↔ modale ──
section("Cohérence carte & modale");
const card = extract("function renderRiskCard(iso)") || "";
ok(card.includes(".disp") || card.includes("p.disp"), "la carte lit p.disp (format actuel du modèle)");
ok(!/fp\(p\.val\)|p\.val\b/.test(card), "la carte ne référence plus p.val (ancien format)");
ok(html.includes("Les six piliers") && html.includes("The six pillars"),
   "la modale décrit bien SIX piliers (FR et EN), comme le modèle");

// ── 3. Rangs mondiaux/régionaux ──
section("Rangs (indRank)");
const rk = FR.indRank("US", "NGDPD");
ok(rk && rk.worldRank === 1, `le PIB des États-Unis est 1er mondial (${rk && rk.worldRank})`);
let rkBad = 0;
for (const iso of ["FR", "DE", "JP", "NG", "BR"]){
  for (const key of ["NGDPD", "GGXWDG_NGDP", "LUR"]){
    const r = FR.indRank(iso, key);
    if (r && !(r.worldRank >= 1 && r.worldRank <= r.worldN && r.regRank >= 1 && r.regRank <= r.regN)) rkBad++;
  }
}
ok(rkBad === 0, "bornes de rang valides (1 ≤ rang ≤ effectif) sur l'échantillon");

// ── 4. Formats monétaires bilingues ──
section("Formats FR/EN");
ok(FR.fmtMoney(20, "Md").includes("Md"), `FR : milliards en « Md » (${FR.fmtMoney(20, "Md")})`);
ok(EN.fmtMoney(20, "Md").includes("B") && !EN.fmtMoney(20, "Md").includes("Md"),
   `EN : milliards en « B » (${EN.fmtMoney(20, "Md")})`);
ok(FR.fmtMoney(27720, "Md").includes(","), `FR : décimale à virgule (${FR.fmtMoney(27720, "Md")})`);
ok(EN.fmtMoney(27720, "Md").includes("."), `EN : décimale à point (${EN.fmtMoney(27720, "Md")})`);

// ── 5. Axes du comparateur ──
section("Axes (niceTicks / yAxisUnit)");
let tickBad = 0;
for (const [lo, hi] of [[0, 100], [-15, 3], [52, 139], [1000, 35000], [0.2, 0.9]]){
  const ts = FR.niceTicks(lo, hi, 5);
  const sorted = ts.every((v, i) => i === 0 || v > ts[i - 1]);
  if (!(ts.length >= 2 && ts.length <= 7 && sorted)) tickBad++;
}
ok(tickBad === 0, "graduations : 2 à 7 ticks strictement croissants sur 5 plages types");
const yu = EN.yAxisUnit("moneyMd", [10000, 20000, 30000]);
ok(/T|B/.test(yu.label), `unité d'axe EN cohérente (${yu.label})`);

// ── 6. Notations d'agence ──
section("Notations (ratingCat)");
ok(FR.ratingCat("AAA") === "ig" && FR.ratingCat("BBB-") === "ig", "AAA et BBB- = investment grade");
ok(FR.ratingCat("BB+") === "spec" && FR.ratingCat("B3") === "spec", "BB+ et B3 = spéculatif");
ok(FR.ratingCat("Ca") === "sub" && FR.ratingCat("CCC") === "sub", "Ca et CCC = très spéculatif");
ok(FR.ratingCat("XYZ") === null && FR.ratingCat(null) === null, "notation inconnue → null");

// ── 7. Dictionnaires bilingues complets ──
section("Dictionnaires");
const grab = (name) => {
  const m = html.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\});`));
  return m ? m[1] : null;
};
const chartInds = (html.match(/const CHART_INDS = \[([^\]]+)\]/) || [])[1] || "";
const indKeys = [...chartInds.matchAll(/"([A-Z_]+)"/g)].map(m => m[1]);
ok(indKeys.length >= 8, `CHART_INDS lu (${indKeys.length} indicateurs)`);
const metDef = grab("MET_DEF") || "", indLabels = grab("IND_LABELS") || "";
const missDef = indKeys.filter(k => !metDef.includes(k));
const missLab = indKeys.filter(k => !indLabels.includes(`"${k}"`));
ok(missDef.length === 0, "chaque indicateur du comparateur a sa définition (MET_DEF)" + (missDef.length ? " — manquent: " + missDef : ""));
ok(missLab.length === 0, "chaque indicateur a son libellé FR/EN (IND_LABELS)" + (missLab.length ? " — manquent: " + missLab : ""));

// ── 8. Équilibre CSS ──
section("CSS");
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";
const oB = (css.match(/{/g) || []).length, cB = (css.match(/}/g) || []).length;
ok(oB === cB && oB > 0, `accolades équilibrées (${oB}/${cB})`);

// ── Verdict ──
console.log("");
if (failures){ console.error(`✗ ${failures} test(s) en échec.`); process.exit(1); }
console.log("✓ Tous les invariants tiennent.");
