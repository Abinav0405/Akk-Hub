import { supabaseMaterials } from '@/core/supabase'
import { formatDisplayDateTime, nowDisplayDateTime, TRANSACTION_QUERY_LIMIT } from '@/modules/materials/lib/dates';

export const LOW_STOCK_THRESHOLD = 5;

export function parseQty(value) {
    const n = typeof value === 'number' ? value : parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(n) ? n : 0;
}

export function parseReturnQty(value) {
    // Catalog quantity is INTEGER — keep returns integer to avoid DB check failures.
    const n = typeof value === 'number' ? value : parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(n) ? n : 0;
}

const CATALOG_PAGE_SIZE = 1000;

/** Fetch all catalog materials sorted by reference number (paginated past Supabase default limit) */
export async function fetchMaterialsCatalog() {
    const all = [];
    let from = 0;

    for (;;) {
        const to = from + CATALOG_PAGE_SIZE - 1;
        const { data, error } = await supabaseMaterials
            .from('materials_catalog')
            .select('*')
            .order('reference_number', { ascending: true })
            .range(from, to);

        if (error) throw error;
        const page = data || [];
        all.push(...page);
        if (page.length < CATALOG_PAGE_SIZE) break;
        from += CATALOG_PAGE_SIZE;
    }

    return all;
}

/** Sum pending take quantities per material_id (aggregate only — safe for anon + staff) */
export async function fetchPendingTakeQuantities(excludeTransactionId = null) {
    const { data, error } = await supabaseMaterials.rpc('get_pending_take_quantities', {
        p_exclude_transaction_id: excludeTransactionId || null,
    });

    if (error) throw error;

    const pending = {};
    for (const row of data || []) {
        if (!row.material_id) continue;
        pending[row.material_id] = parseQty(row.pending_qty);
    }
    return pending;
}

/** Available = on-hand stock minus quantities reserved in pending take requests */
export async function getAvailableQuantity(materialId, excludeTransactionId = null) {
    const { data: item, error } = await supabaseMaterials
        .from('materials_catalog')
        .select('quantity')
        .eq('id', materialId)
        .single();

    if (error) throw error;

    const pending = await fetchPendingTakeQuantities(excludeTransactionId);
    const reserved = pending[materialId] || 0;
    return Math.max(0, (item?.quantity || 0) - reserved);
}

/** Log an entry to material_history */
export async function logMaterialHistory({
    materialId,
    referenceNumber,
    actionType,
    quantityChange,
    quantityAfter,
    workerName = null,
    workerId = null,
    siteName = null,
    transactionId = null,
    performedBy,
    notes = null,
}) {
    const { error } = await supabaseMaterials.from('material_history').insert([{
        material_id: materialId,
        reference_number: referenceNumber,
        action_type: actionType,
        quantity_change: quantityChange,
        quantity_after: quantityAfter,
        worker_name: workerName,
        worker_id: workerId,
        site_name: siteName,
        transaction_id: transactionId,
        performed_by: performedBy,
        notes,
    }]);

    if (error) throw error;
}

/** Fetch history for a material, newest first */
export async function fetchMaterialHistory(materialId) {
    const { data, error } = await supabaseMaterials
        .from('material_history')
        .select('*')
        .eq('material_id', materialId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

/**
 * Outstanding return qty per worker + catalog reference_number.
 * Sums all approved takes minus approved returns for that worker/ref.
 * Optionally exclude a pending return transaction (edit mode).
 */
export async function getOutstandingReturnQty({
    workerId,
    referenceNumber,
    excludeTransactionId = null,
    token = null,
} = {}) {
    if ((!workerId && !token) || !referenceNumber) {
        return {
            totalTaken: 0,
            totalReturned: 0,
            available: 0,
            material: null,
        };
    }

    const ref = String(referenceNumber).trim();

    // Worker (anon) path: scoped server-side via the session token, since anon
    // no longer has direct table access to `transactions` (SEC-09).
    if (token) {
        const { data, error } = await supabaseMaterials.rpc('get_worker_outstanding_return', {
            p_token: token,
            p_reference_number: ref,
            p_exclude_transaction_id: excludeTransactionId || null,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        return {
            totalTaken: parseQty(row?.total_taken),
            totalReturned: parseReturnQty(row?.total_returned),
            available: parseQty(row?.available),
            material: row?.material || null,
        };
    }

    // Staff (authenticated) path: RLS already scopes `transactions` via is_staff().
    const { data: takeTransactions, error: takeError } = await supabaseMaterials
        .from('transactions')
        .select('*')
        .eq('transaction_type', 'take')
        .eq('approval_status', 'approved')
        .eq('worker_id', workerId)
        .limit(TRANSACTION_QUERY_LIMIT);

    if (takeError) throw takeError;

    const { data: returnTransactions, error: returnError } = await supabaseMaterials
        .from('transactions')
        .select('*')
        .eq('transaction_type', 'return')
        .eq('approval_status', 'approved')
        .eq('worker_id', workerId)
        .limit(TRANSACTION_QUERY_LIMIT);

    if (returnError) throw returnError;

    let totalTaken = 0;
    let material = null;
    for (const txn of takeTransactions || []) {
        for (const mat of txn.materials || []) {
            if (String(mat.reference_number || '').trim() !== ref) continue;
            totalTaken += parseQty(mat.quantity);
            if (!material) material = mat;
        }
    }

    let totalReturned = 0;
    for (const txn of returnTransactions || []) {
        if (excludeTransactionId && txn.id === excludeTransactionId) continue;
        for (const mat of txn.materials || []) {
            if (String(mat.reference_number || '').trim() !== ref) continue;
            totalReturned += parseReturnQty(mat.return_quantity);
        }
    }

    const available = Math.max(0, totalTaken - totalReturned);
    return { totalTaken, totalReturned, available, material };
}

/** Map of ref → outstanding qty for a worker (picker). */
export async function getWorkerOutstandingReturns(workerId, excludeTransactionId = null, token = null) {
    if (!workerId && !token) return [];

    // Worker (anon) path: scoped server-side via the session token (SEC-09).
    if (token) {
        const { data, error } = await supabaseMaterials.rpc('get_worker_returnable_items', {
            p_token: token,
            p_exclude_transaction_id: excludeTransactionId || null,
        });
        if (error) throw error;
        return (data || []).map((row) => ({
            reference_number: row.reference_number,
            material_id: row.material_id,
            name: row.name,
            unit: row.unit,
            total_taken: parseQty(row.quantity),
            available_quantity: parseQty(row.available_quantity),
            quantity: parseQty(row.quantity),
        }));
    }

    // Staff (authenticated) path: RLS already scopes `transactions` via is_staff().
    const { data: takeTransactions, error: takeError } = await supabaseMaterials
        .from('transactions')
        .select('*')
        .eq('transaction_type', 'take')
        .eq('approval_status', 'approved')
        .eq('worker_id', workerId)
        .limit(TRANSACTION_QUERY_LIMIT);

    if (takeError) throw takeError;
    if (!takeTransactions?.length) return [];

    const { data: returnTransactions, error: returnError } = await supabaseMaterials
        .from('transactions')
        .select('*')
        .eq('transaction_type', 'return')
        .eq('approval_status', 'approved')
        .eq('worker_id', workerId)
        .limit(TRANSACTION_QUERY_LIMIT);

    if (returnError) throw returnError;

    const takenMap = {};
    for (const txn of takeTransactions) {
        for (const mat of txn.materials || []) {
            const ref = String(mat.reference_number || '').trim();
            if (!ref) continue;
            if (!takenMap[ref]) {
                takenMap[ref] = {
                    reference_number: ref,
                    material_id: mat.material_id,
                    name: mat.name,
                    unit: mat.unit,
                    total_taken: 0,
                };
            }
            takenMap[ref].total_taken += parseQty(mat.quantity);
        }
    }

    const returnedMap = {};
    for (const txn of returnTransactions || []) {
        if (excludeTransactionId && txn.id === excludeTransactionId) continue;
        for (const mat of txn.materials || []) {
            const ref = String(mat.reference_number || '').trim();
            if (!ref) continue;
            returnedMap[ref] = (returnedMap[ref] || 0) + parseReturnQty(mat.return_quantity);
        }
    }

    return Object.values(takenMap)
        .map((entry) => {
            const totalReturned = returnedMap[entry.reference_number] || 0;
            const available = Math.max(0, entry.total_taken - totalReturned);
            return {
                ...entry,
                available_quantity: available,
                quantity: entry.total_taken,
            };
        })
        .filter((item) => item.available_quantity > 0)
        .sort((a, b) =>
            String(a.reference_number).localeCompare(String(b.reference_number), undefined, { numeric: true })
        );
}

/** Validate stock is sufficient before approving a take (includes other pending takes). */
export async function validateTakeStock(transaction) {
    const errors = [];
    const pending = await fetchPendingTakeQuantities(transaction?.id || null);

    for (const mat of transaction.materials || []) {
        if (!mat.material_id) {
            errors.push(`${mat.name || 'Unknown'}: not linked to catalog`);
            continue;
        }
        const { data: item, error } = await supabaseMaterials
            .from('materials_catalog')
            .select('quantity, name')
            .eq('id', mat.material_id)
            .single();
        if (error || !item) {
            errors.push(`${mat.name}: not found in catalog`);
            continue;
        }
        const qty = parseQty(mat.quantity);
        const reserved = pending[mat.material_id] || 0;
        const available = Math.max(0, (item.quantity || 0) - reserved);
        if (available < qty) {
            errors.push(`${item.name}: insufficient stock (${available} available, ${qty} requested)`);
        }
    }
    if (errors.length > 0) throw new Error(errors.join('; '));
}

/**
 * Apply stock deduction when a take request is approved.
 * Validate ALL materials first, then apply ALL updates. Fail fast — no partial success.
 */
export async function applyTakeApproval(transaction, adminName) {
    const materials = transaction.materials || [];
    if (!materials.length) throw new Error('Take request has no materials');

    const prepared = [];
    for (const mat of materials) {
        if (!mat.material_id) {
            throw new Error(`${mat.name || 'Unknown material'}: not linked to catalog`);
        }

        const { data: item, error: fetchError } = await supabaseMaterials
            .from('materials_catalog')
            .select('*')
            .eq('id', mat.material_id)
            .single();

        if (fetchError || !item) {
            throw new Error(`${mat.name}: catalog item not found`);
        }

        const qty = parseQty(mat.quantity);
        if (qty < 1) {
            throw new Error(`${mat.name}: invalid quantity`);
        }
        if (item.quantity < qty) {
            throw new Error(`${mat.name}: insufficient stock (${item.quantity} available, ${qty} requested)`);
        }

        prepared.push({ mat, item, qty, newQty: item.quantity - qty });
    }

    for (const { mat, item, qty, newQty } of prepared) {
        const { error: updateError } = await supabaseMaterials
            .from('materials_catalog')
            .update({ quantity: newQty, updated_at: new Date().toISOString() })
            .eq('id', mat.material_id);

        if (updateError) {
            throw new Error(`${mat.name}: failed to update stock`);
        }

        await logMaterialHistory({
            materialId: mat.material_id,
            referenceNumber: mat.reference_number || item.reference_number,
            actionType: 'take',
            quantityChange: -qty,
            quantityAfter: newQty,
            workerName: transaction.worker_name,
            workerId: transaction.worker_id,
            siteName: transaction.site_name || null,
            transactionId: transaction.id,
            performedBy: adminName,
            notes: `Taken by ${transaction.worker_name} (${transaction.worker_id})`,
        });
    }
}

/** Apply stock increase when a return request is approved. Validate all, then apply all. */
export async function applyReturnStockIncrease(transaction, adminName) {
    const materials = transaction.materials || [];
    const prepared = [];

    for (const mat of materials) {
        const returnQty = parseReturnQty(mat.return_quantity);
        if (returnQty <= 0) continue;

        let materialId = mat.material_id;

        if (!materialId && mat.reference_number) {
            const { data: catalogItem } = await supabaseMaterials
                .from('materials_catalog')
                .select('id, quantity, reference_number')
                .eq('reference_number', mat.reference_number)
                .single();
            if (catalogItem) materialId = catalogItem.id;
        }

        if (!materialId) {
            throw new Error(`${mat.name || mat.reference_number || 'Unknown material'}: not linked to catalog`);
        }

        const { data: item, error: fetchError } = await supabaseMaterials
            .from('materials_catalog')
            .select('*')
            .eq('id', materialId)
            .single();

        if (fetchError || !item) {
            throw new Error(`${mat.name || materialId}: catalog item not found`);
        }

        prepared.push({
            mat,
            item,
            materialId,
            returnQty,
            newQty: item.quantity + returnQty,
        });
    }

    if (prepared.length === 0) {
        throw new Error('Return request has no valid quantities to restock');
    }

    for (const { mat, item, materialId, returnQty, newQty } of prepared) {
        const { error: updateError } = await supabaseMaterials
            .from('materials_catalog')
            .update({ quantity: newQty, updated_at: new Date().toISOString() })
            .eq('id', materialId);

        if (updateError) throw updateError;

        await logMaterialHistory({
            materialId,
            referenceNumber: mat.reference_number || item.reference_number,
            actionType: 'return',
            quantityChange: returnQty,
            quantityAfter: newQty,
            workerName: transaction.worker_name,
            workerId: transaction.worker_id,
            siteName: transaction.site_name || null,
            transactionId: transaction.id,
            performedBy: adminName,
            notes: `Returned by ${transaction.worker_name} (${transaction.worker_id})`,
        });
    }
}

/**
 * Allocate an approved/declined return onto matching take rows.
 * Prefer same worker + reference. If several takes share a ref, fill each take
 * up to its original qty from that worker's approved returns.
 */
export async function applyReturnToTakeMaterials(returnTransaction, status, adminName) {
    const returnMaterials = returnTransaction.materials || [];
    const workerId = returnTransaction.worker_id;
    const referenceNumbers = [...new Set(returnMaterials.map(m => m.reference_number).filter(Boolean))];
    if (referenceNumbers.length === 0) return;

    let takeQuery = supabaseMaterials
        .from('transactions')
        .select('*')
        .eq('transaction_type', 'take')
        .eq('approval_status', 'approved')
        .limit(TRANSACTION_QUERY_LIMIT);
    if (workerId) takeQuery = takeQuery.eq('worker_id', workerId);

    const { data: takeTransactions, error: takeError } = await takeQuery;
    if (takeError) throw takeError;

    let returnsQuery = supabaseMaterials
        .from('transactions')
        .select('*')
        .eq('transaction_type', 'return')
        .eq('approval_status', 'approved')
        .limit(TRANSACTION_QUERY_LIMIT);
    if (workerId) returnsQuery = returnsQuery.eq('worker_id', workerId);

    const { data: allApprovedReturns, error: returnsError } = await returnsQuery;
    if (returnsError) throw returnsError;

    const returnedByRef = {};
    for (const approvedReturn of allApprovedReturns || []) {
        if (status === 'declined' && approvedReturn.id === returnTransaction.id) continue;
        for (const mat of approvedReturn.materials || []) {
            const ref = String(mat.reference_number || '').trim();
            if (!ref) continue;
            returnedByRef[ref] = (returnedByRef[ref] || 0) + parseReturnQty(mat.return_quantity);
        }
    }

    const takesByRef = {};
    for (const take of takeTransactions || []) {
        for (const mat of take.materials || []) {
            const ref = String(mat.reference_number || '').trim();
            if (!referenceNumbers.includes(ref) && !referenceNumbers.includes(mat.reference_number)) continue;
            if (!takesByRef[ref]) takesByRef[ref] = [];
            takesByRef[ref].push({ take, matQty: parseQty(mat.quantity) });
        }
    }

    const updates = new Map();

    for (const refNum of referenceNumbers) {
        const remaining = returnedByRef[refNum] || 0;
        let leftover = remaining;
        const candidates = (takesByRef[refNum] || []).filter(({ take }) =>
            !workerId || take.worker_id === workerId
        );

        for (const { take, matQty } of candidates) {
            const applied = Math.min(matQty, leftover);
            leftover = Math.max(0, leftover - applied);
            const isFullyReturned = applied >= matQty;

            const currentMaterials = updates.get(take.id) || take.materials || [];
            const updatedMaterials = currentMaterials.map((material) => {
                if (String(material.reference_number || '').trim() !== String(refNum).trim()) return material;
                if (status === 'approved') {
                    return {
                        ...material,
                        returned: isFullyReturned,
                        returned_quantity: applied,
                        return_date: isFullyReturned ? nowDisplayDateTime() : material.return_date,
                        return_declined: false,
                        return_declined_by: null,
                        return_declined_date: null,
                    };
                }
                return {
                    ...material,
                    returned: isFullyReturned,
                    returned_quantity: applied,
                    return_date: isFullyReturned ? material.return_date : null,
                    return_declined: true,
                    return_declined_by: adminName,
                    return_declined_date: nowDisplayDateTime(),
                };
            });
            updates.set(take.id, updatedMaterials);
        }
    }

    // Staff have no direct UPDATE on transactions; this RPC (is_staff()) only lets the
    // return-tracking keys of an approved take's lines change.
    for (const [transactionId, updatedMaterials] of updates) {
        const { error: updateError } = await supabaseMaterials.rpc('staff_set_return_progress', {
            p_transaction_id: transactionId,
            p_materials: updatedMaterials,
        });
        if (updateError) throw updateError;
    }
}

/** Restock a material */
export async function restockMaterial(materialId, addQuantity, adminName, notes = '') {
    if (addQuantity <= 0) throw new Error('Restock quantity must be greater than 0');

    const { data: item, error: fetchError } = await supabaseMaterials
        .from('materials_catalog')
        .select('*')
        .eq('id', materialId)
        .single();

    if (fetchError || !item) throw new Error('Material not found');

    const newQty = item.quantity + addQuantity;
    const { error: updateError } = await supabaseMaterials
        .from('materials_catalog')
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq('id', materialId);

    if (updateError) throw updateError;

    await logMaterialHistory({
        materialId,
        referenceNumber: item.reference_number,
        actionType: 'restock',
        quantityChange: addQuantity,
        quantityAfter: newQty,
        performedBy: adminName,
        notes: notes || `Restocked +${addQuantity} ${item.unit}`,
    });

    return newQty;
}

/** Format history entry for display */
export function formatHistoryEntry(entry) {
    const date = entry.created_at
        ? formatDisplayDateTime(entry.created_at)
        : '';

    switch (entry.action_type) {
        case 'take':
            return {
                icon: 'take',
                color: 'orange',
                text: `Taken by ${entry.worker_name || 'Unknown'} (${entry.worker_id || '—'})${entry.site_name ? ` to ${entry.site_name}` : ''} — ${Math.abs(entry.quantity_change)} units`,
                date,
            };
        case 'return':
            return {
                icon: 'return',
                color: 'green',
                text: `Returned by ${entry.worker_name || 'Unknown'} (${entry.worker_id || '—'})${entry.site_name ? ` to ${entry.site_name}` : ''} — ${entry.quantity_change} units`,
                date,
            };
        case 'restock':
            return {
                icon: 'restock',
                color: 'blue',
                text: `Restocked by ${entry.performed_by || 'Admin'} — +${entry.quantity_change} units (now ${entry.quantity_after})`,
                date,
            };
        case 'adjustment':
            return {
                icon: 'adjustment',
                color: 'slate',
                text: `Adjusted by ${entry.performed_by || 'Admin'} — ${entry.quantity_change >= 0 ? '+' : ''}${entry.quantity_change} units (now ${entry.quantity_after})`,
                date,
            };
        default:
            return { icon: 'other', color: 'slate', text: entry.notes || entry.action_type, date };
    }
}
