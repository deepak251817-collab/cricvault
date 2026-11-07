# Deploying CricVault on Vercel

CricVault is an Express API plus a React frontend. On Vercel the frontend is a static build
(`dist/`) and every `/api/*` call is served by one serverless function (`api/[...path].js`).

Vercel has no writable disk, so the data lives in a **hosted libSQL database (Turso)**. The SQL is
still SQLite — the same schema, the same queries — and the driver talks to it over HTTPS.

```
Browser ──► Vercel static (dist/)          React app
        └─► Vercel function (api/…)  ──►  Turso libSQL database
```

## 1. Create the database

**Recommended: the Vercel integration.** In the Vercel dashboard open your project → **Storage** →
**Turso** (or Marketplace → Turso) → create a database and connect it. Vercel then injects
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` into every environment automatically.

**Manual:** create a database at <https://turso.tech> (free tier: no card) and copy the URL and token,
then add both names under Project → Settings → Environment Variables for Production and Preview.

The app reads, in order: `TURSO_DATABASE_URL`, then `DATABASE_URL`; token from `TURSO_AUTH_TOKEN`,
then `DATABASE_AUTH_TOKEN`. With neither set it falls back to a local file, which is what local
development uses.

## 2. Deploy

If the Vercel project is connected to the GitHub repo, pushing to `main` deploys. Otherwise:

```bash
npx vercel --prod
```

The build runs `npm run build` (Vite) and bundles the API function. The first request creates the
schema and seeds the admin login; later cold starts skip both.

## 3. First login

Open the deployment URL and sign in with **admin / admin123**, then change the password on the
Settings page — the site is public.

## 4. Move your existing league (optional)

The hosted database starts empty. To bring your local data across:

1. Locally, open the season and use **Export backup** to download its `.json`.
2. On the deployed site, sign in as admin, go to **Seasons → Restore from backup**, and upload it.
   It is restored as a new season ("… (restored)"), so nothing existing is overwritten.
3. Repeat for other seasons. Teams and players travel inside the backup.

## Local development

Unchanged and offline:

```bash
npm run dev     # Vite + API on http://localhost:5173, data in data/cricvault.db
npm run build
npm start       # production build + API on http://localhost:8080
```

Set `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` locally if you want to develop against the hosted
database instead of the file.

## Notes and gotchas

- **One function, many instances.** Every request is stateless; all state is in Turso, sessions
  included (the `sessions` table plus an httpOnly cookie that is `secure` on Vercel).
- **Transactions** run through libSQL's interactive transaction API, so a write either lands whole
  or not at all, even across instances.
- **Free tier limits** (Turso): 100 databases, 5 GB storage, 500M row reads per month — far beyond
  a local league's needs.
- **Backups:** export a season now and then; the hosted database is the only copy.
- **Smoke test after deploying:** `BASE=https://your-app.vercel.app node scripts/smoke-api.mjs`
  checks the read endpoints and the login flow.
