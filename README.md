# ⚽ FPL Assistant

A data-driven **Fantasy Premier League** assistant that helps you win your mini-league:
ranked transfer suggestions, captain & chip-timing advice, and analysis of your rivals —
powered by the official FPL API and an optional **Claude AI** coaching layer.

Deployed on **Cloudflare Pages** (static SPA + Pages Functions), advisory-only, with your
Team ID and League ID stored in your browser — never in the code.

## How it works

The FPL API sends no CORS headers, so the browser can't call it directly. Every request
goes through Cloudflare Pages Functions, which also run the scoring engine — so the same
computed numbers feed both the UI and the AI coach, and the API key stays server-side.

```
public/            Static single-page app (Dashboard / Transfers / Captain & Chips / Rivals / Setup)
functions/
  _middleware.js   Security headers + JSON error handling
  api/
    recommendations.js  GET  — fetches FPL data (edge-cached), runs the engine, returns advice
    coach.js            POST — turns the advice into a natural-language plan via Claude
src/               Pure, unit-tested engine (fpl-client, scoring, fdr, transfers, captain, chips, rivals)
test/              node --test unit tests against synthetic payloads
```

### The scoring model (`src/scoring.js`)

Each player gets a projected-points figure blended from FPL's own `ep_next`, recent `form`,
and season `points_per_game` (weights redistribute across whichever signals are live, so it
degrades gracefully in pre-season), nudged by expected goal involvements, gated by
availability (`status` / `chance_of_playing_next_round`), and weighted by the difficulty of
each upcoming fixture. Doubles count twice, blanks count zero. Value = projected points over
the next 3 gameweeks per £m.

## Local development

```bash
npm install
npm test                 # run the engine unit tests
npx wrangler pages dev   # serve the app locally at http://localhost:8788
```

Then open the app, go to **Setup**, enter your Team ID and League ID, and browse the tabs.

- **Team ID** — the number in the URL when you view your team: `…/entry/1234567/…`
- **League ID** — from your classic league's standings URL: `…/leagues-classic/379411/standings/`

## Deploy to Cloudflare Pages

1. **Create the Pages project** (connect this GitHub repo in the Cloudflare dashboard, or
   deploy directly):
   ```bash
   npx wrangler pages deploy public
   ```

2. **Add the AI coaching key as a secret** (optional — the app works fully without it; the
   AI panel just hides until a key is present). Never commit this.
   ```bash
   npx wrangler pages secret put ANTHROPIC_API_KEY
   ```
   Or in the dashboard: **Pages → your project → Settings → Variables and Secrets →
   add secret `ANTHROPIC_API_KEY`**. (Optionally set `ANTHROPIC_MODEL`; defaults to
   `claude-opus-5`.)

3. **Add your custom domain**: **Pages → your project → Custom domains → Set up a domain**,
   and enter `fantasy.totteannerbrink.com`.

4. **Point the CNAME at your web hotel's DNS**: create a `CNAME` record
   `fantasy` → `fpl-assistant.pages.dev` (Cloudflare shows the exact target). Cloudflare
   provisions the TLS certificate automatically once the record resolves.

## Notes

- **Advisory only** — no FPL login is ever used or stored. You make the moves on the
  official FPL site/app.
- **Caching** — FPL responses are cached at the Cloudflare edge (Cache API) for a few
  minutes to stay fast and respect FPL rate limits.
- **Privacy** — your Team ID and League ID live in `localStorage` in your browser only.
