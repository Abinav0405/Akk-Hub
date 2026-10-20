# PERF_AUDIT — SPEED-SWEEP (2026-10-20)

Scope: `src/modules/**` only. Claude owns shell/Home/Login; no edits there.

---

## Fixed

### Navigation (full reload → SPA)
| file | change |
|------|--------|
| `timesheet/pages/WorkerTimesheets.jsx` | `window.location.href = '/login'` → `navigate('/login', { replace: true })` (already had `useNavigate`) |

Left as-is (not in-app nav):
- `progress/components/ErrorBoundary.jsx` — intentional hard reload after fatal error
- `window.location.origin` for absolute logo/URL resolution

### Polling / heartbeats (pause when `document.hidden`)
| file | change |
|------|--------|
| `timesheet/lib/smartPolling.js` | Skip tick when hidden; tick on visibility restore |
| `timesheet/components/worker/WorkerHome.jsx` (`useNow`) | Pause live clock when tab hidden |
| `timesheet/components/DriverStatusCard.jsx` | Pause 1s timer + 8s route poll when hidden |
| `timesheet/components/VehicleLiveMap.jsx` | Pause 5s fallback poll when hidden |
| `timesheet/pages/ManagerDashboard.jsx` | Smart heartbeat 5s skips when hidden |
| `timesheet/pages/SupervisorDashboard.jsx` | Same |
| `timesheet/pages/AdminDashboard.jsx` | Online heartbeat + smart shift poll skip when hidden |
| `timesheet/lib/vehicleTracking.js` | GPS upload interval skips when hidden |
| `materials/pages/AdminDashboard.jsx` | Online heartbeat skips when hidden; transactions poll **30s** + `refetchIntervalInBackground: false` (was 3s; Claude 16:45) |
| `materials/pages/RequestPortal.jsx` | `get_worker_transactions` poll **30s** + `refetchIntervalInBackground: false` (was 3s) |
| `materials/pages/RequestHistory.jsx` | Same as RequestPortal |
| `timesheet/pages/ShiftHistory.jsx` | Added `refetchIntervalInBackground: false` (30s poll already) |

Already good: `progress/hooks/useHeartbeat.js`, `progress/components/CameraCapture.jsx` (already check `document.hidden`).

### Heavy libs → `await import()` at use
| file | change |
|------|--------|
| `materials/pages/AdminDashboard.jsx` | Dropped top-level `xlsx`; dynamic in `exportToExcel` |
| `materials/pages/History.jsx` | Same |
| `timesheet/pages/AdminDashboard.jsx` | Dynamic `xlsx` in worker + shift exports; leave export awaits async `leaveExport` |
| `timesheet/pages/ManagerDashboard.jsx` | Dynamic `xlsx` in export |
| `timesheet/pages/SupervisorDashboard.jsx` | Dynamic `xlsx` in export |
| `timesheet/pages/AdminFormDetail.jsx` | Dynamic `xlsx` in responses export |
| `timesheet/lib/leaveExport.js` | Async + dynamic `xlsx` |
| `timesheet/pages/AttendanceReport.jsx` | Dynamic `html2pdf.js` in `exportPdf` |

---

## Listed only (not changed / Claude or larger)

### Heavy libs still top-level (component *is* the heavy UI, or always-on when mounted)
| file | lib | note |
|------|-----|------|
| `progress/lib/documentEndorsement.js` | `pdf-lib` | Lib used when endorsing; callers often dynamic already |
| `progress/lib/pdf.js` | html2canvas, jspdf | Lib module — keep; prefer callers `await import` |
| `progress/lib/packageExcel.js` / `jsrExcel.js` | exceljs | Same |
| `progress/components/EndorsementPreview.jsx` | pdfjs-dist | Preview needs it when mounted |
| `progress/components/AnalyticsPanel.jsx` | recharts | Chart panel; already lazy from dashboards |
| `materials/components/AdminAnalytics.jsx` | recharts | Same |
| `timesheet/components/LiveQrCamera.jsx` | html5-qrcode | Camera screen needs it when mounted |
| `timesheet/components/VehicleLiveMap.jsx` | leaflet | Map when expanded; could lazy the whole map later (M) |
| `timesheet/lib/pdfDownload.js` | html2canvas, jspdf | Lib; used on share/PDF actions |

### `select('*')` (118+ hits) — leave query shapes alone
Widespread on shifts/workers/transactions. Narrowing needs column inventories; list for Claude if hub wants payload cuts. Highest volume: `AdminDashboard` (timesheet), manager/supervisor dashboards, materials transactions.

### Intervals &lt; 15s kept (with visibility pause where applicable)
| location | interval | reason |
|----------|----------|--------|
| Smart heartbeats | 5s | Head-only cheap poll |
| DriverStatusCard timer | 1s | Live elapsed display |
| FaceMatchPrompt | FRAME_MS | Camera frame loop — do not pause mid-match |
| WorkerHome `useNow` | ~1s | Live clock UI |

### Materials poll raise (Claude 16:45 add-on) — done
| location | was | now |
|----------|-----|-----|
| `RequestPortal` / `RequestHistory` / `AdminDashboard` transactions queries | 3s | 30s + `refetchIntervalInBackground: false` |
| Progress pages | — | no `refetchInterval` on pages (only heartbeat / camera timers) |

### Serial awaits / StrictMode double channels
Not audited file-by-file for `Promise.all` opportunities; no obvious safe serial-to-parallel without behavior risk. Realtime channel double-open under StrictMode: leave for Claude if still noisy after foundation rewrite.

### Wake #58 — `/timesheet/shifts` + `/timesheet/timesheets` (Claude 19:40)
| route | before (QA hunt) | after | change |
|-------|------------------|-------|--------|
| `/timesheet/shifts` | ~3.7 s usable (empty) | **~2.6 s** usable | Narrow shift/break cols; `.limit(365)`; sites Map lookup; sites+breaks still `Promise.all` |
| `/timesheet/timesheets` | ~2.3 s usable (empty) | list loads without `timesheet_html`; HTML fetched on View | Dropped list `select('*')` |

---

## Suggested next (Claude / later Cursor)
1. Lazy-load `VehicleLiveMap` / `AdminAnalytics` / `AnalyticsPanel` at button/tab open if not already.
2. ~~Raise materials transactions poll~~ — done (30s).
3. Column-trim hottest `select('*')` queries after schema review.
