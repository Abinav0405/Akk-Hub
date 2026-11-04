/**
 * Transmittal Form helpers for CompanyFormFiller:
 *   - fills the next transmittal number (editable; a number in use is flagged and refused)
 *   - picking a known company fills Attn / Address / Tel from its last transmittal
 *   - picking a known project fills its Project Ref. (and the company, if still empty)
 *   - suggestion lists from earlier transmittals and the site list
 * Only fields that are empty, or still hold what was auto-filled, are ever changed.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getTodaySingapore } from '@/modules/timesheet/lib/timeUtils';
import {
    TRANSMITTAL_KEY,
    loadTransmittalDirectory,
    lookupCompany,
    lookupProject,
    nextTransmittalNo,
    normNo,
    transmittalSuggestions,
} from '@/modules/timesheet/lib/companyForms/transmittal';

const COMPANY_FIELDS = ['attn', 'address', 'tel_email'];
const NO = 'transmittal_no';
const str = (v) => String(v ?? '').trim();
const thisYear = () => Number(String(getTodaySingapore()).slice(0, 4)) || new Date().getFullYear();

function formatDay(iso) {
    try {
        return new Date(iso).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
        return '';
    }
}

export default function useTransmittalAssist({ definition, fields, setFields, initialPayload }) {
    const enabled = definition?.key === TRANSMITTAL_KEY;
    // Editing a sent form: its own number is not "taken".
    const ownNo = normNo(initialPayload?.fields?.[NO]);
    const query = useQuery({
        queryKey: ['transmittal-directory'],
        enabled,
        queryFn: loadTransmittalDirectory,
        staleTime: 0,
        refetchOnMount: 'always',
    });
    const dir = query.data || null;

    const usedBy = useCallback(
        (no, d = dir) => {
            const key = normNo(no);
            if (!key || key === ownNo || !d) return null;
            return d.used.get(key) || null;
        },
        [dir, ownNo]
    );

    const nextNo = useMemo(() => {
        if (!dir) return null;
        const used = new Set([...dir.used.keys()].filter((k) => k !== ownNo));
        return nextTransmittalNo(dir.latestNo, used, thisYear());
    }, [dir, ownNo]);

    // Values this hook wrote, so it can replace them later without touching typed ones.
    const filled = useRef({});

    // Fill the number while the field is empty or still holds the number we filled.
    useEffect(() => {
        if (!enabled || !nextNo) return;
        setFields((prev) => {
            const cur = str(prev[NO]);
            if (cur && cur !== filled.current[NO]) return prev;
            if (cur === nextNo) return prev;
            filled.current[NO] = nextNo;
            return { ...prev, [NO]: nextNo };
        });
    }, [enabled, nextNo, setFields]);

    const fillFrom = (prev, next, record, keys) => {
        for (const k of keys) {
            const cur = str(prev[k]);
            const mayWrite = !cur || cur === filled.current[k];
            if (!mayWrite) continue;
            const v = record ? str(record[k]) : '';
            next[k] = v;
            if (v) filled.current[k] = v;
            else delete filled.current[k];
        }
    };

    /** setFields((prev) => applyChange(prev, key, value)) */
    const applyChange = useCallback(
        (prev, key, value) => {
            const next = { ...prev, [key]: value };
            if (!enabled) return next;
            if (key === NO) {
                // Typed by hand → stop treating it as ours.
                if (str(value) !== filled.current[NO]) delete filled.current[NO];
                return next;
            }
            if (!dir) return next;
            if (key === 'company_name') {
                fillFrom(prev, next, lookupCompany(dir, value), COMPANY_FIELDS);
            } else if (key === 'project') {
                const p = lookupProject(dir, value);
                fillFrom(prev, next, p, ['project_ref']);
                if (p?.company_name && !str(prev.company_name)) {
                    next.company_name = p.company_name;
                    filled.current.company_name = p.company_name;
                    fillFrom(prev, next, lookupCompany(dir, p.company_name), COMPANY_FIELDS);
                }
            }
            return next;
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [enabled, dir]
    );

    const suggestions = useMemo(() => (enabled ? transmittalSuggestions(dir, fields) : {}), [enabled, dir, fields]);

    const taken = enabled ? usedBy(fields?.[NO]) : null;
    const companyKnown = enabled && Boolean(lookupCompany(dir, fields?.company_name));

    const hints = useMemo(() => {
        if (!enabled) return {};
        const h = {};
        if (taken) {
            h[NO] = { tone: 'bad', text: `Already used on ${formatDay(taken.created_at)}${nextNo ? ` — next free number is ${nextNo}` : ''}.`, fix: nextNo };
        } else if (query.isLoading) {
            h[NO] = { text: 'Finding the next number…' };
        } else if (query.isError) {
            h[NO] = { tone: 'bad', text: 'Could not check earlier numbers. Type the number yourself.' };
        } else if (str(fields?.[NO]) && str(fields?.[NO]) === filled.current[NO]) {
            h[NO] = { text: 'Next number. You can change it — later forms continue from the latest one sent.' };
        }
        if (companyKnown && COMPANY_FIELDS.some((k) => filled.current[k] && filled.current[k] === str(fields?.[k]))) {
            h.company_name = { text: 'Attn, address and tel filled from the last transmittal to this company.' };
        }
        return h;
    }, [enabled, taken, nextNo, query.isLoading, query.isError, fields, companyKnown]);

    /** Re-check the number just before sending. Returns false (and fixes the number) if it was taken meanwhile. */
    const checkBeforeSubmit = useCallback(
        async (values) => {
            if (!enabled) return true;
            const fresh = (await query.refetch()).data;
            if (!fresh) return true; // offline check failed — the database still refuses duplicates
            const no = str(values?.[NO]);
            const hit = no && normNo(no) !== ownNo ? fresh.used.get(normNo(no)) : null;
            if (!hit) return true;
            const used = new Set([...fresh.used.keys()].filter((k) => k !== ownNo));
            const free = nextTransmittalNo(fresh.latestNo, used, thisYear());
            filled.current[NO] = free;
            setFields((prev) => ({ ...prev, [NO]: free }));
            toast.error(`${no} was already used. Changed to ${free} — check it and send again.`);
            return false;
        },
        [enabled, query, ownNo, setFields]
    );

    const applyNumber = useCallback(
        (no) => {
            filled.current[NO] = no;
            setFields((prev) => ({ ...prev, [NO]: no }));
        },
        [setFields]
    );

    return { enabled, applyChange, suggestions, hints, checkBeforeSubmit, applyNumber };
}
