-- =====================================================================================
-- AKK Hub — dark details-box opacity on photo overlays (admin Branding slider).
--
-- APPLY ON: Akk Hub / unified Progress DB only
--   Project ref: rvejqoxmvcemeebywpzx
--   URL:         https://rvejqoxmvcemeebywpzx.supabase.co
--
-- Why this is NOT SPT 0083:
--   Hub one-DB migration rehomes Site Progress into schema `progress` (not `public`).
--   Hub frontend is UNIFIED (VITE_SUPABASE_URL → rvejqoxmvcemeebywpzx) and calls
--   supabaseProgress with db.schema = 'progress', so branding RPCs hit
--   progress.get_company_branding / progress.staff_update_company_branding.
--   Do NOT paste Site Progress Tracker `0083_overlay_opacity.sql` here — that file
--   assumes public.company_branding and search_path = public (legacy SPT project
--   qpndkdbomtbnhkdyigyy / VITE_PROGRESS_*). Leave 0083 for that legacy DB only.
--
-- Safe to re-run. After apply: NOTIFY pgrst, 'reload schema';
-- =====================================================================================

alter table progress.company_branding
  add column if not exists overlay_opacity_pct int;

update progress.company_branding
   set overlay_opacity_pct = 48
 where overlay_opacity_pct is null;

alter table progress.company_branding
  alter column overlay_opacity_pct set default 48;

-- Return type / arg list changes → drop old progress overloads first.
drop function if exists progress.staff_get_company_branding(text);
drop function if exists progress.get_company_branding();
drop function if exists progress.staff_update_company_branding(text, text, text, int, int, text, text, text, jsonb, text, numeric, numeric, numeric, numeric, int, numeric, numeric, numeric, numeric, int, jsonb);
drop function if exists progress.staff_update_company_branding(text, text, text, int, int, text, text, text, jsonb, text, numeric, numeric, numeric, numeric, int, int, numeric, numeric, numeric, numeric, int, jsonb);

create or replace function progress.get_company_branding()
returns table (
  company_name text,
  company_address text,
  logo_path text,
  logo_size_pct int,
  logo_opacity_pct int,
  logo_position text,
  overlay_position text,
  overlay_lines jsonb,
  gps_position text,
  logo_x_pct numeric,
  logo_y_pct numeric,
  overlay_x_pct numeric,
  overlay_y_pct numeric,
  overlay_scale_pct int,
  overlay_opacity_pct int,
  gps_x_pct numeric,
  gps_y_pct numeric,
  verify_x_pct numeric,
  verify_y_pct numeric,
  verify_scale_pct int,
  document_chrome jsonb,
  updated_at timestamptz
)
language sql
security definer
set search_path = progress, extensions
stable
as $$
  select b.company_name, b.company_address, b.logo_path,
         b.logo_size_pct, b.logo_opacity_pct, b.logo_position,
         b.overlay_position, b.overlay_lines, b.gps_position,
         b.logo_x_pct, b.logo_y_pct,
         b.overlay_x_pct, b.overlay_y_pct, b.overlay_scale_pct,
         coalesce(b.overlay_opacity_pct, 48),
         b.gps_x_pct, b.gps_y_pct,
         b.verify_x_pct, b.verify_y_pct, b.verify_scale_pct,
         b.document_chrome,
         b.updated_at
    from company_branding b
   where b.id = 1;
$$;

create or replace function progress.staff_get_company_branding(p_manager_token text default null)
returns table (
  company_name text,
  company_address text,
  logo_path text,
  logo_size_pct int,
  logo_opacity_pct int,
  logo_position text,
  overlay_position text,
  overlay_lines jsonb,
  gps_position text,
  logo_x_pct numeric,
  logo_y_pct numeric,
  overlay_x_pct numeric,
  overlay_y_pct numeric,
  overlay_scale_pct int,
  overlay_opacity_pct int,
  gps_x_pct numeric,
  gps_y_pct numeric,
  verify_x_pct numeric,
  verify_y_pct numeric,
  verify_scale_pct int,
  document_chrome jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = progress, extensions
as $$
begin
  perform _current_staff_actor(p_manager_token);
  return query select * from get_company_branding();
end;
$$;

create or replace function progress.staff_update_company_branding(
  p_company_name text,
  p_company_address text,
  p_logo_path text,
  p_logo_size_pct int,
  p_logo_opacity_pct int,
  p_logo_position text,
  p_manager_token text default null,
  p_overlay_position text default 'bl',
  p_overlay_lines jsonb default '["datetime","site","section","status","address","gps"]'::jsonb,
  p_gps_position text default null,
  p_logo_x_pct numeric default null,
  p_logo_y_pct numeric default null,
  p_overlay_x_pct numeric default null,
  p_overlay_y_pct numeric default null,
  p_overlay_scale_pct int default 100,
  p_overlay_opacity_pct int default 48,
  p_gps_x_pct numeric default null,
  p_gps_y_pct numeric default null,
  p_verify_x_pct numeric default null,
  p_verify_y_pct numeric default null,
  p_verify_scale_pct int default 100,
  p_document_chrome jsonb default null
)
returns void
language plpgsql
security definer
set search_path = progress, extensions
as $$
declare
  v_admin uuid := _require_admin();
  v_name text := trim(coalesce(p_company_name, ''));
  v_addr text := trim(coalesce(p_company_address, ''));
  v_pos text := lower(trim(coalesce(p_logo_position, 'br')));
  v_overlay text := lower(trim(coalesce(p_overlay_position, 'bl')));
  v_gps text := nullif(lower(trim(coalesce(p_gps_position, ''))), '');
  v_allowed text[] := array['datetime','site','section','status','address','gps'];
  v_lines jsonb := '[]'::jsonb;
  v_raw jsonb := coalesce(p_overlay_lines, '[]'::jsonb);
  v_key text;
  v_seen text[] := '{}';
  v_logo_x numeric := coalesce(p_logo_x_pct, 72);
  v_logo_y numeric := coalesce(p_logo_y_pct, 72);
  v_overlay_x numeric := coalesce(p_overlay_x_pct, 3);
  v_overlay_y numeric := coalesce(p_overlay_y_pct, 72);
  v_overlay_scale int := coalesce(p_overlay_scale_pct, 100);
  v_overlay_opacity int := coalesce(p_overlay_opacity_pct, 48);
  v_gps_x numeric := p_gps_x_pct;
  v_gps_y numeric := p_gps_y_pct;
  v_verify_x numeric := coalesce(p_verify_x_pct, 78);
  v_verify_y numeric := coalesce(p_verify_y_pct, 0);
  v_verify_scale int := coalesce(p_verify_scale_pct, 100);
  v_chrome jsonb := p_document_chrome;
begin
  perform _current_staff_actor(p_manager_token);
  if v_name = '' then
    raise exception 'Company name is required';
  end if;
  if v_addr = '' then
    raise exception 'Company address is required';
  end if;
  if p_logo_size_pct is null or p_logo_size_pct < 2 or p_logo_size_pct > 30 then
    raise exception 'Logo size must be between 2 and 30';
  end if;
  if p_logo_opacity_pct is null or p_logo_opacity_pct < 40 or p_logo_opacity_pct > 100 then
    raise exception 'Logo opacity must be between 40 and 100';
  end if;
  if v_overlay_opacity < 15 or v_overlay_opacity > 100 then
    raise exception 'Details box opacity must be between 15 and 100';
  end if;
  if v_pos not in ('tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br') then
    v_pos := 'br';
  end if;
  if v_overlay not in ('tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br') then
    v_overlay := 'bl';
  end if;
  if v_gps is not null and v_gps not in ('tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br') then
    v_gps := null;
  end if;

  if v_overlay_scale < 50 or v_overlay_scale > 220 then
    raise exception 'Details size must be between 50 and 220';
  end if;
  if v_verify_scale < 50 or v_verify_scale > 220 then
    raise exception 'Barcode size must be between 50 and 220';
  end if;

  v_logo_x := greatest(0, least(100, v_logo_x));
  v_logo_y := greatest(0, least(100, v_logo_y));
  v_overlay_x := greatest(0, least(100, v_overlay_x));
  v_overlay_y := greatest(0, least(100, v_overlay_y));
  v_verify_x := greatest(0, least(100, v_verify_x));
  v_verify_y := greatest(0, least(100, v_verify_y));
  if v_gps_x is not null then
    v_gps_x := greatest(0, least(100, v_gps_x));
  end if;
  if v_gps_y is not null then
    v_gps_y := greatest(0, least(100, v_gps_y));
  end if;
  if v_gps_x is null or v_gps_y is null then
    v_gps_x := null;
    v_gps_y := null;
    v_gps := null;
  end if;

  if jsonb_typeof(v_raw) = 'string' then
    begin
      v_raw := (v_raw #>> '{}')::jsonb;
    exception
      when others then
        v_raw := '[]'::jsonb;
    end;
  end if;
  if jsonb_typeof(v_raw) = 'array' then
    for v_key in select jsonb_array_elements_text(v_raw)
    loop
      v_key := lower(trim(v_key));
      if v_key = any(v_allowed) and not (v_key = any(v_seen)) then
        v_seen := v_seen || v_key;
        v_lines := v_lines || jsonb_build_array(v_key);
      end if;
    end loop;
  end if;

  if v_chrome is not null and jsonb_typeof(v_chrome) = 'string' then
    begin
      v_chrome := (v_chrome #>> '{}')::jsonb;
    exception
      when others then
        v_chrome := '{}'::jsonb;
    end;
  end if;
  if v_chrome is not null and jsonb_typeof(v_chrome) = 'object' then
    v_chrome := jsonb_build_object(
      'header_show_logo', case when v_chrome ? 'header_show_logo' then coalesce((v_chrome->>'header_show_logo')::boolean, true) else true end,
      'header_show_name', case when v_chrome ? 'header_show_name' then coalesce((v_chrome->>'header_show_name')::boolean, true) else true end,
      'header_extra', left(trim(coalesce(v_chrome->>'header_extra', '')), 160),
      'footer_show_page', case when v_chrome ? 'footer_show_page' then coalesce((v_chrome->>'footer_show_page')::boolean, true) else true end,
      'footer_show_rule', case when v_chrome ? 'footer_show_rule' then coalesce((v_chrome->>'footer_show_rule')::boolean, true) else true end,
      'footer_extra', left(trim(coalesce(v_chrome->>'footer_extra', '')), 160)
    );
  elsif v_chrome is not null then
    v_chrome := null;
  end if;

  insert into company_branding (
    id, company_name, company_address, logo_path,
    logo_size_pct, logo_opacity_pct, logo_position,
    overlay_position, overlay_lines, gps_position,
    logo_x_pct, logo_y_pct,
    overlay_x_pct, overlay_y_pct, overlay_scale_pct, overlay_opacity_pct,
    gps_x_pct, gps_y_pct,
    verify_x_pct, verify_y_pct, verify_scale_pct,
    document_chrome,
    updated_at, updated_by
  ) values (
    1, v_name, v_addr, nullif(trim(coalesce(p_logo_path, '')), ''),
    p_logo_size_pct, p_logo_opacity_pct, v_pos,
    v_overlay, v_lines, v_gps,
    v_logo_x, v_logo_y,
    v_overlay_x, v_overlay_y, v_overlay_scale, v_overlay_opacity,
    v_gps_x, v_gps_y,
    v_verify_x, v_verify_y, v_verify_scale,
    coalesce(v_chrome, jsonb_build_object(
      'header_show_logo', true,
      'header_show_name', true,
      'header_extra', '',
      'footer_show_page', true,
      'footer_show_rule', true,
      'footer_extra', ''
    )),
    now(), v_admin
  )
  on conflict (id) do update
     set company_name = excluded.company_name,
         company_address = excluded.company_address,
         logo_path = excluded.logo_path,
         logo_size_pct = excluded.logo_size_pct,
         logo_opacity_pct = excluded.logo_opacity_pct,
         logo_position = excluded.logo_position,
         overlay_position = excluded.overlay_position,
         overlay_lines = excluded.overlay_lines,
         gps_position = excluded.gps_position,
         logo_x_pct = excluded.logo_x_pct,
         logo_y_pct = excluded.logo_y_pct,
         overlay_x_pct = excluded.overlay_x_pct,
         overlay_y_pct = excluded.overlay_y_pct,
         overlay_scale_pct = excluded.overlay_scale_pct,
         overlay_opacity_pct = excluded.overlay_opacity_pct,
         gps_x_pct = excluded.gps_x_pct,
         gps_y_pct = excluded.gps_y_pct,
         verify_x_pct = excluded.verify_x_pct,
         verify_y_pct = excluded.verify_y_pct,
         verify_scale_pct = excluded.verify_scale_pct,
         document_chrome = coalesce(v_chrome, company_branding.document_chrome),
         updated_at = now(),
         updated_by = v_admin;
end;
$$;

grant execute on function
  progress.get_company_branding(),
  progress.staff_get_company_branding(text),
  progress.staff_update_company_branding(text, text, text, int, int, text, text, text, jsonb, text, numeric, numeric, numeric, numeric, int, int, numeric, numeric, numeric, numeric, int, jsonb)
to anon, authenticated;

notify pgrst, 'reload schema';
