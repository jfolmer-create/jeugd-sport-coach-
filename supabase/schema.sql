-- Teamplanner Jeugdvoetbal: database voor Supabase.
-- Plak dit in Supabase → SQL Editor → New query en klik op Run. Je kunt het veilig vaker uitvoeren.

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default '',
  data        jsonb not null default '{}'::jsonb,
  share_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists teams_owner_idx on public.teams(owner);

-- Versienummer: de app vraagt dit op en meldt het als dit script opnieuw moet draaien.
alter table public.teams add column if not exists rev bigint not null default 0;

-- Mede-coaches: een team heeft één eigenaar en kan extra coaches hebben (via een uitnodigingslink).
create table if not exists public.team_members (
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  email      text not null default '',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- Mag de ingelogde coach dit team zien en wijzigen? (eigenaar of mede-coach)
create or replace function public.can_edit_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.teams t where t.id = p_team and t.owner = auth.uid())
      or exists (select 1 from public.team_members m where m.team_id = p_team and m.user_id = auth.uid());
$$;
revoke all on function public.can_edit_team(uuid) from public;
grant execute on function public.can_edit_team(uuid) to authenticated;

-- Iedere coach ziet en wijzigt alleen de teams waarvan hij eigenaar of mede-coach is. Alleen de eigenaar mag een team verwijderen.
alter table public.teams enable row level security;
drop policy if exists "coach leest eigen teams" on public.teams;
drop policy if exists "coach maakt teams" on public.teams;
drop policy if exists "coach wijzigt eigen teams" on public.teams;
drop policy if exists "coach verwijdert eigen teams" on public.teams;
create policy "coach leest eigen teams"      on public.teams for select to authenticated using (public.can_edit_team(id));
create policy "coach maakt teams"            on public.teams for insert to authenticated with check (owner = auth.uid());
create policy "coach wijzigt eigen teams"    on public.teams for update to authenticated using (public.can_edit_team(id)) with check (public.can_edit_team(id));
create policy "coach verwijdert eigen teams" on public.teams for delete to authenticated using (owner = auth.uid());

-- Bij elke wijziging: versienummer omhoog, tijd bijwerken, eigenaar blijft gelijk,
-- en ten hoogste eens per uur automatisch een kopie van de vorige versie bewaren.
create table if not exists public.team_versions (
  id         bigint generated always as identity primary key,
  team_id    uuid not null references public.teams(id) on delete cascade,
  data       jsonb not null,
  reason     text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists team_versions_team_idx on public.team_versions(team_id, created_at desc);
alter table public.team_versions enable row level security;
drop policy if exists "coach leest versies" on public.team_versions;
drop policy if exists "coach bewaart versie" on public.team_versions;
create policy "coach leest versies"  on public.team_versions for select to authenticated using (public.can_edit_team(team_id));
create policy "coach bewaart versie" on public.team_versions for insert to authenticated with check (public.can_edit_team(team_id));

create or replace function public.teams_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner <> old.owner then raise exception 'De eigenaar van een team kan niet worden gewijzigd'; end if;
  if new.data is distinct from old.data then
    new.rev := old.rev + 1;
    new.updated_at := now();
    if not exists (select 1 from public.team_versions v where v.team_id = old.id and v.created_at > now() - interval '1 hour') then
      insert into public.team_versions (team_id, data, reason) values (old.id, old.data, 'automatisch');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists teams_before_update on public.teams;
create trigger teams_before_update before update on public.teams for each row execute function public.teams_before_update();

-- Per team de 40 nieuwste versies bewaren.
create or replace function public.team_versions_trim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.team_versions where team_id = new.team_id and id not in
    (select id from public.team_versions where team_id = new.team_id order by created_at desc, id desc limit 40);
  return null;
end;
$$;
drop trigger if exists team_versions_trim on public.team_versions;
create trigger team_versions_trim after insert on public.team_versions for each row execute function public.team_versions_trim();

-- Mede-coaches zien elkaar; de eigenaar kan iemand weghalen en iedereen kan zelf vertrekken.
alter table public.team_members enable row level security;
drop policy if exists "coach ziet mede-coaches" on public.team_members;
drop policy if exists "eigenaar of coach zelf haalt weg" on public.team_members;
create policy "coach ziet mede-coaches" on public.team_members for select to authenticated using (public.can_edit_team(team_id));
create policy "eigenaar of coach zelf haalt weg" on public.team_members for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.teams t where t.id = team_id and public.can_edit_team(t.id)));

-- Uitnodigingen: een link die 14 dagen geldig is. Iedere coach van het team kan er een maken.
create table if not exists public.team_invites (
  token      text primary key,
  team_id    uuid not null references public.teams(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);
alter table public.team_invites enable row level security;
drop policy if exists "coach ziet uitnodigingen" on public.team_invites;
drop policy if exists "coach maakt uitnodiging" on public.team_invites;
drop policy if exists "coach trekt uitnodiging in" on public.team_invites;
create policy "coach ziet uitnodigingen"   on public.team_invites for select to authenticated using (public.can_edit_team(team_id));
create policy "coach maakt uitnodiging"    on public.team_invites for insert to authenticated with check (public.can_edit_team(team_id) and created_by = auth.uid() and length(token) >= 16);
create policy "coach trekt uitnodiging in" on public.team_invites for delete to authenticated using (public.can_edit_team(team_id));

-- Uitnodiging aannemen: wie ingelogd is en de link heeft, wordt mede-coach. Geeft het team terug.
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.team_invites;
begin
  if auth.uid() is null then return null; end if;
  select * into inv from public.team_invites where token = p_token and expires_at > now();
  if not found then return null; end if;
  if not exists (select 1 from public.teams t where t.id = inv.team_id and t.owner = auth.uid()) then
    insert into public.team_members (team_id, user_id, email)
    values (inv.team_id, auth.uid(), coalesce(auth.jwt()->>'email', ''))
    on conflict (team_id, user_id) do nothing;
  end if;
  return inv.team_id;
end;
$$;
revoke all on function public.accept_invite(text) from public;
grant execute on function public.accept_invite(text) to authenticated;

-- Wie zijn de coaches van dit team (met e-mailadres)? Alleen voor coaches van dat team.
create or replace function public.team_people(p_team uuid)
returns table (user_id uuid, email text, is_owner boolean)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, true from public.teams t join auth.users u on u.id = t.owner
   where t.id = p_team and public.can_edit_team(p_team)
  union all
  select m.user_id, coalesce(u.email::text, m.email), false from public.team_members m left join auth.users u on u.id = m.user_id
   where m.team_id = p_team and public.can_edit_team(p_team);
$$;
revoke all on function public.team_people(uuid) from public;
grant execute on function public.team_people(uuid) to authenticated;

-- Account opheffen: verwijdert de coach en daarmee al zijn eigen teams, versies en stemmen.
-- (Foto's en logo's haalt de app eerst zelf weg.)
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- Beschikbaarheidsronde: de coach zet een ronde open voor een aantal wedstrijden.
alter table public.teams add column if not exists avail_open boolean not null default false;
alter table public.teams add column if not exists avail_matches jsonb not null default '[]'::jsonb;

-- Wat ouders doorgeven: per kind en wedstrijd welke taken ze niet kunnen (drive, flag, wash) of dat het kind er niet is (absent).
create table if not exists public.availability (
  team_id    uuid not null references public.teams(id) on delete cascade,
  player_id  text not null,
  match_id   text not null,
  cannot     text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (team_id, player_id, match_id)
);
alter table public.availability enable row level security;
drop policy if exists "coach leest beschikbaarheid" on public.availability;
drop policy if exists "coach wist beschikbaarheid" on public.availability;
create policy "coach leest beschikbaarheid" on public.availability for select to authenticated
  using (public.can_edit_team(team_id));
create policy "coach wist beschikbaarheid" on public.availability for delete to authenticated
  using (public.can_edit_team(team_id));

-- Ouders geven via de kijklink door wat ze niet kunnen. Alleen zolang de ronde open staat.
create or replace function public.submit_availability(token text, p_player text, entries jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.teams;
  e jsonb;
begin
  select * into t from public.teams where share_token = token and length(token) >= 16;
  if not found or not t.avail_open then return false; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(t.data->'players', '[]'::jsonb)) p where p->>'id' = p_player) then
    return false;
  end if;
  for e in select * from jsonb_array_elements(coalesce(entries, '[]'::jsonb)) loop
    if t.avail_matches ? (e->>'match') then
      insert into public.availability (team_id, player_id, match_id, cannot, updated_at)
      values (t.id, p_player, e->>'match',
              array(select x from jsonb_array_elements_text(coalesce(e->'cannot', '[]'::jsonb)) x where x in ('drive', 'flag', 'wash', 'absent')),
              now())
      on conflict (team_id, player_id, match_id) do update set cannot = excluded.cannot, updated_at = now();
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.submit_availability(text, text, jsonb) from public;
grant execute on function public.submit_availability(text, text, jsonb) to anon, authenticated;

-- Kijklink voor ouders: alleen wie het geheime token kent, ziet het schema.
-- Alleen wat ouders nodig hebben: geen wisselschema's, speelminuten, posities, trainingsopkomst of wat gezinnen wel of niet kunnen.
drop function if exists public.get_shared_team(text);
create or replace function public.get_shared_team(token text)
returns table (name text, data jsonb, updated_at timestamptz, avail_open boolean, avail_matches jsonb, availability jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select t.name,
         jsonb_build_object(
           'settings', coalesce((select jsonb_object_agg(s.key, s.value) from jsonb_each(coalesce(t.data->'settings', '{}'::jsonb)) s
                                 where s.key in ('club', 'team', 'sport', 'arriveBefore', 'flagAway', 'washPerMatch', 'logoUrl', 'photoUrl')), '{}'::jsonb),
           'players', coalesce((select jsonb_agg(jsonb_build_object('id', p->'id', 'name', p->'name', 'parent', p->'parent'))
                                from jsonb_array_elements(coalesce(t.data->'players', '[]'::jsonb)) p), '[]'::jsonb),
           'matches', coalesce((select jsonb_agg(m - 'lineup' - 'played' - 'missedTraining' - 'useReserve' - 'live')
                                from jsonb_array_elements(coalesce(t.data->'matches', '[]'::jsonb)) m), '[]'::jsonb),
           'updatedAt', t.data->'updatedAt'),
         t.updated_at,
         t.avail_open,
         t.avail_matches,
         coalesce((select jsonb_agg(jsonb_build_object('player', a.player_id, 'match', a.match_id, 'cannot', to_jsonb(a.cannot)))
                   from public.availability a where a.team_id = t.id), '[]'::jsonb)
  from public.teams t
  where t.share_token = token and length(token) >= 16;
$$;
revoke all on function public.get_shared_team(text) from public;
grant execute on function public.get_shared_team(text) to anon, authenticated;

-- Logo en teamfoto: openbare opslag, alleen de coach van het team mag uploaden of verwijderen.
-- Bestanden staan in de map <team-id>/ in de bucket team-media.
insert into storage.buckets (id, name, public) values ('team-media', 'team-media', true) on conflict (id) do nothing;
drop policy if exists "coach uploadt teammedia" on storage.objects;
drop policy if exists "coach wijzigt teammedia" on storage.objects;
drop policy if exists "coach verwijdert teammedia" on storage.objects;
drop policy if exists "coach leest teammedia" on storage.objects;
-- Let op: "name" altijd volledig noemen, anders pakt Postgres de teamnaam (teams.name) in plaats van de bestandsnaam.
create policy "coach leest teammedia" on storage.objects for select to authenticated
  using (bucket_id = 'team-media' and exists (select 1 from public.teams t where t.id::text = (storage.foldername(storage.objects.name))[1] and public.can_edit_team(t.id)));
create policy "coach uploadt teammedia" on storage.objects for insert to authenticated
  with check (bucket_id = 'team-media' and exists (select 1 from public.teams t where t.id::text = (storage.foldername(storage.objects.name))[1] and public.can_edit_team(t.id)));
create policy "coach wijzigt teammedia" on storage.objects for update to authenticated
  using (bucket_id = 'team-media' and exists (select 1 from public.teams t where t.id::text = (storage.foldername(storage.objects.name))[1] and public.can_edit_team(t.id)));
create policy "coach verwijdert teammedia" on storage.objects for delete to authenticated
  using (bucket_id = 'team-media' and exists (select 1 from public.teams t where t.id::text = (storage.foldername(storage.objects.name))[1] and public.can_edit_team(t.id)));

-- Gedeeld adresboek van clubs. Elke coach die een adres invult of gebruikt, telt als één stem.
-- Het adres met de meeste stemmen geldt voor iedereen; één coach kan het dus niet in zijn eentje veranderen.
create table if not exists public.club_location_votes (
  key        text not null,              -- genormaliseerde clubnaam, bv. 'olympia28'
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  address    text not null,
  lat        double precision not null,
  lon        double precision not null,
  updated_at timestamptz not null default now(),
  primary key (key, user_id)
);
alter table public.club_location_votes enable row level security;
drop policy if exists "coaches lezen stemmen" on public.club_location_votes;
drop policy if exists "coach stemt" on public.club_location_votes;
drop policy if exists "coach wijzigt eigen stem" on public.club_location_votes;
drop policy if exists "coach verwijdert eigen stem" on public.club_location_votes;
create policy "coaches lezen stemmen" on public.club_location_votes for select to authenticated using (true);
create policy "coach stemt" on public.club_location_votes for insert to authenticated with check (user_id = auth.uid());
create policy "coach wijzigt eigen stem" on public.club_location_votes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "coach verwijdert eigen stem" on public.club_location_votes for delete to authenticated using (user_id = auth.uid());

-- Eerdere versie (club_locations) overzetten naar stemmen en opruimen.
do $$ begin
  if to_regclass('public.club_locations') is not null then
    insert into public.club_location_votes (key, user_id, name, address, lat, lon, updated_at)
      select key, updated_by, name, address, lat, lon, updated_at from public.club_locations where updated_by is not null
      on conflict do nothing;
    drop table public.club_locations;
  end if;
end $$;

-- Het geldende adres: meeste stemmen; bij gelijke stand het eerst ingevoerde.
create or replace function public.club_location(p_key text)
returns table (name text, address text, lat double precision, lon double precision, votes bigint)
language sql
stable
set search_path = public
as $$
  select (array_agg(v.name order by v.updated_at))[1],
         (array_agg(v.address order by v.updated_at))[1],
         avg(v.lat), avg(v.lon), count(*)
  from public.club_location_votes v
  where v.key = p_key
  group by lower(regexp_replace(v.address, '[^[:alnum:]]', '', 'g'))
  order by count(*) desc, min(v.updated_at)
  limit 1;
$$;
grant execute on function public.club_location(text) to authenticated;

-- Versie van dit script. De app controleert dit en vraagt je het script opnieuw te draaien als het ouder is.
create or replace function public.teamplanner_schema()
returns int
language sql
immutable
as $$ select 2 $$;
grant execute on function public.teamplanner_schema() to anon, authenticated;
