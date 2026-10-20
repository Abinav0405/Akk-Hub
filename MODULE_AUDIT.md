# MODULE_AUDIT — MODULE-BUG-AUDIT (2026-10-20)

Compared module navigations to `src/app/AppRoutes.jsx` (read-only). Fixed S items in `modules/**`. M/L left for Claude.

---

## Fixed (S)

| page / file | issue | fix |
|-------------|-------|-----|
| `timesheet/pages/WorkerPortal.jsx` | Notification “forms” CTA used literal `"/timesheet/forms/:id?id=${…}"` (no interpolation) → dead route | `navigate(\`/timesheet/forms/${id}\`)` |
| `progress/pages/MySubmissions.jsx` | `backTo="/timesheet/clock"` (wrong module) | `backTo="/progress/home"` |
| `materials/pages/History.jsx` | `backTo="/timesheet/admin"` (wrong module) | `backTo="/materials/admin"` |
| `materials/pages/RequestHistory.jsx` | logout → `/login` (earlier QA) | already `/connect/materials` |
| `materials/pages/History.jsx` | `requireAdminSession` vs STAFF route `/materials/log` | `requireStaffSession` + allow `admin\|manager` (HUB-INTEGRATION) |
| `timesheet/pages/ManagerTimesheets.jsx` | Module Log out still present (hub sign-out is `/account`) | Removed logout UI + `revokeRoleSession` |
| `*/lib/utils.js` `createPageUrl` | Missing maps (AdminNavChrome → `/Analytics`, materials MobileHome → `/AdminDashboard`) | Expanded PAGE_PATHS to match AppRoutes |
| `modules/*/index.js` | Duplicate LEGACY page exports | Deduped |
| Timesheet SMALL-PAGES text | UTF-8 mojibake (`â€¦` / `Â·`) + BOM | Restored … — · → ←; stripped BOM |

---

## Routes vs AppRoutes (spot-check)

### Present in AppRoutes (OK)
Module literals generally match: `/timesheet/*`, `/materials/*`, `/progress/*`, `/login`, `/connect/materials|progress`, `/verify`, `/privacy`, hubs `/me|/site|/manage|/admin`, `/`.

### Missing / mismatched (list for Claude)

| source | navigates / links to | AppRoutes? | effort | notes |
|--------|----------------------|------------|--------|-------|
| Progress `NativeBottomNav` + Hub `TabBar` | Both on native | Double chrome | **M** | Claude said hub CSS hides module bars — confirm on device |
| `createPageUrl` unknown names | Falls back to `/${name}` e.g. `/WorkerPortal` | Not registered | **S** if hit | Core maps expanded 2026-10-20; still falls back for typos |
| Hub `/account` vs `/progress/account` | MyAccount exported at progress path; hub Account separate | Both exist | — | OK if intentional |
| PhotoVerification `createPageUrl(fromPage)` | `fromPage` ∈ Admin/Manager/Exporter/MySubmissions/Home | Mapped in progress `utils` | — | OK |

No other dead module→module path found for SMALL-PAGES in this pass.

---

## Storage keys

Most module keys go through `storageKey('<module>', …)` or auth helpers (`seenRequestIdsKey`). Vehicle journey + package view keys are namespaced. No un-namespaced S fixes required this pass.

---

## Guards that may bounce valid hub users (M/L for Claude)

| page | behaviour | risk |
|------|-----------|------|
| Timesheet SMALL-PAGES (`WorkerTimesheets`, `ShiftHistory`, `History`, …) | Still check `storageKey('timesheet', 'workerId'|'workerLoggedIn')` / `verifyRoleSession` and send to `/login` | Hub identity may be set while timesheet flags empty → bounce until Connect/bridge fills flags |
| Materials `History` | ~~`requireAdminSession`~~ → staff admin\|manager (fixed) | — |
| Progress pages | Module session + `useRoleGuard` | Depends on Claude connect bridges |

---

## Static / dead UI (list)

| item | effort | owner |
|------|--------|-------|
| Materials FilterToolbar hub stub ignores `search`/`filters`/`actions` | **L** | Claude `@/ui/layout` or modules re-export |
| Timesheet Admin wide tables on phone | **L** | Claude redesign (legacy) |
| `ErrorBoundary` hard reload | — | Intentional |
| ~~Duplicate exports in `modules/*/index.js`~~ | — | Fixed 2026-10-20 |

---

## Console / static smell

- ManagerDashboard smart heartbeat still `console.log` on each shift head change (noisy; optional remove).
- Many `select('*')` — see `PERF_AUDIT.md`.
