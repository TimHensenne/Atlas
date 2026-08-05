-- =====================================================================
-- ATLAS — Schéma Supabase : comptes + classement JOURNALIER (1 tentative/jour)
-- ---------------------------------------------------------------------
-- À coller dans Supabase → SQL Editor → Run.
-- Prérequis : Authentication → Providers → activer "Email" (email + mot de passe).
-- Les mots de passe sont hachés par Supabase (jamais en clair) : ne créez
-- JAMAIS de colonne "password". La session ("se souvenir de moi") est gérée
-- automatiquement par le client Supabase (persistSession + autoRefreshToken).
-- =====================================================================

-- 1) PROFIL public minimal, lié au compte d'authentification.
--    Le pseudo sert au classement. Les autres champs sont FACULTATIFS
--    (RGPD : jamais obligatoires ; n'ajoutez que ceux que vous exploitez).
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  pseudo      text not null unique check (char_length(pseudo) between 2 and 24),
  -- ---- Facultatifs (consentement + finalité affichée) --------------
  first_name  text,
  birth_year  int  check (birth_year is null or birth_year between 1900 and extract(year from now())::int),
  sex         text check (sex is null or sex in ('F','M','X')),
  country     text,          -- pays/région seulement, PAS d'adresse postale
  consent_optional boolean not null default false,  -- consentement aux champs facultatifs
  created_at  timestamptz not null default now()
);

-- 2) SCORE JOURNALIER : une seule ligne par joueur et par jour.
--    La clé primaire (user_id, day) empêche techniquement une 2e tentative.
create table if not exists public.daily_scores (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  day           date not null default (now() at time zone 'utc')::date,
  total         int  not null check (total >= 0),
  country_tries int,
  flag_tries    int,
  created_at    timestamptz not null default now(),
  primary key (user_id, day)     -- ← "une seule tentative par jour"
);

-- 3) SÉCURITÉ (Row Level Security) : chacun ne touche que SES données.
alter table public.profiles     enable row level security;
alter table public.daily_scores enable row level security;

-- profiles : je ne lis / n'écris QUE mon profil.
create policy "profil_select_soi" on public.profiles
  for select using (auth.uid() = id);
create policy "profil_insert_soi" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profil_update_soi" on public.profiles
  for update using (auth.uid() = id);

-- daily_scores : j'insère UNIQUEMENT mon score, daté d'AUJOURD'HUI.
-- Pas de politique UPDATE ni DELETE → le score du jour est définitif
-- (une tentative ferme, on ne rejoue pas pour améliorer).
create policy "score_insert_soi_aujourdhui" on public.daily_scores
  for insert with check (
    auth.uid() = user_id
    and day = (now() at time zone 'utc')::date
  );
create policy "score_select_soi" on public.daily_scores
  for select using (auth.uid() = user_id);

-- 4) CLASSEMENT DU JOUR exposé publiquement, SANS aucune donnée perso :
--    seulement pseudo + total. La vue (security_invoker = off) lit malgré la
--    RLS mais ne révèle que ces deux colonnes.
create or replace view public.leaderboard_today
with (security_invoker = off) as
  select p.pseudo, d.total, d.day
  from public.daily_scores d
  join public.profiles p on p.id = d.user_id
  where d.day = (now() at time zone 'utc')::date
  order by d.total asc, d.created_at asc;

grant select on public.leaderboard_today to anon, authenticated;

-- (Optionnel) Classement d'un jour précis, même forme, paramétrable côté client
-- via une fonction : décommentez si besoin.
-- create or replace function public.leaderboard_on(d date)
--   returns table(pseudo text, total int)
--   language sql stable security definer as $$
--     select p.pseudo, s.total from public.daily_scores s
--     join public.profiles p on p.id = s.user_id
--     where s.day = d order by s.total asc, s.created_at asc;
--   $$;
-- grant execute on function public.leaderboard_on(date) to anon, authenticated;

-- =====================================================================
-- NOTES
-- • Droits RGPD : la suppression du compte (auth.users) cascade et efface
--   profil + scores. Prévoyez un bouton "supprimer mon compte" côté app.
-- • Rétention : purgez éventuellement les vieux daily_scores (cron Supabase).
-- • Anti-triche : le score vient du client ; la RLS empêche d'écrire pour
--   autrui ou 2×/jour, mais pas de mentir sur son propre total. Acceptable
--   pour un jeu ludique ; sinon il faudrait valider la partie côté serveur.
-- =====================================================================

-- =====================================================================
-- CONNEXION : par EMAIL uniquement.
-- L'ancienne fonction public.email_for_pseudo(text) renvoyait l'email
-- associé à un pseudo — or les pseudos sont publics (classement), donc
-- n'importe qui pouvait énumérer les emails. Elle a été SUPPRIMÉE.
-- Si elle existe encore dans ta base, exécute ceci pour l'enlever :
revoke execute on function public.email_for_pseudo(text) from anon, authenticated;
drop function if exists public.email_for_pseudo(text);
-- =====================================================================
