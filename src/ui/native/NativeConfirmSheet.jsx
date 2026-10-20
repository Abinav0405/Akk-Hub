/**
 * The confirmation dialog drawn by NativeConfirmHost (ui/native/NativeConfirm.jsx).
 * Loaded on the first confirmAction() so the Radix dialog code isn't in the first page load.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { cn } from '@/ui/utils';

export default function NativeConfirmSheet({ request, onSettle }) {
    const destructive = Boolean(request?.destructive);
    const body = request?.detail || request?.message;

    return (
        <Dialog open={!!request} onOpenChange={(open) => !open && onSettle(false)}>
            <DialogContent className="max-w-sm" hideClose>
                <DialogHeader className="pr-0 text-center sm:text-left">
                    <DialogTitle>{request?.title || 'Are you sure?'}</DialogTitle>
                    {body ? (
                        <DialogDescription className="whitespace-pre-line">{body}</DialogDescription>
                    ) : (
                        <DialogDescription className="sr-only">Confirm this action</DialogDescription>
                    )}
                </DialogHeader>
                <div className="grid gap-2 pt-1">
                    <button
                        type="button"
                        className={cn('g-btn g-btn--block', destructive ? 'g-btn--danger' : 'g-btn--primary')}
                        onClick={() => onSettle(true)}
                        autoFocus
                    >
                        {request?.confirmLabel || 'Confirm'}
                    </button>
                    <button type="button" className="g-btn g-btn--ghost g-btn--block" onClick={() => onSettle(false)}>
                        {request?.cancelLabel || 'Cancel'}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
