-- =====================================================================================
-- AKK Hub — AKK Camera registry + Photo Verification fallback (progress schema).
--
-- APPLY ON: Akk Hub / unified Progress DB only
--   Project ref: rvejqoxmvcemeebywpzx
--   URL:         https://rvejqoxmvcemeebywpzx.supabase.co
--
-- Lets the Flutter AKK Camera App (schema = progress) register verification
-- codes and attach JPEGs to Hub Site work packages. Storage buckets are
-- project-level (not schema-level). Safe to re-run.
--
-- After apply: NOTIFY pgrst, 'reload schema';
-- =====================================================================================

create table if not exists progress.akk_camera_photos (
  id uuid primary key default gen_random_uuid(),
  verification_code text not null unique,
  sha256_hash text not null,
  phash text,
  storage_path text,
  captured_at timestamptz,
  lat double precision,
  lng double precision,
  address text,
  device_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists akk_camera_photos_verification_code_uidx
  on progress.akk_camera_photos (verification_code);

alter table progress.akk_camera_photos enable row level security;
revoke all on table progress.akk_camera_photos from anon, authenticated;

insert into storage.buckets (id, name, public)
values ('akk-camera-photos', 'akk-camera-photos', false)
on conflict (id) do nothing;

create or replace function progress.akk_camera_register_photo(
  p_verification_code text,
  p_sha256_hash text,
  p_phash text,
  p_storage_path text,
  p_captured_at timestamptz default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_address text default null,
  p_device_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = progress, extensions
as $$
declare
  v_id uuid;
  v_existing progress.akk_camera_photos%rowtype;
  v_code text := upper(trim(coalesce(p_verification_code, '')));
  v_sha text := lower(trim(coalesce(p_sha256_hash, '')));
  v_phash text := nullif(lower(trim(coalesce(p_phash, ''))), '');
  v_path text := nullif(trim(coalesce(p_storage_path, '')), '');
begin
  -- POSIX ~ rejects {n} above 255 ("invalid regular expression: invalid
  -- repetition count(s)"). dHash hex is 528 chars, so never use {528}.
  -- Do not interpolate barcodes, paths, or overlay JSON into a regex.
  if v_code !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$' then
    raise exception 'Invalid verification code';
  end if;
  if char_length(v_sha) <> 64 or v_sha ~ '[^0-9a-f]' then
    raise exception 'Invalid sha256 hash';
  end if;
  if v_phash is not null and (char_length(v_phash) <> 528 or v_phash ~ '[^0-9a-f]') then
    raise exception 'Invalid phash';
  end if;
  if v_path is not null and (
       v_path !~ '^camera/[A-Za-z0-9_-]+\.jpg$'
       or char_length(v_path) > 180
     ) then
    raise exception 'Invalid storage path';
  end if;
  if p_lat is not null and (p_lat < -90 or p_lat > 90) then
    raise exception 'Invalid latitude';
  end if;
  if p_lng is not null and (p_lng < -180 or p_lng > 180) then
    raise exception 'Invalid longitude';
  end if;

  select * into v_existing
    from akk_camera_photos
   where verification_code = v_code
   for update;

  if v_existing.id is not null then
    if v_existing.sha256_hash <> v_sha then
      raise exception 'Verification code already registered';
    end if;
    update akk_camera_photos
       set phash = coalesce(phash, v_phash),
           storage_path = coalesce(v_path, storage_path),
           captured_at = coalesce(captured_at, p_captured_at),
           lat = coalesce(lat, p_lat),
           lng = coalesce(lng, p_lng),
           address = coalesce(address, nullif(left(p_address, 500), '')),
           device_id = coalesce(device_id, nullif(left(p_device_id, 200), ''))
     where id = v_existing.id;
    return v_existing.id;
  end if;

  insert into akk_camera_photos (
    verification_code, sha256_hash, phash, storage_path,
    captured_at, lat, lng, address, device_id
  ) values (
    v_code, v_sha, v_phash, v_path,
    p_captured_at, p_lat, p_lng,
    nullif(left(p_address, 500), ''), nullif(left(p_device_id, 200), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Prefer package_images (Hub Site work packages); fall back to akk_camera_photos.
create or replace function progress.verify_photo_by_code(p_code text)
returns table (
  site_name text,
  section_label text,
  lcb_id text,
  package_date date,
  stage text,
  captured_at timestamptz,
  captured_address text,
  worker_display_name text,
  sha256_hash text,
  phash text
)
language sql
security definer
set search_path = progress, extensions
stable
as $$
  (
    select s.name, p.section_label, p.lcb_id, p.package_date,
           pi.stage, pi.captured_at, pi.captured_address, w.display_name,
           pi.sha256_hash, pi.phash
    from package_images pi
    join packages p on p.id = pi.package_id
    left join sites s on s.id = p.site_id
    left join app_users w on w.id = p.worker_id
    where pi.verification_code = upper(trim(coalesce(p_code, '')))
    limit 1
  )
  union all
  (
    select
      'AKK Camera'::text,
      null::text,
      null::text,
      null::date,
      'camera'::text,
      c.captured_at,
      c.address,
      'AKK Camera App'::text,
      c.sha256_hash,
      c.phash
    from akk_camera_photos c
    where c.verification_code = upper(trim(coalesce(p_code, '')))
      and not exists (
        select 1 from package_images pi
        where pi.verification_code = upper(trim(coalesce(p_code, '')))
      )
    limit 1
  )
  limit 1;
$$;

grant execute on function progress.akk_camera_register_photo(
  text, text, text, text, timestamptz, double precision, double precision, text, text
) to anon, authenticated;

grant execute on function progress.verify_photo_by_code(text) to anon, authenticated;

drop policy if exists akk_camera_photos_anon_insert on storage.objects;
create policy akk_camera_photos_anon_insert on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'akk-camera-photos' and name like 'camera/%');

drop policy if exists akk_camera_photos_anon_select on storage.objects;
create policy akk_camera_photos_anon_select on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'akk-camera-photos' and name like 'camera/%');

notify pgrst, 'reload schema';
