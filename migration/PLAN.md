# AKK Hub — one database: findings + plan

Built from the three audits (2026-10-21). Details per project: `findings-progress.md`, `findings-materials.md`; Attendance is summarised here.

## 1. What exists today
| | Attendance | Materials | Site Progress (+ Camera) | Total |
| --- | --- | --- | --- | --- |
| Database | 31 MB | 17 MB | 65 MB | **~113 MB** |
| Tables | 39 | 9 | 38 | ~86 |
| Largest | shifts 11,945 · breaks 10,974 · login_events 1,392 | materials_catalog 711 · transactions 629 · material_history 1,368 | package_images 16,161 · notifications 3,843 | |
| Storage | 9.6 MB (2 buckets) | none | **8.8 GB** (progress-photos 8.15 GB / 17,081 files; document-artifacts 591 MB) | **~8.8 GB** |
| Accounts | workers 61 (52 foreign + 9 local) · managers 7 · supervisors 2 · admins 4 (Supabase Auth) | requesters 27 · staff 5 (Auth) | workers 28 · managers 6 · clients 9 · admins 2–3 (Auth) | |
| Server functions (RPCs) | ~45 | 16 | ~190 | ~250 |

**Attendance in short:** bcrypt passwords (with a legacy plaintext fallback + auto-upgrade), 12–24 h role sessions, login rate-limit/lockout (5 tries → 15 min), login audit log, Face-ID login (128-number face templates + enrolled devices), payslips/timesheets stored as HTML (≈3 MB), pay balances carried forward, vehicle tracking, feedback + company forms, leave policy, 8 tables on Realtime. It is the most mature auth of the three.

## 2. Problems found (must fix in the new project)
| # | Where | Problem | Severity |
| --- | --- | --- | --- |
| 1 | **Attendance** | `worker_details` / `local_worker_details` (NRIC/FIN, **bank account numbers**, salary rates, password hashes, **face templates**) have policies "select/update/delete for everyone" (`USING true`, role public + anon). **Anyone holding the app's public key can read, change or delete any worker record.** Same "for everyone" read/write on `shifts`, `breaks`, `leave_requests`, `payslip_history`, `public_holidays`, `working_days_config`, `admin_status`, `sites`; payslip tables have `anon_read_INTERIM`. | **Critical** (personal data; PDPA) |
| 2 | Attendance | `is_admin_jwt()` = `auth.uid() IS NOT NULL` → **any** signed-in Supabase user counts as admin. Harmless with 4 users, **dangerous once Materials/Progress staff share one project**. | High |
| 3 | Attendance | Storage: anyone can upload/replace/delete `announcement-images`; anyone can read/upload `leave-attachments` (medical certificates). | High |
| 4 | Materials | 27 requester passwords stored in **plaintext**; open policies on `sites`, `admin_status`. | High |
| 5 | Progress | Anon can read/upload photos & documents (loose storage policies, see findings-progress). | Medium |
| 6 | **Attendance + Materials** | **Webhook secrets are written inside trigger/function definitions** (and the Attendance one appeared in the audit output; the Materials one appeared too). | **Rotate now** |
| 7 | all | Cross-table links are text IDs by convention, no foreign keys (`shifts.worker_id`, `shifts.site_id`, `leave_requests.employee_id`, `transactions.worker_id`…). Orphans possible. | Medium |

> **Do this now, before any migration:** rotate the two FCM webhook secrets (Attendance `x-akk-fcm-secret`, Materials `x-mt-fcm-secret`) — update the edge function secret and the trigger/function that sends it. Better: store it in `supabase_vault` and read it inside the function.

## 3. Name collisions (why we can't just merge the tables)
`sites` ×3 (different columns and ID types: text vs uuid) · `role_sessions` ×2 · `device_push_tokens` / `device_tokens` ×3 · `admin_status` ×2 · `notifications` (Progress only) · RPCs `verify_worker_login`, `verify_manager_login`, `verify_role_session`, `revoke_role_session`, `record_login_*`, `staff_register_device_token`… → use **one Postgres schema per area** plus a shared `core`.

## 4. Target design
**One project, four schemas:** `core` (people, accounts, sessions, sites, devices/push, audit, settings), `attendance`, `materials`, `progress`.

- **core.accounts** — one row per human/login: `id uuid`, `kind` (worker | supervisor | manager | admin | client), `login_id` (employee ID / e-mail / client name), `password_hash` (bcrypt), `display_name`, `is_active`, `auth_user_id` (nullable → Supabase Auth user for admins), `permissions jsonb` (the 22 JSR flags + module access).
- **core.sessions** — one token table (uuid), role + subject + data + expiry, based on Attendance's `create_role_session / verify_role_session` and its lockout/rate-limit tables (`login_attempts`, `login_events`, `security_alerts`, `app_auth_settings`). **This replaces the three login bridges and the "link your account" screens.**
- **core.sites** — one list (uuid) with lat/lng/QR token + `section_label`; `core.legacy_ids(source, old_id, new_id)` maps every old site/person ID so history keeps pointing at the right thing.
- **attendance.worker_profiles** — HR data (NRIC, bank, rates, leave balances, face template, local/foreign flag), merged from `worker_details` + `local_worker_details` (same columns + a few CPF/SINDA extras).
- All domain tables move unchanged into their schema, plus **real foreign keys** to `core.accounts` / `core.sites`. Catalogue/transaction/package UUIDs are preserved.
- **Security:** RLS on everything; browser keys only call RPCs / read what a policy allows; "admin" = a row in `core.accounts` with kind admin (not "any signed-in user"); storage private + signed URLs; face templates and NRIC readable only by admin RPCs.
- **Front end:** supabase-js supports a schema per client (`createClient(url, key, { db: { schema: 'progress' } })`) → the three hub clients keep working with the **same RPC names**; the cut-over is "same URL, different schema", then the bridge code is deleted.

## 5. What can't be decided until the match-keys arrive
- Same person across the three systems (employee ID / e-mail match). Attendance has **61** workers vs 27 requesters vs 28 photo-workers → people exist in some systems and not others; per-person **module access flags** will say who can use what.
- Same site across the three (Attendance 6 · Materials 8 · Progress 8 → expect name differences to merge by hand).
- Same manager/admin across systems.
→ run `02_match_keys.sql` (privacy-safe: IDs, site names, hashed e-mails) once per project.

## 6. Order of work and rough effort
| Step | What | Effort |
| --- | --- | --- |
| 0 | Rotate the 2 webhook secrets; decide how fast to close problem #1 (needs app changes) | 1–2 h |
| 1 | Match-keys + decide merges (people / sites / staff) | 0.5 day (with you) |
| 2 | Write `core` + `attendance` + `materials` + `progress` schemas, RLS, merged login RPCs | 2–3 days |
| 3 | Data copy scripts + **dry run** into a throw-away project, row-count + spot check reports | 1–2 days |
| 4 | Storage copy (8.8 GB, 17k+ files) — runs unattended | 3–6 h machine time |
| 5 | Hub: one client, new session code, delete bridges/connect screens; push + webhooks re-pointed; camera app re-pointed | 1–2 days |
| 6 | Test every portal on the new project, then cut over in a quiet window (freeze writes ~1 h), keep old projects read-only 2–4 weeks | 1 day + window |
| | **Total** | **~6–9 working days + a ~1 h cut-over** |

**Cut-over safety:** nothing in the old projects is deleted; if a check fails we point the apps back. Passwords carry over (bcrypt hashes copy; Materials' plaintext gets hashed on the way in); users keep their logins; login sessions are not migrated, so everyone signs in once.

## 7. Risks
- Photos (8.8 GB) are the long pole; storage policies and signed-URL use need front-end changes.
- ~250 RPCs depend on `auth.uid()` / token helpers (`_require_worker`, `_current_staff_actor`) → these helpers must be rewritten against `core.sessions`, then the RPCs re-tested.
- The camera app writes straight into the Progress project: it must be re-pointed at the same time (or it will keep writing to the old one).
- Payslip/timesheet HTML and pay-balance maths are business-critical → compare totals before/after.
