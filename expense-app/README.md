# SplitShare

A Splitwise-style expense sharing web app: create groups, add shared
expenses with flexible splitting, track who owes whom, and settle up.

## Features

- Sign up with a **username plus email and/or phone** (any combination, as
  long as you provide at least one contact method), or **Sign in with
  Google**. Log in, search for people, and send friend requests using
  whichever identifier you have — username, email, or phone
- Groups (roommates, trips, etc.) and one-off friend expenses. Edit a
  group's name, type, or currency at any time from the group page
- A group can optionally set its own **currency**, overriding every
  member's personal default for that group specifically — useful for a
  shared trip so everyone sees the same numbers instead of their own
  converted view
- **Friend requests**: adding a friend sends a request they have to accept
  (with a badge/notification on the Friends tab); group invites pick from
  your accepted friends instead of typing emails. Sharing a group or a
  direct expense still friends people instantly, since that context is
  already mutual
- Split expenses **equally**, by **exact amounts**, by **percentage**, or by
  **shares** — cent-accurate, remainders distributed the same way Splitwise
  does
- **Settings**: set your default currency and update your username, email,
  or phone at any time (each checked for uniqueness across the system)
- Automatic balance tracking, per group and per friend — converted to
  *your own* default currency (or the group's currency, if it set one)
  using the historical exchange rate on each expense's date, so two people
  can view the very same shared debt in their own preferred currencies, and
  mixed-currency balances combine correctly instead of adding 1:1. Each
  group's Expenses tab shows your running balance for that group at a glance
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

## Enabling Google sign-in (optional)

Without this, the app works fine with email/password only — the "Continue
with Google" button just doesn't render.

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create a project (or use an existing one).
2. **APIs & Services → OAuth consent screen**: set it up as **External**,
   fill in the required fields (app name, support email). No verification
   is needed for testing with your own Google account.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   → application type **Web application**.
4. Under **Authorized JavaScript origins**, add every origin you'll load the
   app from, e.g. `http://localhost:3000` and `https://splitshare-xxxx.onrender.com`.
   No redirect URIs are needed — this uses Google's One Tap/button flow, not
   a redirect.
5. Copy the generated **Client ID** (ends in `.apps.googleusercontent.com`)
   and set it as `GOOGLE_CLIENT_ID`, locally in `.env` and on Render (see
   below). It's a public identifier, not a secret.

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
4. Render will prompt for the `DATABASE_URL` (and, optionally, `GOOGLE_CLIENT_ID`)
   env vars since they aren't stored in git — paste in your Neon/Supabase
   connection string from above (or add them afterwards under the service's
   **Environment** tab → **Edit**).
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
