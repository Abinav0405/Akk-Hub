/**
 * Account avatar for workers: their passport-style photo. Tap to add one; with a photo, tap for
 * Change (pick → crop) or Remove. Staff (and the old three-project setup) keep the initials avatar.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { UNIFIED, supabaseCore } from '@/core/supabase';
import { getRoleSessionToken } from '@/core/auth/timesheetSession';
import { initialsOf } from '@/ui/photo';
import PhotoCropDialog from '@/ui/PhotoCropDialog';

export default function MyPhotoAvatar({ name, isWorker }) {
    const enabled = UNIFIED && isWorker;
    const [photo, setPhoto] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [menu, setMenu] = useState(false);
    const [cropFile, setCropFile] = useState(null);
    const inputRef = useRef(null);
    const wrapRef = useRef(null);

    useEffect(() => {
        if (!enabled) return undefined;
        let live = true;
        const load = () =>
            supabaseCore.rpc('my_photo', { p_session_token: getRoleSessionToken() }).then(({ data }) => {
                if (live) setPhoto(data || null);
            });
        load();
        // The ID card can add the photo too — keep both in step.
        window.addEventListener('akk:photo-changed', load);
        return () => {
            live = false;
            window.removeEventListener('akk:photo-changed', load);
        };
    }, [enabled]);

    useEffect(() => {
        if (!menu) return undefined;
        const close = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenu(false);
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [menu]);

    const save = async (next) => {
        setBusy(true);
        setError('');
        try {
            const { error: e } = await supabaseCore.rpc('set_my_photo', { p_session_token: getRoleSessionToken(), p_photo: next });
            if (e) throw e;
            setPhoto(next);
            window.dispatchEvent(new CustomEvent('akk:photo-changed'));
            setCropFile(null);
        } catch (e) {
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

    const face = photo ? (
        <img src={photo} alt="Your photo" className="h-full w-full object-cover" />
    ) : (
        <span className="text-lg font-bold text-[var(--g-brand-text)]">{initialsOf(name)}</span>
    );

    if (!enabled) {
        return <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--g-brand-soft)]">{face}</span>;
    }
    return (
        <div className="relative shrink-0" ref={wrapRef}>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
            <button
                type="button"
                onClick={() => (photo ? setMenu((m) => !m) : inputRef.current?.click())}
                disabled={busy}
                aria-label={photo ? 'Change or remove your photo' : 'Add your photo'}
                aria-haspopup={photo ? 'menu' : undefined}
                aria-expanded={photo ? menu : undefined}
                className="relative flex h-16 w-14 items-center justify-center overflow-hidden rounded-xl bg-[var(--g-brand-soft)] ring-1 ring-[var(--g-hairline)]"
            >
                {face}
                <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-tl-lg bg-white/95 text-[var(--g-brand)]">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Camera className="h-3.5 w-3.5" aria-hidden />}
                </span>
            </button>
            {menu ? (
                <div role="menu" className="absolute left-0 top-[calc(100%+6px)] z-20 w-44 overflow-hidden rounded-xl border border-[var(--g-hairline)] bg-white py-1 shadow-lg">
                    <button
                        type="button"
                        role="menuitem"
                        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-medium hover:bg-slate-50"
                        onClick={() => {
                            setMenu(false);
                            inputRef.current?.click();
                        }}
                    >
                        <ImagePlus className="h-4 w-4" aria-hidden /> Change photo
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-medium text-red-700 hover:bg-red-50"
                        onClick={() => {
                            setMenu(false);
                            save(null);
                        }}
                    >
                        <Trash2 className="h-4 w-4" aria-hidden /> Remove photo
                    </button>
                </div>
            ) : null}
            {error ? <p className="mt-1 max-w-[10rem] text-xs text-red-600" role="alert">{error}</p> : null}
            <PhotoCropDialog file={cropFile} busy={busy} onCancel={() => setCropFile(null)} onDone={save} />
        </div>
    );
}
