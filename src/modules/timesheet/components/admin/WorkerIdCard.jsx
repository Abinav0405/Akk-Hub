/**
 * Worker details as an ID card: passport photo + name, ID, role, type, status.
 * Admins can add / change / remove the photo (one AKK Hub backend only).
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { UNIFIED, supabaseCore } from '@/core/supabase';
import { initialsOf, toPassportPhoto } from '@/ui/photo';

export default function WorkerIdCard({ worker, type, inCompany = true, editable = true }) {
    const id = worker?.employee_id;
    const name = worker?.employee_name || worker?.name || id;
    const [photo, setPhoto] = useState(null);
    const [loading, setLoading] = useState(UNIFIED);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        if (!UNIFIED || !id) return undefined;
        let live = true;
        setLoading(true);
        supabaseCore.rpc('admin_get_worker_photo', { p_employee_id: id }).then(({ data }) => {
            if (!live) return;
            setPhoto(data || null);
            setLoading(false);
        });
        return () => {
            live = false;
        };
    }, [id]);

    const save = async (next) => {
        setBusy(true);
        setError('');
        const { error: e } = await supabaseCore.rpc('admin_set_worker_photo', { p_employee_id: id, p_photo: next });
        setBusy(false);
        if (e) setError(e.message || 'Could not save the photo.');
        else setPhoto(next);
    };

    const onPick = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
            await save(await toPassportPhoto(file));
        } catch (e) {
            setError(e.message);
        }
    };

    return (
        <section
            className="flex gap-4 rounded-2xl border border-[var(--g-hairline)] bg-gradient-to-br from-white to-slate-50 p-4 sm:col-span-2 lg:col-span-3"
            aria-label={`Employee card for ${name}`}
        >
            <div className="relative shrink-0">
                <div className="flex h-[112px] w-[90px] items-center justify-center overflow-hidden rounded-xl border border-[var(--g-hairline)] bg-slate-100">
                    {loading ? (
                        <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden />
                    ) : photo ? (
                        <img src={photo} alt={`Photo of ${name}`} className="h-full w-full object-cover" />
                    ) : (
                        <span className="text-2xl font-bold text-slate-400">{initialsOf(name)}</span>
                    )}
                </div>
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--g-brand-text)]">AKK Engineering · Employee</p>
                <p className="mt-1 truncate text-lg font-semibold text-slate-900">{name}</p>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                    <dt className="text-slate-500">ID</dt>
                    <dd className="font-medium tabular-nums text-slate-900">{id}</dd>
                    <dt className="text-slate-500">Role</dt>
                    <dd className="truncate text-slate-900">{worker?.designation || '—'}</dd>
                    <dt className="text-slate-500">Type</dt>
                    <dd className="text-slate-900">{type === 'local' ? 'Local (Singapore / PR)' : 'Foreign (work pass)'}</dd>
                    <dt className="text-slate-500">Status</dt>
                    <dd className={inCompany ? 'text-emerald-700' : 'text-red-700'}>{inCompany ? 'In company' : 'Not in company'}</dd>
                </dl>
                {UNIFIED && editable ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => inputRef.current?.click()}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                        >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
                            {photo ? 'Change photo' : 'Add photo'}
                        </button>
                        {photo ? (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => save(null)}
                                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                            >
                                <Trash2 className="h-4 w-4" aria-hidden /> Remove
                            </button>
                        ) : null}
                    </div>
                ) : null}
                {error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}
            </div>
        </section>
    );
}
