import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useLanguage } from '@/modules/timesheet/lib/i18n';
import {
    isShiftApproved,
    isShiftDeclined,
    shiftNeedsApprovalActions,
} from '@/modules/timesheet/lib/shiftApproval';

export function ShiftApprovalStatusBadge({ shift }) {
    const { t } = useLanguage();
    if (!shift?.has_left) return null;
    if (isShiftApproved(shift)) {
        return (
            <Badge className="bg-emerald-100 text-emerald-900 border-emerald-200">{t('ui.approved')}</Badge>
        );
    }
    if (isShiftDeclined(shift)) {
        return <Badge variant="destructive">{t('ui.declined')}</Badge>;
    }
    return (
        <Badge className="bg-amber-100 text-amber-900 border-amber-200">{t('ui.pendingApproval')}</Badge>
    );
}

export function ShiftApprovalMeta({ shift }) {
    const { t } = useLanguage();
    if (!shift) return null;
    const approvedByLabel = shift.approved_by || (isShiftApproved(shift) ? shift.edited_by : null);
    return (
        <>
            {approvedByLabel ? (
                <p className="text-xs text-emerald-800 italic">{t('ui.approvedBy', { name: approvedByLabel })}</p>
            ) : null}
            {shift.edited_by && shift.edited_by !== approvedByLabel ? (
                <p className="text-xs text-slate-500 italic">{t('ui.editedBy', { name: shift.edited_by })}</p>
            ) : null}
        </>
    );
}

export function ShiftApprovalButtons({ shift, onApprove, onDecline, busy = false, className = '' }) {
    const { t } = useLanguage();
    if (!shiftNeedsApprovalActions(shift)) return null;
    return (
        <div className={`flex flex-wrap gap-2 ${className}`}>
            <Button
                type="button"
                size="sm"
                className="min-h-9 flex-1 bg-emerald-600 hover:bg-emerald-700 text-xs sm:flex-initial sm:text-sm"
                disabled={busy}
                onClick={() => onApprove(shift)}
            >
                {busy ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                    <CheckCircle className="w-4 h-4 mr-1" />
                )}
                {t('ui.approve')}
            </Button>
            <Button
                type="button"
                size="sm"
                variant="destructive"
                className="min-h-9 flex-1 text-xs sm:flex-initial sm:text-sm"
                disabled={busy}
                onClick={() => onDecline(shift)}
            >
                <XCircle className="w-4 h-4 mr-1" />
                {t('ui.decline')}
            </Button>
        </div>
    );
}
