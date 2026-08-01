// ─────────────────────────────────────────────────────────────────────
// Atlas — configuration Supabase (comptes + classement du jour).
// Valeurs : Supabase → Settings → API Keys (Project URL + Publishable key).
// La "publishable key" (sb_publishable_…) remplace l'ancienne clé anon :
// elle est PUBLIQUE et prévue pour le navigateur — c'est la sécurité RLS
// qui protège les données, pas le secret de la clé.
// Ne mets JAMAIS ici la "secret key" (sb_secret_…).
// Place ce fichier dans public/ (à côté d'index.html).
// ─────────────────────────────────────────────────────────────────────
window.ATLAS_SUPABASE = {
  url:  "https://yfshnwrhwmmmmnvdxgke.supabase.co",
  anon: "sb_publishable_I_WLAStvMqJsYD8aceoSfQ_ojtACfaU"
};
