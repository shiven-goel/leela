# LAPdiary (was Leela) – notes for Claude

LAPdiary is the baby tracker Keshav and Nida use for their daughter Leela (Leela Ansari Palita; the app was called Leela until 21 Nov 2026 and the code, repo, database and web address still use that name, so keep them). In anything the family sees, the app is "LAPdiary" and "Leela" means the baby. It was built by their friend Shiven and handed over to Keshav on 21 Nov 2026; Keshav now owns it and develops it with Claude.

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

## Sweet spot (rebuilt 21 Nov 2026)

`src/lib/sweetspot.ts` (no libraries) learns each baby's own rhythm; there are no fixed targets. Awake time before the next sleep comes from weighted quantiles of past awake gaps near the same time of day (recent days count most, half-life 7 days, half pulled to the clock time), nap and night lengths likewise, and the baby's own night (onset, wake, length) from recent long sleeps (half-life 2 days), so a moved bedtime is followed within a few nights. Nights last until the usual wake time; awake in the night gives a `resettle` bedtime (no notification). Feeds know the baby doesn't feed in long sleeps (`feed.when`: gap, on-waking, before-sleep). `accuracy` re-predicts the last two weeks for the Sweet spot screen. Keshav chose not to set a bedtime goal (Nov 2026); revisit with him in a few weeks only if needed. Tune with backtests on real logs kept outside the repo (it's public), never commit them.

## Massage and vitamins

Massage is an activity kind (`massage`; older imported ones have `data.label` 'Massage') with its own home button. Daily vitamins: the list is `children.settings.supplements` (`src/lib/supplements.ts`), the Vitamins home button opens `src/components/Vitamins.tsx`, and each one given is a Medicine entry with `data.supplement: true`. Home buttons are now a 3×3 grid: Sleep, Feed, Diaper, Bottle, Pump, Bath, Massage, Vitamins, More.

## Outings and pumping (Nida's ideas, 21 Nov 2026)

Outings and visits are the activity kind `outing` with `data.where` (place chips from the family's own past places); History shows them with their places. Firsts (first visit somewhere) stay milestones. Time to pump: `pumpDue()` in `src/lib/alerts.ts` works breast by breast (Nida nurses one side and often pumps the other): each side's last emptying (breastfeed or pumping, sides from `left_s/right_s` or `left_ml/right_ml`, both when not noted) plus her own usual gap for that side at that time of day over the last week. Shown on the Pump home button and in the pumping sheet; the "Time to pump" notification is off by default (`prefs.alerts.pump`), sent by `sweetspot-push` once per emptying, with the side's usual yield at that time (`expectedMl`). The pumping coach (`src/lib/pumping.ts`, `src/screens/PumpingScreen.tsx`, overlay `pumping`, opened from the pumping sheet and History › Pumping) shows ml a day and the trend against the week before, yield by time of day and side, emptyings a day, the longest stretch, suggestions from common breastfeeding guidance, and how well "time to pump" did.

## Reminders, diary and solids (21 Nov 2026)

`sweetspot-push` also sends a vitamins nudge from 7 pm when one on the list isn't given (`vitaminsLeft`, pref `vitamins`) and "How the week went" on Sunday from 11 am (`weekText`, pref `weekly`, against the week before). The Diary tab is month by month of her life (figures and memories, latest two open), "on this day" from earlier months, and a photo grid. Solids (overlay `solids`, from More › Feeding and History › Solids; `src/lib/solids.ts`): readiness signs (saved in `children.settings.solids.ready`), countdown to 6 months, foods tried with reactions, the 3-day wait after a new food and the common allergens recognised from food names.

## History (rebuilt 21 Nov 2026)

One period bar (`src/components/history/PeriodBar.tsx`, periods in `src/lib/period.ts`): Day, Week (last 7 days, the default), Month (calendar), All (since birth), plus a sheet for any day, month of life, calendar month or own dates. Day shows the day strip, tappable totals and the timeline. Longer periods show an overview of category rows (`src/lib/insights.ts`: sleep, feeds, diapers, pumping, each activity kind, vitamins, medicine, temperature, symptoms, growth, firsts, notes) with sparklines and change against the period before; every row opens `src/screens/HistoryDetail.tsx` (figures, bars by day/week/month, time of day, every entry). Activities are counted in times; minutes only from entries with a length (most imported ones have none) and the screen says so. Medicines named like vitamins count as vitamins (`isSupplement`). Search (`HistorySearch.tsx`) covers all history; the ⋯ button has the doctor report for the chosen dates (overlay `report` with `from`/`to`; long ranges become weekly rows), the memory book and import. Older entries load on demand (`loadAllHistory`).

## Vaccines

Leela's three earlier Vaccine entries (1 Sep, 30 Sep, 30 Oct 2026) were linked to the 6, 10 and 14-week doses on 21 Nov 2026, and the birth doses marked as given before.

`src/lib/vaccines.ts` has India's IAP-ACVIP 2023 schedule. A dose counts as given when a Vaccine entry (type `symptom`, `data.kind` `vaccine`) lists its id in `data.vax`. The family's own dates, doses they're not having and doses given before they used the list live in `children.settings.vaccines` (`dates`, `skip`, `before`). The screen is `src/screens/VaccinesScreen.tsx` (overlay `vaccines`, also opened by `?open=vaccines` or a tapped vaccine notification).

## Backups

The `backup` edge function (verify_jwt off, checks the cron secret) saves a gzipped JSON copy of every table and the sign-in list to the private storage bucket `backups` (`daily/leela-YYYY-MM-DD.json.gz`) every night at 03:17 India time (pg_cron job `leela-backup`), keeping 30 days. To restore, download a copy and upsert the rows (parents before children: families, profiles, family_members, children, imports, events, timer_segments). If Leela ever has other families, switch to Supabase's paid plan for proper backups. `backup.yml` (weekly copy to GitHub) stays off: Keshav chose not to keep database passwords in a public repo.

## Deploying edge functions

The deployed functions are one-line wrappers made in the Supabase dashboard (Edge Functions > function > Code > Deploy updates): `import 'https://cdn.jsdelivr.net/gh/vahsekatilap/leela@<commit>/supabase/functions/<name>/index.ts'`. The real code and its helper files load from that exact commit, so push first, then change the commit in the wrapper. `ghar-bridge`, `sweetspot-push`, `backup` and `admin` are deployed this way; all have Verify JWT off. The Supabase connector's deploy_edge_function can also deploy the one-line wrapper directly. `leela-check` is Shiven's old one-off test function.

## Checking work

Network installs may not work in Claude's workspace. Push work to a branch first: `.github/workflows/check.yml` runs lint, unit tests, the edge bundles and the build, and writes `<branch>/report.md` (plus freshly built `bundles/`) to the `check-results` branch, readable with git. Merge to main only when it passes; main deploys the app.

## Look and behaviour (Keshav's choices, Nov 2026)

- Dark theme by default, always (`[data-theme="dark"]` in `src/index.css`); Settings offers Warm night and Light per phone. `index.html` and the manifest are dark from the first frame so there is never a white flash.
- Logo: the LAP wordmark (ivory letters, the A's crossbar an amber curve like a lap) on charcoal: `public/favicon.svg`, the PNG icons and `src/components/LeelaMark.tsx`.
- Pumping is shared with the whole family (`sharedWithFamily` in `src/lib/config.ts`, `showsFor()`); contractions stay private.
- Home buttons: Sleep, Feed, Diaper, Bottle, Pump, Bath, Massage, Vitamins, More (a 3×3 grid). Bottle and pumping start now and stop later; stopping opens the entry to fill in the amount.
- Times are picked on scroll wheels (`WheelTimeSheet` in `src/components/TimeField.tsx`), never the clock dial.
- The timeline shows "35 min · 8:45 – 9:20 AM" under each entry that lasts a while (`timeSpanText()` in `src/lib/describe.ts`).
- The Family tab is now Settings. The admin panel (`src/screens/AdminScreen.tsx`, edge function `admin`) shows only to people whose `profiles.prefs.admin` is true: Keshav. Nobody else should see that it exists. WHO growth curves and percentiles appear only there; History shows plain growth.
- Sync: opening the app with a copy on the phone fetches only what changed (`refresh()`), renewing the sign-in first; coming back to the app (`resume()`) catches up at once and reconnects live updates; a 15-second safety check runs while live updates are down. While catching up after a long gap, Today says so and dims timers.

## Known follow-ups

- Done on 21 Nov 2026: `sweetspot-push` uses the new address (and maps old saved links to it); Shiven's empty test account ("Goel"), the check family and all end-to-end test families and accounts were deleted (only the family "NIKE" with Keshav, Nida and Leela is left; 26 old test photos remain in the `family` bucket under deleted family folders); `e2e.yml` runs only by hand now (a full run adds test families to the real database, so delete them afterwards). It still has no `CANARY_KEY`.
