-- Extend attendance.device_push_tokens for supervisor Android push (AKK Hub).
-- Adapted from Timesheet migration_fcm_push_tokens_supervisor.sql. Safe to re-run.

ALTER TABLE attendance.device_push_tokens
  ADD COLUMN IF NOT EXISTS supervisor_id text NULL;

ALTER TABLE attendance.device_push_tokens DROP CONSTRAINT IF EXISTS device_push_tokens_one_subject;

DO $$
BEGIN
  -- manager_email may or may not exist depending on schema vintage
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'attendance' AND table_name = 'device_push_tokens' AND column_name = 'manager_email'
  ) THEN
    ALTER TABLE attendance.device_push_tokens
      ADD CONSTRAINT device_push_tokens_one_subject CHECK (
        (
          worker_id IS NOT NULL
          AND admin_email IS NULL
          AND manager_email IS NULL
          AND supervisor_id IS NULL
        )
        OR (
          worker_id IS NULL
          AND admin_email IS NOT NULL
          AND manager_email IS NULL
          AND supervisor_id IS NULL
        )
        OR (
          worker_id IS NULL
          AND admin_email IS NULL
          AND manager_email IS NOT NULL
          AND supervisor_id IS NULL
        )
        OR (
          worker_id IS NULL
          AND admin_email IS NULL
          AND manager_email IS NULL
          AND supervisor_id IS NOT NULL
        )
      );
  ELSE
    ALTER TABLE attendance.device_push_tokens
      ADD CONSTRAINT device_push_tokens_one_subject CHECK (
        (
          worker_id IS NOT NULL
          AND admin_email IS NULL
          AND supervisor_id IS NULL
        )
        OR (
          worker_id IS NULL
          AND admin_email IS NOT NULL
          AND supervisor_id IS NULL
        )
        OR (
          worker_id IS NULL
          AND admin_email IS NULL
          AND supervisor_id IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS device_push_tokens_supervisor_id_idx
  ON attendance.device_push_tokens (supervisor_id)
  WHERE supervisor_id IS NOT NULL;

COMMENT ON TABLE attendance.device_push_tokens IS
  'FCM tokens for workers, admins, managers, and supervisors. Written via att-register-device-token (service role).';
