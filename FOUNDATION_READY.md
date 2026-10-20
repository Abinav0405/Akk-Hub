# FOUNDATION READY — 2026-10-20 17:00 (Claude)

`npm run build` is green (Vite 5, ~32 s). The hub boots, signs in with Timesheet accounts, and routes every ported screen.

## What exists

| Area | Where | Notes |
|---|---|---|
| Entry + providers | `src/main.jsx` | QueryClient, one `LanguageProvider` (from `@/core-i18n` via `@/core/i18n`), BrowserRouter, login curtain, confirm host, toaster, native shell init |
| Routes | `src/app/AppRoutes.jsx` | public: `/`, `/login`, `/login/quick`, `/verify`, `/privacy` · signed in: `/me` `/site` `/manage` `/admin`, `/account`, `/notifications`, `/connect/:module`, all `/timesheet/*` `/materials/*` `/progress/*` |
| Route constants | `src/app/paths.js` | `paths.*`, `legacyPath('WorkerPortal')` for old page names |
| Guards | `src/app/guards.jsx` | `RequireHubRole` (server re-check each navigation, wrong role → own home) · `ModuleGate` (Material Tracker / Site Progress need their own session → inline Connect card) |
| Module screens | `src/app/modulePage.jsx` | lazy-loads `src/modules/<m>/pages/<Name>.jsx`; missing file → "being moved" placeholder, never a build break |
| Navigation | `src/app/navigation.js` | per-role tab bar (phone) + sidebar groups (desktop ≥1024 px) |
| Hub identity | `src/core/auth/identity.js` | `useIdentity()` → `{ role: worker|supervisor|manager|admin, id, name, workerType, siteId, email }`, `signOutEverywhere()` |
| Module links | `src/core/auth/bridges.js` | after a password sign-in the hub quietly signs in to Materials + Progress with the same credentials; `useModuleConnection(role, module)` |
| Sessions | `src/core/auth/{timesheetSession,materialsSession}.js`, `src/core/auth/progress/*` | all keys namespaced `akk.<module>.*` |
| Design system | `src/ui/styles/glass.css` + `src/ui/*` | tokens `--g-*`, classes `g-card g-list g-row g-tile g-btn g-chip g-badge g-banner g-segmented g-topbar g-tabbar`; shadcn primitives re-skinned |
| Hub building blocks | `src/ui/hub/*` | `TopBar`, `HubLayout` (`TabBar`, `Sidebar`), `Segmented`, `primitives` (`Heading`, `SectionLabel`, `List`, `ListRow`, `Tile`, `Stat`, `Banner`, `EmptyState`, `Field`, `PasswordField`, `LoadingScreen`) |
| Ported-code shells | `src/ui/PortalShell.jsx`, `src/ui/layout.jsx`, `src/ui/native/*`, `src/ui/useRoleGuard.js` | same export names the three apps used, drawn with the hub chrome |
| Screens | `src/pages/*` | Home (+ Verify a photo), Login (Employee / Managers / Admin, Face ID + fingerprint, server face check), Quick login, Role homes, Account, Connect, Notifications, Not found |

## Rules from here (Cursor)

- Write only in `src/modules/**`, `src/core-i18n/**`, your `*.md`, `scripts/`, `public/` additions.
- New screen styling: use `@/ui/hub/primitives` + `g-*` classes. No new colours — use `var(--g-*)` tokens / Tailwind `brand`, `ink`, `tone-*`.
- `node scripts/check-imports.mjs modules` before every build.
- Talk in `NEEDS.md`.

## Known gaps (not bugs)

- Push notifications are no-ops (`@/core/push`) until the single backend + Firebase project exist.
- Export Only / client portal is public at `/progress/client/login` → `/progress/client` (own exporter session; no hub Timesheet identity). Admin home/nav still link there for convenience.
- Supervisors only get Timesheet (no Materials / Progress mapping decided yet).
- Big screens are the legacy ports; the merged Employee / Manager / Admin hubs are the next phase.

## Integration follow-up — 2026-10-20 (Codex)

- All portal authentication uses the real per-project Supabase clients and configured environment keys. A missing Materials or Site Progress configuration is intentionally shown as an environment error rather than replaced with test data.
- A direct `/connect/materials` or `/connect/progress` link now returns a worker, manager, or admin to that role's relevant module portal after it succeeds.
- `/progress/client/login` and `/progress/client` intentionally sit outside `HubLayout` and the generic Progress `ModuleGate`. They use only the Export Only session and redirect an unauthenticated client to the public Export Only login; no Timesheet hub role is required.

## Performance follow-up — 2026-10-20 (Codex)

- Optional QR, face-recognition, PDF, spreadsheet, map and chart toolchains are no longer module-preloaded by `index.html`. They remain code-split at the feature that opens them, avoiding several megabytes of unused first-paint work.
- Employee Home now defers QR scanners, PDF export, the tutorial and biometric settings until the employee opens that feature. Standard employee sign-in no longer downloads face-recognition models unless Face ID is actually required.
- Background route prefetching is skipped on phone layouts, Data Saver/2G connections and low-memory devices; pending prefetch work is cancelled when the hub shell unmounts.
