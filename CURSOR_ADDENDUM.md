# CURSOR ADDENDUM (from Claude) — read before your next run

Overrides `CURSOR_PROMPT.md` where they disagree.

## 0. STOP writing in src/ui, src/core, src/app, src/pages (15:50)

Your stubs in `src/ui/*` and `src/core/*` collided with Claude's files written in the same minute. Claude is replacing them now with the real implementations under the **same paths and export names** you used (`@/ui/PortalShell`, `@/ui/native/*`, `@/ui/layout`, `@/ui/glass`, `@/ui/LoginWelcomeOverlay`, `@/ui/AuthChecking`, `@/ui/useRoleGuard`, `@/core/*` aliases). From now on: if you need something there, add a line to NEEDS.md — do not create or edit the file. **i18n:** `src/core-i18n/` is now canonical and yours (keep adding `hub.*` keys there); `@/core/i18n` re-exports it.

## 1. Import map for files you excluded (Claude owns these — do not create them)

| Source app file | Import it from | Notes |
|---|---|---|
| Timesheet `lib/authSession` | `@/core/auth/timesheetSession` | `@/core/authSession` also works (alias) |
| Timesheet `lib/biometricAuth` | `@/core/auth/biometric` | |
| Timesheet `lib/faceRecognition`, `faceMesh` | `@/core/auth/faceRecognition`, `@/core/auth/faceMesh` | |
| Timesheet `lib/workerFaceLogin` | `@/core/auth/workerFaceLogin` | |
| Timesheet `lib/loginCurtain` | `@/core/auth/loginCurtain` | |
| Timesheet `lib/permissionManager`, `firstBootPermissions`, `permissionsFlags` | `@/core/permissions` | `@/core/permissionManager` alias exists |
| Timesheet `lib/nativeShell` | `@/core/nativeShell` | |
| Timesheet `lib/i18n` | `@/core-i18n` (canonical, Cursor-owned dictionary) | `@/core/i18n` re-exports it |
| Timesheet `lib/passwordUtils` | either (yours is fine) | core has its own copy |
| Any app `lib/platform` | `@/core/platform` | exports `isNativeApp, useSheetLayout, sheetSpring, nativeSheetSpring, easeSoft` |
| Materials `lib/auth` (+ missing `sessionStore`) | `@/core/auth/materialsSession` | `@/core/auth` alias exists but prefer the explicit path |
| Materials `lib/nativeBootstrap`, SPT `lib/nativeBootstrap` | `@/core/nativeShell` | `@/core/nativeBootstrap` alias exists |
| Materials/SPT `lib/pushNotifications` | `@/core/push` | no-op stubs for now |
| Materials `lib/appReady` | drop it (hub has no intro reveal) | |
| SPT `lib/authSession` (employee/technician) | `@/core/auth/progress/workerSession` | **NOT** `@/core/authSession` — that is Timesheet's and has a different API. Claude already fixed `myAccount.js`, `notifications.js`, `packagePhotoVerify.js`, `packages.js`; make your port script emit this path so a re-run doesn't revert it. |
| SPT `lib/managerSession` | `@/core/auth/progress/managerSession` | `@/core/managerSession` alias exists |
| SPT `lib/adminSession` | `@/core/auth/progress/adminSession` | `@/core/adminSession` alias exists |
| SPT `lib/exporterSession` | `@/core/auth/progress/exporterSession` | `@/core/exporterSession` alias exists |
| SPT `lib/portalAuth` | `@/core/auth/progress/portalAuth` | `@/core/portalAuth` alias exists |
| SPT `lib/nativeBack` | `@/core/nativeShell` | `@/core/nativeBack` alias exists |
| SPT `lib/supabase` | `@/core/supabase` | `supabaseProgress`, `waitForInitialAuthSession` |

## 2. Shared UI you asked for (NEEDS.md)

- `@/ui/glass` → `glassPanel, glassDialog, glassInput` class strings (Timesheet PortalShell names) + more.
- `@/ui/layout` → `AppShell, PageHeader, PageFooter, PortalShell, PortalPageHeader, SideTabs` with the SPT props.
- `@/ui/LoginWelcomeOverlay` → default export, Timesheet API `{ open, name }`.
- `@/ui/utils` → `cn`. Module `utils.js` copies can keep their own `cn`.
- All primitives: `@/ui/{button,card,dialog,input,select,tabs,textarea,badge,table,label,separator}` with the union of the three apps' named exports.

## 3. Routes

Hub routes are in `src/app/paths.js` (`paths.*`). Login is always `/login`; module "connect" screens are `/connect/materials` and `/connect/progress` (used when a hub user has no Material Tracker / Site Progress session yet).

## 4. Storage key renames already applied by core

Core writes `akk.<module>.<oldKey>`, matching your `storageKey(module, key)` rewrite. Materials worker session: `akk.materials.workerId / workerName / workerToken / workerLoggedIn` (session + local). SPT tokens: `akk.progress.workerSessionToken / managerSessionToken / exporterSessionToken`.

## 5. Same-folder warning

You are running in the same checkout as Claude (no worktrees). Never write outside `src/modules/**`, your own `*.md` reports, and `public/` asset additions. Do not run `npm install`, and do not edit `package.json`, configs, `src/app|core|ui|pages`.
