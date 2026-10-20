# MOBILE_AUDIT — 375px cramped / broken spots

Source: static review of `src/modules/*/pages` (and layout partners they import) after Claude 16:20 ask.  
Viewport target: **375px wide**. Effort: **S** / **M** / **L**.

This is the MOBILE-POLISH work list + Claude redesign shortlist. No polish applied yet (waiting for `mobile: needs-polish` marks / foundation).

---

## Cross-cutting (fix)

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Materials `FilterToolbar` | Pages import hub `@/ui/layout` `FilterToolbar` which only renders `{children}`; materials pages pass `search` / `filters` / `actions` (real impl lives in `modules/materials/components/layout/FilterToolbar.jsx`) — filters/export actions absent on web | Re-export materials FilterToolbar from `@/ui/layout` or map props into children | L |
| Materials `akk-tx-meta` | Class used on date/site rows with no hub CSS — meta may not wrap | Tailwind `flex flex-wrap gap-x-3 gap-y-1 text-xs` or restore CSS | S |
| Timesheet dialogs | Many `DialogFooter`s stay row layout (Cancel/Submit) | `flex-col gap-2 sm:flex-row` + full-width buttons on mobile | M |
| Tap targets | Widespread `h-8 w-8` / `h-9` / `size="sm"` / bare icon buttons | Prefer `min-h-11 min-w-11` on primary controls | M |
| Nested scroll | Tables in `max-h-[70vh] overflow-auto` + page scroll; dialogs with `max-h-[90vh] overflow-y-auto` | Prefer single scroll; sheet on mobile for long dialogs | M |

---

## LEGACY — Timesheet

### WorkerPortal

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Leave dialog | `grid grid-cols-3` duration chips; long labels (“Morning half-day”) cramped | `grid-cols-1 sm:grid-cols-3` or shorten mobile labels | S |
| Leave / password dialogs | `DialogFooter` not stacked | `flex-col gap-2 sm:flex-row` | S |
| Document preview header | Print/Back `h-9` beside long title in one row | Stack title above actions; `min-h-11` | M |
| Leave dialog body | Nested `max-h-[90vh] overflow-y-auto` + long selects | Single scroll / mobile sheet | M |

### AdminDashboard

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Main tabs (web) | `TabsList` `hidden md:grid` + `grid-cols-4 lg:grid-cols-7` — no strip &lt;768px (depends on mobile nav) | Confirm mobile nav covers all tabs; or scrollable strip at all widths | M |
| Worker directory | `min-w-[1200px]` table in nested overflow | Sticky first col OK; add card list &lt;md | L |
| Foreign workers | `min-w-[1100px]` same pattern | Same as local workers | L |
| Payslip report | `min-w-[1040px]` + `whitespace-nowrap` headers (has `overflow-x-auto`) | Keep scroll; optional card/summary &lt;md | L |
| Sites tab | `min-w-[880px]`; Actions `min-w-[220px] whitespace-nowrap` | Stack/collapse actions to menu | M |
| Time tracker filters | `grid-cols-3` worker-type tabs tight at 375px | 2-col or scroll on `&lt;sm` | S |
| Time tracker toolbar | Six outline buttons in `grid-cols-2` | Stack full-width on `&lt;sm` | S |
| Dialogs | Many footers lack stacked layout | Batch `flex-col sm:flex-row` | M |
| Payslip filters | `min-w-[200px]` on month inputs | `min-w-0 w-full` below `sm` | S |

### ManagerDashboard

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Page root | `overflow-x-hidden` on root + main can clip inner horizontal scroll | Scope overflow to chrome only | S |
| Primary tabs | 4 tabs in `grid-cols-2` — OK; long i18n labels may wrap oddly | Watch translations | S |
| Shift cards | Hours row `flex … gap-4` without wrap | `flex-wrap` | S |
| Create / print dialogs | Row `DialogFooter` | Stack on mobile | S |
| Edit shift | `grid-cols-2` datetime; break remove `h-6 w-6` | Stack fields; 44px delete | S |
| Company forms tab | Embeds review/editor panels | Audit child components for tables | M |

### SupervisorDashboard

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Filters | Dual TabsLists with responsive grids | Mostly OK | — |
| Shift cards | Hours line without wrap | `flex-wrap` | S |
| Edit shift | `grid-cols-2` entry/exit; `h-6 w-6` delete | Stack; enlarge delete | S |

### History

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Header | Logo + `text-2xl` title + address in one `justify-between` row | `flex-col … sm:flex-row` | M |
| Expand control | Chevron `p-1` / `w-4 h-4` (~24px) | `min-h-11 min-w-11` | S |
| Fixed footer | Footer + list padding | Mostly OK; watch fold | S |

---

## LEGACY — Materials

### RequestPortal

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| PageHeader actions | History + Logout in trailing; title `nowrap` competes at 375px | Stack / icon-only + menu on `max-sm` | M |
| Password toggles (web) | Bare Eye button ~16px icon hit area | `h-11 w-11` hit box | S |
| MaterialForm | `size="icon"`, `whitespace-nowrap` qty, `grid-cols-2` rows | `min-w-0`; stack qty on `max-sm` | M |

### AdminDashboard

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| FilterToolbar | Hub stub ignores `search`/`filters`/`actions` | See cross-cutting | L |
| Section tabs | Up to 6 `TabsTrigger`s, `whitespace-nowrap`, horizontal scroll | Short labels or section dropdown | M |
| Transaction toolbar | Up to 5 `size="sm"` buttons per pending row | Primary row + “More” menu | M |
| Expand chevron | `h-10 w-10` (40px) | `min-h-11 min-w-11` | S |
| akk-tx-meta / return text | Unstyled meta; long return strings no `break-words` | Wrap utilities | S |

### ManagerDashboard

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Shared layout | Thin wrapper around AdminDashboard (`role="manager"`) | Same FilterToolbar + tab fixes once | L |

---

## LEGACY — Progress

### WorkerPortal

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| PageHeader actions | Bell + account + Logout crowded in trailing | Wrap or overflow menu on `max-sm` | M |
| Hero grid | `grid-cols-1 sm:grid-cols-2` | Mostly OK | — |

### SubmitProgress

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Stage picker | `grid-cols-2` / `sm:grid-cols-4`; stage buttons lack `min-h-11` on web | Add `min-h-11` | S |
| ReviewSheet | Remove photo `h-7 w-7` (~28px) | `h-11 w-11` | S |
| Review footer | Stacks on 375px | Mostly OK | — |
| Nested scroll | Form + ReviewSheet `overflow-y-auto` | Prefer sheet / single scroll | S |

### ManagerDashboard

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| PortalShell segments | `overflow-x-auto` + `min-w-max` (4 sections) | Mostly OK; shorter labels optional | S |
| Lazy panels | Branding / CommercialHub / PackageReviewBoard | Residual desktop risk when opened | M |

### AdminDashboard

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Segmented tabs | Ops + admin tabs; segmented `min-height` ~40px | Bump to 44px on touch | S |
| Lazy panels | Analytics / export / users tabs | Test each at 375px | M |

### ExporterDashboard

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| TabsList | `w-full` + `whitespace-nowrap` + overflow scroll | Mostly OK | — |
| Logout (web) | `size="sm"` text button | `min-h-11` | S |
| Reports tab | Lazy `CommercialHub` | Residual desktop layout | M |

---

## SMALL-PAGES — Timesheet

### LegalNotice

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Content | `max-w-4xl` card — fine at 375px | Mostly OK | — |

### AdminAnnouncements

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Create header | Title vs Post button may collide | `flex-wrap gap-2` | S |
| List actions | Active + Delete beside long body | Wrap or stack under title | S |

### AdminForms

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Delete icon | `h-8 w-8` | `h-11 w-11` | S |

### AdminFormDetail

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Top actions | Save / Publish / Delete strip | Primary-only on mobile optional | S |
| Reorder / delete | `h-8 w-8` icon buttons | 44px targets | S |
| Response rows | Name + timestamp + chevron squeeze | Stack meta under title | S |

### WorkerFormFill

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Form body | Single column; rating `h-10` | Mostly OK | — |

### WorkerSubmittedForms

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Rows | Timestamp `shrink-0` may clip title | Wrap date below label | S |

### WorkerCompanyForms

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Dept grid | `sm:grid-cols-2` → 1 col at 375px | Mostly OK | — |

### WorkerCompanyFormFill

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| CompanyFormFiller | Page is thin wrapper; table/checklist layouts in child | Card or `overflow-x-auto` in filler | L |

### WorkerCompanyFormHistory

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Row | Small checkbox + title + compact print actions | Stack print; enlarge checkbox hit | M |
| Detail dialog | Nested scroll | Full-screen sheet on mobile | M |

### LeaveHistory

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Actions | Print/Withdraw `size="sm"` | `min-h-10`+ | S |
| Card header | Status + timestamp `justify-between` | Stack timestamp | S |

### ShiftHistory

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Month stats / chips | Responsive grids + wrap | Mostly OK | — |
| Expand chevrons | Likely small targets | 44px header hit | S |

### WorkerTimesheets

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Pending actions | `flex-wrap` View/Submit/Decline | Mostly OK | — |
| Doc preview | Header row + `h-9` actions | Stack; taller buttons | M |
| Decline dialog | Row footer | Stack | S |

### Analytics

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Filters / KPIs | Responsive grids | Mostly OK | — |
| Subtitle | Long date range in shell | Truncate on `&lt;sm` | S |

### AttendanceReport

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Calendar | `grid-cols-7 gap-2` cells ~40px, `text-[11px]` | Smaller gap or week strip / list view | M |
| Worker summary | Single `text-xs` ·-separated line | Allow wrap / stack | S |

### ManagerTimesheets

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Toolbars | `flex-wrap` action rows | Mostly OK | — |
| Back | `h-9 w-9` | 44px | S |
| Decline footer | Row layout | Stack | S |
| Wrapper | `overflow-x-hidden` | Scope carefully | S |

### AdminCompanyForms

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Sub tabs | `grid-cols-3` with icons — labels clip | `text-xs` / icon-only + aria / scroll | S |
| Review / questions | Child panels | Component-level table audit | M |

---

## SMALL-PAGES — Materials

### RequestHistory

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| FilterToolbar | Hub API mismatch — filters missing | See cross-cutting | L |
| Status lines | Narrow second column beside material name | Stack under name on `max-sm` | S |
| akk-tx-meta | Unstyled | See cross-cutting | S |

### History

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| FilterToolbar | Same hub mismatch — type/date/worker + Bulk Print missing | See cross-cutting | L |
| Cards | Single-column; Export/Delete wrap | Mostly OK | — |

---

## SMALL-PAGES — Progress

### MySubmissions

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Cards | `min-w-0`, stacked `min-h-11` actions | Mostly OK | — |
| Edit street link | `text-xs` text link | `min-h-11` button | S |
| Vertical length | Many CTAs + details per package | Collapse secondary | S |

### MyAccount

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Panel | `max-w-lg` stacked fields | Mostly OK | — |
| Submit buttons | No `min-h-11` on web | `min-h-11 w-full sm:w-auto` | S |

### PhotoVerification

| area | problem | suggested fix | effort |
|------|---------|---------------|--------|
| Steps / forms | Responsive stack | Mostly OK | — |
| Choose photos (web) | Missing `min-h-11` | Always `min-h-11` | S |

---

## Suggested polish priority (for Claude marks)

1. **L — unblock:** Materials FilterToolbar hub mismatch (AdminDashboard / ManagerDashboard / RequestHistory / History).
2. **L — redesign candidates:** Timesheet AdminDashboard wide tables (workers / payslip / sites); WorkerCompanyFormFill table layouts.
3. **M — chrome:** Timesheet Admin tabs &lt;md; Materials/Progress header action crowding; AttendanceReport calendar; dialog sheets.
4. **S — batch:** Tap targets, DialogFooter stacks, flex-wrap on meta rows, akk-tx-meta CSS.

## MOBILE-POLISH applied (2026-10-20) — SMALL-PAGES only

Per Claude 17:00 + 16:15 order (skip 13 legacy dashboards). Done in modules:

- Materials `RequestHistory` / `History`: module `FilterToolbar` (not hub stub); `akk-tx-meta` → Tailwind wrap; status/edit stack on narrow
- Timesheet: AdminAnnouncements wrap header; AdminForms/AdminFormDetail 44px icons; LeaveHistory stack + min-h-11 actions; ShiftHistory expand hit; WorkerSubmittedForms date under label; WorkerTimesheets preview/decline mobile footers; ManagerTimesheets back + decline stack; AdminCompanyForms short tab labels; Analytics shorter subtitle; AttendanceReport wrap summary + tighter calendar
- Progress: MySubmissions edit-link `min-h-11`

Still open (Claude): 13 legacy dashboard wide tables; hub PublicTabBar (Claude).

## MOBILE-POLISH — Cursor Batch 2 + 3 (2026-10-20 Coordinator)

Done (modules; no business logic):

- **Batch 2:** Timesheet admin section strip 44px chips (CSS); payslip month `min-w-0`; Sites row **More** menu &lt;md; Materials admin short tab labels + transaction **More** menu &lt;sm; Progress admin segmented **44px** (`ProgressPortalShell`).
- **Batch 3:** Timesheet admin payslip + local/foreign worker **card lists** &lt;md; `FormTableEditor` / `CompanyFormFiller` mobile table layout; Admin long dialogs → `moduleSheetDialog` (hub bottom sheet on phones).
- **Audit knock-offs:** AttendanceReport **list view** &lt;md; WorkerCompanyFormFill table layout; dialog sheets (module long dialogs).

## MOBILE-POLISH — Cursor Batch 1 (2026-10-20 Coordinator 17:24)

Done (modules only; no business logic):

- Timesheet dialogs: `DialogFooter` → `flex-col gap-2 sm:flex-row` + `w-full sm:w-auto` buttons (Worker/Manager/Supervisor/Admin).
- Manager/Supervisor: edit-shift datetime `sm:grid-cols-2`; break delete `h-11 w-11`; break time grids stack; Manager `overflow-x-hidden` kept on root, removed from `main`.
- WorkerPortal leave: duration chips `grid-cols-1 sm:grid-cols-3`; single-scroll body; doc preview header stacked + `min-h-11`.
- Materials: RequestPortal History → icon `h-11` on max-sm (Eye/password gone post HUB-INTEGRATION); MaterialForm qty `min-w-0` / stack max-sm.
- Progress: SubmitProgress stage `min-h-11` + ReviewSheet remove `h-11 w-11`; WorkerPortal header wrap; Exporter logout `min-h-11`; PhotoVerification Choose/Check `min-h-11`. MyAccountPanel already had submit `min-h-11`.
- Stripped noisy Timesheet `console.log` (kept DEBUG_MODE `info` helpers + `console.error`).

Queued next: Cursor Batch 2 (do not start until Batch 1 posted).

---

## Live QA addendum (2026-10-20) — home / chrome / login

See **`QA_FINDINGS.md`** for the full pass. Short notes for polish/redesign:

| area | problem | owner | effort |
|------|---------|-------|--------|
| Hub `/` PublicTabBar | Shows on phone-width **web**; source web homes have no bottom tabs | Claude (`pages/PublicTabBar`, `Home`) | S |
| Hub Home padding | `pb-[var(--g-tabbar-space)]` even when tab bar `lg:hidden` | Claude | S |
| Native module screens | HubLayout TabBar + materials/progress `NativeBottomNav` | Claude + modules | M |
| Timesheet Admin &lt;md | Hub TabBar + `AdminWebsiteMobileNav` | Claude / timesheet chrome | M |
| Materials RequestHistory logout | Was `/login` (broken shared path) → fixed `/connect/materials` | Cursor (done) | S |
