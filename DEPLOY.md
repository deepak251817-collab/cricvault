# Deploying CricVault

CricVault is a long-running Node server (Express) that keeps everything in one SQLite file
(`data/cricvault.db`). It is **not** a static site: whoever hosts it must run `node server/index.js`
and give that process a **persistent disk**, otherwise every deploy wipes the league.

Production mode is already built in: `npm start` serves the Vite build from `dist/` and the API from
the same origin, and reads `PORT` from the environment.

## 1. Put the code on GitHub

The folder is now a git repo with one commit and a `.gitignore` that keeps `node_modules/`, `dist/`,
`data/` and `backups/` out of it (your league database never goes to GitHub).

```bash
git remote add origin https://github.com/<your-user>/cricvault.git
git push -u origin main
```

Create the empty repository on GitHub first, then run the two commands. If git asks for credentials,
use a personal access token as the password.

## 2. Deploy on Render

1. Sign in at <https://render.com> and choose **New → Blueprint**.
2. Pick the repository you just pushed. Render reads `render.yaml` and shows one web service,
   `cricvault`, with a 1 GB disk mounted at `data/`.
3. Choose the **Starter** instance (a free instance cannot attach a disk) and click **Apply**.
4. The first build runs `npm ci && npm run build`, then `npm start`. `GET /api/health` is the health
   check; when it answers `{"ok":true,"mode":"prod"}` the service is live at
   `https://cricvault.onrender.com` (or your own name).

The database file is created automatically on first boot, together with the default login
**admin / admin123**. Change that password on the Settings page straight away — the site is public.

Every later `git push` to the branch redeploys. The disk is not touched by deploys, so data survives.

## 3. Move your existing league (optional)

The hosted app starts empty. To bring your local data across:

1. Locally, open the season and use **Export backup** to download its `.json`.
2. On the deployed site, sign in as admin, go to **Seasons → Restore from backup**, and upload the
   file. It is restored as a new season ("… (restored)"), so nothing existing is overwritten.
3. Repeat for any other seasons you want there. Teams and players travel inside the backup.

Take a fresh export before any big change once it is live; the disk protects you from redeploys, not
from mistakes.

## Notes and gotchas

- **`better-sqlite3` is a native module.** Render builds it during `npm ci`; the `engines` range in
  `package.json` (Node 20–22) keeps it on a supported version. If a build ever fails on that module,
  clear the build cache and redeploy.
- **One instance only.** SQLite on a disk does not support multiple instances writing at once, so
  leave the service at one instance and skip zero-downtime/multi-instance settings.
- **Sessions are cookies.** They are per browser and survive restarts; no extra configuration needed.
- **Custom domain:** Render → Settings → Custom Domains, then add the CNAME it shows you.
- **Backups:** the disk is the only copy. Either export seasons regularly or enable Render's disk
  snapshots (paid plans).

## Alternative: Docker on your own server

`npm start` is the only entrypoint needed. On any box with Node 20–22:

```bash
npm ci && npm run build
PORT=8080 CRICVAULT_DB=/srv/cricvault/data/cricvault.db npm start
```

Keep the directory holding the database on a volume that is not wiped on restart, and point a reverse
proxy (Caddy, nginx) at the port for HTTPS.
