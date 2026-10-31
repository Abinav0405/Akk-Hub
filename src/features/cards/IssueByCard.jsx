/**
 * Materials (store staff / managers / admins): "Issue by ID card" — scan the worker's card, then pick the
 * materials. The worker's name + ID come from the card scan (server-checked ticket), never typed, and the
 * record is saved as already approved (handed over at the store).
 */
import { useState } from 'react';
import { IdCard } from 'lucide-react';
import { UNIFIED } from '@/core/supabase';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import MaterialForm from '@/modules/materials/components/MaterialForm';
import ScanCardButton from './ScanCardButton';

export default function IssueByCard({ onIssued }) {
    const [worker, setWorker] = useState(null); // { employee_id, name, scan_id }
    if (!UNIFIED) return null;
    return (
        <>
            <ScanCardButton label="Issue by ID card" purpose="materials" className="h-9" onPick={(w) => setWorker(w)} />
            <Dialog open={Boolean(worker)} onOpenChange={(o) => !o && setWorker(null)}>
                <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <IdCard className="h-5 w-5 text-[var(--g-brand)]" /> Issue materials
                        </DialogTitle>
                        <DialogDescription>
                            To {worker?.name} ({worker?.employee_id}) — checked by ID card. Saved as approved.
                        </DialogDescription>
                    </DialogHeader>
                    {worker ? (
                        <MaterialForm
                            key={worker.scan_id}
                            type="take"
                            asStaff
                            issueTo={worker}
                            onBack={() => setWorker(null)}
                            onSuccess={() => {
                                setWorker(null);
                                onIssued?.();
                            }}
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </>
    );
}
