# Android push notifications — AKK Hub

The app side is done (`src/core/push.js`). It:

- asks for permission after sign-in;
- gets this phone's Firebase (FCM) token and registers it with every back-end the person uses
  (Attendance, Materials, Site work), through each back-end's existing endpoint;
- shows a toast when a notification arrives while the app is open;
- opens the right screen when a notification is tapped, including from a closed app;
- removes the phone at sign-out.

It stays **off** until the three steps below are done.

## 1. One Firebase project for the hub

1. In the Firebase console, create (or reuse) a project for **AKK Hub** and add an Android app with
   package name **`sg.akk.hub`**.
2. Download `google-services.json` and put it at **`android/app/google-services.json`**.
   It's gitignored: never commit it. The Gradle build applies the Google Services plugin
   automatically when the file is there.

## 2. Point all three back-ends at that Firebase project

FCM only delivers a token through the Firebase project that issued it. Each back-end's push
sender (its Supabase edge function / FCM service-account secret) must use the **AKK Hub** project's
service account:

| Back-end | Where it sends from |
| --- | --- |
| Attendance (Timesheet DB) | edge functions that send FCM (service-account secret) |
| Materials (Materials DB) | edge functions that send FCM (service-account secret) |
| Site work (Progress DB) | edge functions that send FCM (service-account secret) |

Update each project's FCM service-account secret in Supabase → Edge Functions → Secrets
(server-side only; never put it in the app or `.env`).

For a notification to open a screen when tapped, the payload's `data.path` should be a hub path,
e.g. `/timesheet/admin?section=leaves`, `/materials/admin`, `/progress/review`, `/me`.
Old page names (`AdminDashboard`, `RequestPortal`…) are still understood.

## 3. Turn it on and build

1. In `.env`: `VITE_ENABLE_FCM_REGISTER=true`. Keep it `false` while `google-services.json` is
   missing: Firebase isn't initialised without it.
2. Build and sync:

   ```bash
   npm run build:android
   ```

3. Install on a phone, sign in, allow notifications, and send a test (for example approve a
   leave request from another device).

## Limits

- **Supervisors:** the Attendance push function has no supervisor subject yet, so supervisors only
  get Site work / Materials notifications until that function accepts one.
- **Material workers:** that back-end's endpoint needs the worker's password once, so their phone
  registers when they link Materials (or on their next sign-in), not on a silent app restart.
- **Known Capacitor bug:** `@capacitor/push-notifications` 8.1.3 can crash on a rare FCM error with
  no exception. The Timesheet app patched this with patch-package. The hub doesn't include that
  patch, so add it before wide rollout if you see crashes at registration.
