-- AKK Hub — worker information: drop the unused columns an earlier draft of 82 added.
-- The catalogue is the ten details from 80; nothing else is stored in worker_info. Refuses to drop a column that holds data.
do $$
declare
    cols text[] := array['date_of_birth', 'gender', 'marital_status', 'email', 'emergency_contact_name', 'emergency_contact_relationship',
                         'home_country_address', 'home_country_contact', 'blood_group', 'education', 'certifications', 'shoe_size', 'uniform_size'];
    c text;
    used bigint;
begin
    foreach c in array cols loop
        if exists (select 1 from information_schema.columns where table_schema = 'core' and table_name = 'worker_info' and column_name = c) then
            execute format('select count(*) from core.worker_info where %I is not null', c) into used;
            if used > 0 then
                raise exception 'core.worker_info.% holds % value(s); not dropping', c, used;
            end if;
            execute format('alter table core.worker_info drop column %I', c);
        end if;
    end loop;
end $$;
