import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { withoutLocalWorkers } from '@/core/localWorkers';
import { storageKey } from '@/core/storage';
import { UNIFIED, supabaseMaterials as supabase } from '@/core/supabase';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
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
    Package, FileSpreadsheet, Loader2, Trash2, Printer, Clock3,
    MapPin, ClipboardList, Users, BarChart3, UserCog, MoreHorizontal, ShieldCheck
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useHubSection } from '@/app/useHubSection';
import { formatDisplayDate, formatFileDate } from '@/modules/materials/lib/dates';
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { sendBrowserNotification, requestBrowserNotificationPermission } from '@/modules/materials/lib/emailNotification';

const AdminAnalytics = lazy(() => import('@/modules/materials/components/AdminAnalytics'));
const RequestersManager = lazy(() => import('@/modules/materials/components/RequestersManager'));
const SitesManager = lazy(() => import('@/modules/materials/components/SitesManager'));
const MaterialsManager = lazy(() => import('@/modules/materials/components/MaterialsManager'));
const ManagersManager = lazy(() => import('@/modules/materials/components/ManagersManager'));
const AdminsManager = lazy(() => import('@/features/managers/AdminsManager'));

const MATERIALS_ADMIN_SECTIONS = UNIFIED
    ? ['transactions', 'materials', 'analytics', 'managers', 'admins']
    : ['transactions', 'materials', 'sites', 'requesters', 'analytics', 'managers'];

const ManagerTabFallback = (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
    </div>
);
import { applyReturnToTakeMaterials } from '@/modules/materials/lib/inventory';
import { requireStaffSession } from '@/core/auth/materialsSession';
import { TRANSACTION_QUERY_LIMIT } from '@/modules/materials/lib/dates';
import {
    buildReturnHistoryMap,
    fetchApprovedReturnsOnce,
    printSingleTransaction,
    printBulkTransactions,
} from '@/modules/materials/lib/transactionPrint';
import { printFailureMessage } from '@/modules/materials/lib/printDocument';
import { AppShell, PageHeader } from '@/ui/layout';
import NativeBottomNav from '@/modules/materials/components/mobile/NativeBottomNav';
import NativeActionSheet from '@/modules/materials/components/mobile/NativeActionSheet';
import { NavIconButton } from '@/modules/materials/components/mobile/NativeNavBar';
import { RouteFallback } from '@/modules/materials/components/mobile/NativeStates';
import { confirmAction } from '@/ui/native/NativeConfirm';
import { isNativeApp } from '@/core/platform';
import { registerNativeBackHandler } from '@/core/nativeShell';
import { getStaffCapabilities } from '@/modules/materials/lib/staffCapabilities';
import RequestsWeb from '@/modules/materials/components/requests/RequestsWeb';
import RequestsNative, { RequestDetailScreen } from '@/modules/materials/components/requests/RequestsNative';
import {
    DEFAULT_FILTERS, computeMetrics, filterRequests, siteOptions,
} from '@/modules/materials/components/requests/requestModel';
import MaterialForm from '@/modules/materials/components/MaterialForm';
import IssueByCard from '@/features/cards/IssueByCard';

const NATIVE_TAB_COPY = {
    transactions: { title: 'Requests' },
    materials: { title: 'Stock', subtitle: 'Catalogue, stock levels and restocking' },
    sites: { title: 'Sites', subtitle: 'Where materials are taken to' },
    requesters: { title: 'People', subtitle: 'Workers who can request materials' },
    analytics: { title: 'Analytics', subtitle: 'Trends across all requests' },
    managers: { title: 'Managers', subtitle: 'Staff with manager access' },
    admins: { title: 'Admins', subtitle: 'Full control of every area' },
};

const FILTERS_KEY = storageKey('materials', 'requestFilters');

/** Filters survive leaving and returning to the screen (per tab session). */
function loadSavedFilters() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(FILTERS_KEY) || 'null');
        if (saved && typeof saved === 'object') {
            const merged = { ...DEFAULT_FILTERS };
            for (const key of Object.keys(DEFAULT_FILTERS)) {
                if (typeof saved[key] === 'string') merged[key] = saved[key];
            }
            return merged;
        }
    } catch {
        /* storage unavailable */
    }
    return { ...DEFAULT_FILTERS };
}

export default function AdminDashboard({ role = 'admin' }) {
    const navigate = useNavigate();
    const native = isNativeApp();
    const [activeTab, setActiveTab] = useHubSection('transactions', MATERIALS_ADMIN_SECTIONS);
    const [filters, setFiltersState] = useState(loadSavedFilters);
    const [page, setPage] = useState(1);
    const [detailId, setDetailId] = useState(null);
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
    const [adminStatusId, setAdminStatusId] = useState(null);
    const [editingTransaction, setEditingTransaction] = useState(null);
    const [isBulkPrinting, setIsBulkPrinting] = useState(false);
    const [actionsOpen, setActionsOpen] = useState(false);
    
    const queryClient = useQueryClient();
    const adminEmail = adminSessionEmail || sessionStorage.getItem(storageKey('materials', 'adminEmail'));
    const capabilities = getStaffCapabilities(role);
    const isAdmin = capabilities.canDeleteTransactions;
    const requestCaps = useMemo(() => ({
        canProcess: capabilities.canProcessTransactions,
        canDelete: capabilities.canDeleteTransactions,
    }), [capabilities.canProcessTransactions, capabilities.canDeleteTransactions]);

    // Any filter change starts again from page 1.
    const setFilters = useCallback((update) => {
        setFiltersState(update);
        setPage(1);
    }, []);

    useEffect(() => {
        try {
            sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
        } catch {
            /* storage unavailable */
        }
    }, [filters]);

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
            return withoutLocalWorkers(data || [], (t) => t.worker_id);
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


    const filteredTransactions = useMemo(() => filterRequests(transactions, filters), [transactions, filters]);
    const requestMetrics = useMemo(() => computeMetrics(transactions, filters), [transactions, filters]);
    const requestSites = useMemo(() => siteOptions(transactions), [transactions]);

    const pendingCount = useMemo(
        () => transactions.filter(t => t.approval_status === 'pending').length,
        [transactions]
    );

    const exportToExcel = async (rows = filteredTransactions) => {
        if (!rows.length) {
            toast.error('No requests to export');
            return;
        }
        const data = [];
        rows.forEach(t => {
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

    const printSelected = async (rows) => {
        if (!rows.length) return;
        try {
            const approvedReturns = await fetchApprovedReturnsOnce(supabase);
            printBulkTransactions(rows, buildReturnHistoryMap(approvedReturns), {
                filterNote: `${rows.length} selected request${rows.length === 1 ? '' : 's'}`,
            });
        } catch (error) {
            console.error('Error printing selected requests:', error);
            toast.error(printFailureMessage(error));
        }
    };

    // ── Request actions (web + app; stable so memoised cards don't re-render) ──
    const processMutate = approveRequestMutation.mutate;
    const processRequest = useCallback(async (transaction, status) => {
        const approving = status === 'approved';
        const who = `${transaction.worker_name || 'this worker'}${transaction.worker_id ? ` (ID ${transaction.worker_id})` : ''}`;
        const kind = transaction.transaction_type === 'return' ? 'return' : 'take';
        const count = (transaction.materials || []).length;
        const ok = await confirmAction(approving
            ? {
                title: 'Approve request?',
                message: `Approve the ${kind} request from ${who}? Stock will change for ${count} material${count === 1 ? '' : 's'}.`,
                confirmLabel: 'Approve',
            }
            : {
                title: 'Decline request?',
                message: `Decline the ${kind} request from ${who}? No stock will change.`,
                confirmLabel: 'Decline',
                destructive: true,
            });
        if (ok) processMutate({ id: transaction.id, status });
    }, [processMutate]);
    const approveRequest = useCallback((t) => processRequest(t, 'approved'), [processRequest]);
    const declineRequest = useCallback((t) => processRequest(t, 'declined'), [processRequest]);

    const deleteMutateAsync = deleteMutation.mutateAsync;
    const deleteRequest = useCallback(async (transaction) => {
        const ok = await confirmAction({
            title: 'Delete request?',
            message: 'Are you sure you want to delete this request? This action cannot be undone.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!ok) return;
        try {
            await deleteMutateAsync({ id: transaction.id });
            setDetailId((id) => (id === transaction.id ? null : id));
        } catch {
            // Error is already handled by the mutation
        }
    }, [deleteMutateAsync]);

    const printRequest = useCallback((transaction) => {
        printTransaction(transaction);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // App: details screen. The row is looked up live so approvals and polls update it.
    const detailTx = useMemo(
        () => (detailId ? transactions.find((t) => t.id === detailId) || null : null),
        [detailId, transactions]
    );
    const listScrollRef = useRef(0);
    const openDetail = useCallback((id) => {
        listScrollRef.current = window.scrollY;
        setDetailId(id);
        window.scrollTo(0, 0);
    }, []);
    const closeDetail = useCallback(() => {
        setDetailId(null);
        requestAnimationFrame(() => window.scrollTo(0, listScrollRef.current));
    }, []);
    // A deleted / vanished row closes its details screen.
    useEffect(() => {
        if (detailId && !isLoading && !detailTx) setDetailId(null);
    }, [detailId, detailTx, isLoading]);

    useEffect(() => {
        if (!native || !detailId) return undefined;
        return registerNativeBackHandler(() => {
            closeDetail();
            return true;
        });
    }, [native, detailId, closeDetail]);

    // App: hardware back leaves the edit form first; each form opens at the top.
    useEffect(() => {
        if (!native || !editingTransaction) return undefined;
        window.scrollTo(0, 0);
        return registerNativeBackHandler(() => {
            setEditingTransaction(null);
            return true;
        });
    }, [native, editingTransaction]);

    // Switching section scrolls back to the top, like a native tab bar.
    useEffect(() => {
        if (native) window.scrollTo(0, 0);
        setDetailId(null);
    }, [native, activeTab]);

    const onRequestsTab = activeTab === 'transactions' && !editingTransaction;
    const showDetail = native && onRequestsTab && Boolean(detailTx);

    if (!authReady) {
        if (native) return <RouteFallback />;
        return (
            <div className="min-h-dvh-safe flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-slate-700" />
            </div>
        );
    }

    const requestsTitle = 'Material Requests';
    const nativeTitle = editingTransaction
        ? 'Edit request'
        : showDetail
            ? 'Request'
            : activeTab === 'transactions' ? requestsTitle : NATIVE_TAB_COPY[activeTab]?.title;
    const nativeSubtitle = editingTransaction
        ? `${editingTransaction.worker_name} · ${editingTransaction.transaction_type === 'return' ? 'Return' : 'Take'}`
        : showDetail
            ? `${detailTx.worker_name || 'Worker'} · ${detailTx.transaction_type === 'return' ? 'Return' : 'Take'}`
            : activeTab === 'transactions'
                ? (loadFailed ? 'Offline — retrying' : isLoading ? 'Loading requests…' : pendingCount > 0 ? `${pendingCount} waiting for approval` : 'All caught up')
                : NATIVE_TAB_COPY[activeTab]?.subtitle;
    const pendingIndicator = pendingCount > 0 ? (
        <button
            type="button"
            className="rq-pending-pill"
            onClick={() => {
                setActiveTab('transactions');
                setFilters((f) => ({ ...f, type: 'all', status: 'pending', returns: 'all' }));
            }}
            aria-label={`${pendingCount} pending request${pendingCount === 1 ? '' : 's'} — show them`}
        >
            <Clock3 aria-hidden className="h-3.5 w-3.5" />
            {pendingCount} pending
        </button>
    ) : null;

    return (
        <>
        <AppShell
            className={!native && onRequestsTab ? 'rq-main-wide' : undefined}
            header={
                <PageHeader
                    title={native
                        ? nativeTitle
                        : activeTab === 'transactions' ? requestsTitle : (NATIVE_TAB_COPY[activeTab]?.title || 'Requests')}
                    description={native
                        ? nativeSubtitle
                        : onRequestsTab ? 'Review requests, track issued materials, and manage returns.' : undefined}
                    eyebrow={native
                        ? (!editingTransaction && !showDetail ? `${isAdmin ? 'Admin' : 'Manager'}${staffSession?.name ? ` · ${staffSession.name}` : ''}` : undefined)
                        : (activeTab === 'transactions' ? 'Materials' : undefined)}
                    onBack={editingTransaction ? () => setEditingTransaction(null) : showDetail ? closeDetail : undefined}
                    backLabel={editingTransaction || showDetail ? 'Requests' : 'Back'}
                    nativeActions={native && !editingTransaction && !showDetail ? (
                        <NavIconButton icon={MoreHorizontal} label="More actions" onClick={() => setActionsOpen(true)} />
                    ) : null}
                    variant="admin"
                    actions={
                        <div className="flex items-center gap-2">
                            {!showDetail ? pendingIndicator : null}
                            {!editingTransaction && !showDetail ? <IssueByCard onIssued={() => queryClient.invalidateQueries({ queryKey: ['transactions'] })} /> : null}
                        </div>
                    }
                />
            }
        >
            <div className="space-y-4">
                {!native && (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList data-section-nav className="w-full overflow-x-auto border border-[var(--g-hairline)] bg-[var(--g-surface)] shadow-[0_1px_2px_rgb(15_29_51/0.04)] sm:w-auto">
                        <TabsTrigger value="transactions" className="data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white">Requests</TabsTrigger>
                        {!UNIFIED ? (
                            <TabsTrigger value="requesters" className="data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white"><span className="sm:hidden">People</span><span className="hidden sm:inline">Requesters</span></TabsTrigger>
                        ) : null}
                        {isAdmin && <TabsTrigger value="analytics" className="data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white"><span className="sm:hidden">Stats</span><span className="hidden sm:inline">Analytics</span></TabsTrigger>}
                        {!UNIFIED ? <TabsTrigger value="sites" className="data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white">Sites</TabsTrigger> : null}
                        <TabsTrigger value="materials" className="data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white"><span className="sm:hidden">Stock</span><span className="hidden sm:inline">Materials</span></TabsTrigger>
                        {isAdmin && <TabsTrigger value="managers" className="data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white">Managers</TabsTrigger>}
                        {isAdmin && UNIFIED ? <TabsTrigger value="admins" className="data-[state=active]:bg-[var(--g-brand)] data-[state=active]:text-white">Admins</TabsTrigger> : null}
                    </TabsList>
                </Tabs>
                )}
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
                    ) : activeTab === 'admins' && isAdmin && UNIFIED ? (
                        <Suspense fallback={ManagerTabFallback}>
                            <AdminsManager />
                        </Suspense>
                    ) : activeTab === 'materials' ? (
                        <Suspense fallback={ManagerTabFallback}>
                            <MaterialsManager />
                        </Suspense>
                    ) : !UNIFIED && activeTab === 'sites' ? (
                        <Suspense fallback={ManagerTabFallback}>
                            <SitesManager />
                        </Suspense>
                    ) : !UNIFIED && activeTab === 'requesters' ? (
                        <Suspense fallback={ManagerTabFallback}>
                            <RequestersManager />
                        </Suspense>
                    ) : editingTransaction ? (
                        <MaterialForm
                            key={editingTransaction.id}
                            type={editingTransaction.transaction_type}
                            editMode={true}
                            asStaff
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
                        <>
                            {showDetail ? (
                                <RequestDetailScreen
                                    key={detailTx.id}
                                    tx={detailTx}
                                    approvedReturns={approvedReturns}
                                    caps={requestCaps}
                                    busy={approveRequestMutation.isPending && approveRequestMutation.variables?.id === detailTx.id}
                                    processing={approveRequestMutation.isPending}
                                    onApprove={approveRequest}
                                    onDecline={declineRequest}
                                    onEdit={setEditingTransaction}
                                    onPrint={printRequest}
                                    onDelete={deleteRequest}
                                />
                            ) : null}
                            {/* The list stays mounted under the details screen so its scroll and loaded pages survive. */}
                            <div hidden={showDetail}>
                                <RequestsNative
                                    transactions={transactions}
                                    filtered={filteredTransactions}
                                    metrics={requestMetrics}
                                    sites={requestSites}
                                    isLoading={isLoading}
                                    loadFailed={loadFailed}
                                    isFetching={isFetching}
                                    onRetry={refetch}
                                    filters={filters}
                                    setFilters={setFilters}
                                    caps={requestCaps}
                                    processingId={approveRequestMutation.isPending ? approveRequestMutation.variables?.id : null}
                                    processing={approveRequestMutation.isPending}
                                    onOpen={openDetail}
                                    onApprove={approveRequest}
                                    onDecline={declineRequest}
                                />
                            </div>
                        </>
                    ) : (
                        <RequestsWeb
                            transactions={transactions}
                            filtered={filteredTransactions}
                            metrics={requestMetrics}
                            sites={requestSites}
                            approvedReturns={approvedReturns}
                            isLoading={isLoading}
                            loadFailed={loadFailed}
                            isFetching={isFetching}
                            onRetry={refetch}
                            filters={filters}
                            setFilters={setFilters}
                            page={page}
                            setPage={setPage}
                            caps={requestCaps}
                            processingId={approveRequestMutation.isPending ? approveRequestMutation.variables?.id : null}
                            processing={approveRequestMutation.isPending}
                            onApprove={approveRequest}
                            onDecline={declineRequest}
                            onEdit={setEditingTransaction}
                            onPrint={printRequest}
                            onDelete={deleteRequest}
                            onExport={exportToExcel}
                            onPrintSelected={printSelected}
                            onOpenBulkPrint={() => setShowPrintDialog(true)}
                            onDeleteAll={() => setShowDeleteDialog(true)}
                        />
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
                        onSelect: () => exportToExcel(),
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
        {!editingTransaction && !showDetail && native ? (
            <NativeBottomNav
                items={[
                    { id: 'transactions', icon: ClipboardList, label: 'Inbox', badge: pendingCount > 0 ? (pendingCount > 99 ? '99+' : pendingCount) : undefined, active: activeTab === 'transactions', onClick: () => setActiveTab('transactions') },
                    { id: 'materials', icon: Package, label: 'Stock', active: activeTab === 'materials', onClick: () => setActiveTab('materials') },
                    ...(!UNIFIED
                        ? [
                            { id: 'sites', icon: MapPin, label: 'Sites', active: activeTab === 'sites', onClick: () => setActiveTab('sites') },
                            { id: 'requesters', icon: Users, label: 'People', active: activeTab === 'requesters', onClick: () => setActiveTab('requesters') },
                        ]
                        : []),
                    ...(isAdmin ? [
                        { id: 'analytics', icon: BarChart3, label: 'Stats', active: activeTab === 'analytics', onClick: () => setActiveTab('analytics') },
                        { id: 'managers', icon: UserCog, label: 'Managers', active: activeTab === 'managers', onClick: () => setActiveTab('managers') },
                        ...(UNIFIED ? [{ id: 'admins', icon: ShieldCheck, label: 'Admins', active: activeTab === 'admins', onClick: () => setActiveTab('admins') }] : []),
                    ] : []),
                ]}
            />
        ) : null}
        </>
    );
}
