-- ═══ Le modèle « item » unifié ════════════════════════════════════════
-- Un seul enregistrement pour tout ce qui est collecté, quelle que soit la
-- source. Deux tables, et UNE règle qui les sépare :
--
--   la collecte n'écrit QUE dans agenda_items ;
--   l'étudiant n'écrit QUE dans agenda_item_etat.
--
-- Aucune des deux n'écrase l'autre. C'est ce qui fait disparaître du client
-- les sept mécanismes qui se battaient pour la même question — gone, mods,
-- acted, prunGone, memeTitre, dupEcheance, actionSupprimee : « la collecte
-- a-t-elle le droit d'effacer ce que l'étudiant a fait ? » Non. Jamais.

-- ── Les FAITS ────────────────────────────────────────────────────────
-- Réécrits à chaque collecte, à l'identique si rien n'a bougé. L'id est
-- STABLE : « source:clé naturelle » (l'id d'évènement Léa, l'assignid
-- Moodle, l'id du MIO). Deux collectes du même devoir produisent le même
-- id, donc un upsert, jamais un doublon — et plus besoin de rapprocher
-- deux titres à la ressemblance.
create table if not exists public.agenda_items (
  user_id           uuid        not null references auth.users(id) on delete cascade,
  id                text        not null,
  source            text        not null check (source in ('lea','mio','moodle','manuel','classe')),
  genre             text        not null check (genre in ('message','document','devoir','examen','tache','seance','autre')),
  cours             text,
  code_cours        text,
  -- Étape 4 : la clé du monde partagé. Nulle tant que le cours n'est pas apparié.
  moodle_course_id  bigint,
  titre             text        not null,
  resume            text,
  consigne          text,
  -- Le lien profond vers la source : le devoir Moodle, le message Léa.
  url               text,
  publie_le         timestamptz,
  echeance_le       timestamptz,
  -- Une échéance sans heure connue : « à remettre le 12 » et rien de plus.
  -- Le rappel part alors le matin, pas « dans 1 h » d'un instant inventé.
  jour_seul         boolean     not null default false,
  -- Ce que la source disait, brut : de quoi rejouer un adaptateur corrigé
  -- sans retourner scraper Omnivox.
  charge            jsonb,
  collecte_le       timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── Le CALQUE PERSONNEL ──────────────────────────────────────────────
-- Volontairement SANS clé étrangère vers agenda_items : la pierre tombale
-- doit survivre à la disparition de l'item. Omnivox continue d'afficher ce
-- que l'étudiant a retiré ; à la collecte suivante l'item revient — et
-- retrouve ici son statut « supprime », qui l'exclut de la vue.
create table if not exists public.agenda_item_etat (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  item_id      text        not null,
  statut       text        not null default 'nouveau'
                           check (statut in ('nouveau','vu','fait','supprime')),
  -- Un report décidé par l'étudiant (ou proposé par l'agent MIO) bat la date
  -- de la source. Nul = on suit la source, y compris quand le prof la déplace.
  echeance_le  timestamptz,
  note         text,
  updated_at   timestamptz not null default now(),
  primary key (user_id, item_id)
);

create index if not exists agenda_items_echeance_idx
  on public.agenda_items (user_id, echeance_le) where echeance_le is not null;
create index if not exists agenda_items_source_idx
  on public.agenda_items (user_id, source);
create index if not exists agenda_items_moodle_idx
  on public.agenda_items (user_id, moodle_course_id) where moodle_course_id is not null;

drop trigger if exists agenda_item_etat_touch on public.agenda_item_etat;
create trigger agenda_item_etat_touch before update on public.agenda_item_etat
  for each row execute function public.agenda_touch_updated_at();

-- ── Privilèges ───────────────────────────────────────────────────────
-- Le piège maison : toute table neuve reçoit d'office ALL pour
-- `authenticated`. On révoque AVANT d'accorder, sinon la restriction ne
-- restreint rien.
alter table public.agenda_items      enable row level security;
alter table public.agenda_item_etat  enable row level security;
revoke all on public.agenda_items     from anon, authenticated;
revoke all on public.agenda_item_etat from anon, authenticated;
grant select, insert, update, delete on public.agenda_items     to authenticated;
grant select, insert, update, delete on public.agenda_item_etat to authenticated;

drop policy if exists "agenda_items : les siens" on public.agenda_items;
create policy "agenda_items : les siens" on public.agenda_items
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "agenda_item_etat : le sien" on public.agenda_item_etat;
create policy "agenda_item_etat : le sien" on public.agenda_item_etat
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── LA COLLECTION ────────────────────────────────────────────────────
-- Faits ⋈ calque. C'est là-dessus que lit toute l'interface : une tuile KPI
-- est le cardinal d'une requête ici, une vue en est le corps, une fiche en
-- est une ligne. security_invoker : la RLS des tables de base s'applique,
-- la vue n'est pas une porte dérobée.
create or replace view public.agenda_vue_items
with (security_invoker = true) as
  select i.user_id, i.id, i.source, i.genre, i.cours, i.code_cours,
         i.moodle_course_id, i.titre, i.resume, i.consigne, i.url,
         i.publie_le,
         coalesce(e.echeance_le, i.echeance_le) as echeance_le,
         i.echeance_le                          as echeance_source,
         i.jour_seul, i.collecte_le,
         coalesce(e.statut, 'nouveau')          as statut,
         e.note, e.updated_at
    from public.agenda_items i
    left join public.agenda_item_etat e
      on e.user_id = i.user_id and e.item_id = i.id
   where coalesce(e.statut, 'nouveau') <> 'supprime';

revoke all on public.agenda_vue_items from anon, authenticated;
grant select on public.agenda_vue_items to authenticated;
