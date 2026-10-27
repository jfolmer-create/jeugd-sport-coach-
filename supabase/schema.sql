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

-- Iedere coach ziet en wijzigt alleen zijn eigen teams.
alter table public.teams enable row level security;
drop policy if exists "coach leest eigen teams" on public.teams;
drop policy if exists "coach maakt teams" on public.teams;
drop policy if exists "coach wijzigt eigen teams" on public.teams;
drop policy if exists "coach verwijdert eigen teams" on public.teams;
create policy "coach leest eigen teams"      on public.teams for select to authenticated using (owner = auth.uid());
create policy "coach maakt teams"            on public.teams for insert to authenticated with check (owner = auth.uid());
create policy "coach wijzigt eigen teams"    on public.teams for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "coach verwijdert eigen teams" on public.teams for delete to authenticated using (owner = auth.uid());

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
  using (exists (select 1 from public.teams t where t.id = team_id and t.owner = auth.uid()));
create policy "coach wist beschikbaarheid" on public.availability for delete to authenticated
  using (exists (select 1 from public.teams t where t.id = team_id and t.owner = auth.uid()));

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
-- Wisselschema's (speelminuten per kind) worden niet meegestuurd.
drop function if exists public.get_shared_team(text);
create or replace function public.get_shared_team(token text)
returns table (name text, data jsonb, updated_at timestamptz, avail_open boolean, avail_matches jsonb, availability jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select t.name,
         jsonb_set(t.data, '{matches}', coalesce(
           (select jsonb_agg(m - 'lineup' - 'played') from jsonb_array_elements(coalesce(t.data->'matches', '[]'::jsonb)) m),
           '[]'::jsonb)),
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
create policy "coach uploadt teammedia" on storage.objects for insert to authenticated
  with check (bucket_id = 'team-media' and exists (select 1 from public.teams t where t.id::text = (storage.foldername(name))[1] and t.owner = auth.uid()));
create policy "coach wijzigt teammedia" on storage.objects for update to authenticated
  using (bucket_id = 'team-media' and exists (select 1 from public.teams t where t.id::text = (storage.foldername(name))[1] and t.owner = auth.uid()));
create policy "coach verwijdert teammedia" on storage.objects for delete to authenticated
  using (bucket_id = 'team-media' and exists (select 1 from public.teams t where t.id::text = (storage.foldername(name))[1] and t.owner = auth.uid()));
