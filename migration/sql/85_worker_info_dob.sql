-- AKK Hub — worker information: Date of Birth becomes the eleventh detail (stored with the worker,
-- askable, editable, exportable). Idempotent; runs after 82/83/84.
alter table core.worker_info add column if not exists date_of_birth date;

create or replace function core._wi_fields()
returns table (key text, label text, kind text, grp text, applies text)
language sql immutable as $$
    values
        ('work_permit_no',           'Work Permit No.',          'text', 'employment', 'foreign'),
        ('permit_expiry_date',       'Work Permit Expiry',       'date', 'employment', 'foreign'),
        ('soc_no',                   'SOC No.',                  'text', 'employment', 'all'),
        ('soc_expiry_date',          'SOC Expiry',               'date', 'employment', 'all'),
        ('hp_number',                'Mobile (HP) Number',       'text', 'personal',   'all'),
        ('nationality',              'Nationality',              'text', 'personal',   'all'),
        ('address',                  'Residential Address',      'text', 'personal',   'all'),
        ('date_of_birth',            'Date of Birth',            'date', 'personal',   'all'),
        ('passport_no',              'Passport No.',             'text', 'passport',   'foreign'),
        ('passport_expiry_date',     'Passport Expiry',          'date', 'passport',   'foreign'),
        ('emergency_contact_number', 'Emergency Contact Number', 'text', 'emergency',  'all')
$$;
