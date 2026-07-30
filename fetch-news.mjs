/**
 * Le job du matin.
 *   node fetch-news.mjs
 *
 * Lit sources.json, va chercher chaque flux, normalise, déduplique
 * (par URL, puis PAR CONTENU à l'intérieur d'une même langue),
 * et écrit public/articles.json — le fichier que la carte consomme.
 *
 * Un flux qui tombe ne fait pas tomber le run.
 */

import Parser from "rss-parser";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const MAX_AGE_HOURS  = 36;   // au-delà, article périmé
const MAX_PER_SOURCE = 12;   // garde-fou par flux, avant dédup
const MAX_PER_COUNTRY = 15;  // la base finale, par pays, toutes langues confondues
const ALLOWED_LANGS  = ["fr", "nl"];  // ← ajoute "en"/"de" pour rouvrir GB/US/DE
const COVER          = 0.58; // recouvrement pondéré : 1 = un titre est contenu dans l'autre
                             // Calibré sur données réelles, pas au jugé :
                             //   0.550 = deux posts distincts → ne doivent pas fusionner
                             //   0.618 = les deux titres du Soir sur Nvidia → doivent fusionner
                             // 0.58 se pose au milieu. Remesure avec diag.mjs si tu le bouges.

/**
 * Accès. Le paywall ne se lit PAS dans un flux RSS : il se décide côté serveur,
 * au chargement, souvent selon un compteur propre au lecteur. On ne peut donc
 * pas trancher article par article — seulement source par source.
 *
 *   free    : intégralement gratuit (services publics, agences)
 *   mixed   : gratuit avec une part d'articles premium
 *   paywall : abonnement obligatoire, ou quasi
 *
 * Ces étiquettes vivent dans sources.json et sont MON estimation, pas un fait
 * vérifié. Corrige-les : tu lis ces journaux, pas moi.
 */
const EXCLUDE_ACCESS = ["paywall"];   // ← mets [] pour tout réactiver
const TIMEOUT_MS     = 10_000;

const parser = new Parser({
  timeout: TIMEOUT_MS,
  headers: {
    "User-Agent": "AtlasBot/0.1 (+https://ton-domaine.be/about; contact@ton-domaine.be)",
  },
});

/* ---------- normalisation ---------- */

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|ref$|source$)/i;

function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);

// Google News suffixe tous ses titres : « Le Bel 20 grimpe - L'Echo ».
// On le retire, sinon le nom du journal pollue la comparaison de contenu.
function cleanTitle(title, feedUrl) {
  if (!feedUrl.includes("news.google.com")) return title;
  return title.replace(/\s+[-–—]\s+[^-–—]{2,60}$/, "").trim();
}

// Mots vides FR / NL / EN / DE : ils sont partout et ne disent rien du sujet.
const STOP = new Set(`le la les de des du un une et en au aux dans pour sur par avec est sont
que qui se ce son sa ses plus ne pas ont fait apres selon entre tout tous cette
het de een van op met voor zijn dat die der den das ist und im von mit auf
the of to in for on and is are with at as by from this that it its`.split(/\s+/));

function tokens(title) {
  return new Set(
    title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
  );
}

/* ---------- presse écrite uniquement ---------- */

/**
 * Filet 2 — l'URL. Marche pour les flux DIRECTS (FT, et tes futurs flux
 * maison), où l'adresse est celle du journal. Inopérant sur Google News,
 * dont les liens sont des redirections opaques.
 */
// Sous-domaines dédiés au streaming : auvio.rtbf.be, vrtnu.vrt.be…
const AV_HOST = /(^|\.)(auvio|vrtnu|vrtmax|player|podcast|video|audio|tv|radio)\./i;

// Rubriques A/V dans le chemin.
const AV_PATH = /\/(auvio|video|videos|podcast|podcasts|audio|replay|live|direct|emission|emissions|vrtnu|vrtmax|tv|radio|kijk|luister|bekijk|watch|listen)(\/|$)/i;

/**
 * Filet 3 — le titre. C'est le seul qui fonctionne sur Google News.
 * Les rédactions préfixent leurs sujets A/V de façon très régulière :
 * « VIDÉO : ... », « Bekijk: ... », « EN IMAGES : ... ».
 * Le séparateur exigé après le marqueur évite les faux positifs :
 * « Video game industry rebounds » ne matche pas, « VIDEO: ... » oui.
 */
const AV_TITLE = /^\s*[\[(]?\s*(vid[ée]o|video|watch|bekijk|herbekijk|kijk|luister|listen|podcast|live|direct|replay|revoir|en images|en photos|in beeld|in pictures|photos|foto'?s)\s*[\])]?\s*[:|·—–-]/i;

/**
 * Forums et fils de discussion. Boursorama, Zonebourse et consorts sont des
 * portails de courtage : Google News y indexe les échanges entre particuliers.
 * Ce n'est pas de la presse écrite, c'en est l'exact opposé.
 */
const FORUM_TITLE = /^\s*(forum|blog|commentaire|discussion|tribune libre)\b|forum\s+bourse/i;
const FORUM_PATH  = /\/(forum|forums|blog|blogs|discussion|communaute)(\/|$)/i;

function isAudioVisual(title, url) {
  if (FORUM_TITLE.test(title)) return true;
  if (AV_TITLE.test(title)) return true;
  // On découpe l'URL : « auvio » dans « https://auvio.rtbf.be » n'est ni en
  // début de chaîne ni précédé d'un point. Tester l'URL brute ne marche pas.
  try {
    const u = new URL(url);
    if (AV_HOST.test(u.hostname)) return true;
    if (AV_PATH.test(u.pathname) || FORUM_PATH.test(u.pathname)) return true;
  } catch { /* URL exotique : on laisse passer, le titre a déjà filtré */ }
  return false;
}

/* ---------- pertinence thématique ---------- */

/**
 * Le vrai problème : Google News nous donne un TITRE, jamais le corps de
 * l'article. Sa description est vide (juste le titre + l'éditeur). On ne peut
 * donc « lire le contenu » qu'au prix de 100 requêtes HTTP par matin.
 *
 * L'alternative, et elle est bonne : être SÉVÈRE. Avec ~40 candidats pour
 * 15 places, jeter un bon article ne coûte rien — il sera remplacé par un
 * autre bon article. Rater un article sur Beyoncé, si.
 *
 * Règle : au moins un mot économique, et aucun mot disqualifiant.
 * Lexiques sans accents : tokens() les a déjà retirés.
 */
const THEME_YES = new Set(`
economie economique economiques croissance recession inflation deflation pib
bourse boursier boursiere indice indices action actions actionnaire actionnaires
marche marches obligation obligations taux rendement dividende dividendes
entreprise entreprises groupe societe firme industrie industriel usine
chiffre affaires benefice benefices perte pertes resultat resultats
emploi emplois licenciement licenciements restructuration faillite
banque banques bancaire assurance credit dette dettes deficit budget budgetaire
fiscal fiscalite impot impots taxe taxes tva
investissement investisseurs fonds capital financement levee acquisition rachat
fusion cotation ipo introduction valorisation
exportation exportations importation importations commerce commercial tarif
salaire salaires pouvoir achat consommation consommateur prix
euro dollar devise bce fmi ocde bnb
petrole gaz energie matieres premieres
economie economisch economische groei recessie inflatie bbp
beurs beursgenoteerd index indexen aandeel aandelen aandeelhouder
markt markten obligatie obligaties rente rendement dividend
bedrijf bedrijven groep onderneming ondernemingen industrie fabriek
omzet winst winsten verlies verliezen resultaat resultaten
baan banen jobs ontslag ontslagen herstructurering faillissement
bank banken bancair verzekering krediet schuld schulden tekort begroting
fiscaal fiscale belasting belastingen btw
investering investeringen investeerders fonds kapitaal financiering overname
fusie notering waardering
export uitvoer import invoer handel commercieel
loon lonen koopkracht consumptie consument prijs prijzen
euro dollar munt ecb imf oeso nbb
olie gas energie grondstoffen
`.trim().split(/\s+/));

/**
 * Le filet négatif. Ces mots-là ne cohabitent pas avec l'économie, et ils
 * sont la porte d'entrée des articles musique / sport / people qui passent
 * à travers la requête Google.
 */
const THEME_NO = new Set(`
album albums chanson chansons chanteur chanteuse concert concerts festival
musique musicien tournee tube single clip rappeur dj playlist eurovision
film films serie series acteur actrice cinema realisateur tournage sortie
netflix streaming teleralite emission audience
match matchs foot football joueur joueuse equipe championnat ligue coupe
transfert entraineur arbitre victoire defaite tennis cyclisme diable diables
accident incendie noyade agression meurtre proces cambriolage
mariage divorce deces funerailles prince princesse roi reine famille royale
chat chien animal recette cuisine restaurant meteo vacances horoscope
album nummer zanger zangeres concert concerten festival muziek muzikant
tournee clip rapper songfestival
film films reeks acteur actrice bioscoop regisseur kijkcijfers realiteit
wedstrijd voetbal speler ploeg competitie beker transfer trainer scheidsrechter
overwinning nederlaag tennis wielrennen duivels
ongeval brand verdrinking moord proces inbraak
huwelijk scheiding overlijden begrafenis prins prinses koning koningin koninklijke
kat hond dier recept keuken restaurant weer vakantie horoscoop
`.trim().split(/\s+/));

/**
 * Le néerlandais agglutine : « recordwinst », « groeiprognose »,
 * « beursgenoteerde » sont des mots uniques. Une comparaison mot à mot les rate
 * tous. D'où ce second passage par radicaux — volontairement longs pour ne pas
 * rattraper n'importe quoi.
 */
const THEME_STEMS = `
economi econom financi bours entrepris industri investis fiscal budget bancair
dividend benefic licenci salair inflation croissance commerc endett capital
actionnaire consommation obligation exportation importation
beurs aandeel bedrijf onderneming winst omzet belasting begroting obligatie
rente inflatie invester krediet faillis overname koopkracht werkgelegen
grondstof handel uitvoer economisch
`.trim().split(/\s+/);

const stemHit = (word) => THEME_STEMS.some((s) => word.includes(s));

/**
 * Retourne { ok, score }. Un titre sans aucun mot économique est écarté :
 * c'est brutal, ça sacrifie « Solvay ferme son site de Jemeppe », mais avec
 * ~40 candidats pour 15 places la perte est théorique.
 */
function themeScore(title) {
  const t = tokens(title);
  let yes = 0, no = 0;
  for (const w of t) {
    if (THEME_NO.has(w)) { no++; continue; }
    if (THEME_YES.has(w) || (w.length >= 6 && stemHit(w))) yes++;
  }
  return { ok: yes > 0 && no === 0, disqualifie: no > 0, score: yes };
}

/**
 * Racinisation grossière, réservée à la DÉDUPLICATION (jamais au thème :
 * les lexiques attendent des mots entiers). Elle existe pour une raison
 * précise : « entreprises » et « entreprise » sont deux mots différents pour
 * une comparaison exacte, et le pluriel suffit à faire rater un doublon.
 */
function stem(w) {
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("en")) w = w.slice(0, -2);   // pluriels NL
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);    // accords féminins
  return w;
}

const simTokens = (title) => new Set([...tokens(title)].map(stem));

/**
 * Deux titres décrivent-ils la même histoire ?
 *
 * Compter les mots à égalité ne marche pas : « Solvay publie ses résultats »
 * et « UCB publie ses résultats » partagent trois mots sur quatre, et sont
 * deux articles différents. Le seul mot qui compte est celui qui est rare.
 *
 * On pondère donc chaque mot par son IDF — l'inverse de sa fréquence dans la
 * moisson du jour. « publie » apparaît partout : poids ~0. « Solvay » deux
 * fois : poids fort. La similarité devient un recouvrement d'INFORMATION,
 * pas de vocabulaire.
 *
 * On rapporte au titre le plus court (et non à l'union) : une reformulation
 * brève partage presque tout SON contenu avec la version longue, mais une
 * petite fraction de l'union. C'est exactement le cas des deux titres du Soir
 * sur Nvidia.
 */
/**
 * Les noms propres du titre — Solvay, UCB, Nvidia, KBC. Ils se repèrent à la
 * majuscule, sans dictionnaire ni modèle. Les mots vides capitalisés en début
 * de phrase (« Le », « De ») sont écartés : ils ne désignent personne.
 */
function entities(title) {
  return new Set(
    (title.match(/[A-ZÀ-Ý][\wÀ-ÿ'’-]{1,}|[A-Z]{2,}/g) || [])
      .map((w) => w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
      .filter((w) => w.length >= 2 && !STOP.has(w))
  );
}

/**
 * Garde-fou : si les deux titres nomment des acteurs DIFFÉRENTS et qu'aucun
 * n'est commun, ce sont deux histoires. « Solvay publie ses résultats » et
 * « UCB publie ses résultats » partagent tout sauf l'essentiel.
 * Si un seul des deux nomme quelqu'un, on ne conclut rien : c'est le cas d'une
 * reformulation courte qui a laissé tomber le nom.
 */
function differentActors(tA, tB) {
  const eA = entities(tA), eB = entities(tB);
  if (!eA.size || !eB.size) return false;
  for (const w of eA) if (eB.has(w)) return false;
  return true;
}

function buildIdf(articles) {
  const df = new Map();
  for (const a of articles) for (const w of a._t) df.set(w, (df.get(w) || 0) + 1);
  const N = articles.length || 1;
  return (w) => Math.log((N + 1) / ((df.get(w) || 0) + 1)) + 1;
}

function sameStory(A, B, idf, titleA, titleB) {
  if (differentActors(titleA, titleB)) return false;
  let interW = 0, aW = 0, bW = 0;
  for (const w of A) { const x = idf(w); aW += x; if (B.has(w)) interW += x; }
  for (const w of B) bW += idf(w);
  if (!aW || !bW) return false;
  return interW / Math.min(aW, bW) >= COVER;
}

function pickDate(item) {
  const raw = item.isoDate || item.pubDate || item.date;
  const d = raw ? new Date(raw) : null;
  return d && !isNaN(d) ? d : null;
}

/* ---------- ingestion ---------- */

async function fetchFeed(feed, country) {
  const parsed = await parser.parseURL(feed.url);
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600_000;
  const raw = parsed.items || [];

  let newestAgeH = null;
  for (const item of raw) {
    const d = pickDate(item);
    if (!d) continue;
    const ageH = (Date.now() - d.getTime()) / 3600_000;
    if (newestAgeH === null || ageH < newestAgeH) newestAgeH = ageH;
  }

  let avSkipped = 0;
  let offTopic = 0;

  const items = raw
    .map((item) => {
      const url = item.link && canonicalUrl(item.link);
      const title = cleanTitle((item.title || "").trim(), feed.url);
      const published = pickDate(item);
      if (!url || !title) return null;
      if (published && published.getTime() < cutoff) return null;

      // Presse écrite seulement. Un article illustré d'une vidéo reste un
      // article ; un sujet Auvio ou un podcast n'en est pas un.
      if (isAudioVisual(title, url)) { avSkipped++; return null; }

      // Thème. Deux régimes, et la distinction est importante :
      //
      //   feed.themed = true  → flux de rubrique (lalibre.be/rss/economie).
      //     C'est une rédaction qui a rangé l'article, pas moi qui devine.
      //     On ne garde que le filet négatif, au cas où un sujet people
      //     traînerait dans la rubrique éco.
      //
      //   sinon → flux généraliste. Le lexique doit trancher, et sévèrement.
      //
      // Appliquer le lexique à un flux déjà trié jetterait 90 % de bons
      // articles : « Solvay ferme son site de Jemeppe » est de l'éco pour la
      // rédaction, et du bruit pour ma liste de mots.
      const theme = themeScore(title);
      const garde = feed.themed ? !theme.disqualifie : theme.ok;
      if (!garde) { offTopic++; return null; }

      return {
        id: hash(url),
        country,
        source: feed.source,
        group: feed.group || null,
        lang: feed.lang,
        title,
        url,
        publishedAt: published ? published.toISOString() : null,
        score: theme.score,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_PER_SOURCE);

  return { items, raw: raw.length, newestAgeH, avSkipped, offTopic };
}

/* ---------- déduplication ---------- */

/**
 * Deux journaux couvrent la même histoire : on n'en garde qu'un, et on note
 * les autres dans `alsoIn`. Uniquement à l'intérieur d'une même langue —
 * le même fait en FR et en NL n'a aucun mot en commun, et de toute façon
 * ce sont deux articles que le lecteur veut voir séparément.
 */
function dedupeByContent(list) {
  const byLang = {};
  for (const a of list) (byLang[a.lang] ||= []).push(a);

  const out = {};
  let merged = 0;

  for (const [lang, articles] of Object.entries(byLang)) {
    articles.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));

    // L'IDF se calcule sur la récolte du jour, pas sur un corpus figé :
    // « BNB » est rare en général, banal un matin où tout le monde en parle.
    for (const a of articles) a._t = simTokens(a.title);
    const idf = buildIdf(articles);

    const kept = [];
    for (const a of articles) {
      const t = a._t;
      const twin = kept.find((k) => sameStory(t, k._t, idf, a.title, k.title));
      if (twin) {
        // Un journal, une entrée. La DH et La Libre republient la même
        // dépêche à 18:34 puis à 18:46 après la clôture : ce sont des mises à
        // jour, pas des points de vue. La liste étant triée du plus récent au
        // plus ancien, le premier vu par source est le bon — les suivants
        // disparaissent, y compris ceux du journal affiché.
        const dejaLa = twin.source === a.source || twin.alsoIn.some((x) => x.source === a.source);
        if (!dejaLa) {
          twin.alsoIn.push({ source: a.source, url: a.url, title: a.title, publishedAt: a.publishedAt });
        }
        merged++;
        continue;
      }
      kept.push(Object.assign(a, { alsoIn: [] }));
    }

    // Le classement du choix — pas de l'affichage. Trois signaux, dans l'ordre :
    // combien de rédactions ont couvert l'histoire, la densité économique du
    // titre, puis la fraîcheur. C'est ta pondération, et elle était déjà là.
    kept.sort((a, b) =>
      b.alsoIn.length - a.alsoIn.length ||
      (b.score || 0) - (a.score || 0) ||
      (b.publishedAt || "").localeCompare(a.publishedAt || "")
    );
    kept.forEach((a) => delete a._t);
    out[lang] = kept;
  }

  return { byLang: out, merged };
}

/**
 * 15 places, deux langues. Servir chacune à son tour plutôt que de trancher
 * dans un classement global : sinon une journée chargée côté flamand écrase
 * complètement le français, et tes deux boutons deviennent un mensonge.
 */
function balanceLanguages(byLang, max) {
  const queues = Object.values(byLang).map((l) => [...l]);
  const out = [];
  while (out.length < max && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (!q.length) continue;
      out.push(q.shift());
      if (out.length >= max) break;
    }
  }
  return out;
}

/* ---------- run ---------- */

async function run() {
  const sources = JSON.parse(await readFile(new URL("./sources.json", import.meta.url)));

  const jobs = [];
  const excluded = [];
  for (const [country, cfg] of Object.entries(sources)) {
    for (const feed of cfg.feeds) {
      if (EXCLUDE_ACCESS.includes(feed.access)) { excluded.push({ country, feed, why: feed.access }); continue; }
      if (!ALLOWED_LANGS.includes(feed.lang)) { excluded.push({ country, feed, why: `langue ${feed.lang}` }); continue; }
      jobs.push({ country, feed });
    }
  }

  const settled = await Promise.allSettled(
    jobs.map(({ country, feed }) => fetchFeed(feed, country).then((r) => ({ country, feed, ...r })))
  );

  const byCountry = {};
  const report = [];

  settled.forEach((res, i) => {
    const { country, feed } = jobs[i];
    if (res.status === "rejected") {
      report.push({ country, source: feed.source, status: "fail",
        reason: String(res.reason?.message || res.reason) });
      return;
    }
    const { items, raw, newestAgeH, avSkipped, offTopic } = res.value;
    report.push({ country, source: feed.source, status: items.length ? "ok" : "stale",
      count: items.length, raw, newestAgeH, avSkipped, offTopic });
    (byCountry[country] ||= []).push(...items);
  });

  const mergedByCountry = {};
  for (const country of Object.keys(byCountry)) {
    // 1. doublons stricts (même URL) — deux flux relaient le même lien
    const seen = new Set();
    const unique = byCountry[country].filter((a) => !seen.has(a.id) && seen.add(a.id));

    // 2. doublons de contenu, langue par langue
    const { byLang, merged } = dedupeByContent(unique);
    mergedByCountry[country] = merged;

    // 3. on choisit les 15 par importance, on les affiche par fraîcheur
    byCountry[country] = balanceLanguages(byLang, MAX_PER_COUNTRY)
      .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    countries: Object.fromEntries(
      Object.entries(sources).map(([iso, cfg]) => [
        iso,
        {
          name: cfg.name,
          sources: cfg.feeds
            .filter((f) => !EXCLUDE_ACCESS.includes(f.access) && ALLOWED_LANGS.includes(f.lang))
            .map((f) => f.source),
          articles: byCountry[iso] || [],
        },
      ])
    ),
  };

  await mkdir(new URL("./public/", import.meta.url), { recursive: true });
  await writeFile(new URL("./public/articles.json", import.meta.url), JSON.stringify(payload, null, 2));

  /* ---------- rapport ---------- */
  const ok    = report.filter((r) => r.status === "ok");
  const stale = report.filter((r) => r.status === "stale");
  const fail  = report.filter((r) => r.status === "fail");
  const kept  = Object.values(payload.countries).reduce((n, c) => n + c.articles.length, 0);
  const jours = (h) => (h === null ? "aucune date" : `dernier article il y a ${Math.floor(h / 24)} j`);

  console.log(`\n${kept} articles retenus · ${ok.length}/${report.length} flux vivants\n`);
  for (const r of ok)    console.log(`  ✓ ${r.country}  ${r.source.padEnd(22)} ${r.count} sur ${r.raw}` +
                                     (r.offTopic ? `  · ${r.offTopic} hors-sujet` : "") +
                                     (r.avSkipped ? ` · ${r.avSkipped} A/V` : ""));
  for (const r of stale) console.log(`  ⚠ ${r.country}  ${r.source.padEnd(22)} ZOMBIE · ${r.raw} items, ${jours(r.newestAgeH)}`);
  for (const r of fail)  console.log(`  ✗ ${r.country}  ${r.source.padEnd(22)} ${r.reason}`);

  console.log();
  for (const [iso, c] of Object.entries(payload.countries)) {
    if (!c.articles.length) continue;
    const parLangue = {};
    for (const a of c.articles) parLangue[a.lang] = (parLangue[a.lang] || 0) + 1;
    const detail = Object.entries(parLangue).map(([l, n]) => `${l.toUpperCase()} ${n}`).join(" · ");
    console.log(`  ${iso}  ${String(c.articles.length).padStart(3)} titres  (${detail})` +
                (mergedByCountry[iso] ? `  — ${mergedByCountry[iso]} doublons fusionnés` : ""));
  }

  if (excluded.length) {
    console.log();
    for (const { country, feed, why } of excluded)
      console.log(`  ⊘ ${country}  ${feed.source.padEnd(22)} exclu — ${why}`);
    console.log(`\n  ⊘ ${excluded.length} flux écartés (abonnement ou langue).`);
    console.log(`    Réglages en haut du fichier : EXCLUDE_ACCESS et ALLOWED_LANGS.`);
  }

  const av = report.reduce((n, r) => n + (r.avSkipped || 0), 0);
  const ot = report.reduce((n, r) => n + (r.offTopic || 0), 0);
  if (av) console.log(`\n  ✂ ${av} sujets vidéo / audio / forum écartés — presse écrite uniquement.`);
  if (ot) console.log(`  ✂ ${ot} articles hors thème économique écartés.`);

  if (stale.length) {
    console.log(`\n  ⚠ ${stale.length} flux répond(ent) mais ne publie(nt) plus.`);
    console.log(`    Une URL périmée est plus dangereuse qu'une URL cassée : elle ne fait pas de bruit.`);
  }
  console.log();

  process.exit(ok.length === 0 ? 1 : 0);
}

run();
