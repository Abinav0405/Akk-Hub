-- =====================================================================================
-- Lock attendance.local_worker_details (and related payslip history) so anon / manager /
-- supervisor JWT clients cannot read HR (NRIC, bank, pay, face, passwords).
--
-- Intent (NEEDS.md / workerPrivacy.js):
--   · Attendance admin (core.is_attendance_admin): full table access
--   · Everyone else via PostgREST: denied — use security-definer RPCs (login, leave, etc.)
--   · service_role: unchanged (bypasses RLS)
--
-- Safe to re-run. After apply: NOTIFY pgrst, 'reload schema';
-- =====================================================================================

ALTER TABLE attendance.local_worker_details ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'attendance' AND tablename = 'local_worker_details'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON attendance.local_worker_details', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY local_worker_details_admin_all
  ON attendance.local_worker_details
  FOR ALL
  TO authenticated
  USING (core.is_attendance_admin())
  WITH CHECK (core.is_attendance_admin());

REVOKE ALL ON TABLE attendance.local_worker_details FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE attendance.local_worker_details TO authenticated;
GRANT ALL ON TABLE attendance.local_worker_details TO service_role;

DO $$
DECLARE
  pol record;
BEGIN
  IF to_regclass('attendance.local_worker_payslip_history') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE attendance.local_worker_payslip_history ENABLE ROW LEVEL SECURITY;

  FOR pol IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'attendance' AND tablename = 'local_worker_payslip_history'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON attendance.local_worker_payslip_history', pol.policyname);
  END LOOP;

  EXECUTE $p$
    CREATE POLICY local_worker_payslip_history_admin_all
      ON attendance.local_worker_payslip_history
      FOR ALL
      TO authenticated
      USING (core.is_attendance_admin())
      WITH CHECK (core.is_attendance_admin())
  $p$;

  REVOKE ALL ON TABLE attendance.local_worker_payslip_history FROM anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE attendance.local_worker_payslip_history TO authenticated;
  GRANT ALL ON TABLE attendance.local_worker_payslip_history TO service_role;
END $$;

NOTIFY pgrst, 'reload schema';
