/** True if value is already a bcrypt hash (cannot display as login password). */
export function isStoredPasswordHash(value) {
    if (typeof value !== 'string') return false;
    return /^\$2[aby]\$\d{2}\$/.test(value.trim());
}

/**
 * Password shown in admin edit form.
 * Hashed passwords are never returned — leave blank unless intentionally resetting.
 */
export function getEditableWorkerPassword(stored) {
    const val = typeof stored === 'string' ? stored.trim() : '';
    if (!val || isStoredPasswordHash(val)) return '';
    // Defensive: never surface residual plaintext in the UI
    return '';
}

/** True when a password is set (hash or legacy value present). */
export function hasWorkerPasswordSet(stored) {
    const val = typeof stored === 'string' ? stored.trim() : '';
    return val.length > 0;
}

/** Password to save from admin form (plain text; server hashes on write). */
export function normalizeWorkerPasswordForSave(value) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) return null;
    if (isStoredPasswordHash(trimmed)) return null;
    return trimmed;
}
