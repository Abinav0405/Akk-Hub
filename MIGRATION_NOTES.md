# Migration notes — storage key renames

`storageKey(module, key)` → `akk.<module>.<key>`.

This file lists renames observed in ported modules and matching Claude session helpers. Do not treat it as ownership of `src/core/` — only a cross-check for Wave 1 ports.

## timesheet

Session keys written by `@/core/auth/timesheetSession` (and read by ported screens via `storageKey('timesheet', …)`):

| Old key | New key |
|---|---|
| `adminLoggedIn` | `akk.timesheet.adminLoggedIn` |
| `adminName` | `akk.timesheet.adminName` |
| `adminEmail` | `akk.timesheet.adminEmail` |
| `workerLoggedIn` | `akk.timesheet.workerLoggedIn` |
| `workerName` | `akk.timesheet.workerName` |
| `workerId` | `akk.timesheet.workerId` |
| `workerType` | `akk.timesheet.workerType` |
| `workerLoginTime` | `akk.timesheet.workerLoginTime` |
| `managerLoggedIn` | `akk.timesheet.managerLoggedIn` |
| `managerName` | `akk.timesheet.managerName` |
| `managerEmail` | `akk.timesheet.managerEmail` |
| `supervisorLoggedIn` | `akk.timesheet.supervisorLoggedIn` |
| `supervisorName` | `akk.timesheet.supervisorName` |
| `supervisorId` | `akk.timesheet.supervisorId` |
| `supervisorSiteId` | `akk.timesheet.supervisorSiteId` |
| `roleSessionToken` | `akk.timesheet.roleSessionToken` |
| `roleSessionRole` | `akk.timesheet.roleSessionRole` |
| `authSessionExpired` | `akk.timesheet.authSessionExpired` |
| `lastWorkerId` | `akk.timesheet.lastWorkerId` |
| `lastWorkerType` | `akk.timesheet.lastWorkerType` |

### timesheet constant / lib keys (modules)

| Old key | New key |
|---|---|
| `akk_update_prompt_dismissed` | `akk.timesheet.akk_update_prompt_dismissed` |
| `akk.language` | **Wave 2:** moved to `akk.hub.language` via `storageKey('hub', 'language')` in `src/core-i18n/i18n.js` (timesheet `lib/i18n.js` re-exports). Legacy timesheet-scoped `akk.timesheet.akk.language` retired. |
| `akk_native_permissions_wizard_v1` | `akk.timesheet.akk_native_permissions_wizard_v1` |
| `akk_active_vehicle_journey_id` | `akk.timesheet.akk_active_vehicle_journey_id` |

## materials

| Old key | New key |
|---|---|
| `workerLoggedIn` | `akk.materials.workerLoggedIn` |
| `workerId` | `akk.materials.workerId` |
| `workerName` | `akk.materials.workerName` |
| `workerToken` | `akk.materials.workerToken` |
| `adminLoggedIn` | `akk.materials.adminLoggedIn` |
| `adminEmail` | `akk.materials.adminEmail` |
| `adminName` | `akk.materials.adminName` |
| `staffName` | `akk.materials.staffName` |
| `staffEmail` | `akk.materials.staffEmail` |
| `staffRole` | `akk.materials.staffRole` |
| `seenRequestIds:<workerId>` | `akk.materials.seenRequestIds:<workerId>` |

Note: materials staff Supabase persistence may also use literal `akk.materials.sb-auth` (not via `storageKey`).

## progress

| Old key | New key |
|---|---|
| `adminLoggedIn` | `akk.progress.adminLoggedIn` |
| `adminName` | `akk.progress.adminName` |
| `adminEmail` | `akk.progress.adminEmail` |
| `managerLoggedIn` | `akk.progress.managerLoggedIn` |
| `managerName` | `akk.progress.managerName` |
| `managerLoginId` | `akk.progress.managerLoginId` |
| `managerSessionToken` | `akk.progress.managerSessionToken` |
| `managerSessionExpired` | `akk.progress.managerSessionExpired` |
| `managerJsrPermissions` | `akk.progress.managerJsrPermissions` |
| `exporterLoggedIn` | `akk.progress.exporterLoggedIn` |
| `exporterName` | `akk.progress.exporterName` |
| `exporterSessionToken` | `akk.progress.exporterSessionToken` |
| `exporterSessionExpired` | `akk.progress.exporterSessionExpired` |
| `workerLoggedIn` | `akk.progress.workerLoggedIn` |
| `workerName` | `akk.progress.workerName` |
| `workerId` | `akk.progress.workerId` |
| `workerSessionToken` | `akk.progress.workerSessionToken` |
| `workerSessionExpired` | `akk.progress.workerSessionExpired` |

### progress constant keys (modules)

| Old key | New key |
|---|---|
| `spt_packageView` | `akk.progress.spt_packageView` |
| `spt_camera_device_id` | `akk.progress.spt_camera_device_id` |

## hub (Claude-owned; not module-prefixed via storageKey in all cases)

| Key | Notes |
|---|---|
| `akk.hub.biometricLogin` | Biometric prefs (`core/auth/biometric.js`) |
| `akk.hub.biometricOfferDeclined` | Declined offer list |
| `akk.hub.faceLoginDevice` | Face-login device prefs (localStorage) |
| `akk.hub.face-login-device` | Native secure-store key (not localStorage) |
| `akk.language` | Legacy literal in `src/core/i18n.js` if still present — prefer `akk.hub.language` from `@/core-i18n` |
| `akk.hub.language` | Wave 2 I18N-THEME canonical language key |

## Assets path notes (see `ASSETS.md`)

- Progress fallback logo rewritten to `/akk-logo-progress.png` in `modules/progress/lib/branding.js` + `canvasOverlay.js` (avoids Windows collision with Timesheet `Akk-logo.png`). Also available: `/brand/akk-logo-spt.png`, `/brand/akk-site-progress-logo.png`.
