# PERF_AUDIT — Timesheet AdminDashboard (Stage 2)

**Date:** 2026-10-21  
**Target:** `src/modules/timesheet/pages/AdminDashboard.jsx` tab-switch lag

## Before
- Single ~15.2k-line component; every tab’s JSX tree created on parent render
- Only `VehiclesTab` was lazy + active-gated
- Shifts list paginated (50); leave cards rendered all at once

## After (this pass)
| Tab | Chunk (approx) | Mount |
| --- | ---: | --- |
| TimeTrackerTab | ~17 KB / 5 KB gz | active only |
| LeavesTab | ~19 KB / 6 KB gz | active only + Show more (50) |
| PayslipReportTab | ~21 KB / 5 KB gz | active only |
| TimesheetReportTab | ~10 KB / 3 KB gz | active only |
| WorkerInfoTab | ~22 KB / 3 KB gz | active only |
| SitesTab | ~7 KB / 2 KB gz | active only |
| VehiclesTab | (pre-existing) | active only |

- `AdminDashProvider` shares handlers/state with tab panels (features preserved)
- Parent still holds dialogs + data hooks (next win: move tab-local queries into panels)

## Measure
- Build: `npm run build` GREEN; tab panels emit separate Vite chunks (see `dist/assets/*Tab-*.js`)
- Manual: switch Attendance admin tabs — inactive panel DOM absent; first open of a cold tab shows `PageLoader` then panel

## Not done
- Split remaining parent hook/dialog monolith
- Virtualize shift/worker tables beyond page size
- React Profiler numeric before/after (optional follow-up)
