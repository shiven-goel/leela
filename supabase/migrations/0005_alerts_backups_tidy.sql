-- Daily private backups, and tidying up after the move to vahsekatilap.github.io.
-- (Medicine, vaccine and summary notifications need no table changes: choices live in
-- profiles.prefs.alerts, medicine reminders in events.data.every_h, vaccines in events.data.vax
-- and children.settings.vaccines.)

-- A private bucket for the daily copies. No storage policies: only the service role can use it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 52428800)
on conflict (id) do nothing;

-- Every night at 03:17 India time, ask the backup function to save a copy.
select cron.schedule('leela-backup', '47 21 * * *', $cron$
  select net.http_post(
    url := 'https://rtebcagicaypvgfeqsjn.supabase.co/functions/v1/backup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-leela-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'leela_push_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$cron$);

-- Phones that turned reminders on at the old address open the new one when a notification is tapped.
update public.push_subscriptions
   set app_url = regexp_replace(app_url, '^https://shiven-goel\.github\.io/leela/?', 'https://vahsekatilap.github.io/leela/')
 where app_url ~ '^https://shiven-goel\.github\.io/leela';

-- Bottles of breast milk logged from Ghar were saved as "breastmilk"; Leela calls it "breast".
update public.events
   set data = jsonb_set(data, '{contents}', '"breast"')
 where type = 'bottle' and data ->> 'contents' = 'breastmilk';
