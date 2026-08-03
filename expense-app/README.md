# SplitShare

A Splitwise-style expense sharing web app: create groups, add shared
expenses with flexible splitting, track who owes whom, and settle up.

## Features

- Email/password accounts (JWT auth)
- Groups (roommates, trips, etc.) and one-off friend expenses
- Split expenses **equally**, by **exact amounts**, by **percentage**, or by
  **shares** — cent-accurate, remainders distributed the same way Splitwise
  does
- Automatic balance tracking, per group and per friend
- **Simplified debts**: minimal-transaction suggestions for settling up a
  group (same greedy algorithm Splitwise uses)
- Settle-up payments, expense comments, and an activity feed

## Stack

Plain Node.js/Express + SQLite (`better-sqlite3`) on the backend, a
dependency-free vanilla JS single-page app on the frontend — no build step.

## Running locally

```bash
cd expense-app
npm install
npm start
```

The app is served at `http://localhost:3000` (set `PORT` to change it). The
SQLite database file is created automatically at `server/db/splitshare.db`
on first run.

## Deploying to Render (free, public URL)

A `render.yaml` Blueprint lives at the repo root, so Render can deploy the
`expense-app/` service straight from GitHub:

1. Sign in at [dashboard.render.com](https://dashboard.render.com) (GitHub
   login works).
2. **New +** → **Blueprint** → connect the `eukirne/KillerGame` repo → pick
   the branch you want deployed (e.g. `claude/expense-sharing-app-5ih1n5`,
   or `main` once merged).
3. Render finds `render.yaml` and provisions a free web service named
   `splitshare` (build: `npm install`, start: `npm start`, `JWT_SECRET`
   auto-generated). Click **Apply**.
4. After the build finishes (~2-3 min) Render gives you a public URL like
   `https://splitshare-xxxx.onrender.com` — open that on your phone to sign
   up and use the app.

Notes on the free plan: the service spins down after 15 minutes idle (the
next request takes ~30s to wake it back up), and there's no persistent
disk, so the SQLite database resets on every redeploy/restart. Fine for
trying the app out; for real persistent use, upgrade to a paid instance
type and add a disk (mount it at e.g. `/var/data` and set `DB_PATH` to a
file under it).

## Project layout

```
server/
  index.js          Express app entrypoint
  db/               SQLite connection + schema.sql
  routes/           auth, groups, expenses, users, settlements, activity, dashboard
  middleware/auth.js JWT auth middleware
  utils/            money math, split calculation, balance/debt-simplification logic
public/
  index.html
  css/style.css
  js/                api client, formatting, modal, expense form, views, router
```
