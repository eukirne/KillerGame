# SplitShare

A Splitwise-style expense sharing web app: create groups, add shared
expenses with flexible splitting, track who owes whom, and settle up.

## Features

- Email/password accounts (JWT auth)
- Groups (roommates, trips, etc.) and one-off friend expenses
- Split expenses **equally**, by **exact amounts**, by **percentage**, or by
  **shares** — cent-accurate, remainders distributed the same way Splitwise
  does
- Automatic balance tracking, per group and per friend — expenses in other
  currencies are converted to USD using the historical exchange rate on the
  expense's own date (not today's rate), so mixed-currency balances combine
  correctly instead of adding 1:1
- **Simplified debts**: minimal-transaction suggestions for settling up a
  group (same greedy algorithm Splitwise uses)
- Settle-up payments, expense comments, and an activity feed
- **Installable PWA**: add it to your iPhone/Android home screen for an
  app-like icon and fullscreen view (offline app-shell caching via a service
  worker; API data always comes from the network)

## Stack

Node.js/Express + Postgres on the backend, a dependency-free vanilla JS
single-page app on the frontend — no build step.

Postgres (rather than a local SQLite file) so data survives redeploys and,
on free hosting tiers, the instance spinning down between requests — see
[Deploying to Render](#deploying-to-render-free-public-url) below for why
that matters and how to get a free persistent database.

Exchange rates come from [Frankfurter](https://frankfurter.dev) (free, no API
key, ECB-backed historical rates back to 1999) and are cached in the
database by `(currency, date)` so each historical rate is only fetched once.
If the rate lookup ever fails (offline, rate-limited, unsupported currency),
balances fall back to the most recent cached rate for that currency, or 1:1
as a last resort, rather than breaking.

## Running locally

You need a Postgres database to point the app at — either a free hosted one
(see [Getting a free Postgres database](#getting-a-free-postgres-database)
below) or a local install.

```bash
cd expense-app
cp .env.example .env   # then edit DATABASE_URL to point at your database
npm install
npm start
```

The app is served at `http://localhost:3000` (set `PORT` to change it). The
database schema is created automatically on first run.

## Getting a free Postgres database

[Neon](https://neon.tech) and [Supabase](https://supabase.com) both offer a
free Postgres tier that doesn't expire and doesn't require a card:

1. Sign up (GitHub login works on both) and create a new project.
2. Copy the connection string it gives you (starts with `postgres://` or
   `postgresql://`) — on Neon it's on the project dashboard; on Supabase
   it's under Project Settings → Database → Connection string (use the
   "Connection pooling" one if offered).
3. Use that as `DATABASE_URL`, locally in `.env` and on Render (see below).

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
4. Render will prompt for the `DATABASE_URL` env var since it isn't stored
   in git — paste in your Neon/Supabase connection string from above (or
   add it afterwards under the service's **Environment** tab).
5. After the build finishes (~2-3 min) Render gives you a public URL like
   `https://splitshare-xxxx.onrender.com` — open that on your phone to sign
   up and use the app.

Why Postgres instead of a local file: Render's free instance type has no
persistent disk, and it spins down after 15 minutes idle — so anything
written to local disk (like a SQLite file) is gone the next time it wakes
up or redeploys. A hosted Postgres database keeps your data regardless of
what happens to the web service's container.

## Project layout

```
server/
  index.js          Express app entrypoint
  db/               Postgres pool + schema.sql
  routes/           auth, groups, expenses, users, settlements, activity, dashboard
  middleware/auth.js JWT auth middleware
  utils/            money math, split calculation, balance/debt-simplification logic, fx rates
public/
  index.html
  css/style.css
  js/                api client, formatting, modal, expense form, views, router
```
