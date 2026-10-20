# QA checklist — AKK Hub routes

Manual smoke list. Dev server (if already running): `http://localhost:5190/` — **do not start a second** `npm run dev`. Start when needed: `npm run dev` (Vite port **5190**).

Status legend: **wired** = registered in `src/app/AppRoutes.jsx`; **redirect** = Navigate to another hub path; **page-ready** = module page export exists and is mounted.

| Route | Click / action | Expected | Status |
|---|---|---|---|
| `/` | Open hub home | Brand + login CTAs (WebHome / AppHome) | wired (Claude) |
| `/login` | Open unified login | Role portals (employee / management / admin) | wired (Claude) |
| `/login/quick` | Quick login | Biometric / quick sign-in | wired (Claude) |
| `/account` | Open account | Hub Account (`signOutEverywhere`) | wired (Claude); progress `MyAccount` also at `/progress/account` |
| `/notifications` | Open notifications | Inbox | wired (Claude) |
| `/verify` | Open photo verification | Code/upload verify UI | wired → `PhotoVerification` |
| `/privacy` | Legal / privacy | Legal notice | wired → `LegalNotice` (`/legal` redirects here) |
| `/me` | Employee home | Merged EmployeeHome | wired (Claude) |
| `/site` `/manage` `/admin` | Role hubs | RoleHome tiles into modules | wired (Claude) |
| `/connect/:module` | Connect materials/progress | ModuleGate ConnectForm | wired (Claude) |
| `/timesheet/clock` | Old clock entry | Redirect → `/me` | redirect |
| `/timesheet/payslips` | Old payslips | Redirect → `/me` | redirect |
| `/timesheet/vehicles/scan` | Old vehicle scan | Redirect → `/me` | redirect |
| `/timesheet/shifts` | Shift history | Past/pending shifts | wired → `ShiftHistory` |
| `/timesheet/leave` | Leave | Redirect → `/timesheet/leave/history` | redirect |
| `/timesheet/leave/history` | Leave history | Applications + withdraw/print | wired → `LeaveHistory` |
| `/timesheet/timesheets` | Worker timesheets | Monthly review/submit | wired → `WorkerTimesheets` |
| `/timesheet/forms` | Submitted survey forms | Worker form list | wired → `WorkerSubmittedForms` |
| `/timesheet/forms/:id` | Fill survey form | Form filler | wired → `WorkerFormFill` |
| `/timesheet/company-forms` (+ `/fill`, `/history`) | Company forms | Worker checklists | wired |
| `/timesheet/site-shifts` | Supervisor dashboard | Site shift board | wired → `SupervisorDashboard` |
| `/timesheet/manage` | Manager dashboard | Manager hub | wired → `ManagerDashboard` |
| `/timesheet/manage/timesheets` | Manager timesheet approvals | Approvals UI | wired → `ManagerTimesheets` |
| `/timesheet/admin` | Admin hub | Admin dashboard | wired → `AdminDashboard` |
| `/timesheet/admin/analytics` | Analytics | Charts/metrics | wired → `Analytics` |
| `/timesheet/admin/attendance` | Attendance report | Attendance table | wired → `AttendanceReport` |
| `/timesheet/admin/announcements` | Announcements admin | Create/toggle | wired → `AdminAnnouncements` |
| `/timesheet/admin/forms` (+ `/:id`) | Admin forms | Survey editor | wired |
| `/timesheet/admin/company-forms` | Company forms admin | Template list | wired → `AdminCompanyForms` |
| `/timesheet/history` | Staff history | History page | wired → `History` |
| `/materials/request` | Request materials | Take/return form | wired → `RequestPortal` |
| `/materials/history` | Request history | Worker request cards | wired → `RequestHistory` |
| `/materials/manage` | Manager dashboard | Materials manager | wired → `ManagerDashboard` |
| `/materials/admin` | Materials admin | Admin dashboard | wired → `AdminDashboard` |
| `/materials/log` | Staff transaction log | History (admin\|manager) | wired → `History` |
| `/progress/submit` `/progress/camera` | Submit progress | Package submit | wired → `SubmitProgress` |
| `/progress/submissions` | My submissions | Worker package list | wired → `MySubmissions` |
| `/progress/home` | Progress worker portal | Worker home | wired → `WorkerPortal` |
| `/progress/review` | Manager review | Review board | wired → `ManagerDashboard` |
| `/progress/admin` | Progress admin | Admin panels | wired → `AdminDashboard` |
| `/progress/client/login` | Export Only login | Public Export Only Portal (no hub identity); real Export Only credentials | wired → `ExporterLogin` |
| `/progress/client` | Exporter/client | Export-only UI (Packages + Client reports); unauthenticated → `/progress/client/login` | wired → `ExporterDashboard` |
| `/progress/account` | Progress account | MyAccount panel | wired → `MyAccount` |

## Build / lint

- `node scripts/check-imports.mjs modules` — ignore known `branding.js` object-literal false positives.
- `npm run build` — **GREEN** as of 2026-10-20 (Cursor credit-gap session).
- `npm run lint` — not configured in `package.json`.
- QA tip: `?app=1` previews the app Home UI in a browser. Use an approved real account for authenticated portal smoke tests.

## Smoke notes for Claude / QA

1. Materials/Progress after hub login: `/connect/materials` / `/connect/progress` must succeed per role.
2. Sign-out only from `/account` (module Log out removed from hub-embedded screens).
3. AdminNavChrome links use `createPageUrl` → `/timesheet/admin/*` (not bare `/Analytics`).
4. With an approved real account, Materials and Progress should show their connect forms only when their own project session is absent, then route back to the selected role portal after linking.

## Native / shell chrome (2026-10-20)

- Inside `.g-shell`, CSS suppresses module bottom bars: `.app-native-tabbar`, `.admin-app-dock.akk-tabbar`, `.n-tabbar` (Materials). Web also **does not mount** those navs (`isNativeApp()` gate) — Export Only keeps its own logout + web Tabs (no hub chrome).
- Hub `TabBar` always shows on phones (&lt;1024px), **including** `/timesheet/admin*`. `AdminWebsiteMobileNav` is section-picker only (hamburger), not a second app chrome.
