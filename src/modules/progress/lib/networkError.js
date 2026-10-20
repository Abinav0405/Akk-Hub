function errorText(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return `${error.message || ''} ${error.details || ''} ${error.code || ''} ${error.name || ''}`;
}

/** True for connectivity / timeout failures — not for invalid credentials or empty RPC rows. */
export function isTransportError(error) {
  return /fetch|network|Failed to fetch|timeout|offline|ERR_NETWORK|AuthRetryableFetchError|503|502|504|Load failed|Failed to load|PGRST301|connection/i.test(
    errorText(error)
  );
}

/** True when an employee/technician, manager, or admin RPC failed because the session is gone. */
export function isAuthError(error) {
  return /not authenticated|not logged in|invalid (employee|login|session)|session (expired|token)|jwt expired|unauthorized|Admin access required/i.test(
    errorText(error)
  );
}

/** True when PostgREST/Postgres cannot find the RPC (migration not applied, or schema cache stale). */
export function isMissingRpcError(error) {
  return /PGRST202|PGRST203|42883|could not find the function|function .* does not exist|schema cache/i.test(
    errorText(error)
  );
}

export function friendlyDbError(error, fallback = 'Something went wrong') {
  const text = errorText(error);
  if (/0043_manager_jsr_permission/i.test(text)) {
    const hint = typeof error === 'string' ? error : error?.message;
    if (hint) return hint;
  }
  const allowed = text.match(/You are not allowed to [^.!\n]+/i);
  if (allowed) return allowed[0].trim();
  if (isAuthError(error)) return 'Your session expired. Please log in again.';
  if (isTransportError(error)) return 'Could not reach the server. Check your connection and try again.';
  if (/package_images_verification_code|verification_code/i.test(text)) {
    return 'Could not save that photo. Please retake it.';
  }
  if (/duplicate key|unique constraint|23505/i.test(text)) return 'That name is already in use';
  if (/package not found/i.test(text)) return 'That package could not be found';
  if (/cannot change an approved package/i.test(text)) return 'Approved packages cannot be changed';
  if (/image not found/i.test(text)) return 'That photo could not be found';
  const raw = typeof error === 'string' ? error : error?.message;
  if (
    raw &&
    raw.length < 80 &&
    !/not authenticated|function |relation |column |permission denied|PGRST/i.test(raw)
  ) {
    return raw;
  }
  return fallback;
}
