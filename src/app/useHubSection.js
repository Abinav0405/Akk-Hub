/**
 * A dashboard's current section, kept in the URL (?section=…) so the hub navigation can open
 * "Leave", "Sites", "People", "Export queue"… inside any dashboard directly, the browser Back
 * button works between sections, and a refresh stays put.
 *
 *   const [tab, setTab] = useHubSection('transactions', ['transactions', 'sites', 'requesters']);
 *
 * Unknown / missing values fall back to the default. Switching section replaces the history
 * entry (tab-like); the sidebar / tab bar links push one.
 *
 * `setSection` accepts a section id or a functional updater `(prev) => next`, matching useState.
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useHubSection(defaultId, ids) {
    const [params, setParams] = useSearchParams();
    const raw = params.get('section');
    const current = raw && (!ids || ids.includes(raw)) ? raw : defaultId;

    const setSection = useCallback(
        (idOrUpdater) => {
            setParams(
                (prev) => {
                    const prevSection = prev.get('section');
                    const prevId = prevSection && (!ids || ids.includes(prevSection)) ? prevSection : defaultId;
                    const id = typeof idOrUpdater === 'function' ? idOrUpdater(prevId) : idOrUpdater;
                    const next = new URLSearchParams(prev);
                    if (!id || id === defaultId) next.delete('section');
                    else next.set('section', id);
                    return next;
                },
                { replace: true }
            );
        },
        [defaultId, ids, setParams]
    );

    return [current, setSection];
}

/** `/materials/admin` + `sites` → `/materials/admin?section=sites` */
export function sectionHref(path, section) {
    return section ? `${path}?section=${encodeURIComponent(section)}` : path;
}
