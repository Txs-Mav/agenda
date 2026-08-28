-- ═══ Moodle côté serveur ══════════════════════════════════════════════
-- Le jeton Moodle est durable et en lecture seule, mais il reste une clé :
-- il ne redescend JAMAIS vers le navigateur. L'étudiant peut le déposer et
-- le retirer, jamais le relire. Seule la fonction edge, avec le rôle de
-- service, en a besoin.
create table if not exists public.agenda_moodle_jetons (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  site       text        not null,
  jeton      text        not null,
  moodle_uid bigint,
  valide_le  timestamptz,
  erreur     text,
  updated_at timestamptz not null default now()
);
alter table public.agenda_moodle_jetons enable row level security;
-- Révoquer AVANT d'accorder : toute table neuve reçoit d'office ALL pour
-- `authenticated`, et un grant par colonne ne restreint rien sans ça.
revoke all on public.agenda_moodle_jetons from anon, authenticated;
grant select (user_id, site, moodle_uid, valide_le, erreur, updated_at)
  on public.agenda_moodle_jetons to authenticated;
grant insert, update, delete on public.agenda_moodle_jetons to authenticated;
drop policy if exists "agenda_moodle_jetons : le sien" on public.agenda_moodle_jetons;
create policy "agenda_moodle_jetons : le sien" on public.agenda_moodle_jetons
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop trigger if exists agenda_moodle_jetons_touch on public.agenda_moodle_jetons;
create trigger agenda_moodle_jetons_touch before update on public.agenda_moodle_jetons
  for each row execute function public.agenda_touch_updated_at();

-- Les inscriptions, relevées à chaque passage : elles nomment les cours, et
-- — étape suivante — elles PROUVENT le droit d'entrer dans une classe.
create table if not exists public.agenda_moodle_inscriptions (
  user_id          uuid   not null references auth.users(id) on delete cascade,
  moodle_course_id bigint not null,
  nom              text,
  court            text,
  updated_at       timestamptz not null default now(),
  primary key (user_id, moodle_course_id)
);
alter table public.agenda_moodle_inscriptions enable row level security;
revoke all on public.agenda_moodle_inscriptions from anon, authenticated;
grant select on public.agenda_moodle_inscriptions to authenticated;
drop policy if exists "agenda_moodle_inscriptions : les siennes" on public.agenda_moodle_inscriptions;
create policy "agenda_moodle_inscriptions : les siennes" on public.agenda_moodle_inscriptions
  for select to authenticated using (user_id = (select auth.uid()));
