create table if not exists public.combat_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.combat_profiles enable row level security;

grant select, insert, update on public.combat_profiles to authenticated;

create policy "combat_profiles_select_own"
on public.combat_profiles
for select
using (auth.uid() = user_id);

create policy "combat_profiles_insert_own"
on public.combat_profiles
for insert
with check (auth.uid() = user_id);

create policy "combat_profiles_update_own"
on public.combat_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
