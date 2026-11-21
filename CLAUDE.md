# Leela – notes for Claude

Leela is the baby tracker Keshav and Nida use for their daughter Leela. It was built by their friend Shiven and handed over to Keshav on 21 Nov 2026; Keshav now owns it and develops it with Claude.

- Code: this repo (`vahsekatilap/leela`, public). React + Vite PWA, deployed to GitHub Pages by `.github/workflows/deploy.yml` at https://vahsekatilap.github.io/leela/.
- Database: Supabase project `rtebcagicaypvgfeqsjn` ("Leela", West EU), in Keshav's "Palita Family" organisation. The app uses only the publishable key (`.env.production`). Secret API key `default` was replaced on 21 Nov; legacy keys are disabled and the old HS256 signing key is revoked; the database password was reset and nobody keeps it.
- Keshav only wants to press buttons: ask tap-to-answer questions, never ask him to run commands. Never use the word "secret" in anything the family sees; say "private".

## Ghar bridge (keep it working)

Ghar, the family's Android app (repo `vahsekatilap/ghar`, Supabase project `sfjzdkajewcrcqzbpyou`), shows Leela's live status and lets family and the nanny log sleep, feeds, nappies and notes. It does this only through the edge function `supabase/functions/ghar-bridge` (deployed with verify_jwt off) and the table `ghar_links` (Ghar household → Leela family + child; migration 0004).

- Any change to Leela's tables, event types, `data` fields or the sweet spot must keep the bridge's requests and replies the same (`status`, `log`, `delete` – see the comment at the top of `ghar-bridge/index.ts`). Change the bridge's insides if needed, never its shape, unless Ghar is changed in the same piece of work.
- The bridge reuses the sweet spot code: `npm run build:edge` writes `sweetspot.js` into both `sweetspot-push/` and `ghar-bridge/`. Redeploy both functions after changing `src/lib/sweetspot.ts`.
- Entries logged from Ghar have no `created_by` (Ghar people aren't Leela users); `data.ghar` holds who logged it (`by`, `member`), the room (`room`) and any extra words (`detail`). Show `data.ghar.by` wherever the app shows who logged an entry (not done yet).
- Who may see or log is decided in Ghar (`leela_access()` there), asked with the person's own Ghar sign-in.

## Known follow-ups

- `sweetspot-push` still names the old address (`shiven-goel.github.io`) as its contact, and older push subscriptions may open the old link.
- Shiven's own empty test account ("Goel") and the end-to-end test families still live in the database; `.github/workflows/e2e.yml` keeps adding test families weekly and lost its `CANARY_KEY` in the move. Keshav chose to leave them for now.
- No backups: `backup.yml` needs `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE`, which are not set.
