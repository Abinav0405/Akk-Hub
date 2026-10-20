/**
 * Shared cache for "is this session still valid?" server checks.
 *
 * Every ported screen re-verifies its session on mount (Timesheet verifyRoleSession, SPT
 * useRoleGuard, Materials requireWorkerSession…), and the hub guard does too — two to three
 * round trips per page switch. This keeps one answer per session token for a short time and
 * shares a single in-flight request between everyone asking at once.
 *
 * Only positive answers are cached; a rejection is never reused, so a revoked session is
 * still caught on the next check after the TTL.
 */
const DEFAULT_TTL_MS = 90 * 1000;
const entries = new Map(); // key → { at, value }
const inflight = new Map(); // key → Promise

/**
 * @template T
 * @param {string} key  unique per session (include the token)
 * @param {() => Promise<T>} fn  the real server check; return a falsy value for "invalid"
 * @param {{ ttl?: number, isValid?: (v: T) => boolean }} [options]
 * @returns {Promise<T>}
 */
export function cachedVerify(key, fn, { ttl = DEFAULT_TTL_MS, isValid = Boolean } = {}) {
    if (!key) return fn();
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
    if (inflight.has(key)) return inflight.get(key);

    const p = Promise.resolve()
        .then(fn)
        .then(
            (value) => {
                inflight.delete(key);
                if (isValid(value)) entries.set(key, { at: Date.now(), value });
                else entries.delete(key);
                return value;
            },
            (error) => {
                inflight.delete(key);
                throw error;
            },
        );
    inflight.set(key, p);
    return p;
}

/** Peek without a request: the cached value if still fresh, else undefined. */
export function peekVerified(key, ttl = DEFAULT_TTL_MS) {
    const hit = entries.get(key);
    return hit && Date.now() - hit.at < ttl ? hit.value : undefined;
}

/** Seed after a sign-in (the server just issued the session). */
export function primeVerified(key, value) {
    if (key) entries.set(key, { at: Date.now(), value });
}

export function forgetVerified(prefix = '') {
    for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
    for (const key of [...inflight.keys()]) if (key.startsWith(prefix)) inflight.delete(key);
}
