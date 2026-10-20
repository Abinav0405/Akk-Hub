import React, { useState, useEffect, useRef, useMemo, useCallback, memo, lazy, Suspense } from 'react';
import { storageKey } from '@/core/storage';
import { supabaseMaterials as supabase } from '@/core/supabase';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Badge } from '@/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import {
    Search, Package, RotateCcw,
    Calendar, Clock, User, FileSpreadsheet, Loader2, Trash2, Printer,
    CheckCircle, XCircle, AlertCircle, Edit2, ChevronDown, ChevronUp, MapPin,
    ClipboardList, Users, BarChart3, UserCog, MoreHorizontal, Inbox
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useHubSection } from '@/app/useHubSection';
import { formatDisplayDate, formatDisplayDateTime, formatFileDate } from '@/modules/materials/lib/dates';
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { sendBrowserNotification, requestBrowserNotificationPermission } from '@/modules/materials/lib/emailNotification';

const AdminAnalytics = lazy(() => import('@/modules/materials/components/AdminAnalytics'));
const RequestersManager = lazy(() => import('@/modules/materials/components/RequestersManager'));
const SitesManager = lazy(() => import('@/modules/materials/components/SitesManager'));
const MaterialsManager = lazy(() => import('@/modules/materials/components/MaterialsManager'));
const ManagersManager = lazy(() => import('@/modules/materials/components/ManagersManager'));

const MATERIALS_ADMIN_SECTIONS = ['transactions', 'materials', 'sites', 'requesters', 'analytics', 'managers'];

const ManagerTabFallback = (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
    </div>
);
import { parseReturnQty, applyReturnToTakeMaterials } from '@/modules/materials/lib/inventory';
import { requireStaffSession } from '@/core/auth/materialsSession';
import { matchesDateFilter, TRANSACTION_QUERY_LIMIT } from '@/modules/materials/lib/dates';
import {
    buildReturnHistoryMap,
    fetchApprovedReturnsOnce,
    printSingleTransaction,
    printBulkTransactions,
} from '@/modules/materials/lib/transactionPrint';
import { printFailureMessage } from '@/modules/materials/lib/printDocument';
import { AppShell, PageHeader, FilterToolbar, EmptyState } from '@/ui/layout';
import NativeBottomNav from '@/modules/materials/components/mobile/NativeBottomNav';
import NativeFilterBar from '@/modules/materials/components/mobile/NativeFilterBar';
import NativeActionSheet from '@/modules/materials/components/mobile/NativeActionSheet';
import NativeTxCard, { staffItemStatus } from '@/modules/materials/components/mobile/NativeTxCard';
import MoreMenu from '@/modules/progress/components/MoreMenu';
import { NavIconButton } from '@/modules/materials/components/mobile/NativeNavBar';
import { NativeEmptyState, NativeErrorState, RouteFallback, SkeletonList } from '@/modules/materials/components/mobile/NativeStates';
import { confirmAction } from '@/modules/materials/components/mobile/NativeConfirm';
import { isNativeApp } from '@/core/platform';
import { setNativeBackInterceptor } from '@/modules/materials/hooks/useAndroidBackButton';
import { useProgressiveList } from '@/modules/materials/hooks/useProgressiveList';
import { getStaffCapabilities } from '@/modules/materials/lib/staffCapabilities';
// Component to display GitHub-style commit history for returns
const ReturnHistoryDisplay = ({ referenceNumber, totalQuantity, materialName, approvedReturns = [] }) => {
    const returnHistory = React.useMemo(() => {
        if (!referenceNumber) return [];
        const history = [];
        for (const transaction of approvedReturns) {
            const materialReturn = transaction.materials?.find(m =>
                m.reference_number === referenceNumber
            );
            const qty = parseReturnQty(materialReturn?.return_quantity);
            if (qty > 0) {
                history.push({
                    returner: transaction.worker_name,
                    quantity: qty,
                    date: transaction.transaction_date,
                    time: transaction.transaction_time,
                    transactionId: transaction.id
                });
            }
        }
        return history;
    }, [approvedReturns, referenceNumber]);

    if (returnHistory.length === 0) {
        return (
            <div className="bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
                <div className="text-yellow-700 font-medium">
                    Taken to Site
                </div>
                <div className="text-yellow-600 text-xs mt-1">
                    Not Returned
                </div>
            </div>
        );
    }

    // Calculate total returned and remaining
    const totalReturned = returnHistory.reduce((sum, entry) => sum + entry.quantity, 0);
    const remaining = totalQuantity - totalReturned;
    const isFullyReturned = remaining <= 0;

    return (
        <div className="space-y-1">
            {/* Individual return entries */}
            {returnHistory.map((entry, index) => (
                <div key={entry.transactionId} className="bg-blue-50 border border-blue-200 rounded px-2 py-1">
                    <div className="text-blue-700 font-medium">
                        🔄 Returned {entry.quantity}/{totalQuantity} {materialName} by {entry.returner}
                    </div>
                    <div className="text-blue-600 text-xs mt-1">
                        on {formatDisplayDate(entry.date)} at {entry.time}
                    </div>
                </div>
            ))}

            {/* Final status */}
            {isFullyReturned ? (
                <div className="bg-green-50 border border-green-200 rounded px-2 py-1">
                    <div className="text-green-700 font-medium">
                        ✅ Fully returned {totalQuantity}/{totalQuantity} {materialName}
                    </div>
                    <div className="text-green-600 text-xs mt-1">
                        All materials returned
                    </div>
                </div>
            ) : (
                <div className="bg-orange-50 border border-orange-200 rounded px-2 py-1">
                    <div className="text-orange-700 font-medium">
                        🔄 Partially returned {totalReturned}/{totalQuantity} {materialName}
                    </div>
                    <div className="text-orange-600 text-xs mt-1">
                        Remaining qty to return: {remaining}/{totalQuantity}
                    </div>
                </div>
            )}
        </div>
    );
};

import MaterialForm from '@/modules/materials/components/MaterialForm';

/** Long lists render in pages so the screen stays smooth. */
const LIST_PAGE = 60;

const NATIVE_TAB_COPY = {
    transactions: { title: 'Requests' },
    materials: { title: 'Stock', subtitle: 'Catalogue, stock levels and restocking' },
    sites: { title: 'Sites', subtitle: 'Where materials are taken to' },
    requesters: { title: 'People', subtitle: 'Workers who can request materials' },
    analytics: { title: 'Analytics', subtitle: 'Trends across all requests' },
    managers: { title: 'Managers', subtitle: 'Staff with manager access' },
};

const TYPE_OPTIONS = [
    { value: 'all', label: 'All types' },
    { value: 'take', label: 'Take' },
    { value: 'return', label: 'Return' },
];
const STATUS_OPTIONS = [
    { value: 'all', label: 'All status' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'declined', label: 'Declined' },
];
const RETURN_OPTIONS = [
    { value: 'all', label: 'All materials' },
    { value: 'returned', label: 'Returned' },
    { value: 'partially_returned', label: 'Partial' },
    { value: 'not_returned', label: 'Not returned' },
];
const DATE_OPTIONS = [
    { value: 'all', label: 'All time' },
    { value: 'week', label: 'This week' },
    { value: 'month', label: 'This month' },
    { value: 'year', label: 'This year' },
];

/**
 * A request in the app's staff inbox. Memoised: React Query keeps unchanged
 * rows referentially stable, so the 3 s poll only re-renders rows that changed.
 */
const StaffRequestCard = memo(function StaffRequestCard({
    transaction,
    expanded,
    approvedReturns,
    isAdmin,
    processing,
    busy,
    onToggle,
    onEdit,
    onProcess,
    onPrint,
    onDelete,
}) {
    const isPending = transaction.approval_status === 'pending';
    const isTake = transaction.transaction_type === 'take';
    const materials = transaction.materials || [];

    return (
        <NativeTxCard
            tx={transaction}
            title={transaction.worker_name}
            titleNote={`ID ${transaction.worker_id}`}
            itemStatus={staffItemStatus}
            expanded={expanded}
            onToggleExpand={isTake && materials.length ? () => onToggle(transaction.id) : undefined}
            expandedContent={materials.map((material, idx) => (
                <div key={idx}>
                    <p className="mb-1.5 font-semibold text-slate-800">
                        {material.name}
                        {material.reference_number ? <span className="n-ref ml-2">#{material.reference_number}</span> : null}
                    </p>
                    {material.reference_number ? (
                        <ReturnHistoryDisplay
                            referenceNumber={material.reference_number}
                            totalQuantity={material.quantity}
                            materialName={material.name}
                            approvedReturns={approvedReturns}
                        />
                    ) : (
                        <div className="bg-gray-50 border border-gray-200 rounded px-2 py-1">
                            <div className="text-gray-700 font-medium">No reference number</div>
                            <div className="text-gray-600 text-xs mt-1">
                                This material cannot be returned (missing reference number)
                            </div>
                        </div>
                    )}
                </div>
            ))}
            actions={
                <>
                    {isPending ? (
                        <>
                            <button
                                type="button"
                                className="n-btn n-btn--sm n-tx__decide"
                                data-tone="success"
                                disabled={processing}
                                onClick={() => onProcess(transaction, 'approved')}
                            >
                                {busy ? <span className="n-spinner" aria-hidden /> : <CheckCircle className="h-4 w-4" aria-hidden />}
                                Approve
                            </button>
                            <button
                                type="button"
                                className="n-btn n-btn--tinted n-btn--sm n-tx__decide"
                                data-tone="danger"
                                disabled={processing}
                                onClick={() => onProcess(transaction, 'declined')}
                            >
                                <XCircle className="h-4 w-4" aria-hidden />
                                Decline
                            </button>
                            <button
                                type="button"
                                className="n-btn n-btn--tinted n-btn--sm"
                                data-tone="info"
                                onClick={() => onEdit(transaction)}
                            >
                                <Edit2 className="h-4 w-4" aria-hidden />
                                Edit
                            </button>
                        </>
                    ) : null}
                    <button
                        type="button"
                        className="n-btn n-btn--tinted n-btn--sm"
                        data-tone="neutral"
                        onClick={() => onPrint(transaction)}
                    >
                        <Printer className="h-4 w-4" aria-hidden />
                        Print
                    </button>
                    {isAdmin ? (
                        <button
                            type="button"
                            className="n-btn n-btn--tinted n-btn--sm"
                            data-tone="danger"
                            aria-label="Delete request"
                            onClick={() => onDelete(transaction)}
                        >
                            <Trash2 className="h-4 w-4" aria-hidden />
                            Delete
                        </button>
                    ) : null}
                </>
            }
        />
    );
});

export default function AdminDashboard({ role = 'admin' }) {
    const navigate = useNavigate();
    const native = isNativeApp();
    const [activeTab, setActiveTab] = useHubSection('transactions', MATERIALS_ADMIN_SECTIONS);
    const [txLimit, setTxLimit] = useState(LIST_PAGE);
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFilter, setDateFilter] = useState('all');
    const [workerIdFilter, setWorkerIdFilter] = useState('');
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [confirmError, setConfirmError] = useState('');
    const [authReady, setAuthReady] = useState(false);
    const [adminSessionEmail, setAdminSessionEmail] = useState('');
    const [staffSession, setStaffSession] = useState(null);
    const [showPrintDialog, setShowPrintDialog] = useState(false);
    const [printStartDate, setPrintStartDate] = useState('');
    const [printEndDate, setPrintEndDate] = useState('');
    const [printWorkerId, setPrintWorkerId] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [materialReturnFilter, setMaterialReturnFilter] = useState('all');
    const [adminStatusId, setAdminStatusId] = useState(null);
    const [editingTransaction, setEditingTransaction] = useState(null);
    const [expandedCards, setExpandedCards] = useState(new Set());
    const [isBulkPrinting, setIsBulkPrinting] = useState(false);
    const [actionsOpen, setActionsOpen] = useState(false);
    
    const queryClient = useQueryClient();
    const adminEmail = adminSessionEmail || sessionStorage.getItem(storageKey('materials', 'adminEmail'));
    const capabilities = getStaffCapabilities(role);
    const isAdmin = capabilities.canDeleteTransactions;

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const session = await requireStaffSession(navigate, role);
            if (cancelled || !session) return;
            setAdminSessionEmail(session.email);
            setStaffSession(session);
            setAuthReady(true);
            requestBrowserNotificationPermission();
        })();
        return () => { cancelled = true; };
    }, [navigate, role]);

    // Track admin online status (per-email row; no broken sendBeacon)
    useEffect(() => {
        if (!adminEmail || !authReady) return;
        let rowId = null;
        let cancelled = false;

        const upsertOnline = async () => {
            try {
                const { data: existingStatus, error: selectError } = await supabase
                    .from('admin_status')
                    .select('*')
                    .eq('admin_email', adminEmail)
                    .limit(1);

                if (selectError) throw selectError;

                if (existingStatus && existingStatus.length > 0) {
                    const { error } = await supabase
                        .from('admin_status')
                        .update({
                            admin_email: adminEmail,
                            last_seen: new Date().toISOString(),
                            is_online: true
                        })
                        .eq('id', existingStatus[0].id);
                    if (error) throw error;
                    rowId = existingStatus[0].id;
                } else {
                    const { data, error } = await supabase
                        .from('admin_status')
                        .insert([{
                            admin_email: adminEmail,
                            last_seen: new Date().toISOString(),
                            is_online: true
                        }])
                        .select()
                        .single();
                    if (error) throw error;
                    rowId = data.id;
                }
                if (!cancelled) setAdminStatusId(rowId);
            } catch (error) {
                console.error('Failed to set online status:', error);
            }
        };

        upsertOnline();

        const heartbeat = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            upsertOnline();
        }, 15000);

        return () => {
            cancelled = true;
            clearInterval(heartbeat);
            const idToClear = rowId || adminStatusId;
            if (idToClear) {
                supabase
                    .from('admin_status')
                    .update({ is_online: false, last_seen: new Date().toISOString() })
                    .eq('id', idToClear);
            }
        };
    }, [adminEmail, authReady]);

    const { data: transactions = [], isLoading, refetch, isFetching, failureCount, errorUpdatedAt, dataUpdatedAt } = useQuery({
        queryKey: ['transactions'],
        enabled: authReady,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('transactions')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(TRANSACTION_QUERY_LIMIT);
            if (error) throw error;
            return data || [];
        },
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
    });

    // App: once a load has failed with nothing to show, keep the error up (with
    // "Retrying…") instead of flickering back to skeletons on every 30 s poll.
    const loadFailed = transactions.length === 0 && (failureCount > 0 || errorUpdatedAt > dataUpdatedAt);

    const approvedReturns = React.useMemo(
        () => (transactions || []).filter(t =>
            t.transaction_type === 'return' && t.approval_status === 'approved'
        ),
        [transactions]
    );

    const prevTransactionsRef = useRef([]);
    
    useEffect(() => {
        const checkNewRequests = async () => {
            if (!isLoading && transactions.length > 0 && prevTransactionsRef.current.length > 0) {
                // Only show notifications for admin users, not workers
                const isAdmin = !!adminEmail;
                if (!isAdmin) return;

                const newRequests = transactions.filter(t =>
                    t.approval_status === 'pending' &&
                    !prevTransactionsRef.current.find(pt => pt.id === t.id)
                );

                if (newRequests.length > 0) {
                    toast.info(`${newRequests.length} new request(s) received`, {
                        description: 'Pending approval',
                    });

                    // Send browser notification for the latest new request
                    const latestRequest = newRequests[0];
                    sendBrowserNotification(latestRequest);
                }
            }

            prevTransactionsRef.current = transactions;
        };

        checkNewRequests();
    }, [transactions, isLoading, adminEmail]);

    const deleteAllMutation = useMutation({
        mutationFn: async () => {
            const { error } = await supabase
                .from('transactions')
                .delete()
                .neq('id', '00000000-0000-0000-0000-000000000000');
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            toast.success('All history deleted successfully');
            setShowDeleteDialog(false);
            setConfirmText('');
        },
        onError: (error) => {
            toast.error(error.message || 'Failed to delete history');
        },
    });

    const approveRequestMutation = useMutation({
        mutationFn: async ({ id, status }) => {
            const { data: transaction, error } = await supabase.rpc('process_transaction', {
                p_transaction_id: id,
                p_status: status,
            });
            if (error) throw error;
            if (transaction?.transaction_type === 'return') {
                await applyReturnToTakeMaterials(transaction, status, staffSession?.name || 'Staff');
            }
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            queryClient.invalidateQueries({ queryKey: ['materials_catalog'] });
            const action = variables.status === 'approved' ? 'approved' : 'declined';
            toast.success(`Request ${action} successfully`);
        },
        onError: (error) => {
            toast.error(error.message || 'Failed to process request');
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async ({ id }) => {
            const { error } = await supabase
                .from('transactions')
                .delete()
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            setEditingTransaction(null);
            toast.success('Transaction deleted successfully');
        },
        onError: (error) => {
            toast.error(error.message || 'Failed to delete transaction');
        },
    });

    const handleDeleteHistory = () => {
        if (confirmText.trim() === 'DELETE') {
            setConfirmError('');
            deleteAllMutation.mutate();
        } else {
            setConfirmError('Type DELETE to confirm');
        }
    };

    const handleEditSuccess = () => {
        setEditingTransaction(null);
    };


    const filteredTransactions = useMemo(() => transactions.filter(t => {
        const matchesFilter = filter === 'all' || t.transaction_type === filter;
        let matchesSearch = false;

        if (searchTerm.startsWith('/')) {
            // Special search syntax: /approver_name to search by who approved the transaction
            const approverName = searchTerm.slice(1).toLowerCase().trim();
            matchesSearch = t.approved_by?.toLowerCase().includes(approverName);
        } else {
            // Regular search: worker name, worker ID, material name, or reference number
            matchesSearch =
                t.worker_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.worker_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.materials?.some(m => m.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                       m.reference_number?.includes(searchTerm));
        }

        const matchesWorkerId = !workerIdFilter || t.worker_id?.toLowerCase().includes(workerIdFilter.toLowerCase());
        const matchesStatus = statusFilter === 'all' || t.approval_status === statusFilter;
        const matchesDate = matchesDateFilter(t.transaction_date, dateFilter);

        let matchesMaterialReturn = true;
        if (materialReturnFilter !== 'all' && t.transaction_type === 'take' && t.materials) {
            if (materialReturnFilter === 'returned') {
                // Show only take transactions where ALL materials are returned
                matchesMaterialReturn = t.materials.every(m => m.returned === true);
            } else if (materialReturnFilter === 'partially_returned') {
                // Show only take transactions where some materials are returned but not all
                matchesMaterialReturn = t.materials.some(m => (m.returned_quantity || 0) > 0) &&
                                       t.materials.some(m => (m.returned_quantity || 0) < m.quantity);
            } else if (materialReturnFilter === 'not_returned') {
                // Show only take transactions where no materials are returned
                matchesMaterialReturn = t.materials.every(m => (m.returned_quantity || 0) === 0);
            }
        } else if (materialReturnFilter !== 'all') {
            // For non-take transactions (like return requests), don't show them in material return filters
            matchesMaterialReturn = false;
        }

        return matchesFilter && matchesSearch && matchesDate && matchesWorkerId && matchesStatus && matchesMaterialReturn;
    }), [transactions, filter, searchTerm, workerIdFilter, statusFilter, dateFilter, materialReturnFilter]);

    const pendingCount = useMemo(
        () => transactions.filter(t => t.approval_status === 'pending').length,
        [transactions]
    );

    const exportToExcel = async () => {
        const data = [];
        filteredTransactions.forEach(t => {
            if (t.materials && t.materials.length > 0) {
                t.materials.forEach(m => {
                    data.push({
                        'Date': formatDisplayDate(t.transaction_date),
                        'Time': t.transaction_time,
                        'Type': t.transaction_type,
                        'Worker Name': t.worker_name,
                        'Worker ID': t.worker_id,
                        'Site': t.site_name || '',
                        'Material': m.name,
                        'Quantity': m.quantity,
                        'Unit': m.unit,
                        'Status': t.approval_status,
                        'Reference Number': m.reference_number || '',
                        'Return Quantity': m.return_quantity ?? '',
                        'Returned Quantity': m.returned_quantity ?? '',
                        'Returned': m.returned ? 'Yes' : 'No',
                        'Notes': t.notes || ''
                    });
                });
            }
        });

        const XLSX = await import('xlsx');
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions');
        
        XLSX.writeFile(workbook, `AKK_Materials_${formatFileDate(new Date())}.xlsx`);
    };

    const printTransaction = async (transaction) => {
        try {
            const approvedReturns = await fetchApprovedReturnsOnce(supabase);
            const returnHistoryMap = buildReturnHistoryMap(approvedReturns);
            printSingleTransaction(transaction, returnHistoryMap);
        } catch (error) {
            console.error('Error printing transaction:', error);
            toast.error(printFailureMessage(error));
        }
    };

    const printBulk = async () => {
        setIsBulkPrinting(true);
        try {
            let transactionsToPrint = filteredTransactions;

            if (printStartDate || printEndDate || printWorkerId) {
                transactionsToPrint = filteredTransactions.filter(t => {
                    let matches = true;
                    if (printStartDate && t.transaction_date < printStartDate) matches = false;
                    if (printEndDate && t.transaction_date > printEndDate) matches = false;
                    if (printWorkerId && t.worker_id !== printWorkerId) matches = false;
                    return matches;
                });
            }

            if (!transactionsToPrint.length) {
                toast.error('No transactions to print');
                return;
            }

            const approvedReturns = await fetchApprovedReturnsOnce(supabase);
            const returnHistoryMap = buildReturnHistoryMap(approvedReturns);

            setShowPrintDialog(false);
            // Let the dialog unmount so the native preview is visible/tappable
            await new Promise((r) => setTimeout(r, 80));
            printBulkTransactions(transactionsToPrint, returnHistoryMap, {
                startDate: printStartDate || '',
                endDate: printEndDate || '',
                workerId: printWorkerId || '',
            });
        } catch (error) {
            console.error('Error during bulk print:', error);
            toast.error(printFailureMessage(error));
        } finally {
            setIsBulkPrinting(false);
        }
    };

    const toggleCardExpansion = (transactionId) => {
        const newExpanded = new Set(expandedCards);
        if (newExpanded.has(transactionId)) {
            newExpanded.delete(transactionId);
        } else {
            newExpanded.add(transactionId);
        }
        setExpandedCards(newExpanded);
    };

    // ── App-only handlers (stable, so memoised cards don't re-render) ──────────
    const { visible: visibleTransactions, hasMore, sentinelRef } = useProgressiveList(filteredTransactions, {
        resetKey: `${filter}|${searchTerm}|${workerIdFilter}|${statusFilter}|${dateFilter}|${materialReturnFilter}`,
    });

    const toggleExpandedNative = useCallback((id) => {
        setExpandedCards((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const processMutate = approveRequestMutation.mutate;
    const processNative = useCallback(async (transaction, status) => {
        const approving = status === 'approved';
        const ok = await confirmAction(approving
            ? {
                title: 'Approve request?',
                message: 'Approve this request? Stock will change if this is a take or return.',
                confirmLabel: 'Approve',
                tone: 'success',
            }
            : {
                title: 'Decline request?',
                message: 'Decline this request?',
                confirmLabel: 'Decline',
                destructive: true,
            });
        if (ok) processMutate({ id: transaction.id, status });
    }, [processMutate]);

    const deleteMutateAsync = deleteMutation.mutateAsync;
    const deleteNative = useCallback(async (transaction) => {
        const ok = await confirmAction({
            title: 'Delete request?',
            message: 'Are you sure you want to delete this request? This action cannot be undone.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!ok) return;
        try {
            await deleteMutateAsync({ id: transaction.id });
        } catch {
            // Error is already handled by the mutation
        }
    }, [deleteMutateAsync]);

    const printNative = useCallback((transaction) => {
        printTransaction(transaction);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // App: hardware back leaves the edit form first; each form opens at the top.
    useEffect(() => {
        if (!native || !editingTransaction) return undefined;
        window.scrollTo(0, 0);
        return setNativeBackInterceptor(() => {
            setEditingTransaction(null);
            return true;
        });
    }, [native, editingTransaction]);

    // Switching section scrolls back to the top, like a native tab bar.
    useEffect(() => {
        if (native) window.scrollTo(0, 0);
    }, [native, activeTab]);

    const getStatusBadge = (status) => {
        switch(status) {
            case 'approved':
                return <Badge variant="success"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
            case 'declined':
                return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Declined</Badge>;
            default:
                return <Badge variant="warning"><AlertCircle className="w-3 h-3 mr-1" />Pending</Badge>;
        }
    };

    if (!authReady) {
        if (native) return <RouteFallback />;
        return (
            <div className="min-h-dvh-safe flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-slate-700" />
            </div>
        );
    }

    return (
        <>
        <AppShell
            header={
                <PageHeader
                    title={native
                        ? (editingTransaction ? 'Edit request' : NATIVE_TAB_COPY[activeTab]?.title)
                        : (NATIVE_TAB_COPY[activeTab]?.title || 'Requests')}
                    description={native
                        ? (editingTransaction
                            ? `${editingTransaction.worker_name} · ${editingTransaction.transaction_type === 'return' ? 'Return' : 'Take'}`
                            : activeTab === 'transactions'
                                ? (loadFailed ? 'Offline — retrying' : isLoading ? 'Loading requests…' : pendingCount > 0 ? `${pendingCount} waiting for approval` : 'All caught up')
                                : NATIVE_TAB_COPY[activeTab]?.subtitle)
                        : undefined}
                    eyebrow={native && !editingTransaction
                        ? `${isAdmin ? 'Admin' : 'Manager'}${staffSession?.name ? ` · ${staffSession.name}` : ''}`
                        : undefined}
                    onBack={editingTransaction ? () => setEditingTransaction(null) : undefined}
                    backLabel={editingTransaction ? 'Requests' : 'Back'}
                    nativeActions={native && !editingTransaction ? (
                        <NavIconButton icon={MoreHorizontal} label="More actions" onClick={() => setActionsOpen(true)} />
                    ) : null}
                    variant="admin"
                    actions={
                        <div className="flex items-center gap-2">
                            {pendingCount > 0 && (
                                <Badge variant="warning">{pendingCount} Pending</Badge>
                            )}
                        </div>
                    }
                />
            }
        >
            <div className="space-y-4">
            <div className="flex flex-col gap-3">
                {!native && (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList data-section-nav className="bg-card border border-border shadow-xs w-full overflow-x-auto sm:w-auto">
                        <TabsTrigger value="transactions" className="data-[state=active]:bg-brand data-[state=active]:text-white"><span className="sm:hidden">Inbox</span><span className="hidden sm:inline">Transactions</span></TabsTrigger>
                        <TabsTrigger value="requesters" className="data-[state=active]:bg-brand data-[state=active]:text-white"><span className="sm:hidden">People</span><span className="hidden sm:inline">Requesters</span></TabsTrigger>
                        {isAdmin && <TabsTrigger value="analytics" className="data-[state=active]:bg-brand data-[state=active]:text-white"><span className="sm:hidden">Stats</span><span className="hidden sm:inline">Analytics</span></TabsTrigger>}
                        <TabsTrigger value="sites" className="data-[state=active]:bg-brand data-[state=active]:text-white">Sites</TabsTrigger>
                        <TabsTrigger value="materials" className="data-[state=active]:bg-brand data-[state=active]:text-white"><span className="sm:hidden">Stock</span><span className="hidden sm:inline">Materials</span></TabsTrigger>
                        {isAdmin && <TabsTrigger value="managers" className="data-[state=active]:bg-brand data-[state=active]:text-white"><span className="sm:hidden">Admins</span><span className="hidden sm:inline">Managers</span></TabsTrigger>}
                    </TabsList>
                </Tabs>
                )}

                {activeTab === 'transactions' && native && !editingTransaction && (
                    <NativeFilterBar
                        search={searchTerm}
                        onSearch={setSearchTerm}
                        placeholder="Name, ID, material or /approver"
                        groups={[
                            { id: 'status', label: 'Status', value: statusFilter, onChange: setStatusFilter, options: STATUS_OPTIONS },
                            { id: 'type', label: 'Type', value: filter, onChange: setFilter, options: TYPE_OPTIONS },
                            { id: 'returns', label: 'Returns', value: materialReturnFilter, onChange: setMaterialReturnFilter, options: RETURN_OPTIONS },
                            { id: 'date', label: 'Date', value: dateFilter, onChange: setDateFilter, options: DATE_OPTIONS },
                        ]}
                        fields={[
                            { id: 'worker', label: 'Worker ID', value: workerIdFilter, onChange: setWorkerIdFilter, placeholder: 'Filter by worker ID' },
                        ]}
                    />
                )}
                {activeTab === 'transactions' && !native && (
                    <FilterToolbar
                        search={
                            <div className="relative w-full">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input
                                    className="pl-10 w-full"
                                    placeholder="Search by name, ID, or material..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        }
                        filters={
                            <>
                                <Tabs value={filter} onValueChange={setFilter}>
                                    <TabsList>
                                        <TabsTrigger value="all">All Types</TabsTrigger>
                                        <TabsTrigger value="take">Take</TabsTrigger>
                                        <TabsTrigger value="return">Return</TabsTrigger>
                                    </TabsList>
                                </Tabs>
                                <Tabs value={statusFilter} onValueChange={setStatusFilter}>
                                    <TabsList>
                                        <TabsTrigger value="all">All Status</TabsTrigger>
                                        <TabsTrigger value="pending">Pending</TabsTrigger>
                                        <TabsTrigger value="approved">Approved</TabsTrigger>
                                        <TabsTrigger value="declined">Declined</TabsTrigger>
                                    </TabsList>
                                </Tabs>
                                <Tabs value={materialReturnFilter} onValueChange={setMaterialReturnFilter}>
                                    <TabsList>
                                        <TabsTrigger value="all">All Materials</TabsTrigger>
                                        <TabsTrigger value="returned">Returned</TabsTrigger>
                                        <TabsTrigger value="partially_returned">Partial</TabsTrigger>
                                        <TabsTrigger value="not_returned">Not Returned</TabsTrigger>
                                    </TabsList>
                                </Tabs>
                                <Tabs value={dateFilter} onValueChange={setDateFilter}>
                                    <TabsList>
                                        <TabsTrigger value="all">All Time</TabsTrigger>
                                        <TabsTrigger value="week">Week</TabsTrigger>
                                        <TabsTrigger value="month">Month</TabsTrigger>
                                        <TabsTrigger value="year">Year</TabsTrigger>
                                    </TabsList>
                                </Tabs>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <Input
                                        placeholder="Filter by Worker ID"
                                        value={workerIdFilter}
                                        onChange={(e) => setWorkerIdFilter(e.target.value)}
                                        className="pl-9 w-full sm:w-44"
                                    />
                                </div>
                            </>
                        }
                        actions={
                            <>
                                <Button onClick={exportToExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                                    Export
                                </Button>
                                <Button variant="secondary" onClick={() => setShowPrintDialog(true)}>
                                    <Printer className="w-4 h-4 mr-2" />
                                    Bulk Print
                                </Button>
                                {isAdmin && (
                                    <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Delete All
                                    </Button>
                                )}
                            </>
                        }
                    />
                )}
            </div>
                <AnimatePresence mode="wait">
                    {activeTab === 'analytics' && isAdmin ? (
                        <Suspense
                            fallback={
                                <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                    Loading analytics…
                                </div>
                            }
                        >
                            <AdminAnalytics transactions={transactions} />
                        </Suspense>
                    ) : activeTab === 'managers' && isAdmin ? (
                        <Suspense fallback={ManagerTabFallback}>
                            <ManagersManager />
                        </Suspense>
                    ) : activeTab === 'materials' ? (
                        <Suspense fallback={ManagerTabFallback}>
                            <MaterialsManager />
                        </Suspense>
                    ) : activeTab === 'sites' ? (
                        <Suspense fallback={ManagerTabFallback}>
                            <SitesManager />
                        </Suspense>
                    ) : activeTab === 'requesters' ? (
                        <Suspense fallback={ManagerTabFallback}>
                            <RequestersManager />
                        </Suspense>
                    ) : editingTransaction ? (
                        <MaterialForm
                            key={editingTransaction.id}
                            type={editingTransaction.transaction_type}
                            editMode={true}
                            existingTransaction={editingTransaction}
                            onBack={() => setEditingTransaction(null)}
                            onSuccess={handleEditSuccess}
                            onDelete={isAdmin ? async () => {
                                const confirmed = await confirmAction({
                                    title: 'Delete request?',
                                    message: 'Are you sure you want to delete this request? This action cannot be undone.',
                                    confirmLabel: 'Delete',
                                    destructive: true,
                                });
                                if (!confirmed) return;
                                try {
                                    await deleteMutation.mutateAsync({ id: editingTransaction.id });
                                } catch (error) {
                                    // Error is already handled by the mutation
                                }
                            } : null}
                        />
                    ) : native ? (
                        loadFailed ? (
                            <NativeErrorState
                                title="Couldn’t load requests"
                                onRetry={() => refetch()}
                                retrying={isFetching}
                            />
                        ) : isLoading ? (
                            <SkeletonList count={4} label="Loading requests" />
                        ) : filteredTransactions.length === 0 ? (
                            <NativeEmptyState
                                icon={Inbox}
                                title={transactions.length ? 'No matching requests' : 'No requests yet'}
                                description={transactions.length
                                    ? 'Try a different search or clear the filters.'
                                    : 'Take and return requests from workers will appear here.'}
                            />
                        ) : (
                            <div>
                                <p className="n-results" aria-live="polite">
                                    {filteredTransactions.length} request{filteredTransactions.length === 1 ? '' : 's'}
                                </p>
                                <div className="n-list">
                                    {visibleTransactions.map((transaction) => (
                                        <StaffRequestCard
                                            key={transaction.id}
                                            transaction={transaction}
                                            expanded={expandedCards.has(transaction.id)}
                                            approvedReturns={approvedReturns}
                                            isAdmin={isAdmin}
                                            processing={approveRequestMutation.isPending}
                                            busy={approveRequestMutation.isPending && approveRequestMutation.variables?.id === transaction.id}
                                            onToggle={toggleExpandedNative}
                                            onEdit={setEditingTransaction}
                                            onProcess={processNative}
                                            onPrint={printNative}
                                            onDelete={deleteNative}
                                        />
                                    ))}
                                </div>
                                {hasMore ? (
                                    <div ref={sentinelRef} className="n-more">
                                        <span className="n-spinner" aria-hidden />
                                    </div>
                                ) : null}
                            </div>
                        )
                    ) : isLoading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 animate-spin text-slate-700" />
                        </div>
                    ) : filteredTransactions.length === 0 ? (
                        <EmptyState title="No Transactions Found" description="Try adjusting filters or search." />
                    ) : (
                        <div className="space-y-4">
                            <AnimatePresence>
                                {filteredTransactions.slice(0, txLimit).map((transaction, index) => (
                                    <motion.div
                                        key={transaction.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: Math.min(index, 20) * 0.03 }}
                                    >
                                        <Card className="overflow-hidden">
                                            <div className={`h-0.5 ${transaction.transaction_type === 'return' ? 'bg-emerald-600' : 'bg-brand'}`} />
                                            <CardContent className="p-4 sm:p-5">
                                                <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => toggleCardExpansion(transaction.id)}
                                                        className="text-slate-500 hover:text-slate-700 p-1 h-10 w-10"
                                                    >
                                                        {expandedCards.has(transaction.id) ? (
                                                            <ChevronUp className="w-4 h-4" />
                                                        ) : (
                                                            <ChevronDown className="w-4 h-4" />
                                                        )}
                                                    </Button>
                                                    <div className="hidden sm:flex flex-wrap gap-2">
                                                        {transaction.approval_status === 'pending' ? (
                                                            <>
                                                                <Button
                                                                    size="sm"
                                                                    onClick={() => setEditingTransaction(transaction)}
                                                                    className="bg-blue-600 hover:bg-blue-700"
                                                                >
                                                                    <Edit2 className="w-4 h-4 mr-1" />
                                                                    Edit
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        if (!window.confirm('Approve this request? Stock will change if this is a take or return.')) return;
                                                                        approveRequestMutation.mutate({ id: transaction.id, status: 'approved' });
                                                                    }}
                                                                    className="bg-green-600 hover:bg-green-700"
                                                                    disabled={approveRequestMutation.isPending}
                                                                >
                                                                    <CheckCircle className="w-4 h-4 mr-1" />
                                                                    Approve
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        if (!window.confirm('Decline this request?')) return;
                                                                        approveRequestMutation.mutate({ id: transaction.id, status: 'declined' });
                                                                    }}
                                                                    className="bg-red-600 hover:bg-red-700"
                                                                    disabled={approveRequestMutation.isPending}
                                                                >
                                                                    <XCircle className="w-4 h-4 mr-1" />
                                                                    Decline
                                                                </Button>
                                                            </>
                                                        ) : (
                                                            <Badge className={transaction.approval_status === 'approved' ? 'bg-green-600' : 'bg-red-600'}>
                                                                {transaction.approval_status === 'approved' ? 'Already Approved' : 'Already Declined'}
                                                            </Badge>
                                                        )}
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => printTransaction(transaction)}
                                                        >
                                                            <Printer className="w-4 h-4 mr-1" />
                                                            Print
                                                        </Button>
                                                        {isAdmin && <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            onClick={async () => {
                                                                if (!window.confirm('Are you sure you want to delete this request? This action cannot be undone.')) return;
                                                                try {
                                                                    await deleteMutation.mutateAsync({ id: transaction.id });
                                                                } catch (error) {
                                                                    // Error is already handled by the mutation
                                                                }
                                                            }}
                                                            disabled={deleteMutation.isPending}
                                                        >
                                                            <Trash2 className="w-4 h-4 mr-1" />
                                                            Delete
                                                        </Button>}
                                                    </div>
                                                    <div className="sm:hidden">
                                                        <MoreMenu
                                                            items={[
                                                                transaction.approval_status === 'pending' && {
                                                                    label: 'Edit',
                                                                    icon: <Edit2 className="h-4 w-4" />,
                                                                    onClick: () => setEditingTransaction(transaction),
                                                                },
                                                                transaction.approval_status === 'pending' && {
                                                                    label: 'Approve',
                                                                    icon: <CheckCircle className="h-4 w-4" />,
                                                                    disabled: approveRequestMutation.isPending,
                                                                    onClick: () => {
                                                                        if (!window.confirm('Approve this request? Stock will change if this is a take or return.')) return;
                                                                        approveRequestMutation.mutate({ id: transaction.id, status: 'approved' });
                                                                    },
                                                                },
                                                                transaction.approval_status === 'pending' && {
                                                                    label: 'Decline',
                                                                    icon: <XCircle className="h-4 w-4" />,
                                                                    danger: true,
                                                                    disabled: approveRequestMutation.isPending,
                                                                    onClick: () => {
                                                                        if (!window.confirm('Decline this request?')) return;
                                                                        approveRequestMutation.mutate({ id: transaction.id, status: 'declined' });
                                                                    },
                                                                },
                                                                {
                                                                    label: 'Print',
                                                                    icon: <Printer className="h-4 w-4" />,
                                                                    onClick: () => printTransaction(transaction),
                                                                },
                                                                isAdmin && {
                                                                    label: 'Delete',
                                                                    icon: <Trash2 className="h-4 w-4" />,
                                                                    danger: true,
                                                                    disabled: deleteMutation.isPending,
                                                                    onClick: async () => {
                                                                        if (!window.confirm('Are you sure you want to delete this request? This action cannot be undone.')) return;
                                                                        try {
                                                                            await deleteMutation.mutateAsync({ id: transaction.id });
                                                                        } catch {
                                                                            /* mutation handles toast */
                                                                        }
                                                                    },
                                                                },
                                                            ]}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                                    <div className="flex items-start gap-4">
                                                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                                                            transaction.transaction_type === 'return'
                                                                ? 'bg-emerald-50'
                                                                : 'bg-brand-muted'
                                                        }`}>
                                                            {transaction.transaction_type === 'return' ? (
                                                                <RotateCcw className="w-5 h-5 text-emerald-600" />
                                                            ) : (
                                                                <Package className="w-5 h-5 text-brand" />
                                                            )}
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <Badge className={transaction.transaction_type === 'return' ? 'bg-emerald-600 text-white' : ''}>
                                                                    {transaction.transaction_type === 'return' ? 'Return' : 'Take'}
                                                                </Badge>
                                                                {getStatusBadge(transaction.approval_status)}
                                                            </div>
                                                            <p className="font-medium text-slate-900">
                                                                {transaction.worker_name}
                                                                <span className="ml-2 text-sm font-normal text-muted-foreground">ID {transaction.worker_id}</span>
                                                            </p>
                                                            <div className="akk-tx-meta">
                                                                <span className="inline-flex items-center gap-1">
                                                                    <Calendar className="w-3.5 h-3.5" />
                                                                    {formatDisplayDate(transaction.transaction_date)}
                                                                </span>
                                                                <span className="inline-flex items-center gap-1">
                                                                    <Clock className="w-3.5 h-3.5" />
                                                                    {transaction.transaction_time}
                                                                </span>
                                                                {transaction.site_name && (
                                                                    <span className="inline-flex items-center gap-1">
                                                                        <MapPin className="w-3.5 h-3.5" />
                                                                        {transaction.site_name}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {transaction.approved_by && transaction.approval_status !== 'pending' && (
                                                                <p className="text-xs text-muted-foreground">
                                                                    {transaction.approval_status === 'approved' ? 'Approved' : 'Declined'} by {transaction.approved_by}
                                                                    {transaction.approval_date && ` on ${formatDisplayDateTime(transaction.approval_date)}`}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>

                                                <div className="rounded-lg border border-border bg-muted/40 p-3">
                                                    {/* Collapsed view - horizontal layout */}
                                                    {!expandedCards.has(transaction.id) && (
                                                        <div className="flex flex-wrap gap-2">
                                                            {transaction.materials?.map((material, idx) => (
                                                                <Badge
                                                                    key={idx}
                                                                    variant="outline"
                                                                    className={`${
                                                                        material.returned
                                                                            ? 'bg-green-50 border-green-200 text-green-800'
                                                                            : transaction.transaction_type === 'take'
                                                                            ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
                                                                            : 'bg-slate-50 border-slate-200'
                                                                    }`}
                                                                >
                                                                    {material.name}
                                                                    <span className="ml-1 text-slate-500">
                                                                        {transaction.transaction_type === 'return' && material.return_quantity
                                                                            ? `(${material.return_quantity}/${material.quantity} ${material.unit})`
                                                                            : `(${material.quantity} ${material.unit})`
                                                                        }
                                                                    </span>
                                                                    {material.reference_number && (
                                                                        <span className="ml-2 font-mono text-xs">
                                                                            #{material.reference_number}
                                                                        </span>
                                                                    )}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Expanded view - vertical layout with status history */}
                                                    {expandedCards.has(transaction.id) && (
                                                        <div className="space-y-3">
                                                            {transaction.materials?.map((material, idx) => (
                                                                <div key={idx} className="border border-border rounded-lg p-3 bg-card">
                                                                    <div className="flex items-center gap-2 mb-2">
                                                                        <Badge
                                                                            variant="outline"
                                                                            className={`${
                                                                                material.returned
                                                                                    ? 'bg-green-50 border-green-200 text-green-800'
                                                                                    : transaction.transaction_type === 'take'
                                                                                    ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
                                                                                    : 'bg-slate-50 border-slate-200'
                                                                            }`}
                                                                        >
                                                                            {material.name}
                                                                            <span className="ml-1 text-slate-500">
                                                                                {transaction.transaction_type === 'return' && material.return_quantity
                                                                                    ? `(${material.return_quantity}/${material.quantity} ${material.unit})`
                                                                                    : `(${material.quantity} ${material.unit})`
                                                                                }
                                                                            </span>
                                                                            {material.reference_number && (
                                                                                <span className="ml-2 font-mono text-xs">
                                                                                    #{material.reference_number}
                                                                                </span>
                                                                            )}
                                                                        </Badge>
                                                                    </div>

                                                                {transaction.transaction_type === 'take' && material.reference_number && (
                                                                    <ReturnHistoryDisplay
                                                                        referenceNumber={material.reference_number}
                                                                        totalQuantity={material.quantity}
                                                                        materialName={material.name}
                                                                        approvedReturns={approvedReturns}
                                                                    />
                                                                )}

                                                                {!material.reference_number && (
                                                                    <div className="bg-gray-50 border border-gray-200 rounded px-2 py-1 ml-2">
                                                                        <div className="text-gray-700 font-medium">
                                                                            📦 {material.name} - No reference number
                                                                        </div>
                                                                        <div className="text-gray-600 text-xs mt-1">
                                                                            This material cannot be returned (missing reference number)
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {transaction.notes && (
                                                        <p className="text-sm text-slate-500 mt-2 italic">
                                                            "{transaction.notes}"
                                                        </p>
                                                    )}
                                                </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                            {filteredTransactions.length > txLimit ? (
                                <button type="button" className="g-btn g-btn--secondary g-btn--block" onClick={() => setTxLimit((n) => n + LIST_PAGE)}>
                                    Show more ({filteredTransactions.length - txLimit} more)
                                </button>
                            ) : null}
                        </div>
                    )}
                </AnimatePresence>
            </div>

            {/* Bulk Print Dialog */}
            <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Bulk Print Transactions</DialogTitle>
                        <DialogDescription>
                            Select date range and worker ID to print multiple transactions.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Start Date</label>
                            <Input
                                type="date"
                                value={printStartDate}
                                onChange={(e) => setPrintStartDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">End Date</label>
                            <Input
                                type="date"
                                value={printEndDate}
                                onChange={(e) => setPrintEndDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Worker ID (Optional - leave empty for all)</label>
                            <Input
                                placeholder="Enter Worker ID or leave empty"
                                value={printWorkerId}
                                onChange={(e) => setPrintWorkerId(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button 
                            variant="outline" 
                            onClick={() => {
                                setShowPrintDialog(false);
                                setPrintStartDate('');
                                setPrintEndDate('');
                                setPrintWorkerId('');
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={printBulk}
                            disabled={isBulkPrinting}
                            className="bg-slate-700 hover:bg-slate-800"
                        >
                            {isBulkPrinting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Printer className="w-4 h-4 mr-2" />
                                    Print
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            {isAdmin && <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete All History</DialogTitle>
                        <DialogDescription>
                            This action cannot be undone. Type DELETE to confirm deletion of all transaction history.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Input
                            type="text"
                            placeholder="Type DELETE"
                            value={confirmText}
                            onChange={(e) => {
                                setConfirmText(e.target.value);
                                setConfirmError('');
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && handleDeleteHistory()}
                        />
                        {confirmError && (
                            <p className="text-sm text-red-600">{confirmError}</p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button 
                            variant="outline" 
                            onClick={() => {
                                setShowDeleteDialog(false);
                                setConfirmText('');
                                setConfirmError('');
                            }}
                        >
                            Cancel
                        </Button>
                        <Button 
                            variant="destructive" 
                            onClick={handleDeleteHistory}
                            disabled={deleteAllMutation.isPending}
                        >
                            {deleteAllMutation.isPending ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                'Delete All'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>}
        </AppShell>
        {native && (
            <NativeActionSheet
                open={actionsOpen}
                onOpenChange={setActionsOpen}
                title={`${isAdmin ? 'Admin' : 'Manager'} actions`}
                description={staffSession?.email ? `Signed in as ${staffSession.email}` : undefined}
                actions={[
                    activeTab === 'transactions' && {
                        id: 'export',
                        icon: FileSpreadsheet,
                        tone: 'success',
                        label: 'Export to Excel',
                        hint: `${filteredTransactions.length} request${filteredTransactions.length === 1 ? '' : 's'} with current filters`,
                        onSelect: exportToExcel,
                    },
                    activeTab === 'transactions' && {
                        id: 'print',
                        icon: Printer,
                        tone: 'slate',
                        label: 'Bulk print',
                        hint: 'Choose a date range or worker',
                        onSelect: () => setShowPrintDialog(true),
                    },
                    activeTab === 'transactions' && isAdmin && {
                        id: 'delete-all',
                        icon: Trash2,
                        label: 'Delete all history',
                        hint: 'Permanently removes every request',
                        destructive: true,
                        onSelect: () => setShowDeleteDialog(true),
                    }
                ]}
            />
        )}
        {!editingTransaction && native ? (
            <NativeBottomNav
                items={[
                    { id: 'transactions', icon: ClipboardList, label: 'Inbox', badge: pendingCount > 0 ? (pendingCount > 99 ? '99+' : pendingCount) : undefined, active: activeTab === 'transactions', onClick: () => setActiveTab('transactions') },
                    { id: 'materials', icon: Package, label: 'Stock', active: activeTab === 'materials', onClick: () => setActiveTab('materials') },
                    { id: 'sites', icon: MapPin, label: 'Sites', active: activeTab === 'sites', onClick: () => setActiveTab('sites') },
                    { id: 'requesters', icon: Users, label: 'People', active: activeTab === 'requesters', onClick: () => setActiveTab('requesters') },
                    ...(isAdmin ? [
                        { id: 'analytics', icon: BarChart3, label: 'Stats', active: activeTab === 'analytics', onClick: () => setActiveTab('analytics') },
                        { id: 'managers', icon: UserCog, label: 'Managers', active: activeTab === 'managers', onClick: () => setActiveTab('managers') },
                    ] : []),
                ]}
            />
        ) : null}
        </>
    );
}
