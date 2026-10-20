// TODO(claude): AppShell/PageHeader (@/ui/layout) + materials hooks (useAndroidBackButton, useProgressiveList) may need hub mounts
import React, { useState, useEffect } from 'react';
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
    Download, Search, Package, RotateCcw,
    Calendar, Clock, FileSpreadsheet, Loader2, Trash2, Printer
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { formatDisplayDate, formatFileDate } from '@/modules/materials/lib/dates';
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { requireStaffSession } from '@/core/auth/materialsSession';
import { matchesDateFilter, TRANSACTION_QUERY_LIMIT } from '@/modules/materials/lib/dates';
import {
    buildReturnHistoryMap,
    fetchApprovedReturnsOnce,
    printSingleTransaction,
    printBulkTransactions,
} from '@/modules/materials/lib/transactionPrint';
import { printFailureMessage } from '@/modules/materials/lib/printDocument';
import { AppShell, PageHeader, EmptyState } from '@/ui/layout';
import FilterToolbar from '@/modules/materials/components/layout/FilterToolbar';

export default function History() {
    const navigate = useNavigate();
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFilter, setDateFilter] = useState('all');
    const [workerIdFilter, setWorkerIdFilter] = useState('');
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [confirmError, setConfirmError] = useState('');
    const [showPrintDialog, setShowPrintDialog] = useState(false);
    const [printStartDate, setPrintStartDate] = useState('');
    const [printEndDate, setPrintEndDate] = useState('');
    const [printWorkerId, setPrintWorkerId] = useState('');
    const [isBulkPrinting, setIsBulkPrinting] = useState(false);
    const [authReady, setAuthReady] = useState(false);

    const queryClient = useQueryClient();

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const session = await requireStaffSession(navigate);
            if (cancelled) return;
            const ok = session && (session.roles?.includes('admin') || session.roles?.includes('manager'));
            if (ok) setAuthReady(true);
            else if (session) navigate('/connect/materials');
        })();
        return () => { cancelled = true; };
    }, [navigate]);

    const { data: transactions = [], isLoading } = useQuery({
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
    });

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

    const handleDeleteHistory = () => {
        if (confirmText.trim() === 'DELETE') {
            setConfirmError('');
            deleteAllMutation.mutate();
        } else {
            setConfirmError('Type DELETE to confirm');
        }
    };

    const filteredTransactions = transactions.filter(t => {
        const matchesFilter = filter === 'all' || t.transaction_type === filter;
        const matchesSearch =
            t.worker_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.worker_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.materials?.some(m => m.name?.toLowerCase().includes(searchTerm.toLowerCase()));

        const matchesWorkerId = !workerIdFilter || t.worker_id?.toLowerCase().includes(workerIdFilter.toLowerCase());
        const matchesDate = matchesDateFilter(t.transaction_date, dateFilter);

        return matchesFilter && matchesSearch && matchesDate && matchesWorkerId;
    });

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
            await new Promise((r) => setTimeout(r, 80));
            printBulkTransactions(transactionsToPrint, returnHistoryMap, {
                startDate: printStartDate || '',
                endDate: printEndDate || '',
                workerId: printWorkerId || '',
                filterNote: (!printWorkerId && !printStartDate && !printEndDate)
                    ? 'All Workers (current filters applied)'
                    : '',
            });
        } catch (error) {
            console.error('Error during bulk print:', error);
            toast.error(printFailureMessage(error));
        } finally {
            setIsBulkPrinting(false);
        }
    };

    const exportToExcel = async () => {
        const data = [];
        filteredTransactions.forEach(t => {
            if (t.materials && t.materials.length > 0) {
                t.materials.forEach(m => {
                    data.push({
                        'Date': formatDisplayDate(t.transaction_date),
                        'Time': t.transaction_time,
                        'Type': t.transaction_type,
                        'Status': t.approval_status,
                        'Worker Name': t.worker_name,
                        'Worker ID': t.worker_id,
                        'Site': t.site_name || '',
                        'Material': m.name,
                        'Quantity': m.quantity,
                        'Unit': m.unit,
                        'Reference Number': m.reference_number || '',
                        'Return Quantity': m.return_quantity ?? '',
                        'Returned Quantity': m.returned_quantity ?? '',
                        'Returned': m.returned ? 'Yes' : 'No',
                        'Notes': t.notes || ''
                    });
                });
            } else {
                data.push({
                    'Date': formatDisplayDate(t.transaction_date),
                    'Time': t.transaction_time,
                    'Type': t.transaction_type,
                    'Status': t.approval_status,
                    'Worker Name': t.worker_name,
                    'Worker ID': t.worker_id,
                    'Site': t.site_name || '',
                    'Material': '',
                    'Quantity': '',
                    'Unit': '',
                    'Reference Number': '',
                    'Return Quantity': '',
                    'Returned Quantity': '',
                    'Returned': '',
                    'Notes': t.notes || ''
                });
            }
        });

        const XLSX = await import('xlsx');
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions');
        XLSX.writeFile(workbook, `AKK_Materials_${formatFileDate(new Date())}.xlsx`);
    };

    if (!authReady) {
        return (
            <div className="min-h-dvh-safe flex items-center justify-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-brand" />
            </div>
        );
    }

    return (
        <AppShell
            header={
                <PageHeader
                    title="Transaction History"
                    description="Search, export, print, or delete records"
                    backTo={"/materials/admin"}
                    variant="admin"
                    actions={
                        <div className="flex flex-wrap gap-2">
                            <Button onClick={exportToExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                                <FileSpreadsheet className="w-4 h-4 mr-2" />
                                <span className="hidden sm:inline">Export</span>
                                <Download className="w-4 h-4 sm:hidden" />
                            </Button>
                            <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                                <Trash2 className="w-4 h-4 mr-2" />
                                <span className="hidden sm:inline">Delete All</span>
                            </Button>
                        </div>
                    }
                />
            }
        >
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
                            <Tabs value={filter} onValueChange={setFilter}>
                                <TabsList>
                                    <TabsTrigger value="all">All</TabsTrigger>
                                    <TabsTrigger value="take">Take</TabsTrigger>
                                    <TabsTrigger value="return">Return</TabsTrigger>
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
                            <Input
                                placeholder="Filter by Worker ID"
                                value={workerIdFilter}
                                onChange={(e) => setWorkerIdFilter(e.target.value)}
                                className="w-full sm:w-48"
                            />
                        </>
                    }
                    actions={
                        <Button variant="secondary" onClick={() => setShowPrintDialog(true)}>
                            <Printer className="w-4 h-4 mr-2" />
                            Bulk Print
                        </Button>
                    }
                />

                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-brand" />
                    </div>
                ) : filteredTransactions.length === 0 ? (
                    <EmptyState
                        title="No Transactions Found"
                        description={searchTerm ? 'Try a different search term' : 'Start by recording a material take or return'}
                    />
                ) : (
                    <div className="space-y-3">
                        <AnimatePresence>
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
                                            <div className="flex items-start justify-between gap-3 mb-3">
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
                                                        <Badge className={transaction.transaction_type === 'return' ? 'bg-emerald-600 text-white' : ''}>
                                                            {transaction.transaction_type === 'return' ? 'Return' : 'Take'}
                                                        </Badge>
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
                                                        </div>
                                                    </div>
                                                </div>
                                                <Button size="sm" variant="outline" onClick={() => printTransaction(transaction)}>
                                                    <Printer className="w-4 h-4 mr-1" />
                                                    Print
                                                </Button>
                                            </div>
                                            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5">
                                                {transaction.materials?.map((material, idx) => (
                                                    <div key={idx} className="text-sm">
                                                        <span className="font-medium text-slate-800">{material.name}</span>
                                                        <span className="ml-2 text-muted-foreground">
                                                            {material.quantity} {material.unit}
                                                        </span>
                                                    </div>
                                                ))}
                                                {transaction.notes && (
                                                    <p className="text-sm text-muted-foreground italic pt-1 border-t border-border">
                                                        "{transaction.notes}"
                                                    </p>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Bulk Print Transactions</DialogTitle>
                        <DialogDescription>
                            Optional date/worker filters are applied on top of the current type/search filters.
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
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Printer className="w-4 h-4 mr-2" />
                            )}
                            {isBulkPrinting ? 'Preparing…' : 'Print'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
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
            </Dialog>
        </AppShell>
    );
}
