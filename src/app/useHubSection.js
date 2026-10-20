/**
 * A dashboard's current section, kept in the URL (?section=…) so the hub navigation can open
 * "Leave", "Sites", "People", "Export queue"… inside any dashboard directly, the browser Back
 * button works between sections, and a refresh stays put.
 *
 *   const [tab, setTab] = useHubSection('transactions', ['transactions', 'sites', 'requesters']);
 *
 * Unknown / missing values fall back to the default. Switching section replaces the history
 * entry (tab-like); the sidebar / tab bar links push one.
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useHubSection(defaultId, ids) {
    const [params, setParams] = useSearchParams();
    const raw = params.get('section');
    const current = raw && (!ids || ids.includes(raw)) ? raw : defaultId;

    const setSection = useCallback(
        (id) => {
            setParams(
                (prev) => {
                    const next = new URLSearchParams(prev);
                    if (!id || id === defaultId) next.delete('section');
                    else next.set('section', id);
                    return next;
                },
                { replace: true }
            );
        },
        [defaultId, setParams]
    );

    return [current, setSection];
}

/** `/materials/admin` + `sites` → `/materials/admin?section=sites` */
export function sectionHref(path, section) {
    return section ? `${path}?section=${encodeURIComponent(section)}` : path;
}
