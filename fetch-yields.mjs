/**
 * Rendements souverains 10 ans + spreads — source FRED (séries OCDE).
 *   node fetch-yields.mjs   →   écrit public/yields.json
 *
 * FRED (Fed de Saint-Louis) publie les rendements des obligations d'État à
 * 10 ans via des séries de l'OCDE : IRLTLT01{ISO2}M156N, mensuelles. On passe
 * par l'endpoint CSV « fredgraph », qui ne demande AUCUNE clé d'API.
 * Couverture : pays de l'OCDE (~40). Le spread est calculé face au Treasury
 * américain 10 ans (référence mondiale). Données mensuelles → on garde la
 * dernière valeur de chaque année pour la mini-courbe.
 *
 * À lancer une fois par mois (déjà branché dans le script npm « data »).
 */

import { writeFile, mkdir } from "node:fs/promises";

const FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=";
const UA = "AtlasBot/0.1 (+https://timhensenne.github.io/Atlas/)";
const BENCH = "US";                       // Treasury US 10 ans = référence des spreads
const YEAR_MAX = new Date().getFullYear();
const HISTN = 15;

// Pays OCDE candidats (code ISO-2 = code de série FRED). Ceux sans série 10 ans
// sont simplement ignorés.
const OECD = ["AU","AT","BE","CA","CL","CO","CZ","DK","EE","FI","FR","DE","GR",
  "HU","IS","IE","IL","IT","JP","KR","LV","LT","LU","MX","NL","NZ","NO","PL",
  "PT","SK","SI","ES","SE","CH","TR","GB","US"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Récupère et parse une série FRED (CSV). Renvoie { yield, date, hist0, hist }.
async function fetchSeries(iso, essai = 0){
  const url = FRED + `IRLTLT01${iso}M156N`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok){
      if (essai < 2){ await sleep(600 * (essai + 1)); return fetchSeries(iso, essai + 1); }
      return null;
    }
    const csv = await r.text();
    const lines = csv.trim().split("\n").slice(1);      // saute l'en-tête
    const monthly = [];
    for (const line of lines){
      const [date, val] = line.split(",");
      if (!date || val == null) continue;
      const v = Number(val.trim());
      if (val.trim() === "." || !isFinite(v)) continue; // "." = valeur manquante
      monthly.push([date.trim(), v]);
    }
    if (monthly.length < 2) return null;
    const last = monthly[monthly.length - 1];
    // dernière valeur de chaque année (≤ année courante) → série annuelle
    const byYear = {};
    for (const [date, v] of monthly){
      const y = +date.slice(0, 4);
      if (y <= YEAR_MAX) byYear[y] = v;
    }
    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b).slice(-HISTN);
    return {
      yield: +last[1].toFixed(2),
      date: last[0].slice(0, 7),
      hist0: years[0],
      hist: years.map((y) => +byYear[y].toFixed(2)),
    };
  } catch {
    if (essai < 2){ await sleep(600 * (essai + 1)); return fetchSeries(iso, essai + 1); }
    return null;
  }
}

async function main(){
  console.log(`\n  Rendements 10 ans · FRED/OCDE · réf. ${BENCH}\n`);
  const series = {};
  for (const iso of OECD){
    const s = await fetchSeries(iso);
    if (s) series[iso] = s;
    process.stdout.write(s ? "·" : "×");
    await sleep(200);
  }
  console.log("");

  const bench = series[BENCH];
  const benchY = bench ? bench.yield : null;

  const countries = {};
  for (const [iso, s] of Object.entries(series)){
    countries[iso] = { ...s, spread: benchY != null ? +(s.yield - benchY).toFixed(2) : null };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    benchmark: bench ? { iso: BENCH, yield: bench.yield, date: bench.date } : null,
    countries,
  };

  await mkdir("public", { recursive: true });
  await writeFile("public/yields.json", JSON.stringify(out));
  console.log(`\n  ✓ public/yields.json — ${Object.keys(countries).length} pays`
    + (benchY != null ? ` · Treasury à ${benchY} %` : " · référence indisponible") + "\n");
}

main();
