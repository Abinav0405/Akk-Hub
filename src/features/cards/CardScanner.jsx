/**
 * Read an AKK ID card: camera (QR on the phone or printed card) or the 16-digit number typed / from a
 * barcode gun (staff only). Calls onCode(code) once per read; remount (change `key`) to read again.
 */
import { useState } from 'react';
import { useEffect } from 'react';
import { Keyboard, Nfc } from 'lucide-react';
import { nfcAvailable, startNfcRead } from './nfc';
import LiveQrCamera from '@/modules/timesheet/components/LiveQrCamera';
import { Button } from '@/ui/button';
import { extractCode, groupNumber, luhnOk } from './cardModel';

export default function CardScanner({ onCode, busy = false, allowTyping = true, hint = 'Point the camera at the ID card QR' }) {
    const [typing, setTyping] = useState(false);
    const [nfcOn, setNfcOn] = useState(false); // listening for a tap
    const [nfcOk, setNfcOk] = useState(false);
    const [nfcMsg, setNfcMsg] = useState('');
    const [num, setNum] = useState('');
    const digits = num.replace(/\D/g, '').slice(0, 16);
    const complete = digits.length === 16;
    const valid = complete && luhnOk(digits);

    useEffect(() => {
        if (allowTyping) nfcAvailable().then(setNfcOk);
    }, [allowTyping]);

    // Tap mode: the NFC reader runs only while this is on, and stops after one card.
    useEffect(() => {
        if (!nfcOn) return undefined;
        let stop = () => {};
        let alive = true;
        setNfcMsg('');
        startNfcRead(
            (text) => {
                if (!alive) return;
                setNfcOn(false);
                onCode(extractCode(text));
            },
            (m) => alive && setNfcMsg(m),
        ).then((s) => {
            if (alive) stop = s;
            else s();
        });
        return () => {
            alive = false;
            stop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nfcOn]);

    return (
        <div className="space-y-3">
            {nfcOn ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--g-hairline)] bg-white px-4 py-10 text-center" role="status">
                    <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-[var(--g-brand-soft)] text-[var(--g-brand)]">
                        <span className="absolute inset-0 animate-ping rounded-full bg-[var(--g-brand)]/20" />
                        <Nfc className="relative h-9 w-9" />
                    </span>
                    <p className="text-base font-semibold text-slate-900">Hold the card to the back of the phone</p>
                    <p className="text-sm text-slate-500">{nfcMsg || 'Waiting for the tap…'}</p>
                    <button type="button" onClick={() => setNfcOn(false)} className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700">
                        Use the camera instead
                    </button>
                </div>
            ) : !typing ? (
                <LiveQrCamera onDecoded={(text) => onCode(extractCode(text))} busy={busy} hint={allowTyping ? `${hint} or its barcode` : hint} barcode={allowTyping} />
            ) : (
                <form
                    className="space-y-2 rounded-2xl border border-[var(--g-hairline)] bg-white p-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (valid) onCode(digits);
                    }}
                >
                    <label htmlFor="card-number" className="block text-sm font-semibold text-slate-800">
                        Card number
                    </label>
                    <input
                        id="card-number"
                        autoFocus
                        inputMode="numeric"
                        autoComplete="off"
                        value={groupNumber(digits)}
                        onChange={(e) => setNum(e.target.value)}
                        placeholder="0000 0000 0000 0000"
                        className={`h-14 w-full rounded-xl border bg-white px-4 text-center font-mono text-xl tracking-[0.18em] ${complete && !valid ? 'border-red-400' : 'border-[var(--g-hairline)]'}`}
                    />
                    {complete && !valid ? <p className="text-xs text-red-600">That number is not right — check the digits.</p> : <p className="text-xs text-slate-500">16 digits from the back of the card. A barcode scanner can type it here too.</p>}
                    <Button type="submit" className="h-11 w-full" disabled={!valid || busy}>
                        Check card
                    </Button>
                </form>
            )}
            {allowTyping && nfcOk && !nfcOn ? (
                <button type="button" onClick={() => { setTyping(false); setNfcOn(true); }} className="mx-auto flex items-center gap-1.5 text-sm font-semibold text-[var(--g-brand-text)]">
                    <Nfc className="h-4 w-4" /> Tap the card (NFC)
                </button>
            ) : null}
            {allowTyping && !nfcOn ? (
                <button type="button" onClick={() => setTyping((v) => !v)} className="mx-auto flex items-center gap-1.5 text-sm font-semibold text-[var(--g-brand-text)]">
                    <Keyboard className="h-4 w-4" /> {typing ? 'Use the camera instead' : 'Type the card number instead'}
                </button>
            ) : null}
        </div>
    );
}
