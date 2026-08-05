/**
 * 1. Pourquoi DE et ZA sont-ils écartés ? On regarde chaque indicateur clé.
 * 2. Le FMI distingue-t-il données OBSERVÉES et ESTIMATIONS ? On cherche le champ.
 */
const KEYS = ["NGDPD","NGDPDPC","NGDP_RPCH","PCPIPCH","GGXWDG_NGDP"];
const LABELS = {NGDPD:"PIB",NGDPDPC:"PIB/hab",NGDP_RPCH:"Croissance",PCPIPCH:"Inflation",GGXWDG_NGDP:"Dette"};
const SUSPECTS = ["DEU","ZAF","BEL","USA"];

async function get(code, iso){
  const url = `https://www.imf.org/external/datamapper/api/v1/${code}/${iso}`;
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),8000);
  try{
    const r=await fetch(url,{signal:c.signal,headers:{'User-Agent':'AtlasBot/0.1'}});
    clearTimeout(t); if(!r.ok) return {err:r.status};
    const j=await r.json(); return j?.values?.[code]?.[iso] || {empty:true};
  }catch(e){ clearTimeout(t); return {err:e.name}; }
}

const YEAR = new Date().getFullYear();
for(const iso of SUSPECTS){
  console.log(`\n══ ${iso} ══`);
  for(const code of KEYS){
    const s = await get(code, iso);
    if(s.err){ console.log(`  ${LABELS[code].padEnd(10)} ERREUR ${s.err}`); continue; }
    if(s.empty){ console.log(`  ${LABELS[code].padEnd(10)} VIDE`); continue; }
    const years = Object.keys(s).map(Number).sort((a,b)=>a-b);
    const last = Math.max(...years.filter(y=>s[y]!=null));
    const lastObs = Math.max(...years.filter(y=>y<=YEAR && s[y]!=null));
    console.log(`  ${LABELS[code].padEnd(10)} plage ${years[0]}–${last} · ≤${YEAR}: ${lastObs} (${s[lastObs]})`);
    await new Promise(r=>setTimeout(r,60));
  }
}
// Le champ estimatesStartAfter dit à partir de quand c'est de la projection.
console.log("\n══ test frontière observé/estimé ══");
const url = "https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH/DEU";
const r = await fetch(url,{headers:{'User-Agent':'AtlasBot/0.1'}});
const j = await r.json();
console.log("clés de la réponse :", Object.keys(j));
console.log("estimatesStartAfter :", JSON.stringify(j.estimatesStartAfter || "absent"));
