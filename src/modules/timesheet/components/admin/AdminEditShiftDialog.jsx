import { useEffect, useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { AdminFieldLabel, AdminToneIcon, glassDialog, glassInput } from '@/ui/PortalShell';
import { cn, fromDateTimeLocalUtc } from '@/modules/timesheet/lib/utils';
import { formatDate } from '@/modules/timesheet/lib/timeUtils';
import { toast } from 'sonner';
import { Trash2, Edit2 } from 'lucide-react';

const EMPTY_FORM = {
    entry_time: '',
    leave_time: '',
    breaks: [{ lunch_start: '', lunch_end: '' }],
    leave_type: '__none__',
    originalBreaks: [],
};

export default function AdminEditShiftDialog({
    open,
    onOpenChange,
    editingShift,
    initialData,
    needsApprovalActions,
    onSave,
}) {
    const [data, setData] = useState(initialData || EMPTY_FORM);

    useEffect(() => {
        if (open) {
            setData(initialData || EMPTY_FORM);
        }
    }, [open, initialData]);

    const totalBreakHours = (data.breaks || []).reduce((sum, b) => {
        const startIso = b.lunch_start ? fromDateTimeLocalUtc(b.lunch_start) : null;
        const endIso = b.lunch_end ? fromDateTimeLocalUtc(b.lunch_end) : null;
        if (!startIso || !endIso) return sum;
        const diffMs = new Date(endIso) - new Date(startIso);
        if (!Number.isFinite(diffMs) || diffMs <= 0) return sum;
        return sum + diffMs / (1000 * 60 * 60);
    }, 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className={cn(glassDialog, 'max-w-2xl')}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2.5">
                        <AdminToneIcon icon={Edit2} tone="indigo" />
                        Edit Shift
                    </DialogTitle>
                    <DialogDescription>
                        Clock-in, clock-out, breaks, and leave for this shift. Live shift updates pause while this form is open.
                    </DialogDescription>
                </DialogHeader>
                {editingShift ? (
                    <>
                        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 px-4 py-3">
                            <p className="font-semibold text-slate-900">
                                {editingShift.workers?.employee_name || 'Worker'}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                                ID {editingShift.worker_id}
                                {editingShift.work_date ? ` · ${formatDate(editingShift.work_date)}` : ''}
                                {editingShift.sites?.site_name ? ` · ${editingShift.sites.site_name}` : ''}
                            </p>
                        </div>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <AdminFieldLabel>Entry Time</AdminFieldLabel>
                                    <Input
                                        type="datetime-local"
                                        className={glassInput}
                                        value={data.entry_time}
                                        onChange={(e) => setData((prev) => ({ ...prev, entry_time: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <AdminFieldLabel>Exit Time</AdminFieldLabel>
                                    <Input
                                        type="datetime-local"
                                        className={glassInput}
                                        value={data.leave_time}
                                        onChange={(e) => setData((prev) => ({ ...prev, leave_time: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <AdminFieldLabel>Breaks</AdminFieldLabel>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-9 rounded-xl text-xs"
                                        onClick={() => {
                                            const currentBreaks = data.breaks || [];
                                            if (currentBreaks.length > 0) {
                                                const lastBreak = currentBreaks[currentBreaks.length - 1];
                                                if (!lastBreak.lunch_start || !lastBreak.lunch_end) {
                                                    toast.error(
                                                        'Please fill start and end time for the last break before adding a new one'
                                                    );
                                                    return;
                                                }
                                            }
                                            setData((prev) => ({
                                                ...prev,
                                                breaks: [...(prev.breaks || []), { lunch_start: '', lunch_end: '' }],
                                            }));
                                        }}
                                    >
                                        + Add Break
                                    </Button>
                                </div>
                                {data.breaks.map((breakItem, index) => (
                                    <div key={index} className="space-y-2 rounded-xl border border-amber-200/80 bg-amber-50/50 p-3">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-sm font-medium">Break {index + 1}</h4>
                                            {data.breaks.length > 1 && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setData((prev) => ({
                                                            ...prev,
                                                            breaks: prev.breaks.filter((_, i) => i !== index),
                                                        }));
                                                    }}
                                                    className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="space-y-1">
                                                <label className="text-xs text-slate-600">Break Start Time</label>
                                                <Input
                                                    type="datetime-local"
                                                    value={breakItem.lunch_start}
                                                    className={cn(glassInput, 'h-10 text-xs')}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        setData((prev) => {
                                                            const nextBreaks = [...prev.breaks];
                                                            nextBreaks[index] = { ...nextBreaks[index], lunch_start: value };
                                                            return { ...prev, breaks: nextBreaks };
                                                        });
                                                    }}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs text-slate-600">Break End Time</label>
                                                <Input
                                                    type="datetime-local"
                                                    value={breakItem.lunch_end}
                                                    className={cn(glassInput, 'h-10 text-xs')}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        setData((prev) => {
                                                            const nextBreaks = [...prev.breaks];
                                                            nextBreaks[index] = { ...nextBreaks[index], lunch_end: value };
                                                            return { ...prev, breaks: nextBreaks };
                                                        });
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                <div className="text-right text-xs text-slate-600">
                                    Total Break Hours: {totalBreakHours.toFixed(2)}h
                                </div>
                            </div>

                            <div className="space-y-2">
                                <AdminFieldLabel>Leave Type (Optional)</AdminFieldLabel>
                                <Select
                                    value={data.leave_type}
                                    onValueChange={(value) => setData((prev) => ({ ...prev, leave_type: value }))}
                                >
                                    <SelectTrigger className={cn(glassInput, 'w-full')}>
                                        <SelectValue placeholder="Select leave type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">No Leave</SelectItem>
                                        <SelectItem value="Annual Leave">Annual Leave</SelectItem>
                                        <SelectItem value="Maternity Leave">Maternity Leave</SelectItem>
                                        <SelectItem value="Paternity Leave">Paternity Leave</SelectItem>
                                        <SelectItem value="Shared Parental Leave">Shared Parental Leave</SelectItem>
                                        <SelectItem value="Childcare Leave">Childcare Leave</SelectItem>
                                        <SelectItem value="Medical Leave">Medical Leave</SelectItem>
                                        <SelectItem value="Hospitalization Leave">Hospitalization Leave</SelectItem>
                                        <SelectItem value="National Service (NS) Leave">National Service (NS) Leave</SelectItem>
                                        <SelectItem value="Adoption Leave">Adoption Leave</SelectItem>
                                        <SelectItem value="Non-Statutory Leave (Employer Provided)">Non-Statutory Leave (Employer Provided)</SelectItem>
                                        <SelectItem value="Compassionate / Bereavement Leave">Compassionate / Bereavement Leave</SelectItem>
                                        <SelectItem value="Marriage Leave">Marriage Leave</SelectItem>
                                        <SelectItem value="Study / Exam Leave">Study / Exam Leave</SelectItem>
                                        <SelectItem value="Birthday Leave">Birthday Leave</SelectItem>
                                        <SelectItem value="Mental Health Day">Mental Health Day</SelectItem>
                                        <SelectItem value="Volunteer Leave">Volunteer Leave</SelectItem>
                                        <SelectItem value="Unpaid Leave">Unpaid Leave</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <DialogFooter className="flex-col gap-2 sm:flex-row">
                            <Button
                                variant="outline"
                                className="h-11 rounded-xl"
                                onClick={() => onOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            {needsApprovalActions ? (
                                <Button
                                    className="h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700"
                                    onClick={() => onSave(data, true)}
                                >
                                    Save and approve shift
                                </Button>
                            ) : null}
                            <Button
                                onClick={() => onSave(data, false)}
                                className="h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700"
                            >
                                Update Shift
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <div className="py-8 text-center">
                        <p className="text-slate-500">Loading shift data...</p>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
