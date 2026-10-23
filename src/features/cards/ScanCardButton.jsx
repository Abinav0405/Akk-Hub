/**
 * "Scan ID card" button for forms that need a worker (e.g. Material Tracker issue): scans the card,
 * checks it on the server, and hands back { employee_id, name } — only for a valid, employed card.
 */
import { useState } from 'react';
import { IdCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { UNIFIED } from '@/core/supabase';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { cardsScan } from './api';
import CardScanner from './CardScanner';
import { CardFront } from './CardFaces';

export default function ScanCardButton({ onPick, purpose = 'materials', label = 'Scan ID card', className = '' }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [nonce, setNonce] = useState(0);
    const [bad, setBad] = useState(null);
    if (!UNIFIED) return null;

    const onCode = async (code) => {
        setBusy(true);
        try {
            const r = await cardsScan.verify(code, purpose);
            if (!r.found) throw new Error(r.message || 'Not an AKK card');
            const state = r.card?.state;
            const stale = r.method === 'live' && r.live === false;
            if (state !== 'valid' || stale) {
                setBad({ card: r.card, why: stale ? 'Old code — ask for the live card in the app.' : r.checks?.[0]?.text || 'This card is not valid.' });
                return;
            }
            onPick({ employee_id: r.card.employee_id, name: r.card.name });
            toast.success(`${r.card.name} (${r.card.employee_id})`);
            setOpen(false);
        } catch (e) {
            toast.error(e.message);
            setNonce((n) => n + 1);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Button
                type="button"
                variant="outline"
                className={className}
                onClick={() => {
                    setBad(null);
                    setNonce((n) => n + 1);
                    setOpen(true);
                }}
            >
                {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <IdCard className="mr-1.5 h-4 w-4" />} {label}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Scan the worker&apos;s ID card</DialogTitle>
                        <DialogDescription>The worker&apos;s name and ID are filled in for you.</DialogDescription>
                    </DialogHeader>
                    {bad ? (
                        <div className="space-y-3">
                            {bad.card ? <CardFront card={bad.card} /> : null}
                            <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{bad.why}</p>
                            <Button
                                type="button"
                                className="h-11 w-full"
                                onClick={() => {
                                    setBad(null);
                                    setNonce((n) => n + 1);
                                }}
                            >
                                Scan another card
                            </Button>
                        </div>
                    ) : (
                        <CardScanner key={nonce} onCode={onCode} busy={busy} hint="Scan the worker's ID card" />
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
