-- AKK Hub — notification taps open the exact screen.
--   · Site-work notifications stored old page names ('/AdminDashboard', '/ManagerDashboard',
--     '/MySubmissions'); in the hub those names are ambiguous ('/AdminDashboard' is also the
--     Attendance dashboard). New rows store hub paths with ?package=<id> so a tap opens that package.
--   · Existing rows are rewritten the same way.
--   · Native push sends the same path.
-- Idempotent. The app also resolves the old names itself, so this is safe to run any time.

CREATE OR REPLACE FUNCTION progress._notification_path(p_role text, p_package_id uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'progress'
AS $function$
  select case p_role
           when 'admin' then '/progress/admin'
           when 'manager' then '/progress/review'
           else '/progress/submissions'
         end
         || case when p_package_id is null then '' else '?package=' || p_package_id::text end;
$function$;

CREATE OR REPLACE FUNCTION progress._notification_set_path()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'progress'
AS $function$
begin
  if NEW.path is null or NEW.path in ('/AdminDashboard', '/ManagerDashboard', '/MySubmissions', 'AdminDashboard', 'ManagerDashboard', 'MySubmissions') then
    NEW.path := _notification_path(NEW.user_role, NEW.package_id);
  end if;
  return NEW;
end;
$function$;

-- Runs before the native-push AFTER trigger, so the push carries the new path too.
DROP TRIGGER IF EXISTS notifications_set_path ON progress.notifications;
CREATE TRIGGER notifications_set_path BEFORE INSERT ON progress.notifications
  FOR EACH ROW EXECUTE FUNCTION progress._notification_set_path();

UPDATE progress.notifications
   SET path = progress._notification_path(user_role, package_id)
 WHERE path is null
    or path in ('/AdminDashboard', '/ManagerDashboard', '/MySubmissions', 'AdminDashboard', 'ManagerDashboard', 'MySubmissions');
