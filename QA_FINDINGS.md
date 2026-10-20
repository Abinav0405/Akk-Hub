# QA findings — real-data bug hunt (2026-10-20)

Browser: existing Vite on **http://localhost:5190/** (no second `npm run dev`).  
Real Supabase + `.env.qa.local` only. Mock OFF. Passwords never pasted here.  
Read-only clicks (no approve / submit / delete / create).

**Format:** `screen | action | what happened | console/network | owner`

---

## Portal: Employee (`QA_WORKER_*` → `/me`)

| screen | action | what happened | console/network | owner |
|--------|--------|---------------|-----------------|-------|
| `/login?role=employee` → `/me` | Foreign ID+pass login | Lands `/me` (Employee ID `test`, display name `x`). OK. | No console errors observed | — |
| `/me` after login | First paint / click any sidebar link | **`login-welcome-screen` stayed mounted** (loader opacity 0 but full-screen intercept). Blocked clicks until DOM-removed for QA. | none | **Claude: `ui/LoginWelcomeOverlay` / LoginCurtain** |
| `/me` @1366 | Scan layout | Usable; no horizontal overflow; live announcements badge “2”; clock card “No site yet”. | OK | — |
| `/me` @375 | Scan layout + hub TabBar | No h-scroll; TabBar Home · Materials · Site · Account. Content readable. | OK | — |
| `/me` | Open Notifications | Panel opens; live announcements (Ayutha Pooja…). Close works (Esc). | OK | Claude: pages/employee |
| `/timesheet/shifts` | Open My shifts | “No shifts found” empty state (expected for this worker). **~3.7s** to usable (>2s). | leave/shifts REST OK | Cursor: modules/timesheet (perf) · data OK |
| `/timesheet/leave/history` | Open Leave | Leave history loads; balances queried. No h-scroll. | `leave_requests` / `worker_details` 200 | — |
| `/timesheet/timesheets` | Open Timesheets | Empty “No timesheets…” (expected). **~2.3s** usable. | OK | Cursor: modules (minor slow) |
| `/timesheet/company-forms` | Open | Departments listed (Safety 7 / Transport 4 / Electrical 3). OK @1366. | OK | — |
| `/timesheet/forms` | Open Feedback forms | “No submitted forms yet.” OK. | OK | — |
| `/materials/request` | Connect Material Tracker with same worker ID | **Invalid Requester ID or Password** — materials stay unlinked. | Connect RPC reject | **Creds / data** (QA worker ≠ materials requester) — not a code defect; need real materials worker or Abinav note |
| `/progress/submit` | Open Submit photos | Form UI loads (stages Before/During/After). Site picker empty (“Choose a site”). Progress already **Linked** on Account (prior device link). | No ≥400 observed | Cursor: modules/progress if sites should load for linked worker; else data |
| `/progress/submissions` | (via nav) | Not deep-clicked this pass after submit form; Account confirms progress linked. | — | — |
| `/account` | Open | Shows Material Tracker **Not linked**; Site Progress **Linked**. Language radios OK. | OK | Claude: pages Account |
| `/verify` | Skipped deep | Public verify left for later portal pass | — | — |

### Employee — Cursor fixes this pass
- None yet (no clear S/M module code defects beyond slow empty lists; welcome overlay is Claude-owned; materials connect needs real requester creds).

### Employee — for Claude
1. Welcome overlay must fully unmount / `pointer-events: none` after animation so `/me` is clickable.
2. Home/login/shell rebuild continues per your ack (untouched by Cursor).

### Employee — for Abinav
- `QA_WORKER_*` works for Timesheet employee login but **does not** authenticate Material Tracker requester connect.

---

## Portal: Manager (`QA_OTHER_ROLES_*` as Manager → `/manage`)

| screen | action | what happened | console/network | owner |
|--------|--------|---------------|-----------------|-------|
| `/login?role=management` | Manager email+pass | Lands `/manage`. Attention: 554 shifts / 0 leave / 2 materials / 3 site. Modules Timesheet signed-in; Materials + Progress **Linked**. | OK | — |
| `/manage` @~1270 & @375 | Scan RoleHome | No h-scroll; tiles/attention links OK; hub TabBar on phone. | OK | Claude: pages/hubs |
| `/timesheet/manage` | Time Tracker + tabs | Live data: On site 25, 791 shifts, 14 unapproved. Tabs Leaves / Company forms / Timesheet load. Did **not** Create/Approve. No h-scroll @375. | No ≥400 / no console.error | — |
| `/timesheet/manage` Leaves | Open tab | “Leave approvals” heading. OK. | OK | Cursor: modules/timesheet |
| `/timesheet/manage` Company forms | Open tab | “Company form review” + Form questions / Recommended results. OK. | OK | Cursor: modules/timesheet |
| `/timesheet/manage/timesheets` | Open | “Timesheet approvals” — empty pending (OK). | OK | Cursor: modules |
| `/materials/manage` | Open + filters visible | Requests / 2 Pending + live transactions (e.g. Take Approved). Filters Type/Status/Time present. No h-scroll @375. | OK | Cursor: modules/materials |
| `/progress/review` | Open | Packages **585** total; Pending 3; site filters. No h-scroll @375. | OK | Cursor: modules/progress |

### Manager — Cursor fixes this pass
- None (no S/M module defects found on read-only pass).

### Manager — for Claude
- None new beyond Employee welcome-overlay note (may still flash on role login — wiped for QA).

---

## Portal: Supervisor — **BLOCKED**

| screen | action | what happened | console/network | owner |
|--------|--------|---------------|-----------------|-------|
| `/login?role=management` Supervisor | Skipped | No `QA_SUPERVISOR_ID` in `.env.qa.local`. `QA_OTHER_ROLES_*` is Manager → `/manage`, not `/site`. | — | **Abinav** (creds) |

---

## Portal: Admin (`QA_ADMIN_*` → `/admin`)

| screen | action | what happened | console/network | owner |
|--------|--------|---------------|-----------------|-------|
| `/login?role=admin` → `/admin` | Admin email+pass | Lands `/admin`. Attention 555/1/2/3; Materials+Progress linked. | OK | — |
| `/admin` @~1270 & @375 | Scan | No h-scroll; quick actions + module status OK. | OK | Claude: hubs |
| `/timesheet/admin` | Time Tracker + section strip | Live shifts (977 after settle); tabs Leaves/Payslip/Timesheet/Workers/Sites/Vehicles present. Did **not** Create/Delete/Approve. No h-scroll @375. | No ≥400 | Cursor: modules/timesheet |
| `/timesheet/admin/analytics` | Open | Analytics + date/site filters. OK. | OK | Cursor: modules |
| `/timesheet/admin/attendance` | Open | Monthly summary + worker picker. OK. | OK | Cursor: modules |
| `/timesheet/admin/announcements` | Open | 2 active + post UI (did not post). OK. | OK | Cursor: modules |
| `/timesheet/admin/forms` | Open | Forms list + create UI (did not create). OK. | OK | Cursor: modules |
| `/timesheet/admin/company-forms` | Open | Review / questions UI. OK. | OK | Cursor: modules |
| `/materials/admin` | Open | Requests 2 Pending + Transactions/Requesters/Analytics tabs. OK. | OK | Cursor: modules/materials |
| `/materials/log` | Full history | Transaction History + Export/filters. OK. | OK | Cursor: modules/materials |
| `/progress/admin` | Packages | 585 total / Pending 3; Packages/JSR/Analytics tabs. OK. | OK | Cursor: modules/progress |

### Admin — Cursor fixes this pass
- None on admin surfaces (read-only clean).

### Admin — for Claude
- LoginCurtain / welcome overlay may still linger after staff login (same class as Employee note).

---

## Portal: Export Only / Client (`QA_EXPORTONLY_*` → `/progress/client`)

| screen | action | what happened | console/network | owner |
|--------|--------|---------------|-----------------|-------|
| `/progress/client/login` | Load | Standalone login (no hub chrome). Name/Password + Sign in. | OK | — |
| `/progress/client/login` | Click Sign in | **`Close login` backdrop** (`fixed inset-0 z-30` in `LoginForm`) intercepts pointer clicks even when fading. Form `requestSubmit` still works. | — | **Claude: `ui/auth/LoginForm.jsx`** |
| Login → `/progress/client` | After sign-in | **`login-welcome-screen` stuck** (LoginCurtain from ClientLogin; Export Only outside HubLayout guards). Blocks tab clicks until removed. | — | **Cursor fixed:** `ExporterDashboard` now `endLoginCurtain` when session ready |
| `/progress/client` Packages | Filters / search | Live: All 492 / Not exported 49 / Exported 443; site/month/employee filters. No hub chrome. | OK | Cursor: modules/progress |
| Reports tab | Open | Client Report Portal — JSR/claims/invoices empty tables (OK for this account). | OK | Cursor: modules |
| Account tab | Open | Profile + change-password fields (did not submit). | OK | Cursor: modules |
| @375 | Layout | No h-scroll on dashboard. | OK | — |

### Export Only — Cursor fixes this pass
- `modules/progress/pages/ExporterDashboard.jsx` — end `LoginCurtain` when exporter session is ready (mirrors EmployeeHome / WorkerPortal).

### Export Only — for Claude
1. `LoginForm` sheet backdrop: set `pointer-events: none` when `sheetOpen` is false / opacity 0 (or unmount).
2. Optional: end curtain centrally for `/progress/client` if other entry paths start it.

---

## Historical — Hub vs source chrome (earlier pass)

Browser: existing Vite on **http://localhost:5190/** (no second `npm run dev`).  
Compared Hub chrome/login to Timesheet, Material Tracker, Site Progress Tracker source homes.

### 1. Home bottom nav (PublicTabBar)

| Viewport | Hub `/` | Source web homes | Source native homes |
|----------|---------|------------------|---------------------|
| Desktop (≥1024px / `lg`) | No bottom tab bar (`PublicTabBar` is `lg:hidden`) | No bottom tab bar | N/A / app chrome |
| Phone-width web (~390px) | **Shows** Home · Verify photo · Sign in | **No** bottom tab bar | Materials/Progress use native tab bars only inside Capacitor |

**Verdict:** On phone-width **website**, Hub home shows a bottom tab bar that the three source **websites** never show on home. Matches app-style chrome more than web parity. (Later solo pass claimed PublicTabBar removed on web — re-verify after Claude Home rebuild.)

**Owned by Claude:** `src/pages/PublicTabBar.jsx`, `src/pages/Home.jsx`, `src/app/AppRoutes.jsx`.

### 2. Login flows (per module)

| Path | Observed |
|------|----------|
| `/login?role=employee` | Employee ID + password; Foreign/Local segmented. UI OK. |
| `/login?role=management` | Manager/Supervisor + email/password. UI OK. |
| `/login?role=admin` | Admin email/password + forgot. UI OK. |
| Materials / Progress standalone logins | **Not routed.** Hub uses Timesheet identity then `ModuleGate` → `ConnectForm`. |

### 3. Left for Claude (chrome summary)

1. PublicTabBar on web home &lt;lg — hide or native-only (may already be fixed; Claude rebuilding Home).
2. Double bottom nav on native when HubLayout + module NativeBottomNav both render.
3. Timesheet admin web: Hub TabBar + AdminWebsiteMobileNav stacking.
4. Welcome overlay stuck intercept after login (new, see Employee table).
