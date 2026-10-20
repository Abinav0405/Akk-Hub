# CURSOR PROMPT — AKK Hub (paste everything below into Cursor)

You are one of two AI engineers building **AKK Hub**, a single front-end-only React app that merges four existing AKK Engineering apps. The other engineer (Claude Code) owns the architecture and all big/complex screens. **You own the mechanical, repetitive and small work listed in your lanes.** Work in parallel: if Cursor supports multiple/background agents, run **one agent per lane**, each on its own git worktree/branch named `cursor/<lane>`.

## 0. Ground rules (read twice)

1. Target folder: `C:\Users\Arumugam Abinav\OneDrive\Desktop\Abinav\Work\Websites final\Akk Hub`. Run `git init` there first if it is not a repo, and make an initial commit.
2. Source apps are **read-only references**. Never edit, move or delete anything in them:
   - Timesheet: `..\AKK-Timesheet-Manager-main\src`
   - Materials: `..\AKK-Material-Tracker-main\src`
   - Progress: `..\Site progress tracker\src`
   - Camera (Flutter, do not port): `..\AKK Camera App`
   - Marketing site (do not port): `..\AKK-Main-webpage-main`
3. **Never copy or open** `.env`, `.env.*`, `*.json` Firebase admin files, `keystore`, `fcm-secrets.env`, `google-services.json`, `android/` folders, `node_modules`, `dist`. Never print or commit secrets. Do not touch the backend or any `supabase/` folder.
4. **File ownership.** Only create/edit files inside your lane's folders. You must NOT edit: `package.json`, `vite.config.js`, `tailwind.config.js`, `index.html`, anything in `src/app/`, `src/core/`, `src/ui/`, `src/pages/`, or any `*Hub*.jsx`. If you need a dependency, a shared component, or a new route, append a line to `Akk Hub/NEEDS.md` (`- [lane] need: ...`) and move on. Claude Code reads that file.
5. Stack (already decided): React 18, Vite 5, Tailwind 3, Radix/shadcn, React Router v6, TanStack Query, supabase-js v2, framer-motion, Capacitor 8. JavaScript/JSX (no TypeScript conversion). Path alias `@/` = `src/`.
6. Keep behaviour identical to the source. You are moving and re-wiring code, not redesigning it. Do not "improve" business logic (payroll, CPF, shift hours, inventory, hashes, Code128, etc.).
7. Prefer small commits per file group: `lane-x: <what>`.

## 1. Target structure (fixed — do not invent your own)

```
src/
  app/            (Claude) router, providers, shell, paths.js
  core/           (Claude) auth, roles, module registry, supabase clients
  ui/             (Claude) glass design system + shared primitives
  pages/          (Claude) Home, Login, Verify, Account, role hubs
  modules/
    timesheet/    lib/  components/  pages/
    materials/    lib/  components/  pages/
    progress/     lib/  components/  pages/
```

Shared imports you may rely on (Claude creates them; assume they exist):
- `import { supabaseTimesheet, supabaseMaterials, supabaseProgress } from '@/core/supabase'`
- `import { paths } from '@/app/paths'` — central route constants. Until it exists, use the literal paths in section 2.
- `import { storageKey } from '@/core/storage'` → `storageKey('timesheet', 'workerId')` returns `"akk.timesheet.workerId"`.
- Shared UI primitives from `@/ui/*` (Button, Card, Dialog, Input, Select, Tabs, Textarea, Badge, Table, Label, Separator). Replace each module's local `Components/ui/*` imports with these.

## 2. Route map (literal paths to use when rewriting navigation)

```
/                  /login          /account       /notifications   /verify
/timesheet/clock /timesheet/shifts /timesheet/leave /timesheet/leave/history /timesheet/payslips
/timesheet/timesheets /timesheet/forms /timesheet/forms/:id /timesheet/vehicles/scan
/timesheet/site-shifts /timesheet/manage /timesheet/admin /timesheet/admin/analytics
/timesheet/admin/attendance /timesheet/admin/announcements /timesheet/admin/forms
/timesheet/admin/forms/:id /timesheet/admin/company-forms
/materials/request /materials/history /materials/manage /materials/admin
/progress/submit /progress/submissions /progress/camera /progress/review /progress/admin /progress/client
```
Old → new examples: `/WorkerPortal` → `/timesheet/clock`, `/LeaveHistory` → `/timesheet/leave/history`, `/RequestPortal` → `/materials/request`, `/SubmitProgress` → `/progress/submit`, `/PhotoVerification` → `/verify`, `/AdminLogin` `/ManagerLogin` `/WorkerLogin` `/SupervisorLogin` `/ExporterLogin` → `/login`.

## 3. Mechanical rewrite rules (apply in every file you move)

- Supabase: replace each app's `supabase.js` / `supbase.js` / `lib/supabase.js` import with the matching named client from `@/core/supabase`.
- Storage: every `localStorage` / `sessionStorage` key (e.g. `workerLoggedIn`, `adminLoggedIn`, `managerEmail`, `adminName`, session tokens, theme, language, welcome/tour flags) becomes `storageKey('<module>', '<oldKey>')`. Keep a list of renamed keys per module in `Akk Hub/MIGRATION_NOTES.md`.
- Navigation: replace `navigate('/Old')`, `<Link to=...>`, `createPageUrl(...)`, `window.location` redirects with `paths.*` or the literals in section 2. Login redirects always go to `/login`.
- Remove `HashRouter/BrowserRouter` creation, splash/bootstrapping and role-login pages from moved files — Claude owns those. Leave a `// TODO(claude):` comment where a removed piece needed a replacement.
- Keep file/export names. Add each module's public exports to `modules/<m>/index.js`.
- No dead code removal beyond what is required to compile.

## 4. Lanes

### Wave 1 — start immediately (no dependency on Claude's foundation)

**Lane T-LIB (timesheet lib)** → `src/modules/timesheet/lib/`
Port all of `Timesheet/src/lib/**` (incl. `companyForms/`) **except** `authSession.js`, `biometricAuth.js`, `faceRecognition.js`, `faceMesh.js`, `workerFaceLogin.js`, `permissionManager.js`, `firstBootPermissions.js`, `platform.js`, `nativeShell.js` (Claude owns those). Apply section 3. Also port `Timesheet/src/Components/payroll/*`, `companyForms/*`, `LeaveCalendar.jsx`, `DriverStatusCard.jsx`, `VehicleJourneyDetail.jsx`, `VehicleLiveMap.jsx`, `QRScanner.jsx`, `VehicleQRScanner.jsx`, `LiveQrCamera.jsx`, `ScanSuccessOverlay.jsx`, `ScanFailureOverlay.jsx`, `ShiftApprovalActions.jsx` to `src/modules/timesheet/components/`.

**Lane M-LIB (materials)** → `src/modules/materials/`
Port all of `Materials/src/lib/**` (except `auth.js`, `nativeBootstrap.js`, `platform.js`, `pushNotifications.js`, `appReady.js`), `Entities/*.json`, and components `MaterialForm.jsx`, `MaterialInput.jsx`, `MaterialsManager.jsx`, `RequestersManager.jsx`, `SitesManager.jsx`, `ManagersManager.jsx`, `AdminAnalytics.jsx`, `mobile/NativeTxCard.jsx`, `mobile/NativeFilterBar.jsx` into `components/`. Apply section 3.

**Lane P-LIB (progress)** → `src/modules/progress/`
Port all of `Progress/src/lib/**` (except `adminSession.js`, `authSession.js`, `exporterSession.js`, `managerSession.js`, `portalAuth.js`, `nativeBootstrap.js`, `nativeBack.js`, `platform.js`, `pushNotifications.js`), the `hooks/` folder, and components: everything in `Components/jsr/`, `PackageReviewBoard`, `PackageDetailDialog`, `PackageProgressBar`, `PackageSuggestionsPanel`, `PrintPackageDialog`, `ExcelExportDialog`, `MultiExportDialog`, `SummaryExportDialog`, `ExportFileNameField`, `ExportOnlyAdminPanel`, `SortablePhotoGrid`, `PhotoLightbox`, `LivePhotoOverlays`, `WorkerSubmissionPhotos`, `CompletionSlider`, `DeclineReasonDialog`, `DocumentAuditTrail`, `EndorsementDialog`, `EndorsementPreview`, `SignatureOrSealPad`, `SuggestInput`, `SearchField`, `SuccessTick`, `ErrorBoundary`, `BrandingPanel`, `AnalyticsPanel`, `SitesPanel`, `UsersAccessPanel`, `StaffAccountsPanel`, `WorkerAccountsPanel`, `JsrPermissionGrid`, `NotificationBell`, `CameraCapture`, `MoreMenu`. Apply section 3.

**Lane ASSETS** → `public/` and `src/assets/`
Copy logos (`Akk new logo.png`, `logo.png`, `akk logo (1).ico`, `AKK_logo_straight_transparent.png`, `AKK_Site_Progress_Tracker_logo.png`), face-api model files used by Timesheet (check its `public/`), and any fonts/images referenced by the three apps' `public/`. Write `Akk Hub/ASSETS.md` listing what came from where. No `.env`, no Android files.

### Wave 2 — start when `Akk Hub/FOUNDATION_READY.md` exists (Claude creates it)

**Lane UI-SWAP** — in all `modules/*/` code you moved: delete the duplicated local `ui/*` imports and import from `@/ui/*`; fix prop differences minimally; run `npm run build` until clean.

**Lane SMALL-PAGES** → `src/modules/<m>/pages/` (keep each page as a thin wrapper that renders the original logic; no redesign):
Timesheet: `LegalNotice`, `AdminAnnouncements`, `AdminForms`, `AdminFormDetail`, `WorkerFormFill`, `WorkerSubmittedForms`, `WorkerCompanyForms`, `WorkerCompanyFormFill`, `WorkerCompanyFormHistory`, `LeaveHistory`, `ShiftHistory`, `WorkerTimesheets`, `Analytics`, `AttendanceReport`, `ManagerTimesheets`, `AdminCompanyForms`.
Materials: `RequestHistory`, `History`.
Progress: `MySubmissions`, `MyAccount` (becomes `/account` section), `PhotoVerification` (becomes `/verify`).
Export each as a default component and register nothing in the router (Claude wires routes). Note in `NEEDS.md` anything that needs shell context.

**Lane I18N-THEME** → port `Timesheet/src/lib/i18n.js` + `LanguageSwitcher.jsx` to `src/core-i18n/` (new folder you own; Claude will mount it). Extract hard-coded English strings for Home/Login/Account/nav labels into the translation file (keys prefixed `hub.`).

**Lane QA-BUILD** — after the above: `npm run build`, `npm run lint` (if configured); fix **only** import/path/key errors inside your own folders. Write `Akk Hub/QA_CHECKLIST.md`: one line per route in section 2 (what to click, expected result).

### Wave 3 — after Claude says "polish"

**Lane MOBILE-POLISH** — for pages Claude marks `mobile: needs-polish` in `NEEDS.md`: apply Tailwind-only responsive fixes (stack columns <640px, 44px tap targets, sticky action bars, horizontal-scroll tables with sticky first column, `safe-area` padding). No structural redesign.

**Lane CAPACITOR-DOCS** — write `Akk Hub/ANDROID_NOTES.md` summarising permissions the three Android apps declare (camera, location, notifications, biometric, storage) by reading their `AndroidManifest.xml`. Do not copy the android folders.

## 5. Definition of done (per lane)

- All files for your lane exist at the target paths; nothing left in old import styles (`rg "supabase.js|supbase|createPageUrl|localStorage\.(get|set)Item\('(?!akk)"` returns only intentional hits).
- `npm run build` has no errors originating in your files.
- A short report as the last commit message body: files moved, keys renamed, TODOs, items added to `NEEDS.md`.
- You touched nothing outside your lane's folders.

## 6. If unsure

Don't guess about auth, routing, layout or database behaviour — write a `NEEDS.md` line and continue with the next file.
