# CricVault

Cricket league management and live ball-by-ball scoring for a club or franchise league: teams, players, seasons,
squads, fixtures, IPL-style points tables, playoffs, career analytics, Excel import and printable scorecards — all in
one self-hosted app with a SQLite database.

```
npm install
npm run dev            # http://localhost:5173 — admin / admin123
```

---

## Contents

1. [What it does](#what-it-does)
2. [Running it](#running-it)
3. [Logins and roles](#logins-and-roles)
4. [Scoring rules](#scoring-rules)
5. [Season lifecycle](#season-lifecycle)
6. [Season backup and restore](#season-backup-and-restore)
7. [Deleting a season, team or player](#deleting-a-season-team-or-player)
8. [Excel import](#excel-import)
9. [API tour](#api-tour)
10. [Project layout](#project-layout)
11. [Troubleshooting](#troubleshooting)

---

## What it does

| Area | Details |
| --- | --- |
| Seasons | T20, ODI, Test (4 innings) or Custom (own overs, 2 or 4 innings, **0 overs = unlimited**). A season is a sealed archive: adding or removing teams later never rewrites it. |
| Squads | Per team, per season, max 12 players; the XI is picked from that squad with exactly one captain and at least one wicketkeeper. |
| Fixtures | Round-robin generation with "times each team meets" (1–3 legs) or one-off fixtures added by hand, with venue and date. |
| Scoring | Ball-by-ball delivery log, undo removes the last ball, innings close automatically on 10 wickets, over quota or a chased target. |
| Extras | Wides, no-balls, byes, leg byes — with the IPL free-hit law built in (see below). |
| Table | IPL format: win 2, tie/no-result 1, NRR with an all-out side charged its full over quota. |
| Playoffs | Top 2, Top 4 (IPL: Q1, Eliminator, Q2, Final) or Top 5 (Eliminator 4v5, Elim2 3v winner, Q1 1v2, Q2, Final). |
| Records | Season record books or career books: most runs, most wickets, best figures, champions, titles. |
| Analytics | Per-team season and career views, per-player career pages, dashboard across all seasons. |
| Admin | Team logins, Excel import, season export/restore, league settings, password change. |

## Running it

Requirements: Node 18+ (tested on Node 22) and npm.

```bash
npm install          # install once
npm run dev          # Express + Vite middleware, http://localhost:5173
npm run build        # bundle the client into dist/
npm start            # production mode: serves dist/ + API, default port 8080
npm run seed:demo    # fill an empty league with demo teams, players and matches
```

`npm run seed:demo -- --reset` wipes the cricket data (not user accounts) and re-seeds.

Everything you create — teams, players, seasons, fixtures and every ball — is written straight to the SQLite file
`data/cricvault.db`. Restarting the server (or the computer) keeps the league exactly as it was; nothing lives only in
memory. `npm run seed:demo` only ever runs against an **empty** league, so on a league of your own it does nothing.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5173` dev / `8080` prod | HTTP port. |
| `NODE_ENV` | — | `production` (or `--prod`) serves the built client instead of Vite. |
| `CRICVAULT_DB` | `data/cricvault.db` | SQLite file. Point it elsewhere to keep multiple leagues side by side. |

The database is created automatically on first boot (`server/db.js`), along with the admin account. Back the file up
if you want a full-instance safety net; per-season backups are described below.

## Logins and roles

* **Admin** — `admin` / `admin123` on a fresh database. Full access: seasons, fixtures, scoring, squads, players,
  settings, backups. Change the password from Settings.
* **Team** — created by the admin from **Teams → team → login credentials** (`POST /api/teams/:id/credentials`). A team
  user only sees its own team page, analytics and squad; scoring is admin-only.

Sessions are cookie-based (`scrypt` password hashes, sessions table with expiry).

## Scoring rules

**Points table.** Win 2, tie 1, no-result 1, loss 0. Net run rate is `runs/overs faced − runs/overs conceded`, where a
side bowled out is treated as having faced its full over quota. Abandoned/no-result games count as played with 1 point.

**Innings.** Two-innings formats: one side bats, the other chases. Test and 4-innings Custom: four innings with
declarations; the side ahead on aggregate wins, equal aggregates are a draw. An innings closes automatically on 10
wickets, over quota, or when the target is reached.

**Extras, IPL style.**

* **Wide** — 1 penalty run plus any runs run, all charged to the bowler, no ball counted in the over. A batter can only
  be stumped or run out off a wide.
* **No ball** — always 1 penalty run, *plus* any runs off the bat. The delivery does not count in the over. Bat runs are
  credited to the batter (and count as balls faced); the penalty and any extras are charged to the bowler.
* **Free hit** — the delivery after every no-ball is a free hit. On a free hit the batter can only be dismissed run out
  or obstructing the field: bowled, caught, lbw, stumped and hit wicket are rejected by the server. If the free-hit
  delivery is itself a wide or a no-ball, the next delivery stays a free hit.
* **Byes and leg byes** — legal deliveries, not charged to the bowler.

The scoring screen shows a **FREE HIT** banner and restricts the dismissal list automatically; choosing "No ball" in the
wicket dialog scores "no ball + run out" as one delivery.

**Undo.** Every ball is a row in `deliveries`. Undo deletes the last row and the innings state (score, strike, bowler,
overs, extras, cards) is rebuilt by replaying the log, so corrections are always consistent.

## Season lifecycle

`draft → fixtures → live → playoffs → completed`

* Teams are enrolled per season. Removing a team or player from the league later leaves finished seasons untouched.
* Fixtures can only be regenerated before any match is played.
* Playoffs can be seeded from the table (top 2/4/5) or with a manual order, and winners advance automatically through
  Q1 / Eliminator / Q2 / Final.
* A season can be deleted at any stage, including after matches are played — see
  [Deleting a season, team or player](#deleting-a-season-team-or-player). Export a backup first if you might want it back.

## Season backup and restore

Each season can be exported to a single JSON file and restored later, which is the safety net for an accidental edit or
deletion.

**Export** — open a season → **Export backup** (top right), or:

```bash
curl -b cookies.txt -OJ http://localhost:5173/api/seasons/1/export
```

The archive contains everything needed to rebuild the season:

| Key | Contents |
| --- | --- |
| `season` | Format, overs, innings limit, status, playoffs, champion, runner-up, dates, notes. |
| `teams` | Every team enrolled in the season. |
| `players` | Every player referenced by a squad, XI or scorecard. |
| `seasonPlayers` | Squads with captain/keeper flags. |
| `matches` | Fixtures, results, toss, points, playoff bracket wiring. |
| `innings` | Innings order, targets, declarations, closed flags. |
| `deliveries` | The complete ball-by-ball log. |
| `matchXi` | Both XIs per match, with captain/keeper marks. |

A typical T20 season is a few hundred KB (about 500 KB for 7 matches / 1,700 balls).

**Restore** — Seasons page → **Restore backup** → choose the `.json` file → **Restore season**.

Things worth knowing:

* The backup is restored as a **new season** named `"<original name> (restored)"`, so nothing in the current archive is
  overwritten. Delete the broken season once you are happy with the restored copy.
* Teams and players are matched **by name** and reused, so a restore never duplicates your league. Missing teams or
  players are created (short names get a numeric suffix if they clash).
* Every match, innings, delivery and XI gets fresh ids, but results, points, awards, NRR and scorecards are identical
  because they are derived from the delivery log.
* Backups are admin-only and validated: a file that is not a CricVault season backup (`kind: "season-backup"`) is
  rejected, and a backup from a newer format version is refused rather than half-imported.
* Not included: user accounts, league settings and other seasons. Back those up by copying `data/cricvault.db`.

## Deleting a season, team or player

All three deletes are admin-only and ask for confirmation first.

| Delete | Where | What happens |
| --- | --- | --- |
| **Season** | Season page → **Delete** | Removes the season with its tables, squads, fixtures, innings and every ball bowled (the schema cascades). The confirmation names the number of fixtures, and the toast reports how many fixtures and balls went with it. Teams and players are not touched. |
| **Team** | Teams page → **Delete** | Deleted permanently if no season, squad or fixture refers to it. A team with history is **archived** instead (hidden from new squads and fixtures) so past seasons and scorecards never change. |
| **Player** | Players page → **Delete** | Same rule: hard delete when nothing refers to the player, archived when they appear in a squad, XI or scorecard. |
| **Several players** | Players page → tick rows → **Delete n selected** | One call to `POST /api/players/bulk-delete` with `{ "ids": [...] }`, applying the same hard-delete-or-archive rule per player. The header checkbox selects every row currently matching the search and filters. |

Archived teams and players keep their rows in the Archived badge and can be brought back at any time with the
**Restore** button on the same page (`PATCH /api/teams/:id` or `/api/players/:id` with `{ "isActive": true }`).

Deleting a season is permanent — it cannot be undone, so **Export backup** first if there is any chance you will want the
data. A restored backup always comes back as a new season, never over the top of an existing one.

**Start completely fresh:** stop the server, delete `data/cricvault.db` (plus the `-wal`/`-shm` files next to it) and
start it again. The schema and the `admin` login are recreated empty on boot, and your exported `.json` files stay in
`backups/` if you ever want a season back.

## Excel import

**Teams** and **Players** can be bulk-imported from `.xlsx` files.

1. **Teams page → Import** or **Players page → Import** (a season's Squads tab has its own import too).
2. Download the template (`GET /api/import/templates/teams|players`) — it contains the expected headings and a sample row.
3. Upload the filled file (`POST /api/import/teams|players`, multipart `file`).
4. Rows are matched by name: existing teams/players are updated, new ones are created, and the response reports how many
   of each plus any per-row errors.

**Teams**: the template is `Team Name, Short Name`. Home ground and colour are not imported — set them with Edit on the
Teams page. You can optionally enrol the imported teams in a season from the dialog.

**Players**: the template is `Player Name, Role, Batting, Bowling, Wicketkeeper` (no team, season or captain column). In
the import dialog you pick the season and, optionally, the team — every imported player goes into that squad. Leave the
team on **Player pool only** to add players without a team and assign them later.

Squad size stays capped at 12 per team per season, enforced on import and on manual squad edits. An admin can add/remove
squad players; a team user can remove a player from their own team's squad (the player leaves the team and becomes
available to be assigned to another team), while past match scorecards remain unchanged. **Captain is not set on import**;
the team (for team users) or the admin chooses the captain later on the Squads tab.

On the Squads tab the **C** button appoints the captain: the player's row is tinted and only one captain can exist per
team, so appointing someone else removes the previous captain. The **WK** button toggles the wicketkeeper flag and shows
a WK badge on that player; a team may flag more than one wicketkeeper. Starting a match requires exactly one captain
and at least one wicketkeeper in each playing XI.

## API tour

All endpoints live under `/api` and require a session except `/api/health`, `/api/bootstrap` and `/api/auth/login`.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/seasons`, `/seasons/:id` | List / full season detail (table, squads, awards, stats). |
| `GET` | `/seasons/:id/export` | Season backup (admin). |
| `POST` | `/seasons/restore` | Restore a backup as a new season (admin). |
| `POST` | `/seasons/:id/fixtures` | Round robin, `{legs: 1..3}`. |
| `POST` | `/seasons/:id/playoffs` | `{size: 2|4|5}` or `{teamIds: [...]}`. |
| `POST` | `/matches/:id/start` | Toss + both XIs + keepers. |
| `POST` | `/matches/:id/balls` | One delivery: `{inningsId, strikerId, nonStrikerId, bowlerId, runs, extraType, extraRuns, wicket}`. |
| `DELETE` | `/matches/:id/balls/last` | Undo the last delivery. |
| `GET` | `/stats/overview?seasonId=` | Dashboard; `seasonId=all` = career. |
| `GET` | `/stats/records?seasonId=` | Record book; omitted/`all` = career. |
| `GET` | `/teams/:id/analytics?seasonId=` | Team analytics; `all` = career. |
| `GET` | `/teams/:id/seasons` | One row per season for that team. |

## Project layout

```
server/
  db.js             schema, seed, password hashing
  engine.js         delivery log replay, innings/match state, points table, awards, analytics
  auth.js           session middleware
  routes/
    auth.js         login, logout, settings, password
    seasons.js      seasons, squads, fixtures, playoffs
    matches.js      match start, openers, balls, undo
    teams.js        teams, players, squads, team credentials, team analytics
    stats.js        dashboard, leaderboards, records
    import.js       Excel templates and imports
    backup.js       season export / restore
src/
  pages/            Dashboard, Seasons, SeasonDetail, SeasonOps (tabs), Scoring, Scorecard,
                    Teams, TeamPage, Players, PlayerPage, Records, Matches, Settings, Login
  components/       ImportDialog and shared widgets
  ui.jsx            Modal, Tabs, Crest, badges and formatters
  api.js            fetch wrapper + file download helper
  styles.css        the whole design system
scripts/seed-demo.js  demo league generator
data/cricvault.db     SQLite database (created on first run) — all data lives here
backups/              .json season exports you have downloaded into the project
```

## Troubleshooting

* **"Port already in use"** — another instance is running. Stop it or `PORT=5188 npm run dev`.
* **Changes to `server/**` don't apply** — Vite hot-reloads the client only; restart the Node process.
* **Blank page after pulling new code** — run `npm install` (better-sqlite3 is a native module) and rebuild.
* **Restore says the file is not a backup** — it expects the exact JSON produced by **Export backup**; opening and
  re-saving it as text is fine, renaming to `.xlsx` is not.
* **A season cannot be deleted** — it has played matches. Correct or export it instead; the API refuses to destroy played
  history.
