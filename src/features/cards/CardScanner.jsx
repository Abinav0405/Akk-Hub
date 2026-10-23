/**
 * Read an AKK ID card: camera (QR on the phone or printed card) or the 16-digit number typed / from a
 * barcode gun (staff only). Calls onCode(code) once per read; remount (change `key`) to read again.
 */
import { useState } from 'react';
import { Keyboard } from 'lucide-react';
import LiveQrCamera from '@/modules/timesheet/components/LiveQrCamera';
import { Button } from '@/ui/button';
import { extractCode, groupNumber, luhnOk } from './cardModel';

export default function CardScanner({ onCode, busy = false, allowTyping = true, hint = 'Point the camera at the ID card QR' }) {
    const [typing, setTyping] = useState(false);
    const [num, setNum] = useState('');
    const digits = num.replace(/\D/g, '').slice(0, 16);
    const complete = digits.length === 16;
    const valid = complete && luhnOk(digits);

    return (
        <div className="space-y-3">
            {!typing ? (
                <LiveQrCamera onDecoded={(text) => onCode(extractCode(text))} busy={busy} hint={hint} />
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
            {allowTyping ? (
                <button type="button" onClick={() => setTyping((v) => !v)} className="mx-auto flex items-center gap-1.5 text-sm font-semibold text-[var(--g-brand-text)]">
                    <Keyboard className="h-4 w-4" /> {typing ? 'Use the camera instead' : 'Type the card number instead'}
                </button>
            ) : null}
        </div>
    );
}
