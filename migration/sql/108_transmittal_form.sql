-- AKK Hub — Transmittal Form in Company Forms. Idempotent.
--   · Registers the new form ('transmittal') so submissions can be saved (submissions reference
--     company_form_modules). It starts switched on; admins can turn it off under Form Modules.
--   · A transmittal number can only be used once (rejected forms free their number again).
--     The app offers the next free number; this is the backstop when two people send at the same moment.

insert into attendance.company_form_modules (form_key, enabled, updated_at, questions_override)
values ('transmittal', true, now(), '{}'::jsonb)
on conflict (form_key) do nothing;

create unique index if not exists company_form_submissions_transmittal_no_uidx
    on attendance.company_form_submissions (upper(btrim(payload -> 'fields' ->> 'transmittal_no')))
    where form_key = 'transmittal'
      and status <> 'rejected'
      and coalesce(btrim(payload -> 'fields' ->> 'transmittal_no'), '') <> '';
