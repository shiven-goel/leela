# Leela – notes for Claude

Leela is the baby tracker Keshav and Nida use for their daughter Leela. It was built by their friend Shiven and handed over to Keshav on 21 Nov 2026; Keshav now owns it and develops it with Claude.

- Code: this repo (`vahsekatilap/leela`, public). React + Vite PWA, deployed to GitHub Pages by `.github/workflows/deploy.yml` at https://vahsekatilap.github.io/leela/.
- Database: Supabase project `rtebcagicaypvgfeqsjn` ("Leela", West EU), in Keshav's "Palita Family" organisation. The app uses only the publishable key (`.env.production`). Secret API key `default` was replaced on 21 Nov; legacy keys are disabled and the old HS256 signing key is revoked; the database password was reset and nobody keeps it.
- Keshav only wants to press buttons: ask tap-to-answer questions, never ask him to run commands. Never use the word "secret" in anything the family sees; say "private".

## Ghar bridge (keep it working)

Ghar, the family's Android app (repo `vahsekatilap/ghar`, Supabase project `sfjzdkajewcrcqzbpyou`), shows Leela's live status and lets family and the nanny log sleep, feeds, nappies and notes. It does this only through the edge function `supabase/functions/ghar-bridge` (deployed with verify_jwt off) and the table `ghar_links` (Ghar household → Leela family + child; migration 0004).

- Any change to Leela's tables, event types, `data` fields or the sweet spot must keep the bridge's requests and replies the same (`status`, `log`, `delete` – see the comment at the top of `ghar-bridge/index.ts`). Change the bridge's insides if needed, never its shape, unless Ghar is changed in the same piece of work.
- The bridge reuses the sweet spot code: `npm run build:edge` writes `sweetspot.js` into both `sweetspot-push/` and `ghar-bridge/` (and `alerts.js` into `sweetspot-push/`). Redeploy both functions after changing `src/lib/sweetspot.ts`.
- Entries logged from Ghar have no `created_by` (Ghar people aren't Leela users); `data.ghar` holds who logged it (`by`, `member`), the room (`room`) and any extra words (`detail`). The app shows `data.ghar.by` wherever it shows who logged an entry (`loggedBy()` / `gharName()` in `src/lib/store.ts`); use those for any new place.
- Bottles of breast milk from Ghar are saved with `contents: 'breast'` (they were `'breastmilk'` until 21 Nov 2026; migration 0005 fixed the old rows).
- Who may see or log is decided in Ghar (`leela_access()` there), asked with the person's own Ghar sign-in.

## Notifications

One edge function, `sweetspot-push`, sends every notification, every minute from pg_cron: the sweet spot, medicine doses (medicines logged with "Remind about the next dose" keep `data.every_h`; the latest entry of that medicine decides), vaccines (2 days before and on the day, from 9 am) and the evening summary (at each person's time). Each person's choices are in `profiles.prefs.alerts` (`readAlerts()` in `src/lib/alerts.ts`; all on by default, summary 8:30 pm) and apply to every phone where they turned notifications on (`push_subscriptions`). `push_sent` makes each one go out once per phone. Medicine, vaccine and summary code lives in `src/lib/alerts.ts` and `src/lib/vaccines.ts` with no libraries, bundled into `sweetspot-push/alerts.js` by `npm run build:edge`; redeploy `sweetspot-push` after changing them.

## Vaccines

`src/lib/vaccines.ts` has India's IAP-ACVIP 2023 schedule. A dose counts as given when a Vaccine entry (type `symptom`, `data.kind` `vaccine`) lists its id in `data.vax`. The family's own dates, doses they're not having and doses given before they used the list live in `children.settings.vaccines` (`dates`, `skip`, `before`). The screen is `src/screens/VaccinesScreen.tsx` (overlay `vaccines`, also opened by `?open=vaccines` or a tapped vaccine notification).

## Backups

The `backup` edge function (verify_jwt off, checks the cron secret) saves a gzipped JSON copy of every table and the sign-in list to the private storage bucket `backups` (`daily/leela-YYYY-MM-DD.json.gz`) every night at 03:17 India time (pg_cron job `leela-backup`), keeping 30 days. To restore, download a copy and upsert the rows (parents before children: families, profiles, family_members, children, imports, events, timer_segments). If Leela ever has other families, switch to Supabase's paid plan for proper backups. `backup.yml` (weekly copy to GitHub) stays off: Keshav chose not to keep database passwords in a public repo.

## Checking work

Network installs may not work in Claude's workspace. Push work to a branch first: `.github/workflows/check.yml` runs lint, unit tests, the edge bundles and the build, and writes `<branch>/report.md` (plus freshly built `bundles/`) to the `check-results` branch, readable with git. Merge to main only when it passes; main deploys the app.

## Known follow-ups

- Done on 21 Nov 2026: `sweetspot-push` uses the new address (and maps old saved links to it); Shiven's empty test account and the end-to-end test families were deleted; `e2e.yml` runs only by hand now (a full run adds test families to the real database, so delete them afterwards). It still has no `CANARY_KEY`.
