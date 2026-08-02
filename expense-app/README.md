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
