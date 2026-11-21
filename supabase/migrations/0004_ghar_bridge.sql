-- Which Ghar household sees which Leela family and child (used only by the ghar-bridge function).
create table if not exists public.ghar_links (
  ghar_household uuid primary key,
  family_id uuid not null references public.families (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.ghar_links enable row level security;
revoke all on public.ghar_links from anon, authenticated;
-- No policies: only the bridge (service role) reads it.
