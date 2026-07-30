/**
 * Que donne VRAIMENT le FMI DataMapper, indicateur par indicateur, pays par pays ?
 * On teste les codes candidats sur un échantillon varié (grands, moyens, petits).
 */
const CANDIDATS = {
  "NGDPD":        "PIB (Md$ courants)",
  "NGDP_RPCH":    "Croissance PIB (%)",
  "PCPIPCH":      "Inflation (%)",
  "LUR":          "Chômage (%)",
  "GGXWDG_NGDP":  "Dette publique (% PIB)",
  "GGXCNL_NGDP":  "Solde budgétaire (% PIB)",
  "BCA_NGDPD":    "Balance courante (% PIB)",
  "NGDPDPC":      "PIB/habitant ($)",
};
const PAYS = ["BEL","FRA","USA","JPN","NGA","VNM","BOL","MNG","TCD","FJI"];

async function get(code, iso){
  const url = `https://www.imf.org/external/datamapper/api/v1/${code}/${iso}`;
  const ctrl = new AbortController(); const t=setTimeout(()=>ctrl.abort(),8000);
  try{
    const r = await fetch(url,{signal:ctrl.signal,headers:{'User-Agent':'AtlasBot/0.1'}});
    clearTimeout(t);
    if(!r.ok) return null;
    const j = await r.json();
    const s = j?.values?.[code]?.[iso];
    if(!s) return null;
    const yrs = Object.keys(s).map(Number).filter(y=>y<=new Date().getFullYear()).sort((a,b)=>b-a);
    for(const y of yrs) if(s[y]!=null) return {value:s[y], year:y};
    return null;
  }catch(e){ clearTimeout(t); return null; }
}

for(const [code,label] of Object.entries(CANDIDATS)){
  const res = [];
  for(const iso of PAYS){ res.push(await get(code,iso)); await new Promise(r=>setTimeout(r,80)); }
  const ok = res.filter(Boolean).length;
  const years = [...new Set(res.filter(Boolean).map(x=>x.year))].sort();
  console.log(`${label.padEnd(26)} ${ok}/${PAYS.length} pays · années ${years.join(",")}`);
}
console.log("\nÉchantillon :", PAYS.join(", "));
