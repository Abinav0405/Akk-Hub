-- AKK Hub — staff changes to material requests go through checked server functions.
--
-- Signed-in staff have no UPDATE privilege on materials.transactions (only process_transaction
-- and the worker RPCs write to it). Two app paths still did a direct UPDATE and were refused with
-- "permission denied for table transactions":
--   · a manager / admin editing a pending request            → staff_update_pending_transaction
--   · approving / declining a return, which records the
--     returned quantities on the original take request       → staff_set_return_progress
-- Both require materials.is_staff(). The table privileges are left unchanged.
-- Idempotent.

CREATE OR REPLACE FUNCTION materials.staff_update_pending_transaction(
    p_transaction_id uuid,
    p_materials jsonb,
    p_notes text,
    p_site_id text,
    p_site_name text,
    p_transaction_date date,
    p_transaction_time text,
    p_worker_name text DEFAULT NULL,
    p_worker_id text DEFAULT NULL
)
 RETURNS materials.transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'materials'
AS $function$
DECLARE
    tx materials.transactions%ROWTYPE;
BEGIN
    IF NOT materials.is_staff() THEN
        RAISE EXCEPTION 'Staff access required';
    END IF;
    IF p_materials IS NULL OR jsonb_typeof(p_materials) <> 'array' OR jsonb_array_length(p_materials) = 0 THEN
        RAISE EXCEPTION 'Add at least one material';
    END IF;

    SELECT * INTO tx FROM materials.transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found';
    END IF;
    IF tx.approval_status <> 'pending' THEN
        RAISE EXCEPTION 'Only a pending request can be edited';
    END IF;

    UPDATE materials.transactions
    SET materials = p_materials,
        notes = p_notes,
        site_id = NULLIF(p_site_id, '')::uuid,
        site_name = p_site_name,
        transaction_date = p_transaction_date,
        transaction_time = p_transaction_time::time,
        worker_name = COALESCE(NULLIF(btrim(p_worker_name), ''), worker_name),
        worker_id = COALESCE(NULLIF(btrim(p_worker_id), ''), worker_id)
    WHERE id = p_transaction_id
    RETURNING * INTO tx;

    RETURN tx;
END;
$function$;

-- Records return progress on an approved take request. Only the return-tracking keys of each
-- material line may change; the lines themselves (items, quantities, order) must stay the same.
CREATE OR REPLACE FUNCTION materials.staff_set_return_progress(p_transaction_id uuid, p_materials jsonb)
 RETURNS materials.transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'materials'
AS $function$
DECLARE
    tx materials.transactions%ROWTYPE;
    v_keys text[] := array['returned', 'returned_quantity', 'return_date',
                           'return_declined', 'return_declined_by', 'return_declined_date'];
    v_changed boolean;
BEGIN
    IF NOT materials.is_staff() THEN
        RAISE EXCEPTION 'Staff access required';
    END IF;

    SELECT * INTO tx FROM materials.transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found';
    END IF;
    IF tx.transaction_type <> 'take' OR tx.approval_status <> 'approved' THEN
        RAISE EXCEPTION 'Return progress can only be recorded on an approved take request';
    END IF;
    IF p_materials IS NULL OR jsonb_typeof(p_materials) <> 'array'
       OR jsonb_array_length(p_materials) <> jsonb_array_length(COALESCE(tx.materials, '[]'::jsonb)) THEN
        RAISE EXCEPTION 'Material lines do not match the request';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(tx.materials) WITH ORDINALITY AS o(line, i)
        JOIN jsonb_array_elements(p_materials) WITH ORDINALITY AS n(line, i) USING (i)
        WHERE (o.line - v_keys) IS DISTINCT FROM (n.line - v_keys)
    ) INTO v_changed;
    IF v_changed THEN
        RAISE EXCEPTION 'Only return details can be changed on an approved request';
    END IF;

    UPDATE materials.transactions
    SET materials = p_materials
    WHERE id = p_transaction_id
    RETURNING * INTO tx;

    RETURN tx;
END;
$function$;

REVOKE ALL ON FUNCTION materials.staff_update_pending_transaction(uuid, jsonb, text, text, text, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION materials.staff_update_pending_transaction(uuid, jsonb, text, text, text, date, text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION materials.staff_set_return_progress(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION materials.staff_set_return_progress(uuid, jsonb) TO authenticated, service_role;
