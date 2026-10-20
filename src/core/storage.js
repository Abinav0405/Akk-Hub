/**
 * Namespaced browser storage keys.
 *
 * The three source apps used the same bare keys (`workerId`, `adminLoggedIn`, `managerName`…)
 * for different things. Inside the hub every key lives under `akk.<module>.<key>` so a
 * Timesheet worker session can never be read as a Material Tracker one.
 *
 *   storageKey('timesheet', 'workerId') → "akk.timesheet.workerId"
 *   storageKey('hub', 'lastRole')       → "akk.hub.lastRole"
 */
export const STORAGE_NAMESPACES = ['hub', 'timesheet', 'materials', 'progress', 'camera'];

export function storageKey(module, key) {
    return `akk.${module}.${key}`;
}

function safe(fn, fallback = null) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

/** localStorage helpers that never throw (private mode, quota, disabled storage). */
export const local = {
    get: (module, key) => safe(() => localStorage.getItem(storageKey(module, key))),
    set: (module, key, value) =>
        safe(() => {
            if (value == null) localStorage.removeItem(storageKey(module, key));
            else localStorage.setItem(storageKey(module, key), String(value));
        }),
    remove: (module, key) => safe(() => localStorage.removeItem(storageKey(module, key))),
    getJSON: (module, key, fallback = null) =>
        safe(() => {
            const raw = localStorage.getItem(storageKey(module, key));
            return raw ? JSON.parse(raw) : fallback;
        }, fallback),
    setJSON: (module, key, value) =>
        safe(() => localStorage.setItem(storageKey(module, key), JSON.stringify(value))),
};

/** sessionStorage helpers (per-tab). */
export const session = {
    get: (module, key) => safe(() => sessionStorage.getItem(storageKey(module, key))),
    set: (module, key, value) =>
        safe(() => {
            if (value == null) sessionStorage.removeItem(storageKey(module, key));
            else sessionStorage.setItem(storageKey(module, key), String(value));
        }),
    remove: (module, key) => safe(() => sessionStorage.removeItem(storageKey(module, key))),
};

/** Remove every key of one module from both storages (used on sign-out). */
export function clearModuleStorage(module, { keep = [] } = {}) {
    const prefix = `akk.${module}.`;
    const keepSet = new Set(keep.map((k) => storageKey(module, k)));
    for (const store of [safe(() => localStorage), safe(() => sessionStorage)]) {
        if (!store) continue;
        const doomed = [];
        for (let i = 0; i < store.length; i += 1) {
            const k = store.key(i);
            if (k && k.startsWith(prefix) && !keepSet.has(k)) doomed.push(k);
        }
        doomed.forEach((k) => safe(() => store.removeItem(k)));
    }
}
