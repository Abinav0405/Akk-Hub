/**
 * Public "AKK ID check" page (/id?c=CODE): what a phone camera opens when it scans an AKK card QR.
 * Anyone can see the essentials (photo, name, ID, card / permit / certificate valid, live or not) —
 * never NRIC, pay, or document numbers. Staff who are signed in see the full staff check.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { cardsScan } from './api';
import CardScanner from './CardScanner';
import VerifyResult from './VerifyResult';

export default function PublicIdCheck() {
    const [params, setParams] = useSearchParams();
    const code = params.get('c');
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(Boolean(code)); // no camera flash before the code is checked
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        if (!code) return;
        let live = true;
        setBusy(true);
        cardsScan
            .verify(code, 'verify')
            .then((r) => live && setResult(r))
            .catch((e) => live && setResult({ found: false, message: e.message }))
            .finally(() => live && setBusy(false));
        return () => {
            live = false;
        };
    }, [code]);

    return (
        <div className="mx-auto w-full max-w-lg px-4 py-6">
            <header className="mb-5 flex items-center gap-3">
                <img src="/Akk-logo.png" alt="" className="h-10 w-10 rounded-xl bg-white object-contain p-1 shadow-sm" />
                <div>
                    <h1 className="text-lg font-bold text-slate-900">AKK ID check</h1>
                    <p className="text-xs text-slate-500">AKK Engineering Pte. Ltd. — employee identification</p>
                </div>
            </header>
            {busy ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
            ) : result ? (
                <VerifyResult result={result}>
                    <Button
                        type="button"
                        variant="outline"
                        className="mt-2 h-11 w-full"
                        onClick={() => {
                            setResult(null);
                            setParams({});
                            setNonce((n) => n + 1);
                        }}
                    >
                        Check another card
                    </Button>
                </VerifyResult>
            ) : (
                <CardScanner key={nonce} allowTyping={false} onCode={(c) => setParams({ c })} />
            )}
        </div>
    );
}
