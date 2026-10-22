-- AKK Hub — import dates of birth from "bday akk.pdf" (28 workers). Never overwrites a date already on file.
-- Rows for an employee ID that does not exist are skipped. Idempotent.
insert into core.worker_info (employee_id, date_of_birth, updated_by)
select v.employee_id, v.dob::date, 'import:bday-akk.pdf'
  from (values
    ('1006', '1983-05-16'), ('1007', '1995-05-05'), ('1009', '1986-05-13'), ('1011', '1997-01-20'),
    ('1013', '1992-01-27'), ('1015', '1998-05-14'), ('1022', '2000-09-21'), ('1024', '1983-06-19'),
    ('1025', '1986-05-30'), ('1026', '1997-07-01'), ('1027', '1990-04-10'), ('1029', '1994-05-30'),
    ('1030', '1991-03-10'), ('1031', '1991-04-17'), ('1032', '2000-05-16'), ('1033', '1988-06-11'),
    ('1035', '1985-07-02'), ('1037', '1996-07-25'), ('1038', '1978-11-27'), ('1039', '1991-08-10'),
    ('1041', '1991-06-02'), ('1043', '1985-06-05'), ('1047', '2001-04-04'), ('1048', '1987-03-04'),
    ('1049', '1977-02-14'), ('1050', '1985-01-05'), ('1051', '1984-11-06'), ('1052', '1999-11-24')
  ) as v (employee_id, dob)
 where exists (select 1 from core._wi_base(v.employee_id))
on conflict (employee_id) do update
   set date_of_birth = coalesce(core.worker_info.date_of_birth, excluded.date_of_birth),
       updated_at = case when core.worker_info.date_of_birth is null then now() else core.worker_info.updated_at end,
       updated_by = case when core.worker_info.date_of_birth is null then 'import:bday-akk.pdf' else core.worker_info.updated_by end;

insert into core.worker_info_audit (employee_id, action, fields, actor)
select i.employee_id, 'import', array['date_of_birth'], 'import:bday-akk.pdf'
  from core.worker_info i
 where i.updated_by = 'import:bday-akk.pdf' and i.date_of_birth is not null
   and not exists (select 1 from core.worker_info_audit a where a.employee_id = i.employee_id and a.action = 'import' and a.actor = 'import:bday-akk.pdf');
