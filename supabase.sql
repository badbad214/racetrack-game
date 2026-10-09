-- Run this in Supabase SQL Editor
create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  board_size integer not null check (board_size in (400, 600, 900, 1200)),
  sections jsonb not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.tracks enable row level security;

-- Public read access for public tracks
drop policy if exists "Public tracks are readable" on public.tracks;
create policy "Public tracks are readable"
  on public.tracks
  for select
  using (is_public = true);

-- Allow anonymous/public inserts (you can tighten later with auth)
drop policy if exists "Anyone can insert tracks" on public.tracks;
create policy "Anyone can insert tracks"
  on public.tracks
  for insert
  with check (true);
