# Android push notifications — AKK Hub

The app side is done (`src/core/push.js`). It:

- asks for permission after sign-in;
- gets this phone's Firebase (FCM) token and registers it with every back-end the person uses
  (Attendance, Materials, Site work), through each back-end's existing endpoint;
- shows a toast when a notification arrives while the app is open;
- opens the right screen when a notification is tapped, including from a closed app;
- removes the phone at sign-out.

Client registration is **on** when `VITE_ENABLE_FCM_REGISTER=true` and
`android/app/google-services.json` is present. Back-end senders still need the Hub Firebase
service account (section 2).

## 1. One Firebase project for the hub

1. In the Firebase console, create (or reuse) a project for **AKK Hub** and add an Android app with
   package name **`sg.akk.hub`**.
2. Download `google-services.json` and put it at **`android/app/google-services.json`**.
   It's gitignored: never commit it. The Gradle build applies the Google Services plugin
   automatically when the file is there.

## 2. Point all three back-ends at that Firebase project — TRACK A

FCM only delivers a token through the Firebase project that issued it. Each back-end's push
sender must use the **AKK Hub** Firebase service account (`project_id` **`akk-hub-ef7c3`**).
Secret name everywhere: **`FCM_SERVICE_ACCOUNT_JSON`** (full JSON, server-side only — never
commit, never put in app `.env`).

| Back-end | Supabase ref | Sender | Code / deploy | Secret set to Hub SA? |
| --- | --- | --- | --- | --- |
| Attendance (Timesheet) | `xuqvzlbfqdkfjjhdvzac` | edge `fcm-db-webhook`, `leave-reminder` | **Deployed** hub `data.path` + supervisor subject | **DONE** — Hub SA (`akk-hub-ef7c3`) set as `FCM_SERVICE_ACCOUNT_JSON` |
| Materials | `tglslbsruyzkqpxczdzn` | edge `fcm-db-webhook` | **Deployed** hub `data.path` | **DONE** — Hub SA set as `FCM_SERVICE_ACCOUNT_JSON` |
| Site work (Progress) | `qpndkdbomtbnhkdyigyy` | edge `fcm-db-webhook` (+ Cloudflare Pages `FCM_SERVICE_ACCOUNT_JSON` if used) | **Code updated in repo**; deploy **403** (CLI account lacks Progress privileges) | **Blocked** — secrets + deploy both **403** (need Progress owner/admin CLI or Dashboard) |

### Done in code (hub paths)

Payloads now use hub paths (client still maps old names via `legacyPath`):

- Timesheet: `/timesheet/leave/history`, `/timesheet/timesheets`, `/timesheet/admin?section=leaves`, `/timesheet/manage`, `/timesheet/manage/timesheets`, `/me`, supervisors → `/site`
- Materials: `/materials/admin`, `/materials/history`
- Progress: `/progress/review`, `/progress/submissions`

### Done in code (supervisor Attendance subject)

- SQL to run once on Timesheet DB:
  `AKK-Timesheet-Manager-main/SQL files/active/migration_fcm_push_tokens_supervisor.sql`
- `register-device-token` accepts `supervisor_id` (role session `supervisor`) — **deployed**
- `fcm-db-webhook` notifies `supervisor_id` tokens on leave / timesheet awaiting-manager style events — **deployed**
- Hub `src/core/push.js` sends `supervisor_id` when role is supervisor

### Abinav — Hub Firebase SA status

- **Attendance + Materials:** Hub SA already set on both projects (do not re-commit the JSON; leave the adminsdk file off-repo under `Websites final\` root).
- **Progress still needs an owner/admin account** (current CLI login gets **403** on secrets and on `fcm-db-webhook` deploy).

Set Progress secret via Dashboard (**Edge Functions → Secrets → `FCM_SERVICE_ACCOUNT_JSON`**) or CLI after `supabase login` as a Progress privileged user. Prefer `--env-file` over inline JSON in PowerShell:

```powershell
# Build a one-line env file from the Hub SA path, then:
npx supabase secrets set --env-file $tmpEnv --project-ref qpndkdbomtbnhkdyigyy
cd "Site progress tracker"
npx supabase functions deploy fcm-db-webhook --project-ref qpndkdbomtbnhkdyigyy --no-verify-jwt
```

If Site work still sends via Cloudflare Pages, set the same secret name there too.

Also: run the supervisor SQL migration on Timesheet (SQL editor) if not already applied.

## 3. Turn it on and build (client — done)

1. In `.env` (local only; never commit): `VITE_ENABLE_FCM_REGISTER=true`.
   `.env.example` documents the same. Keep it `false` only while `google-services.json` is
   missing: Firebase isn't initialised without it.
2. Build and sync:

   ```bash
   npm run build:android
   ```

3. Install on a phone, sign in, allow notifications, and send a test (for example approve a
   leave request from another device).

`src/core/push.js` is wired from `main.jsx` (`initPush`) and `HubLayout` / module connect
(`registerPushDevice`). Modules register against Hub Firebase once the flag is on.

## Limits

- **Supervisors (code done — needs SQL):** Attendance Hub SA is set; apply the supervisor SQL
  migration if not done. Progress still blocked on 403 (section 2).
- **Material workers (fixed on client track):** that back-end's endpoint needs the worker's
  password once. The phone registers when they link Materials, or on the next hub / Materials
  sign-in that includes a password — not on a silent app restart (no password in memory).
- **Capacitor FCM crash (fixed on client track):** `@capacitor/push-notifications` 8.1.3 is
  guarded via `patches/@capacitor+push-notifications+8.1.3.patch` and `postinstall` →
  `patch-package` (same null-safe register fix as Timesheet).
