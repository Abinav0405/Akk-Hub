/**
 * Pieces of worker information shown INSIDE the Attendance "Edit Worker" dialog:
 *   <EditDialogIdCard id/>                — the Employee Identification Card (photo, WP no.);
 *                                           admin can change / remove the photo (saved to core.worker_photos).
 *   <WorkerInfoEditSection ref id type/>  — the worker information details (+ custom ones), saved with
 *                                           the dialog's own Save through `ref.current.save(newId?)`.
 * The profile sheet's "Edit details" opens that dialog with `openWorkerEdit(id, type)`.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Camera, IdCard, Loader2, Trash2 } from 'lucide-react';
import DateInput from '@/ui/DateInput';
import PhotoCropDialog from '@/ui/PhotoCropDialog';
import { cn } from '@/ui/utils';
import EmployeeIdCard from './EmployeeIdCard';
import { INFO_FIELDS, customFieldDefs, showField } from './fields';
import { workerInfoAdmin } from './api';

/** Ask the admin dashboard to open its Edit Worker dialog for this worker. */
export const openWorkerEdit = (id, type) => window.dispatchEvent(new CustomEvent('akk:worker-edit', { detail: { id: String(id), type } }));

const cache = new Map(); // id -> Promise<profile>
function useProfile(id) {
    const [p, setP] = useState(null);
    useEffect(() => {
        if (!id) return undefined;
        let live = true;
        setP(null);
        if (!cache.has(id)) cache.set(id, workerInfoAdmin.profile(id).catch(() => null));
        cache.get(id).then((d) => live && setP(d));
        return () => {
            live = false;
            // keep only while the dialog is open: next open fetches fresh data
            setTimeout(() => cache.delete(id), 0);
        };
    }, [id]);
    return p;
}

export function EditDialogIdCard({ id, fallback = null }) {
    const p = useProfile(id);
    const [photo, setPhoto] = useState(undefined); // undefined = use profile.photo
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [cropFile, setCropFile] = useState(null);
    const inputRef = useRef(null);

    useEffect(() => {
        setPhoto(undefined);
        setError('');
        setCropFile(null);
    }, [id]);

    if (!id) return null;
    if (!p) return fallback || <div className="mx-auto aspect-[1.586] w-full max-w-[440px] animate-pulse rounded-[18px] bg-slate-200/70" aria-busy="true" />;

    const displayPhoto = photo !== undefined ? photo : p.photo || null;

    const persist = async (next) => {
        setBusy(true);
        setError('');
        // Preview first so the ID card updates immediately; revert if the RPC fails.
        const previous = photo;
        setPhoto(next);
        setCropFile(null);
        try {
            await workerInfoAdmin.setPhoto(id, next);
        } catch (e) {
            setPhoto(previous);
            setError(e.message || 'Could not save the photo.');
        } finally {
            setBusy(false);
        }
    };

    const onPick = (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!String(file.type || '').startsWith('image/')) {
            setError('Choose an image file.');
            return;
        }
        setError('');
        setCropFile(file);
    };

    return (
        <div className="flex flex-col items-center gap-3">
            <div className="w-full max-w-[440px]">
                <EmployeeIdCard card={{ ...p, work_permit_no: p.info?.work_permit_no, photo: displayPhoto }} />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
                <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => inputRef.current?.click()}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
                    {displayPhoto ? 'Change photo' : 'Add photo'}
                </button>
                {displayPhoto ? (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => persist(null)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                    >
                        <Trash2 className="h-4 w-4" aria-hidden /> Remove
                    </button>
                ) : null}
            </div>
            {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
            <PhotoCropDialog file={cropFile} busy={busy} onCancel={() => setCropFile(null)} onDone={persist} />
        </div>
    );
}

const val = (f, v) => (v == null ? '' : f.kind === 'date' ? String(v).slice(0, 10) : String(v));

export const WorkerInfoEditSection = forwardRef(function WorkerInfoEditSection({ id, type }, ref) {
    const p = useProfile(id);
    const fields = useMemo(
        () => (p ? [...INFO_FIELDS.filter((f) => showField(f, type || p.worker_type, p.info?.[f.key])), ...customFieldDefs(p.custom_labels)] : []),
        [p, type],
    );
    const [form, setForm] = useState({});
    const [initial, setInitial] = useState({});
    useEffect(() => {
        if (!p) return;
        const next = Object.fromEntries(fields.map((f) => [f.key, val(f, p.info?.[f.key])]));
        setForm(next);
        setInitial(next);
    }, [p, fields]);

    useImperativeHandle(
        ref,
        () => ({
            /** Saves only changed details. `newId` when the Employee ID was changed in the dialog. */
            async save(newId) {
                const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => (v || '') !== (initial[k] || '')));
                if (!Object.keys(changed).length) return false;
                await workerInfoAdmin.save(newId || id, changed);
                setInitial(form);
                return true;
            },
        }),
        [form, initial, id],
    );

    if (!id) return null;
    if (!p) return <p className="text-sm text-slate-500">Loading worker information…</p>;
    return (
        <section className="rounded-xl border border-[var(--g-hairline)] bg-slate-50/60 p-3">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <IdCard className="h-4 w-4 text-[var(--g-brand)]" /> Worker information
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((f) => {
                    const fid = `wie-${f.key}`;
                    const set = (v) => setForm((x) => ({ ...x, [f.key]: v }));
                    return (
                        <div key={f.key} className={cn(f.kind === 'textarea' && 'sm:col-span-2')}>
                            <label htmlFor={fid} className="mb-1 block text-sm font-medium">
                                {f.label}
                            </label>
                            {f.kind === 'date' ? (
                                <DateInput id={fid} value={form[f.key] || ''} onChange={set} inputClassName="h-10 text-sm" />
                            ) : f.kind === 'textarea' ? (
                                <textarea id={fid} rows={2} value={form[f.key] || ''} onChange={(e) => set(e.target.value)} className="w-full rounded-xl border border-[var(--g-hairline)] bg-white p-2.5 text-sm" />
                            ) : (
                                <input
                                    id={fid}
                                    type={f.kind === 'tel' ? 'tel' : 'text'}
                                    value={form[f.key] || ''}
                                    onChange={(e) => set(e.target.value)}
                                    className="h-10 w-full rounded-xl border border-[var(--g-hairline)] bg-white px-3 text-sm"
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
});
