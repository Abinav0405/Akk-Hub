# Running the backend migration

The three old projects are **only read**: every connection to them is forced read-only by the server.
Only the new project (`rvejqoxmvcemeebywpzx`) is written to.

## 1. Fill in the credentials file (once)

Copy `migration/.env.migration.example` to `migration/.env.migration.local` and fill it in.
That file is gitignored. Never paste its values into chat.

## 2. Test run, offline (no databases touched)

```bash
cd "Akk Hub/migration/tool" && npm install && npm run selftest
```

Expect `41 passed, 0 failed`.

## 3. Move the data

```bash
cd "Akk Hub/migration/tool" && node migrate.mjs all
```

The run goes check → snapshot → build → apply → auth → copy → finish → verify. It ends with
"Everything matches." Each step can also be run on its own (`node migrate.mjs <step>`), and the
`apply` SQL is written to `tool/out/sql/` for review.

Then copy the photos and files (about 8.8 GB). This step is resumable: run it again to continue or to retry failed files.

```bash
cd "Akk Hub/migration/tool" && node migrate.mjs storage
```

To start over (this wipes only what the tool created in the new project):

```bash
cd "Akk Hub/migration/tool" && node migrate.mjs reset --confirm-reset-new-project
```

## 4. Dashboard steps (new project)

1. Project Settings → Data API → **Exposed schemas**: add `core`, `attendance`, `materials`, `progress`.
2. **Rotate** the two push webhook secrets that were exposed earlier. Their webhook pieces were left
   out of the copy on purpose and are re-created for the new project at switch-over.

## What the new project contains

| Schema | What |
| --- | --- |
| `attendance`, `materials`, `progress` | Each old app's tables, functions, rules and data. Same names as before. |
| `core.worker_access` | One row per Attendance worker: Materials on/off, Site photos on/off. |
| `core.sites` | One place per real site, linking that place's rows in each area (`config/site-merges.json`). |
| `core.attendance_admins` | Who counts as an Attendance admin (it used to be "anyone signed in"). |

Other changes:

- **Workers:**
  - One login. A worker's Attendance session also opens Materials and Site photos when their access is on.
  - Their old Materials and Site photos logins keep working too.
- **Staff and admins:**
  - The same e-mail in several projects became one sign-in account; the Attendance password wins.
  - Staff accounts stay separate from worker profiles: supervisor 1018 and worker 1018 are two profiles, and so are IDs ending in `r`.
- **Materials passwords:** they were stored as plain text and are now encrypted. The same passwords still work.
- **Permissions:** every old permission is kept for each kind of user. Signing in to one area no longer grants another area's admin rights, and each area's file rules cover only its own buckets.
- **Push:** Site Progress push is paused in the new project until the switch-over.

## Switch-over (later, separate step)

- **Hub:**
  - Point the hub at the new project's URL and key, with `db.schema` per area.
  - Use `core.my_access` to show and hide areas.
  - Build the admin "worker details" access switches on `core.admin_get_worker` / `core.admin_set_worker_access`.
- **Edge functions:**
  - Redeploy them to the new project.
  - Materials `register-device-token` compares requester passwords as plain text; change it to call `materials.verify_requester_login` (or `core.verify_password`) first.
- **Push:** re-create the push webhooks with new secrets.
