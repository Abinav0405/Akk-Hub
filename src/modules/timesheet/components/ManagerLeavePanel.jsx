import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/ui/select';
import {
    Calendar,
    CheckCircle,
    XCircle,
    Edit2,
    Loader2,
    Paperclip,
} from 'lucide-react';
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { toast } from 'sonner';
import { formatDate } from '@/modules/timesheet/lib/timeUtils';
import { confirmAction } from '@/ui/native/NativeConfirm';
import {
    countRequestedLeaveDays,
    evaluateLeaveConflicts,
    fetchWorkerDirectoryMap,
    getLeaveAttachmentSignedUrl,
    getLeaveStatusLabel,
    normalizeLeaveType,
    updateLeaveRequestFields,
} from '@/modules/timesheet/lib/leaveService';
import { workerIsNotInCompany } from '@/modules/timesheet/lib/workerEmploymentPay';
import { glassPanel } from '@/ui/PortalShell';
import { cn } from '@/modules/timesheet/lib/utils';

function promptRejectReason() {
    const reason = prompt('Reason for rejection (required):');
    if (reason === null) return null;
    const trimmed = String(reason).trim();
    if (!trimmed) {
        toast.error('A rejection reason is required');
        return null;
    }
    return trimmed;
}

export default function ManagerLeavePanel({ managerName }) {
    const queryClient = useQueryClient();
    const [selectedIds, setSelectedIds] = useState([]);
    const [editingLeave, setEditingLeave] = useState(null);
    const [leaveEditData, setLeaveEditData] = useState({
        leave_type: '',
        leave_duration: 'full_day',
        from_date: '',
        to_date: '',
    });
    const [editSoftWarnings, setEditSoftWarnings] = useState([]);
    const [editHardWarnings, setEditHardWarnings] = useState([]);

    const { data: pendingLeaves = [], isLoading } = useQuery({
        queryKey: ['managerPendingLeaves'],
        queryFn: async () => {
            const { data: localWorkers } = await supabase
                .from('local_worker_details')
                .select('employee_id');
            const localIds = new Set((localWorkers || []).map((w) => w.employee_id));

            const { data, error } = await supabase
                .from('leave_requests')
                .select('*')
                .eq('status', 'pending_manager')
                .order('created_at', { ascending: false });

            if (error) throw error;
            const foreignOnly = (data || []).filter((r) => !localIds.has(r.employee_id));

            const directoryMap = await fetchWorkerDirectoryMap(
                supabase,
                foreignOnly.map((r) => r.employee_id),
                'employee_id, employee_name, in_company'
            );

            return foreignOnly
                .map((r) => ({
                    ...r,
                    employee_name: directoryMap.get(r.employee_id)?.employee_name || 'Unknown',
                    in_company: directoryMap.get(r.employee_id)?.in_company,
                }))
                .filter((r) => !workerIsNotInCompany(r));
        },
        refetchInterval: 30000,
    });

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['managerPendingLeaves'] });
        queryClient.invalidateQueries({ queryKey: ['leaveRequests'] });
        queryClient.invalidateQueries({ queryKey: ['allLeaveRequests'] });
        setSelectedIds([]);
    };

    const toggleSelected = (id) => {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === pendingLeaves.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(pendingLeaves.map((r) => r.id));
        }
    };

    const managerApprove = useMutation({
        mutationFn: async (leaveIds) => {
            const ids = Array.isArray(leaveIds) ? leaveIds : [leaveIds];
            const results = [];
            for (const id of ids) {
                const { error } = await supabase
                    .from('leave_requests')
                    .update({
                        status: 'pending_admin',
                        manager_name: managerName,
                        manager_approved_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', id);
                if (error) results.push({ id, ok: false, error: error.message });
                else results.push({ id, ok: true });
            }
            return results;
        },
        onSuccess: (results) => {
            const ok = results.filter((r) => r.ok).length;
            const fail = results.length - ok;
            if (fail) toast.error(`${ok} forwarded, ${fail} failed`);
            else toast.success(ok === 1 ? 'Forwarded to admin for final approval' : `${ok} requests forwarded to admin`);
            invalidate();
        },
        onError: (e) => toast.error(e.message || 'Failed to approve'),
    });

    const managerReject = useMutation({
        mutationFn: async ({ leaveIds, reason }) => {
            const ids = Array.isArray(leaveIds) ? leaveIds : [leaveIds];
            const results = [];
            for (const id of ids) {
                const { error } = await supabase
                    .from('leave_requests')
                    .update({
                        status: 'rejected',
                        rejection_reason: reason,
                        admin_notes: reason,
                        manager_name: managerName,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', id);
                if (error) results.push({ id, ok: false, error: error.message });
                else results.push({ id, ok: true });
            }
            return results;
        },
        onSuccess: (results) => {
            const ok = results.filter((r) => r.ok).length;
            toast.success(ok === 1 ? 'Leave rejected' : `${ok} requests rejected`);
            invalidate();
        },
        onError: (e) => toast.error(e.message || 'Failed to reject'),
    });

    const saveEdit = useMutation({
        mutationFn: async () => {
            if (!editingLeave) return;
            const conflicts = await evaluateLeaveConflicts({
                supabase,
                employeeId: editingLeave.employee_id,
                fromDate: leaveEditData.from_date,
                toDate: leaveEditData.to_date,
                leaveType: leaveEditData.leave_type,
                leaveDuration: leaveEditData.leave_duration,
                siteId: editingLeave.site_id || null,
                attachmentPath: editingLeave.attachment_path || null,
                excludingLeaveId: editingLeave.id,
            });
            setEditHardWarnings(conflicts.hard || []);
            setEditSoftWarnings(conflicts.soft || []);
            if (conflicts.hard?.length) {
                throw new Error(conflicts.hard[0]);
            }
            if (conflicts.soft?.length) {
                const proceed = await confirmAction({
                    title: 'Save with warnings?',
                    message: `Warnings:\n• ${conflicts.soft.join('\n• ')}\n\nSave changes anyway?`,
                    confirmLabel: 'Save anyway',
                });
                if (!proceed) throw new Error('Save cancelled');
            }
            await updateLeaveRequestFields(supabase, {
                leaveId: editingLeave.id,
                leaveEditData,
                editorName: managerName,
                previousLeave: editingLeave,
            });
        },
        onSuccess: () => {
            toast.success('Leave updated');
            setEditingLeave(null);
            setEditSoftWarnings([]);
            setEditHardWarnings([]);
            invalidate();
        },
        onError: (e) => {
            if (e?.message === 'Save cancelled') return;
            toast.error(e.message || 'Failed to update leave');
        },
    });

    const openAttachment = async (path) => {
        const url = await getLeaveAttachmentSignedUrl(supabase, path);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        else toast.error('Could not open attachment');
    };

    const handleBulkForward = () => {
        if (!selectedIds.length) {
            toast.error('Select at least one leave request');
            return;
        }
        managerApprove.mutate(selectedIds);
    };

    const handleBulkReject = () => {
        if (!selectedIds.length) {
            toast.error('Select at least one leave request');
            return;
        }
        const reason = promptRejectReason();
        if (!reason) return;
        managerReject.mutate({ leaveIds: selectedIds, reason });
    };

    return (
        <>
            <Card className={cn(glassPanel, 'mb-0')} data-tour="manager-leaves">
                <CardContent className="p-4 sm:p-5">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                            <Calendar className="h-5 w-5 text-emerald-600" />
                            Leave approvals
                            {pendingLeaves.length > 0 && (
                                <Badge variant="secondary" className="ml-1">
                                    {pendingLeaves.length} pending
                                </Badge>
                            )}
                        </h2>
                        {pendingLeaves.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                                <label className="flex items-center gap-2 text-xs text-slate-600">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-slate-300"
                                        checked={selectedIds.length === pendingLeaves.length && pendingLeaves.length > 0}
                                        onChange={toggleSelectAll}
                                    />
                                    Select all
                                </label>
                                <Button
                                    size="sm"
                                    className="bg-emerald-600 hover:bg-emerald-700"
                                    disabled={!selectedIds.length || managerApprove.isPending}
                                    onClick={handleBulkForward}
                                >
                                    <CheckCircle className="mr-1 h-3.5 w-3.5" />
                                    Forward selected ({selectedIds.length})
                                </Button>
                                <Button
                                    size="sm"
                                    variant="destructive"
                                    disabled={!selectedIds.length || managerReject.isPending}
                                    onClick={handleBulkReject}
                                >
                                    <XCircle className="mr-1 h-3.5 w-3.5" />
                                    Reject selected
                                </Button>
                            </div>
                        )}
                    </div>

                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                        </div>
                    ) : pendingLeaves.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-8 text-center text-sm text-slate-500">
                            No leave requests awaiting manager approval.
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            {pendingLeaves.map((request) => {
                                const days = countRequestedLeaveDays(request);
                                const checked = selectedIds.includes(request.id);
                                return (
                                    <Card key={request.id} className="rounded-2xl border border-slate-200/80 bg-white/90">
                                        <CardContent className="space-y-3 p-4">
                                            <div className="flex flex-col gap-2">
                                                <div className="flex min-w-0 items-start gap-2">
                                                    <input
                                                        type="checkbox"
                                                        className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
                                                        checked={checked}
                                                        onChange={() => toggleSelected(request.id)}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="break-words font-semibold text-slate-900">{request.employee_name}</p>
                                                        <p className="text-xs text-slate-500">ID {request.employee_id}</p>
                                                    </div>
                                                </div>
                                                <Badge className="w-fit bg-amber-100 text-amber-900">
                                                    {getLeaveStatusLabel(request.status)}
                                                </Badge>
                                            </div>
                                            <div className="text-sm text-slate-700">
                                                <p><strong>{normalizeLeaveType(request.leave_type)}</strong> · {days} day(s)</p>
                                                <p className="text-xs text-slate-500">
                                                    {formatDate(request.from_date)} → {formatDate(request.to_date)}
                                                </p>
                                                {request.reason && (
                                                    <p className="mt-1 text-xs text-slate-600">{request.reason}</p>
                                                )}
                                                {request.edited_by && (
                                                    <p className="mt-1 text-xs italic text-slate-500">
                                                        Edited by {request.edited_by}
                                                        {request.edited_at ? ` · ${formatDate(request.edited_at)}` : ''}
                                                        {request.amend_count > 0 ? ` · amended ${request.amend_count}×` : ''}
                                                    </p>
                                                )}
                                            </div>
                                            {request.attachment_path && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-8 text-xs"
                                                    onClick={() => openAttachment(request.attachment_path)}
                                                >
                                                    <Paperclip className="mr-1 h-3 w-3" />
                                                    View attachment
                                                </Button>
                                            )}
                                            <div className="flex flex-wrap gap-2 pt-1">
                                                <Button
                                                    size="sm"
                                                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                                                    disabled={managerApprove.isPending}
                                                    onClick={() => managerApprove.mutate([request.id])}
                                                >
                                                    <CheckCircle className="mr-1 h-3.5 w-3.5" />
                                                    Forward to admin
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    className="flex-1"
                                                    disabled={managerReject.isPending}
                                                    onClick={() => {
                                                        const reason = promptRejectReason();
                                                        if (!reason) return;
                                                        managerReject.mutate({ leaveIds: [request.id], reason });
                                                    }}
                                                >
                                                    <XCircle className="mr-1 h-3.5 w-3.5" />
                                                    Reject
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => {
                                                        setEditingLeave(request);
                                                        setLeaveEditData({
                                                            leave_type: normalizeLeaveType(request.leave_type),
                                                            leave_duration: request.leave_duration,
                                                            from_date: request.from_date,
                                                            to_date: request.to_date,
                                                        });
                                                        setEditSoftWarnings([]);
                                                        setEditHardWarnings([]);
                                                    }}
                                                >
                                                    <Edit2 className="mr-1 h-3.5 w-3.5" />
                                                    Edit
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog
                open={!!editingLeave}
                onOpenChange={(open) => {
                    if (!open) {
                        setEditingLeave(null);
                        setEditSoftWarnings([]);
                        setEditHardWarnings([]);
                    }
                }}
            >
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit leave (manager)</DialogTitle>
                        <DialogDescription>
                            Adjust dates or type before forwarding to admin. Save changes clearly before approving.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Leave type</label>
                            <Select
                                value={leaveEditData.leave_type}
                                onValueChange={(v) => setLeaveEditData((p) => ({ ...p, leave_type: v }))}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Annual Leave">Annual Leave</SelectItem>
                                    <SelectItem value="Medical Leave">Medical Leave</SelectItem>
                                    <SelectItem value="Hospitalization Leave">Hospitalization Leave</SelectItem>
                                    <SelectItem value="Unpaid Leave">Unpaid Leave</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Duration</label>
                            <Select
                                value={leaveEditData.leave_duration}
                                onValueChange={(v) => setLeaveEditData((p) => ({ ...p, leave_duration: v }))}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="full_day">Full day</SelectItem>
                                    <SelectItem value="half_day_morning">Half day (morning)</SelectItem>
                                    <SelectItem value="half_day_afternoon">Half day (afternoon)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className="text-sm font-medium">From</label>
                                <Input
                                    type="date"
                                    value={leaveEditData.from_date}
                                    onChange={(e) => setLeaveEditData((p) => ({ ...p, from_date: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium">To</label>
                                <Input
                                    type="date"
                                    value={leaveEditData.to_date}
                                    onChange={(e) => setLeaveEditData((p) => ({ ...p, to_date: e.target.value }))}
                                />
                            </div>
                        </div>
                        {editHardWarnings.length > 0 && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                                {editHardWarnings.map((w) => <p key={w}>{w}</p>)}
                            </div>
                        )}
                        {editSoftWarnings.length > 0 && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                {editSoftWarnings.map((w) => <p key={w}>{w}</p>)}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingLeave(null)}>Cancel</Button>
                        <Button
                            onClick={() => saveEdit.mutate()}
                            disabled={saveEdit.isPending}
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {saveEdit.isPending ? 'Saving…' : 'Save changes'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
