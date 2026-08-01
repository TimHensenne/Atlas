// Diagnostic ciblé : montre la LIGNE Switzerland et ce que le parseur en extrait.
const API = "https://en.wikipedia.org/w/api.php?action=parse&format=json"
  + "&formatversion=2&prop=text&page=List_of_countries_by_credit_rating";
const UA = "AtlasBot/0.1 (+https://timhensenne.github.io/Atlas/)";

const clean = (html) => html
  .replace(/<sup[\s\S]*?<\/sup>/gi,"").replace(/<[^>]+>/g,"").replace(/\[[^\]]*\]/g,"")
  .replace(/&amp;/g,"&").replace(/&nbsp;/g," ").replace(/&#8722;|\u2212/g,"-")
  .replace(/&[a-z]+;/gi,"").replace(/\s+/g," ").trim();
const RE_SP = /^(AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|CCC[+-]?|CC|C|SD|D|RD)$/;

const r = await fetch(API, { headers: { "User-Agent": UA } });
const j = await r.json();
const html = j?.parse?.text || "";
const tables = html.match(/<table[^>]*wikitable[\s\S]*?<\/table>/gi) || [];
const sp = tables[0] || "";

// Localise le NOM du pays (lien), pas l'URL du drapeau
const anchor = sp.search(/title="Switzerland"|>Switzerland<\/a>/i);
console.log("Ancrage du nom trouvé à :", anchor);

// Remonte au <tr ... et descend jusqu'à </tr>
const start = sp.lastIndexOf("<tr", anchor);
const end = sp.indexOf("</tr>", anchor);
const rowHtml = sp.slice(start, end + 5);
console.log("\n=== LIGNE HTML BRUTE (Switzerland) ===\n" + rowHtml);

// Ce que le parseur robuste en extrait, cellule par cellule
const cells = rowHtml.split(/<t[dh]\b/i).slice(1).map((c) => {
  const gt = c.indexOf(">"); const inner = gt >= 0 ? c.slice(gt + 1) : c;
  return clean(inner.split(/<\/t[dh]>/i)[0]);
});
console.log("\n=== CELLULES EXTRAITES ===");
cells.forEach((c, k) => console.log(`  [${k}] "${c}"`));
console.log("\n  cells[0] (pays)   :", JSON.stringify(cells[0]));
console.log("  cells[1] (note)   :", JSON.stringify(cells[1]));
console.log("  RE_SP teste note  :", RE_SP.test(cells[1] || ""));
