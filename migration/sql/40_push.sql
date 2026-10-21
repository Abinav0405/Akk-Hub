-- =====================================================================================
-- AKK Hub — push notifications from the database (run after the edge functions are deployed).
-- The shared secret lives only in core.push_config (service role) and in the functions' env;
-- migrate.mjs "push" sets both. Site photos push uses progress._deliver_native_push (pg_net).
-- =====================================================================================
create table if not exists core.push_config (
    id int primary key default 1 check (id = 1),
    base_url text not null,
    secret text not null,
    updated_at timestamptz not null default now()
);
alter table core.push_config enable row level security;
revoke all on core.push_config from public, anon, authenticated;
grant all on core.push_config to service_role;

-- Table trigger → edge function. TG_ARGV[0] = 'att' | 'mat'.
create or replace function core.push_webhook()
returns trigger
language plpgsql
security definer
set search_path = core, extensions, net
as $$
declare
    cfg core.push_config%rowtype;
    v_area text := TG_ARGV[0];
begin
    select * into cfg from core.push_config where id = 1;
    if cfg.secret is null or cfg.base_url is null then
        return coalesce(NEW, OLD);
    end if;
    begin
        perform net.http_post(
            url := cfg.base_url || '/functions/v1/' || v_area || '-fcm-db-webhook',
            body := jsonb_build_object(
                'type', TG_OP,
                'table', TG_TABLE_NAME,
                'schema', TG_TABLE_SCHEMA,
                'record', case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
                'old_record', case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                case v_area when 'att' then 'x-akk-fcm-secret' else 'x-mt-fcm-secret' end, cfg.secret));
    exception when others then
        raise warning 'push webhook failed: %', sqlerrm; -- never block the write
    end;
    return coalesce(NEW, OLD);
end;
$$;
revoke all on function core.push_webhook() from public, anon, authenticated;

drop trigger if exists fcm_webhook_leave_requests on attendance.leave_requests;
create trigger fcm_webhook_leave_requests after insert or update or delete on attendance.leave_requests
    for each row execute function core.push_webhook('att');
drop trigger if exists fcm_webhook_passed_out_payslips on attendance.passed_out_payslips;
create trigger fcm_webhook_passed_out_payslips after insert or update on attendance.passed_out_payslips
    for each row execute function core.push_webhook('att');
drop trigger if exists fcm_webhook_passed_out_timesheets on attendance.passed_out_timesheets;
create trigger fcm_webhook_passed_out_timesheets after insert or update on attendance.passed_out_timesheets
    for each row execute function core.push_webhook('att');
drop trigger if exists fcm_webhook_transactions on materials.transactions;
create trigger fcm_webhook_transactions after insert or update on materials.transactions
    for each row execute function core.push_webhook('mat');
drop trigger if exists fcm_webhook_materials_catalog on materials.materials_catalog;
create trigger fcm_webhook_materials_catalog after update on materials.materials_catalog
    for each row execute function core.push_webhook('mat');
