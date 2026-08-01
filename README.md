# Keynest

**Property management for Airbnb hosts**: reservations, cleanings, smart locks and profitability in one self-hosted app.

> 🇪🇸 [Versión en español](README.es.md)

Keynest is a PWA + Node backend that syncs your Airbnb calendars (iCal), generates and tracks cleanings with a checklist per property, manages maintenance tasks, and computes profitability per property. Built to be self-hosted on a small Linux box (LXC, Raspberry Pi…).

## Features

- **Reservations**: automatic iCal sync from Airbnb (every 15 min + manual), calendar with check-in/check-out/stay semantics, manual amount + notes per reservation.
- **Cleanings**: created from check-outs (never on occupied dates, configurable scheduling margin), per-property **instructions + checklist**, assign up to 2 cleaners, **token links** for staff (no account needed), photos from the staff's phone, cost computed from hours × rate + supplies.
- **Maintenance**: kanban with drag & drop, categories master, editable tasks.
- **Multi-language**: full ES/EN UI, per-user language (`auto` = browser).
- **Auth**: multi-user with bcrypt sessions, password change, demo mode (one-click sample data, separate DB, toggleable).
- **Self-hosted**: single Node process + SQLite, systemd hardened service.

## Stack

React 19 + Vite + Tailwind · Hono + better-sqlite3 · react-i18next · No Docker needed.

## Development

```bash
# Backend (API + static server)
cd server
npm install
cp .env.example .env   # set AUTH_USER / AUTH_PASS
npm start

# Frontend (dev server)
cd app
npm install
npm run dev

# Tests & lint
cd server && npm test
cd app && npm run lint
```

## Deploy

Production layout: `/opt/keynest/{server,public,data}` with a hardened systemd unit (`ProtectSystem=full`, `ReadWritePaths` only for `data/`). See `.github/workflows/deploy.yml` for the automated pipeline (push to `main` → tests → build → SSH deploy).

## License

[AGPL-3.0](LICENSE)
