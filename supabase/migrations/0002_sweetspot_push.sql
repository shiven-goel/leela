-- Sweet spot reminders: the phones that asked for them, what has been sent, and the schedule.
-- The VAPID keys and the cron secret live in Supabase Vault (created separately, never in git):
--   leela_vapid_public, leela_vapid_private_jwk, leela_push_cron_secret

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  family_id uuid not null references public.families (id),
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 80 and 100),
  auth text not null check (length(auth) between 16 and 40),
  -- Minutes before the sweet spot starts.
  lead_min integer not null default 15 check (lead_min between 0 and 120),
  -- The address this phone uses for Leela, opened when the notification is tapped.
  app_url text check (app_url ~ '^https?://' and length(app_url) <= 300),
  user_agent text check (length(user_agent) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text check (length(disabled_reason) <= 100),
  last_sent_at timestamptz,
  unique (user_id, endpoint)
);
create index if not exists push_subscriptions_active on public.push_subscriptions (family_id) where disabled_at is null;

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and family_id = (select private.my_family_id()));
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and family_id = (select private.my_family_id()));
grant select, insert, update on public.push_subscriptions to authenticated;

-- Who owns a row never changes, and updated_at always moves.
create or replace function private.push_subscriptions_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.id := old.id;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
create trigger push_subscriptions_touch before update on public.push_subscriptions
  for each row execute function private.push_subscriptions_touch();

-- One row per reminder sent, so each one goes out once. Only the server reads or writes it.
create table if not exists public.push_sent (
  subscription_id uuid not null references public.push_subscriptions (id),
  child_id uuid not null references public.children (id),
  slot text not null check (length(slot) <= 60),
  sent_at timestamptz not null default now(),
  status integer,
  primary key (subscription_id, child_id, slot)
);
alter table public.push_sent enable row level security;
revoke all on public.push_sent from anon, authenticated;

-- The sending function's keys, for the service role only.
create or replace function public.push_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'vapid_public', (select decrypted_secret from vault.decrypted_secrets where name = 'leela_vapid_public'),
    'vapid_private', (select decrypted_secret from vault.decrypted_secrets where name = 'leela_vapid_private_jwk'),
    'cron_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'leela_push_cron_secret'))
$$;
revoke all on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;

-- Every minute, while anyone has reminders on, ask the edge function to send what's due.
create extension if not exists pg_cron;
select cron.schedule('leela-sweetspot-push', '* * * * *', $cron$
  select net.http_post(
    url := 'https://rtebcagicaypvgfeqsjn.supabase.co/functions/v1/sweetspot-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-leela-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'leela_push_cron_secret')),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 25000)
  where exists (select 1 from public.push_subscriptions where disabled_at is null)
$cron$);
