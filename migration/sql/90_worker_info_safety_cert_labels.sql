-- AKK Hub — "SOC" becomes "Safety Certificate" everywhere, including the database:
--   core.worker_info.soc_no          → safety_cert_no            (label "Safety Certificate Number")
--   core.worker_info.soc_expiry_date → safety_cert_expiry_date   (label "Safety Certificate Expiry")
-- Stored data keeps its values; saved lists (required details, open requests, history, declined checks, approved
-- snapshots) are updated to the new keys. Idempotent.

do $$
begin
    if exists (select 1 from information_schema.columns where table_schema = 'core' and table_name = 'worker_info' and column_name = 'soc_no') then
        alter table core.worker_info rename column soc_no to safety_cert_no;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'core' and table_name = 'worker_info' and column_name = 'soc_expiry_date') then
        alter table core.worker_info rename column soc_expiry_date to safety_cert_expiry_date;
    end if;
end $$;

create or replace function core._wi_rename_keys(p text[])
returns text[]
language sql immutable as $$
    select case when p is null then null else array(
        select case f when 'soc_no' then 'safety_cert_no' when 'soc_expiry_date' then 'safety_cert_expiry_date' else f end
          from unnest(p) with ordinality as t(f, n) order by n) end;
$$;

update core.worker_info_settings set required_fields = core._wi_rename_keys(required_fields)
 where required_fields && array['soc_no', 'soc_expiry_date'];
update core.worker_info_requests set fields = core._wi_rename_keys(fields)
 where fields && array['soc_no', 'soc_expiry_date'];
update core.worker_info_audit set fields = core._wi_rename_keys(fields)
 where fields && array['soc_no', 'soc_expiry_date'];
update core.worker_info_checks set decline_fields = core._wi_rename_keys(decline_fields)
 where decline_fields && array['soc_no', 'soc_expiry_date'];
update core.worker_info_requests
   set submitted = (submitted - 'soc_no' - 'soc_expiry_date')
       || case when submitted ? 'soc_no' then jsonb_build_object('safety_cert_no', submitted -> 'soc_no') else '{}'::jsonb end
       || case when submitted ? 'soc_expiry_date' then jsonb_build_object('safety_cert_expiry_date', submitted -> 'soc_expiry_date') else '{}'::jsonb end
 where submitted ? 'soc_no' or submitted ? 'soc_expiry_date';
update core.worker_info_checks
   set approved_snapshot = (approved_snapshot - 'soc_no' - 'soc_expiry_date')
       || case when approved_snapshot ? 'soc_no' then jsonb_build_object('safety_cert_no', approved_snapshot -> 'soc_no') else '{}'::jsonb end
       || case when approved_snapshot ? 'soc_expiry_date' then jsonb_build_object('safety_cert_expiry_date', approved_snapshot -> 'soc_expiry_date') else '{}'::jsonb end
 where approved_snapshot ? 'soc_no' or approved_snapshot ? 'soc_expiry_date';

drop function core._wi_rename_keys(text[]);

create or replace function core._wi_fields()
returns table (key text, label text, kind text, grp text, applies text)
language sql immutable as $$
    values
        ('work_permit_no',           'Work Permit No.',            'text', 'employment', 'foreign'),
        ('permit_expiry_date',       'Work Permit Expiry',         'date', 'employment', 'foreign'),
        ('safety_cert_no',           'Safety Certificate Number',  'text', 'employment', 'all'),
        ('safety_cert_expiry_date',  'Safety Certificate Expiry',  'date', 'employment', 'all'),
        ('hp_number',                'Mobile (HP) Number',         'text', 'personal',   'all'),
        ('nationality',              'Nationality',                'text', 'personal',   'all'),
        ('address',                  'Residential Address',        'text', 'personal',   'all'),
        ('date_of_birth',            'Date of Birth',              'date', 'personal',   'all'),
        ('passport_no',              'Passport No.',               'text', 'passport',   'foreign'),
        ('passport_expiry_date',     'Passport Expiry',            'date', 'passport',   'foreign'),
        ('emergency_contact_number', 'Emergency Contact Number',  'text', 'emergency',  'all')
$$;
