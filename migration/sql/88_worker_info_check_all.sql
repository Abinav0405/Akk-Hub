-- AKK Hub — Worker Information Check shows the worker EVERY detail on file: the whole Attendance
-- record (same columns admins see; never the password hash / face data) + the worker information +
-- custom details. The approved snapshot keeps all of it. Idempotent; runs after 82–87.

create or replace function core.my_info_tasks(p_token text)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_id text := core._wi_me(p_token);
    b record;
    c record;
begin
    select * into b from core._wi_base(v_id);
    if b.in_company and coalesce((select auto_request from core.worker_info_settings where id = 1), true) then
        perform core._wi_auto_request(v_id, b.worker_type, 'auto');
    end if;
    select * into c from core.worker_info_checks where employee_id = v_id and status = 'pending' order by sent_at desc limit 1;
    return jsonb_build_object(
        'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'fields', r.fields, 'message', r.message,
                        'auto', r.auto, 'created_at', r.created_at, 'custom_labels', r.custom_labels) order by r.created_at)
                      from core.worker_info_requests r where r.employee_id = v_id and r.status = 'pending'), '[]'::jsonb),
        'check', case when c.id is null then null else jsonb_build_object(
                     'id', c.id, 'sent_at', c.sent_at,
                     'details', coalesce(core._wi_base_values(v_id), '{}'::jsonb)
                                || core._wi_values(v_id)
                                || jsonb_build_object('custom_labels', core._wi_custom_labels(v_id))) end
    );
end;
$$;

create or replace function core.respond_info_check(p_token text, p_check_id uuid, p_approve boolean, p_reason text default null, p_fields text[] default null)
returns void
language plpgsql volatile security definer set search_path = core as $$
declare
    v_id text := core._wi_me(p_token);
    c record;
    b record;
    v_all jsonb;
begin
    select * into c from core.worker_info_checks where id = p_check_id for update;
    if c.id is null or c.employee_id <> v_id then
        raise exception 'Check not found';
    end if;
    if c.status <> 'pending' then
        raise exception 'You already answered this check';
    end if;
    select * into b from core._wi_base(v_id);
    v_all := coalesce(core._wi_base_values(v_id), '{}'::jsonb) || core._wi_values(v_id);
    if p_approve then
        update core.worker_info_checks set status = 'approved', responded_at = now(), approved_snapshot = v_all where id = c.id;
        insert into core.worker_info_audit (employee_id, action, actor, ref) values (v_id, 'check_approved', 'worker:' || v_id, c.id);
    else
        if length(trim(coalesce(p_reason, ''))) < 3 then
            raise exception 'Please tell us what is wrong';
        end if;
        update core.worker_info_checks set status = 'declined', responded_at = now(), decline_reason = trim(p_reason),
               decline_fields = (select coalesce(array_agg(f), '{}') from unnest(coalesce(p_fields, '{}')) f
                                  where v_all ? f or f ~ '^x_[a-z0-9_]{1,40}$')
         where id = c.id;
        insert into core.worker_info_audit (employee_id, action, fields, actor, ref) values (v_id, 'check_declined', p_fields, 'worker:' || v_id, c.id);
        perform core._wi_push_admins('Information check declined', coalesce(b.name, v_id) || ' (' || v_id || ') says some details are wrong.');
    end if;
end;
$$;

do $$
declare f text;
begin
    foreach f in array array['core.my_info_tasks(text)', 'core.respond_info_check(text, uuid, boolean, text, text[])'] loop
        execute format('revoke all on function %s from public', f);
        execute format('grant execute on function %s to anon, authenticated', f);
    end loop;
end $$;
