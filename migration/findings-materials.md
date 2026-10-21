# Audit findings — Materials project (Material Tracker)

Source: `01_audit.sql` Query 1 + 2, run 2026-10-21. Postgres 17.6. No storage buckets. Same org as Attendance.

## Size
Database 17 MB, 9 tables, ~3,400 rows: transactions 629 · material_history 1,368 · materials_catalog 711 · staff_activity 511 · admin_status 42 · requesters 27 · device_push_tokens 13 · sites 8 · staff_profiles 5 · worker_sessions 46. **Nothing here is heavy; the whole thing moves in minutes.**

## Accounts
| Table | Rows | Notes |
| --- | --- | --- |
| `requesters` (workers) | 27 | `requester_id` text (unique) + `name`. **`password_hash` is PLAINTEXT** — login compares `password_hash = p_password` directly (also `worker_change_password`, `worker_delete_pending_transaction`) |
| `staff_profiles` | 5 | linked to `auth.users` (5 users, email, all confirmed); `roles text[]` ⊂ {admin, manager}; `role` = primary |
| sessions | `worker_sessions` 46 | 30-day sliding token; do not migrate |

Staff use Supabase Auth + RLS (`is_staff()`); requesters use custom token RPCs. Transactions reference people by **text** `worker_id` = requester_id (not a uuid FK).

## Data model notes
- `transactions.materials` is a **jsonb array** of lines (`material_id` uuid, `reference_number`, `quantity`, `return_quantity`, name, unit). **Catalog UUIDs must be preserved on copy** or old transactions lose their link.
- `process_transaction` (approve/decline) updates stock + writes `material_history` atomically; keep as-is.
- `staff_activity` is an audit log written by trigger when an authenticated staff edits; FK → staff_profiles(user_id) ON DELETE RESTRICT (copy staff first).
- `transactions.site_id` → `sites(id)`; also stores `site_name` text (denormalised).

## Overlap with the other databases
- `sites` (8 rows) vs Progress `sites` (8 rows) vs Attendance sites → likely same physical sites; name-match needed.
- `requesters` (27) vs Progress `app_users` (28) vs Attendance workers → same people, join key probably employee ID (`requester_id` ↔ `employee_code` ↔ worker id) — **to confirm once the Attendance audit is in**.
- `staff_profiles` (5) ↔ Progress `admin_profiles`(2)+`manager_users`(6) ↔ Attendance managers/admins → one `staff` table in the new project.
- `device_push_tokens` (13, role+worker_id/admin_email) ↔ Progress `device_tokens` (27) ↔ Attendance tokens → one table keyed by account.

## Security problems found (fix during migration)
1. **Plaintext requester passwords** → on copy, store bcrypt (`crypt(pw, gen_salt('bf'))`) in the unified accounts table; users keep their passwords.
2. **A shared secret is hard-coded inside the function `mt_fcm_db_webhook`** (the `x-mt-fcm-secret` header), and the paste of that function has passed through chat. **Rotate that secret** (new value in the edge function's secrets and the function body, or better: read it from `supabase_vault`). The anon key in the same function is public by design and is fine.
3. RLS holes: policy "Enable all operations for sites" (`USING true`, role public) lets anyone with the anon key edit/delete sites; `admin_status` has `ALL ... true` for public too. Replace with staff-only policies.
4. Webhook URL is hard-coded to this project's ref → must be re-pointed at the hub project's edge function.

## Cleanups
- `admin_status` (42 rows: last_seen / is_online per admin email) is presence tracking; keep only if the hub still uses it.
- Quantities are `integer` in the catalog but `numeric` in some RPCs; unify to numeric.
