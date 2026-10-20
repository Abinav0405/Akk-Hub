# ASSETS — provenance

All destinations are under `Akk Hub/`. Sources were read-only. Last hardened: ASSETS lane (refresh + inventory).

## Runtime paths used by modules

| URL path | File on disk | Notes |
|---|---|---|
| `/Akk-logo.jpg` | `public/Akk-logo.jpg` | Timesheet + Materials default logo (identical bytes in both sources) |
| `/Akk-logo.png` | `public/Akk-logo.png` | Timesheet PNG logo |
| `/akk logo.jpg` | `public/akk logo.jpg` | Timesheet `emailNotification` icon/badge |
| `/akk-logo.png` | *(collision — see below)* | Progress `branding.js` / `canvasOverlay.js` fallback |
| `/akk-logo-progress.png` | `public/akk-logo-progress.png` | Progress logo (safe casing; use this instead of `/akk-logo.png`) |
| `/brand/akk-logo-spt.png` | `public/brand/akk-logo-spt.png` | Same bytes as Progress `akk-logo.png` |
| `/brand/akk-logo-wide.png` | `public/brand/akk-logo-wide.png` | Same bytes as `AKK_logo_straight_transparent.png` |
| `/brand/akk-site-progress-logo.png` | `public/brand/akk-site-progress-logo.png` | URL-safe copy of SPT app logo |
| `/models/*` | `public/models/*` | face-api local fallback (`faceRecognition.js` uses CDN first, then `/models`) |
| `/favicon-32.png`, `/favicon-48.png`, `/apple-touch-icon.png` | matching `public/` files | Linked from `index.html` |

### Windows case collision

`Akk-logo.png` (Timesheet, 123 873 bytes) and Progress source `akk-logo.png` (143 594 bytes) are **different files**. On a case-insensitive volume they cannot coexist as distinct paths under `public/`. Progress code still requests `/akk-logo.png`, which will resolve to Timesheet’s `Akk-logo.png` on Windows. Prefer `/akk-logo-progress.png` or `/brand/akk-logo-spt.png` (see `NEEDS.md`).

## public/

| Destination | Source |
|---|---|
| `public/Akk-logo.png` | `AKK-Timesheet-Manager-main/public/Akk-logo.png` |
| `public/Akk-logo.jpg` | `AKK-Timesheet-Manager-main/public/Akk-logo.jpg` (= Materials `public/Akk-logo.jpg`) |
| `public/akk logo.jpg` | `AKK-Material-Tracker-main/public/akk logo.jpg` |
| `public/logo-materials.png` | `AKK-Material-Tracker-main/logo.png` (renamed; avoids clashing with workspace `logo.png`) |
| `public/akk-logo-progress.png` | `Site progress tracker/public/akk-logo.png` (renamed for case-safe URL) |
| `public/favicon.ico` | `Site progress tracker/public/favicon.ico` |
| `public/favicon.png` | `Site progress tracker/public/favicon.png` |
| `public/favicon-32.png` | `Site progress tracker/public/favicon-32.png` |
| `public/favicon-48.png` | `Site progress tracker/public/favicon-48.png` |
| `public/apple-touch-icon.png` | `Site progress tracker/public/apple-touch-icon.png` |
| `public/Akk new logo.png` | `Websites final/Akk new logo.png` |
| `public/logo.png` | `Websites final/logo.png` |
| `public/akk logo (1).ico` | `Websites final/akk logo (1).ico` |
| `public/AKK_logo_straight_transparent.png` | `Site progress tracker/AKK_logo_straight_transparent.png` |
| `public/AKK_Site_Progress_Tracker_logo.png` | `Site progress tracker/AKK_Site_Progress_Tracker_logo.png` |
| `public/brand/akk-logo-spt.png` | `Site progress tracker/public/akk-logo.png` |
| `public/brand/akk-logo-wide.png` | `Site progress tracker/AKK_logo_straight_transparent.png` |
| `public/brand/akk-site-progress-logo.png` | `Site progress tracker/AKK_Site_Progress_Tracker_logo.png` |
| `public/models/tiny_face_detector_model.bin` | `AKK-Timesheet-Manager-main/public/models/` |
| `public/models/tiny_face_detector_model-weights_manifest.json` | same |
| `public/models/face_landmark_68_model.bin` | same |
| `public/models/face_landmark_68_model-weights_manifest.json` | same |
| `public/models/face_recognition_model.bin` | same |
| `public/models/face_recognition_model-weights_manifest.json` | same |

## src/assets/

Bundled copies for import-style usage (same bytes as `public/` counterparts):

| Destination | Source |
|---|---|
| `src/assets/Akk new logo.png` | `Websites final/Akk new logo.png` |
| `src/assets/logo.png` | `Websites final/logo.png` |
| `src/assets/akk logo (1).ico` | `Websites final/akk logo (1).ico` |
| `src/assets/AKK_logo_straight_transparent.png` | `Site progress tracker/AKK_logo_straight_transparent.png` |
| `src/assets/AKK_Site_Progress_Tracker_logo.png` | `Site progress tracker/AKK_Site_Progress_Tracker_logo.png` |

## Fonts / other static

- No local `.woff`/`.ttf` fonts in any of the three source `public/` trees.
- Hub uses Google Fonts Inter via `index.html` (Claude-owned; not copied here).

## Skipped (intentionally)

- `.env*`, `keystore`, `google-services.json`, Firebase admin JSON, `fcm-secrets.env`
- Any `android/` folders (including splash/launcher drawables), `node_modules`, `dist`
- Cloudflare `public/_headers`, `_redirects`, `_routes.json`
- Marketing site (`AKK-Main-webpage-main`) and Camera Flutter app assets
