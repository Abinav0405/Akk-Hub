import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { storageKey } from '@/core/storage';
import { supabaseMaterials as supabase } from '@/core/supabase';
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Badge } from '@/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs';
import { 
    Search, Package, RotateCcw,
    Calendar, Clock, Loader2, CheckCircle, XCircle, AlertCircle, Edit2, MapPin, History
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import MaterialForm from '@/modules/materials/components/MaterialForm';
import { getWorkerSession, requireWorkerSession, seenRequestIdsKey } from '@/core/auth/materialsSession';
import { formatDisplayDate, formatDisplayDateTime } from '@/modules/materials/lib/dates';
import { AppShell, PageHeader, EmptyState } from '@/ui/layout';
import FilterToolbar from '@/modules/materials/components/layout/FilterToolbar';
import NativeBottomNav from '@/modules/materials/components/mobile/NativeBottomNav';
import NativeFilterBar from '@/modules/materials/components/mobile/NativeFilterBar';
import NativeTxCard, { workerItemStatus } from '@/modules/materials/components/mobile/NativeTxCard';
import { NativeEmptyState, NativeErrorState, SkeletonList } from '@/modules/materials/components/mobile/NativeStates';
import { promptSecret } from '@/modules/materials/components/mobile/NativeConfirm';
import { isNativeApp } from '@/core/platform';
import { setNativeBackInterceptor } from '@/modules/materials/hooks/useAndroidBackButton';
import { useProgressiveList } from '@/modules/materials/hooks/useProgressiveList';

const STATUS_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'declined', label: 'Declined' },
];

const RETURN_OPTIONS = [
    { value: 'all', label: 'All materials' },
    { value: 'returned', label: 'Returned' },
    { value: 'partially_returned', label: 'Partially returned' },
    { value: 'not_returned', label: 'Not returned' },
];

/** One card in the app's history list; memoised so a 3 s poll only re-renders changed rows. */
const WorkerHistoryCard = memo(function WorkerHistoryCard({ transaction, onEdit }) {
    const isPending = transaction.approval_status === 'pending';
    return (
        <NativeTxCard
            tx={transaction}
            title={transaction.transaction_type === 'return' ? 'Return request' : 'Take request'}
            showKind={false}
            itemStatus={workerItemStatus}
            actions={isPending ? (
                <button
                    type="button"
                    className="n-btn n-btn--tinted n-btn--sm"
                    onClick={() => onEdit(transaction)}
                >
                    <Edit2 className="h-4 w-4" aria-hidden />
                    Edit request
                </button>
            ) : null}
        />
    );
});

export default function RequestHistory() {
    const navigate = useNavigate();
    const location = useLocation();
    const native = isNativeApp();
    const [searchTerm, setSearchTerm] = useState('');
    // App: the portal's "Pending" tile opens this list pre-filtered.
    const [statusFilter, setStatusFilter] = useState(() =>
        native && typeof location.state?.status === 'string' ? location.state.status : 'all'
    );
    const [materialReturnFilter, setMaterialReturnFilter] = useState('all');
    const [editingTransaction, setEditingTransaction] = useState(null);
    const queryClient = useQueryClient();
    const [workerId, setWorkerId] = useState(() => sessionStorage.getItem(storageKey('materials', 'workerId')) || '');
    const [workerToken, setWorkerToken] = useState(() => getWorkerSession()?.token || null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const session = await requireWorkerSession(navigate);
            if (cancelled || !session) return;
            setWorkerId(session.workerId);
            setWorkerToken(session.token);
        })();
        return () => { cancelled = true; };
    }, [navigate]);


    const { data: transactions = [], isLoading, refetch, isFetching, failureCount, errorUpdatedAt, dataUpdatedAt } = useQuery({
        queryKey: ['worker-transactions', workerToken],
        enabled: !!workerToken,
        queryFn: async () => {
            const { data, error } = await supabase.rpc('get_worker_transactions', { p_token: workerToken });
            if (error) throw error;
            return data || [];
        },
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
    });

    // App: once a load has failed with nothing to show, keep the error up (with
    // "Retrying…") instead of flickering back to skeletons on every 30 s poll.
    const loadFailed = transactions.length === 0 && (failureCount > 0 || errorUpdatedAt > dataUpdatedAt);

    useEffect(() => {
        if (!workerId || isLoading || transactions.length === 0) return;
        const allIds = transactions.map(t => t.id);
        localStorage.setItem(seenRequestIdsKey(workerId), JSON.stringify(allIds));
    }, [transactions, isLoading, workerId]);

    const deleteMutation = useMutation({
        mutationFn: async (id) => {
            const password = await promptSecret({
                title: 'Delete this request?',
                message: 'Enter your worker password to delete this pending request:',
                confirmLabel: 'Delete request',
                destructive: true,
            });
            if (!password) throw new Error('Delete cancelled');
            const { data, error } = await supabase.rpc('worker_delete_pending_transaction', {
                p_transaction_id: id,
                p_worker_id: workerId,
                p_password: password,
            });
            if (error) throw error;
            if (!data) throw new Error('Only your pending request can be deleted');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            queryClient.invalidateQueries({ queryKey: ['worker-transactions'] });
            setEditingTransaction(null);
        },
    });

    const handleEditSuccess = () => {
        setEditingTransaction(null);
    };

    const startEditing = useCallback((transaction) => setEditingTransaction(transaction), []);

    // App: hardware back leaves the edit form first; each form opens at the top.
    useEffect(() => {
        if (!native || !editingTransaction) return undefined;
        window.scrollTo(0, 0);
        return setNativeBackInterceptor(() => {
            setEditingTransaction(null);
            return true;
        });
    }, [native, editingTransaction]);


    const filteredTransactions = useMemo(() => transactions.filter(t => {
        const matchesSearch =
            t.worker_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.worker_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.materials?.some(m => m.name?.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesStatus = statusFilter === 'all' || t.approval_status === statusFilter;

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

        return matchesSearch && matchesStatus && matchesMaterialReturn;
    }), [transactions, searchTerm, statusFilter, materialReturnFilter]);

    const { visible: visibleTransactions, hasMore, sentinelRef } = useProgressiveList(filteredTransactions, {
        resetKey: `${searchTerm}|${statusFilter}|${materialReturnFilter}`,
    });

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

    return (
        <>
        <AppShell
            header={
                <PageHeader
                    title={editingTransaction ? 'Edit request' : 'My requests'}
                    description={
                        editingTransaction
                            ? 'Only pending requests can be changed.'
                            : (native ? 'Your take and return requests' : 'Filter and edit pending requests')
                    }
                    backTo={editingTransaction ? undefined : '/materials/request'}
                    onBack={editingTransaction ? () => setEditingTransaction(null) : undefined}
                    backLabel={editingTransaction ? 'History' : 'Back'}
                    nativeActions={null}
                    variant="worker"
                    actions={null}
                />
            }
        >
            {native ? (
                editingTransaction ? (
                    <MaterialForm
                        key={editingTransaction.id}
                        type={editingTransaction.transaction_type}
                        editMode={true}
                        existingTransaction={editingTransaction}
                        onBack={() => setEditingTransaction(null)}
                        onSuccess={handleEditSuccess}
                        onDelete={() => deleteMutation.mutate(editingTransaction.id)}
                    />
                ) : (
                    <>
                        <NativeFilterBar
                            search={searchTerm}
                            onSearch={setSearchTerm}
                            placeholder="Search materials"
                            groups={[
                                { id: 'status', label: 'Status', value: statusFilter, onChange: setStatusFilter, options: STATUS_OPTIONS },
                                { id: 'returns', label: 'Returns', value: materialReturnFilter, onChange: setMaterialReturnFilter, options: RETURN_OPTIONS },
                            ]}
                        />
                        {loadFailed ? (
                            <NativeErrorState
                                title="Couldn’t load your requests"
                                onRetry={() => refetch()}
                                retrying={isFetching}
                            />
                        ) : isLoading ? (
                            <SkeletonList count={4} label="Loading your requests" />
                        ) : filteredTransactions.length === 0 ? (
                            <NativeEmptyState
                                icon={History}
                                title={transactions.length ? 'No matching requests' : 'No requests yet'}
                                description={transactions.length
                                    ? 'Try a different search or clear the filters.'
                                    : 'Start by creating a material request.'}
                            />
                        ) : (
                            <>
                                <p className="n-results" aria-live="polite">
                                    {filteredTransactions.length} request{filteredTransactions.length === 1 ? '' : 's'}
                                </p>
                                <div className="n-list">
                                    {visibleTransactions.map((transaction) => (
                                        <WorkerHistoryCard
                                            key={transaction.id}
                                            transaction={transaction}
                                            onEdit={startEditing}
                                        />
                                    ))}
                                </div>
                                {hasMore ? (
                                    <div ref={sentinelRef} className="n-more">
                                        <span className="n-spinner" aria-hidden />
                                    </div>
                                ) : null}
                            </>
                        )}
                    </>
                )
            ) : (
            <div className="space-y-4">
                <FilterToolbar
                    search={
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                                placeholder="Search by name, ID, or material..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                    }
                    filters={
                        <>
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
                                    <TabsTrigger value="partially_returned">Partially Returned</TabsTrigger>
                                    <TabsTrigger value="not_returned">Not Returned</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </>
                    }
                />

                <AnimatePresence mode="wait">
                    {editingTransaction ? (
                        <MaterialForm
                            key={editingTransaction.id}
                            type={editingTransaction.transaction_type}
                            editMode={true}
                            existingTransaction={editingTransaction}
                            onBack={() => setEditingTransaction(null)}
                            onSuccess={handleEditSuccess}
                            onDelete={() => deleteMutation.mutate(editingTransaction.id)}
                        />
                    ) : isLoading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 animate-spin text-brand" />
                        </div>
                    ) : filteredTransactions.length === 0 ? (
                        <EmptyState
                            title="No Requests Found"
                            description={searchTerm ? 'Try a different search term' : 'Start by creating a material request'}
                        />
                    ) : (
                        <div className="space-y-3">
                            {filteredTransactions.map((transaction, index) => (
                                <motion.div
                                    key={transaction.id}
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: Math.min(index, 20) * 0.03 }}
                                >
                                    <Card className="overflow-hidden">
                                        <div className={`h-0.5 ${transaction.transaction_type === 'return' ? 'bg-emerald-600' : 'bg-brand'}`} />
                                        <CardContent className="p-4 sm:p-5">
                                            <div className="flex flex-col gap-4">
                                                <div className="flex flex-col gap-3 max-sm:w-full sm:flex-row sm:items-start sm:justify-between">
                                                    <div className="flex items-start gap-3 min-w-0">
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
                                                        <div className="min-w-0 space-y-1.5">
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
                                                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
                                                    {transaction.approval_status === 'pending' && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="min-h-11 w-full shrink-0 sm:w-auto"
                                                            onClick={() => setEditingTransaction(transaction)}
                                                        >
                                                            <Edit2 className="w-4 h-4 mr-1" />
                                                            Edit
                                                        </Button>
                                                    )}
                                                </div>

                                                <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
                                                    {transaction.materials?.map((material, idx) => (
                                                        <div key={idx} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                                                            <div>
                                                                <span className="font-medium text-slate-800">{material.name}</span>
                                                                <span className="ml-2 text-muted-foreground">
                                                                    {transaction.transaction_type === 'return' && material.return_quantity
                                                                        ? `${material.return_quantity}/${material.quantity} ${material.unit}`
                                                                        : `${material.quantity} ${material.unit}`
                                                                    }
                                                                </span>
                                                                {material.reference_number && (
                                                                    <span className="ml-2 font-mono text-xs text-slate-500">#{material.reference_number}</span>
                                                                )}
                                                            </div>
                                                            {transaction.transaction_type === 'take' && material.reference_number && (
                                                                <span className={`text-xs font-medium ${
                                                                    material.returned
                                                                        ? 'text-emerald-700'
                                                                        : material.return_declined
                                                                        ? 'text-red-600'
                                                                        : (material.returned_quantity || 0) > 0
                                                                        ? 'text-slate-800'
                                                                        : 'text-amber-600'
                                                                }`}>
                                                                    {material.returned
                                                                        ? `Returned on ${formatDisplayDateTime(material.return_date) || material.return_date || ''}`
                                                                        : material.return_declined
                                                                        ? `Return declined by ${material.return_declined_by} on ${formatDisplayDateTime(material.return_declined_date) || material.return_declined_date || ''}`
                                                                        : (material.returned_quantity || 0) > 0
                                                                        ? `Partially returned (${material.returned_quantity}/${material.quantity} ${material.unit})`
                                                                        : 'Not returned'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))}
                                                    {transaction.notes && (
                                                        <p className="text-sm text-muted-foreground italic pt-1 border-t border-border">
                                                            "{transaction.notes}"
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </AnimatePresence>
            </div>
            )}
        </AppShell>
        {!editingTransaction && native ? (
            <NativeBottomNav
                items={[
                    { to: "/materials/request", icon: Package, label: 'Request' },
                    { to: "/materials/history", icon: History, label: 'History' },
                ]}
            />
        ) : null}
        </>
    );
}
