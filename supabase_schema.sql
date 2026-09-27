-- Meetflow Supabase schema: run this once in Supabase Dashboard > SQL Editor.
-- Project: https://fqizwbfhlcfqofvcovmv.supabase.co
-- Purpose: table where every user (Google + email signup) is stored.
--
-- The app already sends SUPABASE_URL + SUPABASE_ANON_KEY with every build
-- (see app.py DEFAULT_SUPABASE_URL/KEY and public/app.js DEFAULT_SB_URL/KEY),
-- mirrors each signup here over Supabase REST (best-effort), and reads the
-- signed-in user's profile back into the dashboard after Google OAuth.

create table if not exists public.employees (
  id text primary key,
  name text not null,
  email text unique not null,
  role text not null default 'Employee',
  department text not null default 'General',
  avatar_color text not null default '#2e644b',
  created_at timestamptz not null default now()
);

alter table public.employees enable row level security;

-- Allow any signed-in OR anonymous app client to register / sync a profile
-- (the app uses the anon key, so anonymous insert+update must be permitted
-- for the self-signup flow; reads stay scoped to one's own row where possible).
drop policy if exists "employees_insert_any" on public.employees;
create policy "employees_insert_any"
  on public.employees for insert
  with check (true);

drop policy if exists "employees_update_any" on public.employees;
create policy "employees_update_any"
  on public.employees for update
  using (true)
  with check (true);

drop policy if exists "employees_select_any" on public.employees;
create policy "employees_select_any"
  on public.employees for select
  using (true);

-- Google OAuth: Supabase Dashboard > Authentication > Providers > Google > Enable.
-- Set the redirect URL to your deployed origin, e.g.
--   https://<your-vercel-app>.vercel.app/meetings
-- plus http://127.0.0.1:<port>/meetings for local testing.
