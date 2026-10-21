# Feature Audit: Workspace Apps vs Akk Hub

**Date:** 2026-10-21  
**Workspace root:** `c:\Users\Arumugam Abinav\OneDrive\Desktop\Abinav\Work\Websites final`  
**Hub path:** `...\Akk Hub`  
**Method:** Folder inventory + code audit (routes, nav, admin tabs, package.json, NEEDS.md, module trees). Marketing copy ignored.  
**Scope rule:** Audit/doc only — no app feature code changes, no git push.

**Legend (Comparison column):**
- **Hub better** — Hub has clearer UX, unification, or stronger capability than the source app
- **Source better** — Source app still ahead in that capability
- **Equal** — Feature present in both at comparable maturity
- **Missing in Hub** — Source has it; Hub does not (or only stub)
- **Hub only** — Not in that source app (listed in Hub-only summary)

---

## 1. Project inventory

| # | Folder | Kind | Package / stack | Audited as product? |
|---|--------|------|-----------------|---------------------|
| 1 | `Akk Hub` | Unified SPA + Capacitor Android | `akk-hub` · Vite/React/Supabase/Capacitor | **Yes — reference** |
| 2 | `AKK-Timesheet-Manager-main` | Attendance / payroll app | Timesheet Manager · Vite/React/Supabase/Capacitor | **Yes** |
| 3 | `AKK-Material-Tracker-main` | Materials take/return app | Material Tracker · Vite/React/Supabase/Capacitor | **Yes** |
| 4 | `Site progress tracker` | Site photos / JSR / export | Site Progress Tracker · Vite/React/Supabase/Capacitor | **Yes** |
| 5 | `AKK Camera App` | Flutter camera companion | `akk_camera` 1.0.3 · Flutter Android | **Yes** |
| 6 | `AKK-Main-webpage-main` | Marketing / company site | Vite/React/Tailwind · single page | **Yes** (site, not ops app) |
| — | `supabase` | CLI link cache (`.temp` only) | — | **No** (not an app) |
| — | `Supbase table details` | CSV/SQL schema dumps | — | **No** (not an app) |
| — | Root JSON keystores, QR PNGs, PDFs, `FIXES_AND_FEATURES.md`, etc. | Assets / docs | — | **No** |

**Projects audited (product surfaces): 6** (5 source + Hub as reference).  
**Source apps cross-checked against Hub: 5.**

---

## 2. Per-source-app feature tables

### 2.1 AKK Timesheet Manager → Hub

**Source:** `AKK-Timesheet-Manager-main`  
**Hub module:** `src/modules/timesheet/**` + hub shell (`/me`, `/site`, `/manage`, `/admin`, …)

| Feature | Source status | Hub status | Comparison |
|---------|---------------|------------|------------|
| Role model (worker / supervisor / manager / admin) | Implemented | Implemented (`RequireHubRole`, hub identity) | **Equal** |
| Worker login (ID + password; local vs foreign) | Implemented | Implemented | **Equal** |
| Management login (manager / supervisor toggle) | Implemented | Implemented (`?as=supervisor`) | **Equal** |
| Admin login (Supabase Auth) | Implemented | Implemented + optional email allowlist | **Hub better** (allowlist + unified session) |
| Device biometric unlock (fingerprint / Face) | Implemented | Implemented (`biometric.js`, Account) | **Equal** |
| Camera Face ID enroll + worker face login | Implemented | Implemented | **Equal** |
| Quick login / remembered unlock | Implemented | Implemented (`/login/quick`) | **Equal** |
| Login curtain / welcome overlay | Implemented | Implemented | **Equal** |
| Web home (portal cards) | Implemented | Implemented (`WebHome`) | **Hub better** (4th Client portal + ONE PRODUCT chrome) |
| Native AppHome + Face/Fingerprint CTAs | Implemented | Implemented (`AppHome`) | **Equal** |
| Maintenance gate (full-app lock) | Implemented (default ON) | Not present as product gate | **Missing in Hub** — source: `main.jsx` / `MaintenancePage.jsx` |
| Theme toggle FAB (dark mode) | Code present, unwired | Intentionally not ported | **Missing in Hub** (intentional; source also unused) |
| i18n (EN / 中文 / தமிழ் / Melayu) | Implemented | Implemented | **Equal** |
| Privacy / legal notice | Implemented | Implemented (`/privacy`) | **Equal** |
| QR clock-in / break / clock-out | Implemented | Implemented (`EmployeeHome` / QRScanner) | **Equal** |
| GPS geofence (~350 m) on site QR | Implemented | Implemented | **Equal** |
| Auto-breaks + SG hours / PH math | Implemented | Implemented (`timeUtils.js`) | **Equal** |
| Scan success/failure overlays | Implemented | Implemented | **Equal** |
| Shift history (worker) | Implemented | Implemented (`/timesheet/shifts`) | **Equal** |
| Leave apply / cancel / history / calendar | Implemented | Implemented | **Equal** |
| Leave attachments + balances + blackouts | Implemented | Implemented | **Equal** |
| Two-step leave (manager → admin) | Implemented | Implemented | **Equal** |
| Worker payslips view/download | Implemented | Implemented | **Equal** |
| Worker passed-out timesheets approve/decline | Implemented | Implemented | **Equal** |
| Worker in-app notifications sheet | Implemented | Implemented (module); hub `/notifications` stub | **Source better** for a dedicated hub inbox — module bell OK; hub page empty |
| Survey / feedback forms (admin build + worker fill) | Implemented | Implemented | **Equal** |
| Company forms catalog / fill / review / print | Implemented | Implemented + edit-pending-before-approve | **Hub better** (NEEDS: manager edit before approve) |
| Vehicle QR + live GPS journey (driver) | Implemented | Implemented | **Equal** |
| Admin vehicles + live map + journey detail | Implemented | Implemented (`VehiclesTab`) | **Equal** |
| Supervisor site-scoped shift approve/edit/export | Implemented | Implemented (`SupervisorDashboard`) | **Equal** |
| Manager time tracker / leave / timesheets / company forms | Implemented | Implemented (`ManagerDashboard` + `?section=`) | **Equal** |
| Admin Time Tracker (CRUD shifts, Excel, pass-out) | Implemented | Implemented (`TimeTrackerTab`) | **Equal** |
| Admin Leaves tab (bulk, print, policy) | Implemented | Implemented | **Equal** |
| Admin Payslip report (CPF/SINDA/SDL, pass-out) | Implemented | Implemented | **Equal** |
| Admin Timesheet report / pass-out chain | Implemented | Implemented | **Equal** |
| Admin Workers (local/foreign, Face ID, print profile) | Implemented | Implemented + UNIFIED access table | **Hub better** (Materials/Site photos switches) |
| Admin Sites + QR generate/download + GPS | Implemented | Unified `/admin/sites` when UNIFIED | **Hub better** (one places list across modules) |
| Analytics + Attendance report (P/A/L/H/S PDF) | Implemented | Implemented | **Equal** |
| Announcements CMS | Implemented | Implemented | **Equal** |
| Print (payslip / leave / timesheet / company form) | Implemented | Implemented | **Equal** |
| Excel exports (shifts, leave, workers, forms) | Implemented | Implemented | **Equal** |
| FCM push + deep links | Implemented | Partial — gated; edge fns may be undeployed on new project | **Source better** (mature on old project); Hub code present but ops-gated |
| Browser desktop notifications (new shifts) | Implemented | Present in module paths | **Equal** |
| Capacitor Android shell / update prompt / back button | Implemented | Implemented (single APK `sg.akk.hub`) | **Hub better** (one app vs three) |
| App tour (joyride) | Implemented | Implemented | **Equal** |
| First-boot permissions helper | Implemented | Permissions consolidated in hub core | **Equal** / slight Hub win on unification |
| Orphan `History.jsx` (unrouted) | Present, unused | History route redirects by role | **Hub better** (no dead staff History) |
| Approvals attention inbox (cross-module) | N/A (single app) | Implemented (`ApprovalsInbox`) | **Hub only** |

---

### 2.2 AKK Material Tracker → Hub

**Source:** `AKK-Material-Tracker-main`  
**Hub module:** `src/modules/materials/**`

| Feature | Source status | Hub status | Comparison |
|---------|---------------|------------|------------|
| Worker / Manager / Admin portals | Implemented | Implemented + hub role homes | **Hub better** (task nav + attention counts) |
| Worker login (requester RPC session) | Implemented | Implemented + UNIFIED auto-link from Attendance | **Hub better** (SSO for workers) |
| Manager / Admin staff Auth + role caps | Implemented | Implemented | **Equal** |
| Take materials request | Implemented | Implemented (`RequestPortal` / `MaterialForm`) | **Equal** |
| Return materials (outstanding / ref lookup) | Implemented | Implemented | **Equal** |
| Site selection on requests | Implemented | Implemented; unified Sites when UNIFIED | **Hub better** |
| Edit / delete pending (worker) | Implemented | Implemented | **Equal** |
| Worker request history + “seen” badge | Implemented | Implemented | **Equal** |
| Worker change password | Implemented | Implemented | **Equal** |
| Staff approve / decline / edit | Implemented | Implemented | **Equal** |
| Admin delete / delete-all history | Implemented | Implemented (admin caps + delete PIN friction) | **Equal** / Hub slightly safer UX |
| Transaction filters (type/status/return/date) | Implemented | Implemented | **Equal** |
| Materials catalog CRUD + restock + adjust + low stock | Implemented | Implemented (`MaterialsManager`) | **Equal** |
| Per-material stock history dialog | Implemented | Implemented | **Equal** |
| Requesters CRUD | Implemented | Implemented; nav hidden when UNIFIED (employees = Attendance) | **Hub better** (one people list) |
| Sites CRUD | Implemented | Unified `/admin/sites` when UNIFIED | **Hub better** |
| Managers admin (Edge `manage-staff`) | Implemented | Implemented; **may fail until edge deployed** on new Hub project | **Source better** (ops live on old project) |
| Analytics charts (admin) | Implemented | Implemented | **Equal** |
| Excel export transactions | Implemented | Implemented | **Equal** |
| Print/PDF transactions (single + bulk) | Implemented | Implemented | **Equal** |
| Print materials / requesters | Implemented | Implemented | **Equal** |
| Browser notifications for new requests | Implemented | Present in module | **Equal** |
| FCM push (pending → staff; decision → worker; low stock) | Gated native | Partial / edge undeployed on new project | **Source better** until Hub push finished |
| Maintenance page (default ON) | Implemented | Not present | **Missing in Hub** — source: `Maintenance.jsx` |
| Native intro splash | Implemented | Hub splash / chrome | **Equal** (different shell) |
| Dedicated `/History` admin page | Orphan (routed, not in nav) | `/materials/log` History | **Hub better** (first-class log route) |
| DatabaseSetup UI | Dev-only, unmounted | Intentionally not ported | **Missing in Hub** (intentional) |
| QR / barcode scan for materials | Absent | Absent | **Equal** (neither has it; deferred idea) |
| Connect gate for staff linking | N/A | Implemented (`/connect/materials`) | **Hub only** |

---

### 2.3 Site Progress Tracker → Hub

**Source:** `Site progress tracker`  
**Hub module:** `src/modules/progress/**` + Client portal

| Feature | Source status | Hub status | Comparison |
|---------|---------------|------------|------------|
| Roles: Worker / Manager / Admin / Export Only | Implemented | Implemented; Export → **Client** portal | **Hub better** (naming + hub chrome) |
| Worker submit package (stages, link rules, draft/submit) | Implemented | Implemented (`SubmitProgress`) | **Equal** |
| My Submissions (continue / resubmit / edit draft) | Implemented | Implemented | **Equal** |
| In-app camera + file upload | Implemented | Implemented (`CameraCapture`) | **Equal** |
| Zoom 0.5×–8×, torch, ultra-wide | Implemented | Implemented in Hub `CameraCapture.jsx` | **Equal** |
| GPS + Nominatim + burn-in overlays | Implemented | Implemented | **Equal** |
| Branding (logo, overlay lines, PDF chrome) | Implemented | Implemented (`BrandingPanel`) | **Equal** |
| Verification code + Code 128 + SHA-256 + dHash | Implemented | Implemented | **Equal** |
| Public photo verification (`/PhotoVerification` / `/verify`) | Implemented | Implemented (`/verify`) | **Equal** |
| Manager/Admin package review (approve/decline/edit) | Implemented | Implemented | **Equal** |
| Send / unsend to export | Implemented | Implemented | **Equal** |
| Print PDF / Excel / multi / summary export | Implemented | Implemented | **Equal** |
| Sites + section options + description/street lists | Implemented | Implemented; unified Sites when UNIFIED | **Hub better** |
| Users & access / staff accounts | Implemented | Implemented; worker access via UNIFIED Employees | **Hub better** |
| Analytics (overview / sites / photos / export & JSR) | Implemented | Implemented | **Equal** |
| JSR / Claims / Invoices / Catalog / Companies | Implemented | Implemented (`CommercialHub`) | **Equal** |
| Signature / seal endorsement | Implemented | Implemented | **Equal** |
| Client / Export Only reports portal | Implemented | Implemented (`ClientPortal`) | **Equal** |
| In-app NotificationBell | Implemented | Implemented (module) | **Equal** |
| FCM push | Implemented | Partial / edge gated | **Source better** until Hub push live |
| Maintenance gate | Implemented | Not present | **Missing in Hub** |
| My Account (name/password) | Implemented | Hub Account + module account | **Hub better** (central Account + biometrics) |
| Heartbeat live refresh (~5s) | Implemented | Present (polling pauses when hidden — Hub perf pass) | **Hub better** (battery/heat awareness) |
| Attach from Flutter Camera App | Via Camera App → SPT | No first-party Flutter companion; Hub in-app camera only | **Missing in Hub** — companion lives in `AKK Camera App` |

---

### 2.4 AKK Camera App → Hub

**Source:** `AKK Camera App` (Flutter Android companion)  
**Hub:** No Flutter camera product; Site-work uses Capacitor/web `CameraCapture` only.

| Feature | Source status | Hub status | Comparison |
|---------|---------------|------------|------------|
| Standalone portrait camera home | Implemented | Not a separate app | **Missing in Hub** — `AKK Camera App` |
| PHOTO + BATCH (≤40) capture modes | Implemented | Package stages support multi-photo; no dedicated Flutter BATCH UX | **Source better** (native batch camera UX) |
| GPS-required shutter + reverse geocode | Implemented | Optional/enforced in SPT capture pipeline | **Equal** conceptually; Camera App stricter offline-first |
| Stamp burn-in matching SPT admin branding | Implemented | Same rules in Hub progress overlays | **Equal** (parity by design) |
| Verification codes / SHA-256 / dHash | Implemented | Same in Hub progress | **Equal** |
| Offline-first local SQLite gallery | Implemented | Hub capture needs online package flow | **Missing in Hub** — offline gallery/sync registry |
| Gallery multi-select / detail / sync badges | Implemented | N/A as companion | **Missing in Hub** |
| Export Original/High/Medium + share/ZIP | Implemented | Package PDF/Excel export (different path) | **Missing in Hub** as camera export; Hub has package export instead |
| Optional Supabase sync registry | Implemented | Verification via package storage | **Missing in Hub** (camera registry) |
| “Add to Site Progress Tracker” attach flow | Implemented → SPT URL | No Flutter→Hub attach bridge documented | **Missing in Hub** — still targets SPT; not Hub-native |
| Settings (ratio, flash, batch, SPT URL, session) | Implemented | Hub Account / branding elsewhere | **Missing in Hub** as camera settings surface |
| APK `AKK-Camera.apk` | Shipped | Single Hub APK only | **Source better** for dedicated field camera |

---

### 2.5 AKK Main Webpage → Hub

**Source:** `AKK-Main-webpage-main` (marketing site at akk.com.sg)  
**Hub:** Ops product — not a replacement for the marketing site.

| Feature | Source status | Hub status | Comparison |
|---------|---------------|------------|------------|
| Company hero / about / 12 services | Implemented | Not in Hub | **Missing in Hub** (out of scope — marketing) |
| Sectors / certifications (ISO, bizSAFE) | Implemented | Not in Hub | **Missing in Hub** |
| Digital Tools cards → Hub / Timesheet / Materials / SPT | Implemented | Hub *is* the consolidated tool | **Hub better** as product; site still needed for marketing links |
| Mailto contact form + map + social links | Implemented | Not in Hub | **Missing in Hub** (intentional) |
| SEO / JSON-LD / sitemap | Implemented | Ops SPA (different) | **Source better** for public marketing SEO |
| Auth / ops workflows | Absent | Full ops suite | **Hub only** |

---

## 3. Hub-only features (source apps lack)

| Hub-only capability | Where | Notes |
|---------------------|-------|-------|
| Unified ONE PRODUCT shell + task-based nav | `navigation.js`, `HubLayout` | Attendance & pay · Materials · Site work · People & sites · Insights · Communication · Settings |
| Single Capacitor APK for all modules | `sg.akk.hub` | Replaces three separate Android apps (+ Camera still separate) |
| UNIFIED backend mode | `core/supabase.js` | One Supabase project; schema per area |
| Worker SSO / auto-link across modules | `bridges.linkHubWorker()` | No Connect form for workers when UNIFIED |
| Unified Sites (merge places, area chips) | `/admin/sites` `SitesPage.jsx` | Attendance + Materials + Site work |
| Unified Employees + area access switches | `WorkerAccessTable` / `WorkerAccessPanel` | Materials / Site photos toggles |
| Cross-module Approvals inbox | `ApprovalsInbox` on RoleHome | Shifts + leave + materials + packages counts |
| Client portal as 4th hub portal | `/progress/client` | Outside HubLayout; bronze theme |
| Module Connect gate (staff) | `/connect/:module` | One-time Materials/Progress link |
| Prefetch on login / lazy module chunks | `prefetch.js`, `modulePage.js` | Performance |
| Hub Account (language + biometric + link status) | `/account` | Central settings |
| Public home portal chooser including Client | `WebHome` / `AppHome` | |
| Dev mock OFF for QA | `devMock.js` | |
| Migration tooling / one-DB copy | `migration/**` | Ops, not end-user |
| Glass / crimson ONE PRODUCT design system | `glass.css` | In flight per NEEDS |

---

## 4. Summary

### 4.1 Top Hub gaps (priority)

1. **AKK Camera App not in Hub** — offline gallery, BATCH camera, export/ZIP, SPT/Hub attach bridge still Flutter-only.  
2. **Hub Notifications page is a stub** — `/notifications` empty; real inboxes remain per-module (worker sheet, Progress bell).  
3. **FCM / push + Materials `manage-staff` edge functions** — code present; undeployed / gated on new Hub project (NEEDS).  
4. **Maintenance mode page** — Timesheet, Materials, and SPT can lock the live site; Hub has no equivalent ops gate.  
5. **Site `is_active` pick-list filters** — UNIFIED Sites exist; inactive sites may still appear in NEW pickers (NEEDS Cursor task).  
6. **`local_worker_details` RLS lock** — UI blocks local HR; anon RLS still open per NEEDS (security).  
7. **Leftover per-module Sites/Requesters/Users sections** — nav cleaned when UNIFIED; dashboard leftovers may remain (NEEDS).  
8. **Flutter Camera → Hub attach** — Camera App still oriented to SPT URL, not Hub package endpoints.  
9. **Marketing site features** — intentional gap; Hub is not akk.com.sg (contact/SEO/certs).  
10. **Materials QR/barcode scanning** — missing in **both** source and Hub (deferred idea; listed so it is not forgotten).

### 4.2 Top Hub wins vs legacy

1. **One product / one login path** — task nav, RoleHomes, single APK instead of three portals.  
2. **Unified Sites + Employees** — merge places; one worker directory with area access.  
3. **Worker SSO across Materials & Site work** — no Connect form when UNIFIED.  
4. **Cross-module Approvals inbox** — managers/admins see pending work in one place.  
5. **Client portal integrated** — Export Only as first-class hub portal.  
6. **Company forms edit-before-approve** — Hub improvement over legacy manager flow.  
7. **Perf / heat hardening** — animation fill-mode, Android glass budget, lazy admin tabs, paused polling.  
8. **Materials History as first-class `/materials/log`** — vs orphan `/History` in source.  
9. **Central Account + biometrics + language** — one settings surface.  
10. **Design system consolidation** — crimson brand, solid content, glass chrome only (vs three visual languages).

### 4.3 Rough parity score

| Source product | Feature parity into Hub (business UI) | Notes |
|----------------|----------------------------------------|-------|
| Timesheet Manager | **~95%** | Ops parity high; maintenance page + hub notifications stub + push ops lag |
| Material Tracker | **~92%** | Ops parity high; manage-staff/push ops lag; no QR (neither side) |
| Site Progress Tracker | **~93%** | Core photo/JSR/export parity; Camera companion + push ops separate |
| AKK Camera App | **~15%** | Only overlapping stamp/verify concepts via Hub in-app camera |
| Main Webpage | **~5%** | Intentionally out of scope (marketing) |

**Overall ops-suite parity (Timesheet + Materials + SPT → Hub): ~93%** of user-facing business capabilities present.  
**Including Camera + Marketing: ~75%** of all workspace product surfaces (Hub never aimed to absorb marketing or Flutter camera wholesale).

### 4.4 Maturity caveats (Hub)

- Most **screens** are implemented; remaining gaps are often **ops** (edge functions, FCM register, storage copy finish) or **polish** (UNIFIED leftover sections, `is_active` filters).  
- Source Timesheet/Materials may still show **maintenance ON** by default — do not confuse “source has maintenance UI” with “source is more complete.”  
- NEEDS.md remains the live message board for unfinished UNIFIED/backend tasks.

---

## 5. Sources consulted

- Hub: `NEEDS.md`, `package.json`, `src/app/{AppRoutes,navigation,paths,guards}.jsx|js`, `src/pages/**`, `src/modules/{timesheet,materials,progress}/**`  
- Timesheet: `src/main.jsx`, `AdminNavChrome`, portals, `src/lib/**`  
- Materials: `src/main.jsx`, portals, managers, print/push libs  
- Site Progress: routes, Submit/MySubmissions, review/admin/JSR, CameraCapture  
- Camera: `FEATURES.md`, `pubspec.yaml`, `lib/features/**`  
- Main webpage: `App.jsx` / `Home.jsx` sections  
- Workspace root listing (skip `node_modules`, build junk, schema dumps)

---

*End of audit.*
