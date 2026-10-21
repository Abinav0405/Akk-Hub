# Audit findings — Site Progress project (SPT + AKK Camera)

Source: `01_audit.sql` Query 1 + 2, run 2026-10-21. Postgres 17.6. Extensions: pg_net, pgcrypto, supabase_vault, uuid-ossp.

## Size (what has to move)
| Thing | Amount |
| --- | --- |
| Database | 65 MB · 38 tables · ~25k rows total (package_images 16,161 · notifications 3,843 · document_audit_events 3,299 · package_edit_log 2,690 · packages 619 · document_titles 518) |
| Storage `progress-photos` | **8,152 MB · 17,081 files** (private) |
| Storage `document-artifacts` | 591 MB · 234 files (private) |
| Storage `akk-camera-photos` | 18 MB · 17 files (private) — but `akk_camera_photos` table has **0 rows** (camera app is not registering photos, or only the bucket is used) |
| Storage `jsr-attachments` / `company-branding` | 0.5 MB · 2 files / empty (public) |
| Auth users | 3 (all email provider, 2 confirmed) → 2 `admin_profiles` |

→ The database is tiny. **The 8.8 GB of photos is the real migration job** (storage can't be copied with SQL; needs a script over the Storage/S3 API).

## Accounts (custom, NOT Supabase Auth, except admins)
| Table | Rows | Notes |
| --- | --- | --- |
| `app_users` (workers) | 28 | `employee_code` unique, role always 'worker' |
| `manager_users` | 6 | `login_id` unique (lower-case), `jsr_permissions` jsonb (22 flags) |
| `exporter_users` (clients) | 9 | `display_name` unique (case-insens.) |
| `admin_profiles` | 2 | linked to `auth.users` (Supabase Auth, email+password) |
| sessions | role_sessions 385 · manager_sessions 171 · exporter_sessions 43 | 12 h tokens; **do not migrate** |

Passwords are **bcrypt via pgcrypto `crypt()`** → hashes are portable: the 43 worker/manager/client accounts can be copied into a unified accounts table with their hashes, nobody has to reset a password. Admins (Supabase Auth) need the 3 auth users re-created/imported with their hashes (Supabase supports importing hashed users).

## Security model
- RLS is ON for every table, but only 2 policies exist (`admin_profiles`, `sites`). Everything else is reachable **only through ~190 SECURITY DEFINER RPCs** that check a session token (`_require_worker/_manager/_exporter/_admin`). Ports as-is; the unified account/session table must keep those token checks.
- **Storage policies are loose (flag for the new project):** anon can INSERT + SELECT `progress-photos` (path `packages/%`), `akk-camera-photos` (`camera/%`), `jsr-attachments` (`attachments/%`); `document-artifacts` is anon SELECT/INSERT/UPDATE with no path limit. Anyone holding the public anon key and a path can read photos. Tighten with signed URLs / authenticated policies in the new project.
- Push: trigger `notifications_deliver_native_push` → `pg_net` POST to `push_delivery_config.webhook_url` with `webhook_secret` (row id 1). Both must be re-pointed at the hub's webhook; `device_tokens` (27) are re-registered by the app anyway.

## Overlap with the other two databases (to confirm with their results)
- **People:** `app_users` (workers) ↔ Timesheet workers ↔ Materials requesters. `manager_users`/`admin_profiles` ↔ Timesheet managers/admins ↔ Materials staff. Join key candidates: employee code / email.
- **Sites:** `sites` (8, with `section_label`) ↔ Timesheet sites (QR/GPS) ↔ Materials sites.
- **Branding:** `company_branding` and `company_settings` both hold the logo (two tables for one thing).
- Unique to this project (no overlap expected): packages/photos, JSR/claims/invoices/contracts/companies, exporters (clients), document artifacts/endorsements/audit, camera verification.

## Cleanups to do during the move
- Legacy overload `staff_approve_package(p_package_id uuid)` and `staff_decline_package(uuid,text)` call `_require_staff()` / `staff_profiles`, which **no longer exist** → dead/broken; drop.
- Notification `path` values are old page names (`/AdminDashboard`, `/MySubmissions`); the hub maps them (`legacyPath`) but new rows should store hub paths.
- `claim_number_seq`, `jsr_number_seq`, `invoice_number_seq`, `package_display_seq` must be carried over so numbering continues.
- 3,299 `document_audit_events` are append-only (trigger blocks UPDATE/DELETE) → copy with INSERT, then re-create the trigger.

## Still needed
Attendance (Timesheet) and Materials results, Query 1 + 2 each.
