# ANDROID_NOTES — Capacitor / Android manifests (CAPACITOR-DOCS)

Source manifests compared for hub merge. Paths are relative to the sibling app folders under `Websites final/`.

## Timesheet — `AKK-Timesheet-Manager-main/android/app/src/main/AndroidManifest.xml`

| Item | Value / notes |
|------|----------------|
| Package / launch | `.MainActivity`, `launchMode=singleTask`, exported launcher |
| Permissions | `CAMERA`, `USE_BIOMETRIC`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `INTERNET`, `POST_NOTIFICATIONS`, `WAKE_LOCK` |
| Location comment | While-in-use only (site QR geofence). Vehicle journey GPS is website-only (no FGS). |
| FCM channel | `com.google.firebase.messaging.default_notification_channel_id` = `akk_updates` |
| FCM icon | `@mipmap/ic_launcher` |
| FileProvider | `${applicationId}.fileprovider` → `@xml/file_paths` |

### Patch to carry forward

`patches/@capacitor+push-notifications+8.0.3.patch` (patch-package):

- Wraps FCM `register()` in try/catch.
- Treats empty/null token as error.
- Still `call.resolve()` after `sendError` so the JS bridge does not hang on FCM init failure.

Hub should re-apply this patch (or equivalent) when Capacitor push is wired.

## Materials — `AKK-Material-Tracker-main/android/app/src/main/AndroidManifest.xml`

| Item | Value / notes |
|------|----------------|
| Launch | `.MainActivity`, `launchMode=singleTop`, `windowSoftInputMode=adjustResize` |
| Permissions | `INTERNET`, `POST_NOTIFICATIONS` (Android 13+) |
| FileProvider | `${applicationId}.fileprovider` → `@xml/file_paths` |
| No camera / location / biometric | Lightweight staff/worker request UI |

## Progress (SPT) — `Site progress tracker/android/app/src/main/AndroidManifest.xml`

| Item | Value / notes |
|------|----------------|
| Launch | `.MainActivity`, `launchMode=singleTask`, hardwareAccelerated, `adjustResize` |
| FCM channel | `spt_updates` |
| Permissions | `INTERNET`, `CAMERA`, `MODIFY_AUDIO_SETTINGS`, `RECORD_AUDIO`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`, `READ_MEDIA_IMAGES`, `READ_MEDIA_VISUAL_USER_SELECTED`, `READ_EXTERNAL_STORAGE` (maxSdk 32) |
| Features | `camera` required; `camera.autofocus` / `microphone` optional |
| Camera + audio note | WebView getUserMedia often requests audio with video; without `RECORD_AUDIO` / `MODIFY_AUDIO_SETTINGS` the camera prompt can fail entirely |
| Gallery | `READ_MEDIA_*` for Photo Verification / attach-from-gallery |

## Hub merge implications (for Claude / MOBILE-POLISH later)

1. **Union permissions** for a single APK: Timesheet biometric + Progress camera/gallery/GPS + Materials notify + shared `INTERNET` / `POST_NOTIFICATIONS` / FileProvider.
2. **FCM channel ids** differ (`akk_updates` vs `spt_updates`) — decide one hub channel (or map both) before production push.
3. **launchMode**: Timesheet/SPT use `singleTask`; Materials uses `singleTop` — pick one for hub `MainActivity`.
4. Do **not** add vehicle-journey FGS; Timesheet intentionally keeps driving GPS on website only.
5. Hold **MOBILE-POLISH** until Claude marks `mobile: needs-polish` rows (per NEEDS order).

## Camera app (out of scope)

`AKK Camera App` is Flutter — not ported into Akk Hub. Its manifests are not required for this Capacitor merge.
