-- ═══ Une classe ↔ un cours Moodle ════════════════════════════════════
-- Le nom affiché d'un cours change d'une session à l'autre ; l'identifiant
-- Moodle, lui, ne bouge pas. C'est LUI la clé du monde partagé — et
-- l'inscription Moodle devient une preuve d'appartenance, ce qui remplace le
-- code à six lettres qu'il fallait faire circuler.
alter table public.agenda_classes  add column if not exists moodle_course_id bigint;
alter table public.agenda_matieres add column if not exists moodle_course_id bigint;
create unique index if not exists agenda_classes_moodle_uniq
  on public.agenda_classes (moodle_course_id) where moodle_course_id is not null;

drop policy if exists "agenda_classes : apparier (proprio)" on public.agenda_classes;
create policy "agenda_classes : apparier (proprio)" on public.agenda_classes
  for update to authenticated
  using (private.agenda_is_proprio(id)) with check (private.agenda_is_proprio(id));

create or replace function public.agenda_join_class_moodle(p_moodle_course_id bigint)
returns json language plpgsql security definer set search_path to '' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid; v_nom text; v_pseudo text;
begin
  if v_uid is null then raise exception 'non connecté'; end if;
  if p_moodle_course_id is null then raise exception 'aucun cours visé'; end if;
  -- La preuve : le relevé d'inscriptions, écrit par la collecte serveur.
  if not exists (select 1 from public.agenda_moodle_inscriptions
                  where user_id = v_uid and moodle_course_id = p_moodle_course_id) then
    raise exception 'tu n''es pas inscrit à ce cours dans Moodle';
  end if;
  select id, nom into v_id, v_nom from public.agenda_classes
   where moodle_course_id = p_moodle_course_id;
  if v_id is null then raise exception 'aucune classe n''est reliée à ce cours'; end if;
  select coalesce(nullif(split_part(email,'@',1),''),'moi') into v_pseudo
    from auth.users where id = v_uid;
  insert into public.agenda_class_members (class_id, user_id, role, pseudo)
    values (v_id, v_uid, 'membre', v_pseudo)
    on conflict (class_id, user_id) do nothing;
  return json_build_object('id', v_id, 'nom', v_nom);
end $function$;
revoke all on function public.agenda_join_class_moodle(bigint) from public, anon;
grant execute on function public.agenda_join_class_moodle(bigint) to authenticated;

-- Ce qu'on peut rejoindre sans rien demander à personne.
create or replace view public.agenda_vue_classes_proposees
with (security_invoker = true) as
  select i.user_id, i.moodle_course_id, i.nom as cours, i.court,
         c.id as class_id, c.nom as classe
    from public.agenda_moodle_inscriptions i
    join public.agenda_classes c on c.moodle_course_id = i.moodle_course_id
   where not exists (select 1 from public.agenda_class_members m
                      where m.class_id = c.id and m.user_id = i.user_id);
revoke all on public.agenda_vue_classes_proposees from anon, authenticated;
grant select on public.agenda_vue_classes_proposees to authenticated;
