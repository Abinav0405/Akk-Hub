/**
 * Account avatar for workers: their passport-style photo, tap to add / change it.
 * Staff (and the old three-project setup) keep the initials avatar.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { UNIFIED, supabaseCore } from '@/core/supabase';
import { getRoleSessionToken } from '@/core/auth/timesheetSession';
import { initialsOf, toPassportPhoto } from '@/ui/photo';

export default function MyPhotoAvatar({ name, isWorker }) {
    const enabled = UNIFIED && isWorker;
    const [photo, setPhoto] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        if (!enabled) return undefined;
        let live = true;
        supabaseCore.rpc('my_photo', { p_session_token: getRoleSessionToken() }).then(({ data }) => {
            if (live) setPhoto(data || null);
        });
        return () => {
            live = false;
        };
    }, [enabled]);

    const onPick = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setBusy(true);
        setError('');
        try {
            const next = await toPassportPhoto(file);
            const { error: e } = await supabaseCore.rpc('set_my_photo', { p_session_token: getRoleSessionToken(), p_photo: next });
            if (e) throw e;
            setPhoto(next);
        } catch (e) {
            setError(e.message || 'Could not save the photo.');
        } finally {
            setBusy(false);
        }
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
        <div className="shrink-0">
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                aria-label={photo ? 'Change your photo' : 'Add your photo'}
                className="relative flex h-16 w-14 items-center justify-center overflow-hidden rounded-xl bg-[var(--g-brand-soft)] ring-1 ring-[var(--g-hairline)]"
            >
                {face}
                <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-tl-lg bg-white/95 text-[var(--g-brand)]">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Camera className="h-3.5 w-3.5" aria-hidden />}
                </span>
            </button>
            {error ? <p className="mt-1 max-w-[10rem] text-xs text-red-600" role="alert">{error}</p> : null}
        </div>
    );
}
