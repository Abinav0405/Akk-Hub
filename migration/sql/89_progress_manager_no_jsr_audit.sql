-- AKK Hub — Site work: managers cannot view the audit trail of JSRs and claims (admin only).
-- Same function as before, plus one rule for manager sessions. Idempotent.
CREATE OR REPLACE FUNCTION progress.document_list_events(p_kind text, p_document_id uuid, p_manager_token text DEFAULT NULL::text, p_exporter_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'progress', 'extensions'
AS $function$
declare
  a record;
begin
  if not _document_kind_ok(p_kind) then raise exception 'Invalid document kind'; end if;
  -- Events are independent of document_artifacts (PDF storage).
  if p_document_id is null or not _document_exists(p_kind, p_document_id) then
    return '[]'::jsonb;
  end if;
  select * into a from _document_actor(p_manager_token, p_exporter_token);
  -- JSR / claim audit trails are for admins only.
  if a.actor_role = 'manager' and p_kind in ('jsr', 'jsr_claim') then
    raise exception 'You cannot view that audit trail';
  end if;
  if not _document_can_read(p_kind, p_document_id, a.actor_role, a.actor_id) then
    raise exception 'You cannot view that audit trail';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id,
      'kind', e.kind,
      'documentId', e.document_id,
      'action', e.action,
      'summary', e.summary,
      'details', e.details,
      'actorName', e.actor_name,
      'actorRole', e.actor_role,
      'actorId', e.actor_id,
      'portal', e.portal,
      'createdAt', e.created_at
    ) order by e.created_at)
    from document_audit_events e
    where e.kind = p_kind
      and e.document_id = p_document_id
      and (
        a.actor_role <> 'exporter'
        or _document_event_visible_to_exporter(e.details, e.action, e.actor_role, e.actor_id, a.actor_id)
      )
  ), '[]'::jsonb);
end;
$function$;
