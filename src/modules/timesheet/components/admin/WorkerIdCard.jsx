/**
 * Worker details as an ID card: passport photo + name, ID, role, type, status.
 * Admins can add / change / remove the photo (one AKK Hub backend only).
 * Visual: employee burgundy / AKK crimson strip (matches ID cards 2.0 employee theme).
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
            className="relative overflow-hidden rounded-2xl sm:col-span-2 lg:col-span-3"
            style={{
                background: 'linear-gradient(135deg, #4a0614 0%, #a50f2d 100%)',
                boxShadow: '0 1px 2px rgb(15 23 42 / 0.1), 0 16px 36px -22px rgb(15 23 42 / 0.55)',
            }}
            aria-label={`Employee card for ${name}`}
        >
            <div
                className="flex items-center gap-2.5 px-4 py-2.5 text-white"
                style={{
                    background: 'linear-gradient(120deg, #2b040c 0%, #5c0718 55%, #7a0b20 100%)',
                    borderBottom: '2px solid rgb(255 255 255 / 0.9)',
                }}
            >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white shadow-[0_0_0_1px_rgb(255_255_255_/_0.9)]">
                    <img src="/Akk-logo.png" alt="" className="h-[78%] w-[78%] object-contain" />
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[11px] font-extrabold tracking-wide">AKK ENGINEERING PTE. LTD.</span>
                    <span className="block text-[9px] font-semibold tracking-[0.14em] text-white/80">IDENTIFICATION CARD</span>
                </span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-extrabold tracking-[0.12em] text-white shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.45)]">
                    EMPLOYEE
                </span>
            </div>
            <div className="flex gap-4 p-4 text-white">
                <div className="relative shrink-0">
                    <div
                        className="flex h-[112px] w-[90px] items-center justify-center overflow-hidden rounded-xl bg-white/15"
                        style={{ boxShadow: '0 0 0 2px rgb(255 255 255 / 0.95), 0 0 0 3.5px rgb(255 255 255 / 0.85)' }}
                    >
                        {loading ? (
                            <Loader2 className="h-5 w-5 animate-spin text-white/70" aria-hidden />
                        ) : photo ? (
                            <img src={photo} alt={`Photo of ${name}`} className="h-full w-full object-cover" />
                        ) : (
                            <span className="text-2xl font-bold text-white/65">{initialsOf(name)}</span>
                        )}
                    </div>
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">Name</p>
                    <p className="mt-0.5 truncate text-lg font-extrabold uppercase leading-tight tracking-wide">{name}</p>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                        <dt className="text-[10px] font-bold uppercase tracking-wide text-white/65">ID</dt>
                        <dd className="font-semibold tabular-nums">{id}</dd>
                        <dt className="text-[10px] font-bold uppercase tracking-wide text-white/65">Role</dt>
                        <dd className="truncate font-semibold">{worker?.designation || '—'}</dd>
                        <dt className="text-[10px] font-bold uppercase tracking-wide text-white/65">Type</dt>
                        <dd className="font-semibold">{type === 'local' ? 'Local (Singapore / PR)' : 'Foreign (work pass)'}</dd>
                        <dt className="text-[10px] font-bold uppercase tracking-wide text-white/65">Status</dt>
                        <dd className={inCompany ? 'font-semibold text-emerald-300' : 'font-semibold text-red-200'}>
                            {inCompany ? 'In company' : 'Not in company'}
                        </dd>
                    </dl>
                    {UNIFIED && editable ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => inputRef.current?.click()}
                                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/35 bg-white/10 px-3 text-sm font-semibold text-white hover:bg-white/18 disabled:opacity-60"
                            >
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
                                {photo ? 'Change photo' : 'Add photo'}
                            </button>
                            {photo ? (
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => save(null)}
                                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-red-100 hover:bg-white/10 disabled:opacity-60"
                                >
                                    <Trash2 className="h-4 w-4" aria-hidden /> Remove
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                    {error ? <p className="mt-2 text-sm text-red-200" role="alert">{error}</p> : null}
                </div>
            </div>
        </section>
    );
}
