# AKK One — Super-App Audit & Staged Plan

Planning only. Nothing has been built or changed in any of the four apps.
Sources: package.json, routes (`main.jsx`), dashboards, migrations, FEATURES.md / PROJECT_PLAN.md / SYSTEM_ANALYSIS.md / BACKEND FROM SCRATCH.md / jsr-module-design.md / BUGS.md, `.env` project URLs (keys not read).

---

## PART A — DECISIONS

### A1. Name
**AKK One** — one app, one login, every tool. (Alternatives: AKK Hub, AKK Works.)
Package id suggestion when the time comes: `sg.akk.one`. Web: `app.akk.sg` (marketing site stays at `akk.sg`).

### A2. Stack (recommendation: keep what you already have)
All three web apps are already the same stack, so the super-app is a *merge*, not a rewrite.

| Layer | Choice | Why |
|---|---|---|
| UI | React 18 + Vite 5 + Tailwind 3 + Radix/shadcn | Identical in all 3 web apps |
| Routing | React Router v6, nested, lazy-loaded per module | Already used; timesheet already uses `LazyRoute` |
| Data fetching | TanStack Query + supabase-js | Already in Timesheet/Material |
| Mobile | Capacitor 8 (Android first) | All 3 web apps already wrap with it; one APK |
| Repo | Monorepo (pnpm workspaces + Turborepo): `apps/web`, `packages/ui`, `packages/auth`, `packages/modules/{timesheet,materials,progress,camera}` | Shared UI/auth, modules stay isolated |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) | Already used everywhere; see A3 |
| Push | One Firebase project + one `register-device-token` / `fcm-db-webhook` pair | Today there are 3 Firebase projects |
| Hosting | Cloudflare Pages (already used for Timesheet + SPT) | One site, one domain |
| Camera | **Flutter app stays separate for now** (Stage 4 decides) | See A4 |

Do NOT rewrite in Next.js / React Native / Flutter: it throws away ~3 production apps for no user-visible gain.

### A3. Backend (the hard part)
Current reality:

| App | Supabase project | Supabase org | Firebase project |
|---|---|---|---|
| Timesheet Manager | "AKK Worker Timesheet" (A) | Org 1 | timesheet-manager-ad77a |
| Material Tracker | separate project (B) | Org 1 | material-tracker-520f1 |
| Site Progress Tracker | project (C) | Org 2 | site-progress-tracker-3a44c |
| AKK Camera (Flutter) | same project (C) | Org 2 | — |

Three options:

| Option | What | Verdict |
|---|---|---|
| 1. Keep 3 projects, super-app holds 3 Supabase clients | Fastest, zero data migration. Still 3 logins, no cross-module data, 3 Firebase setups | OK only as a **temporary Stage 1** |
| 2. Merge into one existing project | Cheaper but inherits that project's quirks; table-name collisions | No |
| 3. **New single "AKK One" Supabase project, one Postgres schema per module** (`timesheet`, `materials`, `progress`, `core`) | One identity, one sites list, one push pipeline, cross-module reports possible | **Recommended end state** |

Org split is a non-issue if we use option 3 (new project in whichever org you choose; org choice only affects billing/team access). Supabase can also transfer projects between orgs if ever needed.

Why not just mash tables together: collisions exist today — `sites` (3 different shapes: Timesheet has GPS+QR token, Material is plain, SPT has section labels), `managers`/`supervisors`/`requesters`/`app_users`/`manager_users`/`staff_profiles` (5+ user stores), `admin_status`, `device_push_tokens`, `role_sessions`, `login_attempts`, `document_titles`. Schemas-per-module + a `core` schema for shared things avoids this.

**`core` schema (new, shared):**
- `people` — one row per human (employee code, name, phone, active) → replaces duplicated worker/requester/app_user rows (Timesheet worker `1001` = Material requester `1001` = SPT employee code).
- `auth` link — each person gets a Supabase Auth user (workers use synthetic email `<code>@akk.local` + password, or a custom-JWT edge function; admins/managers use real email).
- `roles` / `module_access` — person × module × role (e.g. `1001: timesheet=worker, materials=requester, progress=technician`). This drives the Home screen.
- `sites` — one master site list (id, name, GPS, QR token, section label, active) that modules reference.
- `device_tokens`, `notifications`, `company_branding`, `audit_log`.

**Identity model (target):** one login → one session → Home shows only the modules that person has access to. Roles per module are kept (don't flatten them): worker / supervisor / manager / admin / exporter(client).

**Security debts to fix before/during migration (found in repo docs):**
- Material Tracker: plaintext `password_hash`, RLS `USING (true)` on some tables, admin flag only in `sessionStorage` (BUGS.md; later migrations partly lock it down — verify live).
- Timesheet: history of plaintext/bcrypt flip-flops in migrations; verify live state.
- Secrets sitting in the project folder / OneDrive: Firebase admin-SDK JSON ×3, `keystore`, `fcm-secrets.env`, `.env` files. Move out of OneDrive, rotate before the merge, never commit. Anything `service_role` must stay server-side only.

### A4. Camera app
- It is a **Flutter** app (Android only) — the only non-web piece. FEATURES.md says it deliberately mirrors SPT: same stamp layout (from SPT `company_branding`), same verification code / SHA-256 / dHash, writes to SPT's `progress-photos` bucket and RPCs, and shares SPT's project.
- SPT web already has an in-browser camera with the same overlay (`CameraCapture.jsx`, `capacitorCamera.js`, `canvasOverlay.js`, `verificationCode.js`).
- Plan: **don't port it first.** Stage 1–3 the super-app launches the Flutter app via deep link / "Open AKK Camera" button (and AKK Camera's "attach to SPT" flow keeps working because SPT data doesn't move until Stage 3). Stage 4: decide between (a) keep Flutter as a companion forever (best capture speed, offline queue, ultra-wide lens), or (b) rebuild as a Capacitor native-camera module. My lean: **(a) until real-device testing shows the web camera is good enough**, because its offline-first, background stamping, 0.5× lens and GPS gate are hard to match in a WebView.
- Either way, when SPT data moves to the new project, the camera app's Supabase URL/key, RPC names (`akk_camera_register_photo`, `verify_worker_login`, `worker_add_package_images`, `get_company_branding`) and the unified login must be re-pointed — plan this in Stage 3.

---

## PART B — STAGES

| Stage | Goal | Backend change? | Risk |
|---|---|---|---|
| **0. Prep** | Decide name/domain/org; rotate + relocate secrets; freeze feature work on old apps; verify live security state; write the shared design tokens | None | Low |
| **1. Shell + federated modules** | Monorepo, Home launcher, role-based nav, mount each app as a lazy module under `/timesheet/*`, `/materials/*`, `/progress/*`. Each still talks to its own Supabase. Namespace storage keys. Camera = launch button | None | Medium (route/localStorage collisions) |
| **2. Unified login (SSO)** | New `core` project with `people` + `module_access`; one login screen; a token-exchange edge function lets the shell sign in to each legacy backend on the user's behalf (so users see 1 login while data hasn't moved) | New project (empty) + edge fn | Medium–High |
| **3. Data consolidation, one module at a time** | Move into the new project in this order: Material Tracker (smallest) → SPT + Camera (re-point Flutter) → Timesheet (largest, payroll PII, last). Per module: schema copy → data migrate → dual-run/verify → cut over → archive old project | Yes | High; do each in a maintenance window with backups |
| **4. Camera decision** | Keep Flutter companion vs. Capacitor rebuild | Maybe | Medium |
| **5. Cross-module features** | Shared sites (QR/GPS + progress + materials per site), one notification centre, one "My day" for workers, site-level dashboard (hours + materials + photos), unified admin analytics, unified branding | New views/RPCs | Low |
| **6. Release** | One Play Store listing (update an existing package so current users get it, or new `sg.akk.one` + migration notice), retire 3 old apps and 3 Firebase projects | None | Medium (Play listing/signing) |

Stage 1 is the only one that can start immediately and gives visible value with no data risk. Stage 3 should not start until Stage 2 identity works.

---

## PART C — FULL FEATURE AUDIT

### C1. Timesheet Manager (`AKK-Timesheet-Manager-main`)
Roles: Worker (Foreign / Local), Supervisor (site-scoped), Manager, Admin (Supabase Auth). Languages: i18n with switcher. Native Android (Capacitor) + web.

**Auth / entry:** Home with portal cards → worker type selection (Foreign/Local) → worker login (ID + password), quick login, optional biometric (native) and face-recognition login (face-api.js), Admin/Manager/Supervisor logins, manager↔supervisor selection page, login curtain/welcome overlay, splash, first-boot permissions, app tour (joyride), in-app update prompt, legal/privacy notice.

**Worker features:** clock in/out by QR scan at site with GPS radius check (350 m "EVT"), scan success/failure overlays, breaks (multiple per shift), vehicle QR scan (vehicle journey start/stop with live tracking), shift history, timesheets view/print, leave request (many leave types, full/half day, attachments, balance display, calendar), leave history, payslips (viewable/printable once "passed out"), announcements/notifications (with images), company forms (fill, history, submitted forms), theme toggle, language, biometric settings.

**Supervisor:** site-scoped shift oversight (approve/unapprove, filters all/unapproved/done/active; week/month/year).

**Manager:** tabs Time tracker, Leaves, Company forms (review), Timesheets; shift approval; leave approval.

**Admin (mega dashboard, tabs):** Time tracker (all shifts, filters by status/date/worker type/site, edit shift dialog), Leaves (approve/decline, manager leave panel, leave calendar, export, printable leave form), Payslip report (CPF/SINDA/SDL, OT cap, pay balances, payslip overrides, print/PDF), Timesheet report (print/export, "passed out" timesheets), Worker info (local + foreign CRUD, salary/rates, leave limits, face enrolment, password reset), Sites (GPS, QR token generation), Vehicles (CRUD, live map, journey detail/stats). Separate pages: Analytics, Attendance report, Announcements, Forms / Form detail, Company forms (template builder: questions editor, tables, recommended results, flagging, original-document override).
Other: public holidays, working-days config, admin online status, push (FCM webhook, leave reminder cron), realtime subscriptions + smart polling, Excel/PDF export.

**Routes today:** `/`, `/Home`, `/privacy`, `/legal`, `/worker`, `/worker/login`, `/worker/quick-login`, `/WorkerPortal`, `/WorkerFormFill`, `/WorkerSubmittedForms`, `/WorkerCompanyForms`, `/WorkerCompanyFormFill`, `/WorkerCompanyFormHistory`, `/WorkerTimesheets`, `/LeaveHistory`, `/ShiftHistory`, `/AdminLogin`, `/AdminDashboard`, `/Analytics`, `/AttendanceReport`, `/AdminAnnouncements`, `/AdminForms`, `/AdminFormDetail`, `/AdminCompanyForms`, `/ManagerSupervisorSelection`, `/ManagerLogin`, `/ManagerDashboard`, `/ManagerTimesheets`, `/SupervisorLogin`, `/SupervisorDashboard`.

**Data:** worker_details, local_worker_details, shifts, breaks, sites, leave_requests (+policy settings, attachments), public_holidays, working_days_config, managers, supervisors, admin_status, payslip_history, local_worker_payslip_history, passed_out_payslips, passed_out_timesheets, vehicles (+journeys), company_forms (+questions/answers/submissions), announcements, device_push_tokens, role_sessions, login_attempts/events, security_alerts.

### C2. Material Tracker (`AKK-Material-Tracker-main`)
Roles: Requester/Worker, Manager, Admin. Native Android (Capacitor) + web, native-style mobile UI (bottom nav, action sheets, intro).

**Worker (RequestPortal):** login (requester ID + password), summary stats (pending / to return / requests), new request (Take or Return form with multi-material rows, quantity, unit, notes), return flow against existing reference numbers (partial returns, cumulative tracking, can't over-return), recent requests, request history (with unseen badge), print/receipt, change password.
**Manager / Admin dashboard tabs:** Transactions (filters: take/return, pending/approved/declined, returned/partial/not returned, week/month/year; approve/decline; decline a return; print), Requesters (CRUD, password reset), Analytics (admin only; recharts), Sites (CRUD), Materials catalog (CRUD, inventory/stock apply), Managers (admin only; multi-role staff, capabilities by role).
Other: push notifications (FCM webhook), admin online status, email notification, legacy History page, print preview.

**Routes today:** `/`, `/Home`, `/RequestPortal`, `/RequestHistory`, `/WorkerLogin`, `/AdminLogin`, `/AdminDashboard`, `/ManagerLogin`, `/ManagerDashboard`, `/History`, `*`.

**Data:** requesters, transactions (materials JSONB), materials_catalog, material_history, sites, managers/staff, admin_status, device_push_tokens, role_sessions, app_auth_settings.

### C3. Site Progress Tracker (`Site progress tracker`)
Roles: Employee/Technician, Manager, Admin, Exporter ("Export Only" = external client). Native Android + web.

**Technician:** login, Worker Portal, **Submit Progress** (site, section/LCB ID, date; Before / During / After / Completion stages; live camera with burned-in date-time, address, GPS, logo, verification barcode; max photos per stage; retake, sortable photo grid, draft packages, final submit + description), My Submissions (status, resubmit after decline, delete own images/packages under rules), My Account (self-service), notification bell, push.
**Manager/Admin:** Package Review Board (card grid, expand, approve / decline with reason / re-decline, edit metadata, add/remove photos [delete admin-only], reviewed-by label, lightbox, photo-hash verify), Print package PDF (title autocomplete, header, 6 photos/page) and Excel export (exceljs), multi-export / summary export, Export queue (send/unsend packages to Export Only), document endorsements + audit trail + signature/seal pad, Analytics (counts, turnaround, by site, last 30 days), Users & Access (technician / manager / admin / exporter accounts, passwords, activate), Sites (name, section label), Branding & settings (logo, company name, stamp layout, free-layout editor), JSR permission grid.
**JSR & billing (commercial hub):** Job Service Reports from approved packages × catalog rates, Schedule B/C contracts, companies, catalog panel, monthly claims bundling JSRs, workflow (draft → submitted → approved → passed to client → client certifies/partial/rejects → payment cert → invoice → paid), invoice prepare/submit, sign-off/pass-out, exporter assignment (multi), number reuse, client reply with attachments.
**Exporter (client):** Packages tab (download-only photo packs) + Client reports tab (review/certify JSR & claims, invoices).
**Public:** Photo Verification page (upload photo or type code; QR read; SHA-256 + perceptual hash result).

**Routes today:** `/`, `/Home`, `/WorkerLogin`, `/ManagerLogin`, `/AdminLogin`, `/ExporterLogin`, `/WorkerPortal`, `/SubmitProgress`, `/MySubmissions`, `/ManagerDashboard`, `/AdminDashboard`, `/ExporterDashboard`, `/PhotoVerification` (public), `/MyAccount`, `*`.

**Data:** app_users (workers), manager_users, staff_profiles/admin_profiles, role_sessions, sites, packages, package_images (+hashes), package_edit_log, document_titles, document_endorsements, company_branding, notifications, device_tokens, JSR/claims/invoices/catalog/companies tables, exporter assignments, akk_camera_photos.

### C4. AKK Camera (Flutter, `AKK Camera App`)
Android only, portrait, dark liquid-glass UI. Optional Supabase.
**Capture:** full-screen camera home, PHOTO and BATCH (up to 40) modes, never-locking shutter with background processing queue, aspect presets (SPT 4:3 default, 16:9, 1:1, 3:4, full), flash off/on/auto, zoom chips 0.5×/1×/2× + slider (≤8×) + pinch, tap-to-focus, GPS-required gate with explainer pill, live stamp preview (optional).
**Stamp:** burned-in date/time (SGT), address (Nominatim reverse geocode), GPS ±accuracy, company logo + name, Code 128 verification plate; layout is set by Admin in SPT Branding and auto-synced (cached offline).
**Integrity:** 8-char verification code, SHA-256 of final JPEG, 2112-bit dHash — identical to SPT so SPT's public verification page works.
**Storage:** SQLite + files, offline-first, sync statuses.
**Gallery:** 3-col grid, badges, detail view with metadata, multi-select, share/export (device album "AKK Camera", share sheet, ZIP; quality presets), delete.
**Cloud:** optional sync (registry + private bucket archive).
**SPT attach:** worker sign-in (same credentials), choose stage/package rules identical to SPT, upload to `progress-photos`, deep link back to SPT.
**Settings:** capture defaults, read-only stamp layout, export quality, sync, SPT URL/log out, about (v1.0.3).

### C5. Main website (`AKK-Main-webpage-main`) — public marketing site
React/Vite/Tailwind/Framer Motion. Sections: Hero, About, Services, Projects, Certifications, Digital Tools (links to Material Tracker, Timesheet Manager, Site Progress Tracker), Contact, Footer. Recommendation: keep as `akk.sg`; the Digital Tools section becomes a single "Open AKK One" link.

---

## PART D — OVERLAP MAP (what becomes shared)

| Concern | Today | In AKK One |
|---|---|---|
| Home / role cards | 3 separate Homes | One Home that lists modules by `module_access` |
| Login screens | 3 × (Worker/Manager/Admin[/Exporter]) + camera login | One login; role picked from access |
| Users | worker_details/local_worker_details, requesters, app_users, managers×3, supervisors, staff_profiles | `core.people` + `module_access` |
| Sites | 3 tables, 3 shapes | `core.sites` (+ module-specific extension tables) |
| Notifications | 3 Firebase projects, 3 token tables, 3 webhooks | One FCM project, `core.device_tokens`, `core.notifications` |
| PDF / print / Excel | jsPDF+html2canvas ×3, xlsx, exceljs, html2pdf | One shared export package |
| Analytics | 3 separate | Shared chart components (recharts) |
| Branding | SPT `company_branding`, hardcoded logos elsewhere | One branding record |
| Shell chrome | AppShell/PortalShell/NativeChrome/BottomNav ×3 | One `packages/ui` shell |
| Admin presence | `admin_status` ×2 | `core.presence` |

---

## PART E — PROPOSED UNIFIED ROUTING (for Replit / UI generation)

```
/                         Home launcher (module tiles by access) — or Login if signed out
/login                    Single sign-in (ID/email + password; biometric/face on native)
/account                  My Account (password, language, biometrics, theme)
/notifications            Notification centre (all modules)
/verify                   PUBLIC Photo Verification (no login)
/privacy, /legal          Public

/timesheet                Module home (role-aware)
  worker:      /timesheet/clock  /timesheet/shifts  /timesheet/leave  /timesheet/leave/history
               /timesheet/payslips  /timesheet/timesheets  /timesheet/forms  /timesheet/forms/:id  /timesheet/vehicles/scan
  supervisor:  /timesheet/site-shifts
  manager:     /timesheet/manage  (tabs: shifts, leaves, forms, timesheets)
  admin:       /timesheet/admin   (tabs: shifts, leaves, payslips, timesheet-report, workers, sites, vehicles)
               /timesheet/admin/analytics  /timesheet/admin/attendance  /timesheet/admin/announcements
               /timesheet/admin/forms  /timesheet/admin/forms/:id  /timesheet/admin/company-forms

/materials                Module home
  worker:      /materials/request  /materials/history
  manager:     /materials/manage   (tabs: transactions, requesters, sites, materials)
  admin:       /materials/admin    (adds: analytics, managers)

/progress                 Module home
  technician:  /progress/submit  /progress/submissions  /progress/camera
  manager:     /progress/review  (packages, exports, jsr, users, sites)
  admin:       /progress/admin   (packages, exports, jsr & billing, analytics, users & access, branding)
  exporter:    /progress/client  (packages, client reports)

/camera                   Launch / deep-link page for AKK Camera (Stage 1–3); native module later
/admin                    Cross-module Super Admin (people & access, sites, branding, push, audit) — Stage 2+
```

Navigation: bottom nav on mobile = Home · module shortcuts (max 3) · Notifications · Account. Desktop = left sidebar grouped by module. Each module keeps its own tab bars inside.

---

## PART F — PASTE-READY PROMPT FOR REPLIT (UI/routing only, mock data)

> Build a front-end-only React 18 + Vite + Tailwind + Radix UI + React Router v6 prototype called **AKK One** for a Singapore engineering company. No backend: use mock JSON and a fake auth context where the signed-in user has `modules: { timesheet: 'worker'|'supervisor'|'manager'|'admin', materials: 'requester'|'manager'|'admin', progress: 'technician'|'manager'|'admin'|'exporter' }` and a role switcher in a dev toolbar. Mobile-first (it will be wrapped by Capacitor), with desktop sidebar layout. Brand: AKK crimson/bronze accent, clean, professional.
>
> Create: (1) Sign-in screen; (2) Home launcher showing only the modules the user can access as large tiles with badges; (3) the routes listed below as stub pages with realistic placeholder UI (tables, cards, tab bars, dialogs, status chips) matching the described features; (4) shared shell with bottom nav (mobile) / sidebar (desktop), notification bell, account menu; (5) lazy-loaded route groups per module with route guards by role.
>
> [paste PART E routes, then paste PART C feature lists for the modules you want drawn first]

---

## PART G — OPEN QUESTIONS FOR YOU
1. Final name (AKK One / Hub / Works) and domain (`app.akk.sg`?).
2. ~~Which Supabase org should own the new project?~~ **Decided: the org that holds Site Progress Tracker and AKK Camera (Org 2).** Timesheet and Material Tracker projects stay in Org 1 until each is migrated in Stage 3, then archived.
3. Is it OK for workers to keep logging in with Employee ID + password (synthetic email under the hood)?
4. Are Play Store users of the 3 apps on separate listings — update one of them in place (keeps installs) or publish a brand-new app?
5. Camera: keep Flutter companion, or eventually fold into the super-app?
6. Should the Exporter (client) role be part of the same app, or a separate client-only portal?
7. Any module to defer (e.g. JSR/billing) from the first release?
