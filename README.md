# AKK Hub

One front-end React app that merges **Timesheet Manager**, **Material Tracker**, and **Site Progress Tracker** (plus a first-class **Client / Export Only** portal) into a single product shell.

**Repo:** [https://github.com/Abinav0405/Akk-Hub.git](https://github.com/Abinav0405/Akk-Hub.git)  
**Package:** `akk-hub` · Capacitor app id `sg.akk.hub`

---

## What it is

AKK Hub is a **Vite + React** SPA (JavaScript/JSX, no TypeScript conversion) with:

- One branded home and unified login (Employee · Management · Admin · Client)
- Role homes (`/me`, `/site`, `/manage`, `/admin`) and task-based nav (not three separate app names)
- Lazy-loaded module screens under `/timesheet/*`, `/materials/*`, `/progress/*`
- Interim **three Supabase clients** (one per legacy project) until a future single-backend merge
- Capacitor 8 for Android (`android/` scaffold; permissions still being unified)

**Out of scope (do not port):** Flutter **AKK Camera App**, marketing site **AKK-Main-webpage-main**. Source apps under sibling folders are **read-only references**.

---

## Stack

| Layer | Choice |
|--------|--------|
| UI | React 18, Vite 5, Tailwind 3, Radix/shadcn, Framer Motion |
| Routing | React Router v6 · path alias `@/` → `src/` |
| Data | TanStack Query · supabase-js v2 |
| Mobile | Capacitor 8 (Android first) |
| Design | Glass tokens `--g-*`, classes `g-card`, `g-btn`, hub primitives in `@/ui/hub/*` |

---

## Quick start

```bash
cd "Akk Hub"
cp .env.example .env   # fill VITE_* keys (see Environment)
npm install
npm run dev            # http://localhost:5190 — do not start a second server
```

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite on **port 5190** |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build |
| `npm run build:android` | `vite build` + `npx cap sync android` |
| `npm run open:android` | Open Android Studio project |

Import sanity (modules): `node scripts/check-imports.mjs modules`  
(Ignore known false positives from object literals in a few libs.)

**QA preview flags:** `?app=1` forces app-style home in the browser. Dev mock helpers exist in `src/core/devMock.js` — **production / real QA must keep mock OFF** (real `@/core/supabase` + `.env` keys).

---

## Environment

Copy `.env.example` → `.env`. All `VITE_*` values are **public** (bundled into the browser). Never put `service_role` keys or Firebase admin JSON in the repo.

| Variable | Role |
|----------|------|
| `VITE_TIMESHEET_SUPABASE_URL` / `_ANON_KEY` | Hub sign-in + Timesheet module |
| `VITE_MATERIALS_SUPABASE_URL` / `_ANON_KEY` | Material Tracker project |
| `VITE_PROGRESS_SUPABASE_URL` / `_ANON_KEY` | Site Progress (+ shared with Camera) |
| `VITE_ADMIN_EMAIL_ALLOWLIST` | Optional Timesheet admin email allowlist |
| `VITE_ADMIN_DELETE_PIN` | Admin delete UX friction (not a real secret) |
| `VITE_PUSH_REGISTER_SECRET` / `VITE_ENABLE_FCM_REGISTER` | Optional push registration |

Local QA passwords live in **`.env.qa.local`** (gitignored). Never commit or paste them into docs/chat.

Missing Materials or Progress env is shown as a configuration error — not replaced with fake data.

---

## Architecture

```
src/
  main.jsx          Entry: QueryClient, i18n, Router, shell init
  app/              Router, guards, paths, navigation, useHubSection
  core/             Auth, identity, bridges, supabase clients, native, push
  core-i18n/        Translation dictionary (`hub.*` keys)
  ui/               Glass design system + shared primitives + hub chrome
  pages/            Home, Login, Account, role hubs, Connect, Client portal
  modules/
    timesheet/      lib/  components/  pages/
    materials/      …
    progress/       …
```

**Clients:** `supabaseTimesheet`, `supabaseMaterials`, `supabaseProgress` from `@/core/supabase`.  
**Storage:** `storageKey(module, key)` → `akk.<module>.<key>` (hub keys under `akk.hub.*`).  
**Guards:** `RequireHubRole` (server re-check per navigation) · `ModuleGate` (Materials / Progress need their own linked session → Connect card).  
**Deep links:** sidebar/nav uses `?section=` with `useHubSection` on module dashboards.

### Auth & roles

| Hub role | Home | Typical modules |
|----------|------|-----------------|
| Worker / employee | `/me` | Timesheet clock & forms; Materials request; Progress submit (after connect) |
| Supervisor | `/site` | Timesheet site-shifts only (no Materials/Progress mapping yet) |
| Manager | `/manage` | Timesheet manage · Materials manage · Progress review |
| Admin | `/admin` | Full admin surfaces across modules |
| Client / exporter | `/progress/client` | **Outside** hub layout — own Export Only session |

After Timesheet hub login, the shell quietly tries to bridge into Materials + Progress with the same credentials (`bridges.js`). If that fails, use `/connect/materials` or `/connect/progress` (supports `?as=admin|manager|worker`). Sign-out is hub-owned at `/account` (`signOutEverywhere`).

### Client portal

- Public: `/progress/client/login` → `/progress/client`
- Tabs: Packages · Reports · Account (`?tab=reports|account`)
- No Timesheet hub identity required; unauthenticated users redirect to client login
- Legacy `ExporterLogin` / `ExporterDashboard` module pages remain in tree but are **unrouted** (superseded)

### Feature surface (parity snapshot)

Core business features from all three legacy apps are present: clock/leave/payslips/vehicles, materials take-return/approvals/CRUD, progress packages/JSR/exports/client. Intentional Hub deltas: unified chrome, merged `/me`, no per-module logout, no dark-mode FAB.

**Known gaps / constraints**

- Materials / Progress still need a one-time **connect** per device until backend identity merge
- QA Timesheet worker ID may not equal Materials requester ID (data, not a missing screen)
- Supervisor E2E needs `QA_SUPERVISOR_ID` in `.env.qa.local`
- Push (`@/core/push`) is largely a no-op until one Firebase/backend project exists
- Materials legacy `DatabaseSetup` UI not ported (low priority if DB already provisioned)
- Some large admin screens still need further split/paging for phone perf

---

## Routes (essentials)

| Area | Paths |
|------|--------|
| Public | `/` `/login` `/login/quick` `/verify` `/privacy` |
| Hubs | `/me` `/site` `/manage` `/admin` `/account` `/notifications` `/connect/:module` |
| Timesheet | `/timesheet/shifts` `leave/history` `timesheets` `forms` `company-forms*` `site-shifts` `manage*` `admin*` — legacy `clock` / `payslips` / `vehicles/scan` → `/me` |
| Materials | `/materials/request` `history` `manage` `admin` `log` |
| Progress | `/progress/home` `submit` `camera` `submissions` `review` `admin` `account` |
| Client | `/progress/client/login` `/progress/client` |

Canonical constants: `src/app/paths.js` (`paths.*`, `legacyPath(...)`).

---

## Agent ownership (Claude ↔ Cursor)

Live work board: **[`NEEDS.md`](./NEEDS.md)** — the only Cursor ↔ Claude (or Codex stand-in) message channel. **Do not delete it.** Dated status blocks and orders go there.

| Owner | Owns |
|--------|------|
| **Claude** (architecture / shell) | `src/main.jsx`, `src/app/**`, `src/core/**`, `src/ui/**`, `src/pages/**`, Vite/Tailwind/`package.json` when foundation requires it |
| **Cursor** (mechanical / modules) | `src/modules/**`, `src/core-i18n/**`, `public/` asset additions, module scripts under `scripts/` |

**Ground rules**

1. Source apps are read-only; never edit sibling project trees.
2. Never commit secrets (`.env`, keystores, `google-services.json`, Firebase admin JSON, `fcm-secrets.env`).
3. Cursor must not invent routes/auth/layout — request via `NEEDS.md` instead.
4. Prefer behaviour parity with legacy apps; do not “improve” payroll, CPF, inventory hashes, Code128, etc. without an explicit product ask.
5. Same checkout, parallel agents: stay in your lane; communicate only through `NEEDS.md`.

**Import map (Claude-owned auth → use these from modules)**

| Concern | Import from |
|---------|-------------|
| Timesheet session / biometric / face | `@/core/auth/timesheetSession`, `biometric`, `faceRecognition`, … |
| Materials session | `@/core/auth/materialsSession` |
| Progress worker/manager/admin/exporter | `@/core/auth/progress/*` |
| Platform / native / push | `@/core/platform`, `@/core/nativeShell`, `@/core/push` |
| i18n dictionary | `@/core-i18n` (`@/core/i18n` re-exports) |
| UI primitives | `@/ui/*` (not per-module `Components/ui`) |

---

## Android / Capacitor

- Config: `capacitor.config.json` · `webDir: dist` · app id `sg.akk.hub`
- Scaffold: `android/` (sync with `npm run build:android`)
- Union of legacy permissions (target for a single APK): camera, biometric, fine/coarse location, notifications, storage/gallery (Progress), internet; **no** vehicle-journey foreground service (Timesheet keeps driving GPS web-only)
- FCM channel ids historically differed (`akk_updates` vs `spt_updates`) — pick one hub channel before production push
- Push Capacitor patch from Timesheet (`@capacitor/push-notifications`) should be re-applied when FCM is wired

---

## Assets

Logos and face-api models live under `public/` (and some under `src/assets/`). Prefer URL-safe brand paths:

- `/Akk-logo.jpg` / `/Akk-logo.png` — Timesheet/Materials defaults
- `/akk-logo-progress.png` or `/brand/akk-logo-spt.png` — Progress (avoid Windows case clash with `Akk-logo.png`)
- `/models/*` — face-api local fallback
- Favicons / apple-touch icons linked from `index.html`

---

## Backend roadmap (high level)

**Today (Stage 1):** one shell, three Supabase projects, connect/bridge for Materials & Progress.

**Target:** new single Supabase project with schemas `core` + `timesheet` / `materials` / `progress`, one people list, one sites list, one push pipeline. Migrate module-by-module later; Camera Flutter stays a companion until a deliberate Stage 4 decision.

Hosting pattern for the web apps historically: Cloudflare Pages. Play Store: one listing (`sg.akk.hub` / eventual `sg.akk.one`).

---

## Security & repo hygiene

- `.gitignore` excludes `.env*`, `qa-shots/`, Android build/sync artifacts, keystores, `google-services.json`
- Dist builds must not ship secrets or source maps with credentials
- Treat admin delete PIN and allowlists as UX/defence-in-depth only

---

## Contributing locally

1. Read **`NEEDS.md`** for current stop/go and lane orders.
2. Work only in your ownership paths (table above).
3. Keep `npm run build` green; fix import/path issues in your own folders first.
4. For authenticated smoke: one Vite on `:5190`, mock OFF, real QA accounts from `.env.qa.local`.

Questions about product direction or backend merge belong with the project owner (Abinav); agent coordination stays in `NEEDS.md`.
