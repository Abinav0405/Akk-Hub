-- =====================================================================================
-- AKK Hub — match keys (READ-ONLY). Run ONE section per project, copy the single JSON cell,
-- paste it back saying which project it came from.
--
-- Purpose: find the same person / site across the three databases. Outputs only:
--   · employee IDs / site names / login IDs (the keys)
--   · e-mail addresses as one-way MD5 hashes (so I can tell two accounts are the same address
--     without you sending the addresses themselves)
-- No names, NRIC, bank details, passwords, tokens or QR codes.
-- =====================================================================================


-- ===== A. ATTENDANCE (Timesheet) ========================================================
select jsonb_build_object(
  'worker_ids_foreign', (select coalesce(jsonb_agg(employee_id order by employee_id), '[]') from worker_details),
  'worker_ids_local',   (select coalesce(jsonb_agg(employee_id order by employee_id), '[]') from local_worker_details),
  'supervisor_ids',     (select coalesce(jsonb_agg(supervisor_id order by supervisor_id), '[]') from supervisors),
  'site_names',         (select coalesce(jsonb_agg(site_name order by site_name), '[]') from sites),
  'manager_email_md5',  (select coalesce(jsonb_agg(md5(lower(email)) order by 1), '[]') from managers),
  'admin_email_md5',    (select coalesce(jsonb_agg(md5(lower(email)) order by 1), '[]') from auth.users)
) as match_attendance;


-- ===== B. MATERIALS =====================================================================
select jsonb_build_object(
  'requester_ids',     (select coalesce(jsonb_agg(requester_id order by requester_id), '[]') from requesters),
  'site_names',        (select coalesce(jsonb_agg(name order by name), '[]') from sites),
  'staff_email_md5',   (select coalesce(jsonb_agg(md5(lower(email)) order by 1), '[]') from staff_profiles),
  'auth_email_md5',    (select coalesce(jsonb_agg(md5(lower(email)) order by 1), '[]') from auth.users)
) as match_materials;


-- ===== C. SITE PROGRESS =================================================================
select jsonb_build_object(
  'worker_codes',       (select coalesce(jsonb_agg(employee_code order by employee_code), '[]') from app_users),
  'site_names',         (select coalesce(jsonb_agg(name order by name), '[]') from sites),
  'manager_login_md5',  (select coalesce(jsonb_agg(md5(lower(login_id)) order by 1), '[]') from manager_users),
  'admin_email_md5',    (select coalesce(jsonb_agg(md5(lower(email)) order by 1), '[]') from admin_profiles),
  'auth_email_md5',     (select coalesce(jsonb_agg(md5(lower(email)) order by 1), '[]') from auth.users)
) as match_progress;
