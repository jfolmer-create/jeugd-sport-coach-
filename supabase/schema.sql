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

-- Kijklink voor ouders: alleen wie het geheime token kent, ziet het schema.
-- Wisselschema's (speelminuten per kind) worden niet meegestuurd.
create or replace function public.get_shared_team(token text)
returns table (name text, data jsonb, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select t.name,
         jsonb_set(t.data, '{matches}', coalesce(
           (select jsonb_agg(m - 'lineup' - 'played') from jsonb_array_elements(coalesce(t.data->'matches', '[]'::jsonb)) m),
           '[]'::jsonb)),
         t.updated_at
  from public.teams t
  where t.share_token = token and length(token) >= 16;
$$;
revoke all on function public.get_shared_team(text) from public;
grant execute on function public.get_shared_team(text) to anon, authenticated;
