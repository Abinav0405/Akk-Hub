import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { declinePackage } from '@/modules/progress/lib/staffPackages';
import { packageHeading } from '@/modules/progress/lib/sectionLabel';
import { friendlyDbError } from '@/modules/progress/lib/networkError';

export default function DeclineReasonDialog({ pkg, onClose, onDeclined }) {
    const [reason, setReason] = useState(pkg.decline_reason || '');
    const [busy, setBusy] = useState(false);

    const handleConfirm = async () => {
        if (!reason.trim()) {
            toast.error('Enter a reason for declining');
            return;
        }
        setBusy(true);
        try {
            await declinePackage(pkg.id, reason.trim());
            toast.success('Package declined');
            onDeclined();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not decline'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{pkg.approval_status === 'declined' ? 'Decline again' : 'Decline Package'}</DialogTitle>
                </DialogHeader>
                <p className="-mt-2 text-sm text-muted-foreground">
                    {packageHeading(pkg)}
                </p>
                <div className="space-y-1.5">
                    <Label htmlFor="decline-reason">Reason for declining</Label>
                    <Textarea
                        id="decline-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="e.g. Photos too blurry, please retake"
                        rows={3}
                        autoFocus
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button variant="destructive" onClick={handleConfirm} disabled={busy}>
                        Confirm Decline
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
