import React, { useState, useEffect, useMemo } from 'react';
import { storageKey } from '@/core/storage';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Package, RotateCcw, History, ArrowRight, ClipboardList } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabaseMaterials as supabase } from '@/core/supabase';
import MaterialForm from '@/modules/materials/components/MaterialForm';
import { getWorkerSession, requireWorkerSession, seenRequestIdsKey } from '@/core/auth/materialsSession';
import { AppShell, PageHeader } from '@/ui/layout';
import NativeActionRow from '@/modules/materials/components/mobile/NativeActionRow';
import NativeBottomNav from '@/modules/materials/components/mobile/NativeBottomNav';
import { NativeErrorState, SkeletonStats } from '@/modules/materials/components/mobile/NativeStates';
import { StatusPill } from '@/modules/materials/components/mobile/NativeTxCard';
import { isNativeApp } from '@/core/platform';
import { formatDisplayDate } from '@/modules/materials/lib/dates';
import { setNativeBackInterceptor } from '@/modules/materials/hooks/useAndroidBackButton';

const FORM_TITLES = {
    take: 'Take materials',
    return: 'Return materials',
};

export default function RequestPortal() {
    const navigate = useNavigate();
    const native = isNativeApp();
    const [activeForm, setActiveForm] = useState(null);
    const [workerName] = useState(() => getWorkerSession()?.workerName || '');
    const [notificationCount, setNotificationCount] = useState(0);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);


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

    const { data: transactions = [], isLoading: transactionsLoading, refetch, isFetching, failureCount, errorUpdatedAt, dataUpdatedAt } = useQuery({
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
    const transactionsError = transactions.length === 0 && (failureCount > 0 || errorUpdatedAt > dataUpdatedAt);

    useEffect(() => {
        if (!workerId || transactions.length === 0 || initialLoadComplete) return;
        const key = seenRequestIdsKey(workerId);
        const seenIds = JSON.parse(localStorage.getItem(key) || '[]');
        const currentApprovedDeclinedIds = transactions
            .filter(t => t.approval_status === 'approved' || t.approval_status === 'declined')
            .map(t => t.id);

        const updatedSeenIds = [...new Set([...seenIds, ...currentApprovedDeclinedIds])];
        localStorage.setItem(key, JSON.stringify(updatedSeenIds));
        setInitialLoadComplete(true);
    }, [transactions, initialLoadComplete, workerId]);

    useEffect(() => {
        if (!initialLoadComplete || !workerId) return;

        const key = seenRequestIdsKey(workerId);
        const seenIds = JSON.parse(localStorage.getItem(key) || '[]');

        const newApprovals = transactions.filter(t =>
            (t.approval_status === 'approved' || t.approval_status === 'declined') &&
            !seenIds.includes(t.id)
        );

        setNotificationCount(newApprovals.length);
    }, [transactions, initialLoadComplete, workerId]);

    const handleSuccess = () => {
        setActiveForm(null);
    };

    // App: hardware back closes an open form instead of leaving the portal,
    // and each form opens at the top of the screen.
    useEffect(() => {
        if (!native || !activeForm) return undefined;
        window.scrollTo(0, 0);
        return setNativeBackInterceptor(() => {
            setActiveForm(null);
            return true;
        });
    }, [native, activeForm]);

    // App home summary — derived only from this worker's real transactions.
    const summary = useMemo(() => {
        if (!native) return null;
        let pending = 0;
        let itemsOut = 0;
        for (const t of transactions) {
            if (t.approval_status === 'pending') pending += 1;
            if (t.transaction_type === 'take' && t.approval_status === 'approved') {
                for (const m of t.materials || []) {
                    if (m.reference_number && !m.returned) itemsOut += 1;
                }
            }
        }
        return { pending, itemsOut, total: transactions.length, recent: transactions.slice(0, 3) };
    }, [native, transactions]);


    const markHistorySeen = () => {
        const approvedOrDeclinedIds = transactions
            .filter(t =>
                t.approval_status === 'approved' ||
                t.approval_status === 'declined'
            )
            .map(t => t.id);

        if (workerId) {
            localStorage.setItem(
                seenRequestIdsKey(workerId),
                JSON.stringify(approvedOrDeclinedIds)
            );
        }

        setNotificationCount(0);
    };

    const firstName = workerName.trim().split(/\s+/)[0] || '';
    const historyBadge = notificationCount > 0 ? (notificationCount > 4 ? '4+' : notificationCount) : undefined;
    const nativeTitle = activeForm ? FORM_TITLES[activeForm] : (firstName ? `Hello, ${firstName}` : 'Request Portal');
    const nativeSubtitle = !activeForm
        ? 'What would you like to do today?'
        : 'Fill in the details and submit for approval.';

    return (
        <>
        <AppShell
            maxWidth="4xl"
            header={
                <PageHeader
                    title={native ? nativeTitle : (activeForm ? FORM_TITLES[activeForm] : (firstName ? `Hello, ${firstName}` : 'Request portal'))}
                    description={native ? nativeSubtitle : (activeForm ? 'Fill in the details and submit for approval.' : undefined)}
                    eyebrow={native && !activeForm ? 'Materials' : undefined}
                    onBack={native && activeForm ? () => setActiveForm(null) : (!native && activeForm ? () => setActiveForm(null) : undefined)}
                    backLabel={activeForm ? 'Materials' : 'Back'}
                    nativeActions={null}
                    variant="worker"
                    actions={
                        <>
                            {!native && (
                            <Link
                                to={"/materials/history"}
                                onClick={markHistorySeen}
                            >
                                <Button variant="outline" className="relative h-11 w-11 p-0 sm:h-11 sm:w-auto sm:px-4" aria-label="View History">
                                    <History className="h-4 w-4 sm:mr-2" />
                                    <span className="hidden sm:inline">View History</span>
                                    {notificationCount > 0 && (
                                        <Badge className="absolute -top-2 -right-2 bg-red-600 text-white h-5 w-5 flex items-center justify-center p-0 text-xs">
                                            {notificationCount > 4 ? '4+' : notificationCount}
                                        </Badge>
                                    )}
                                </Button>
                            </Link>
                            )}
                        </>
                    }
                />
            }
        >
            <AnimatePresence mode="wait">
                {!activeForm ? (
                    native ? (
                    <div key="selection-native">
                        <section className="n-section" aria-label="Summary">
                            {transactionsError ? (
                                <div className="n-group">
                                    <NativeErrorState
                                        title="Couldn’t load your requests"
                                        onRetry={() => refetch()}
                                        retrying={isFetching}
                                    />
                                </div>
                            ) : transactionsLoading && !summary.total ? (
                                <SkeletonStats />
                            ) : (
                                <div className="n-stats">
                                    <button
                                        type="button"
                                        className="n-stat"
                                        data-tone="warning"
                                        onClick={() => navigate("/materials/history", { state: { status: 'pending' } })}
                                    >
                                        <span className="n-stat__value">{summary.pending}</span>
                                        <span className="n-stat__label"><span className="n-stat__dot" aria-hidden />Pending</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="n-stat"
                                        data-tone="brand"
                                        onClick={() => setActiveForm('return')}
                                    >
                                        <span className="n-stat__value">{summary.itemsOut}</span>
                                        <span className="n-stat__label"><span className="n-stat__dot" aria-hidden />To return</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="n-stat"
                                        onClick={() => {
                                            markHistorySeen();
                                            navigate("/materials/history");
                                        }}
                                    >
                                        <span className="n-stat__value">{summary.total}</span>
                                        <span className="n-stat__label">Requests</span>
                                    </button>
                                </div>
                            )}
                        </section>

                        <section className="n-section n-enter" aria-labelledby="portal-new">
                            <h2 id="portal-new" className="n-section__title">New request</h2>
                            <div className="n-group">
                                <NativeActionRow
                                    onClick={() => setActiveForm('take')}
                                    icon={Package}
                                    tone="brand"
                                    title="Take materials"
                                    hint="Request items from inventory"
                                />
                                <NativeActionRow
                                    onClick={() => setActiveForm('return')}
                                    icon={RotateCcw}
                                    tone="success"
                                    title="Return materials"
                                    hint={summary.itemsOut > 0 ? `${summary.itemsOut} item${summary.itemsOut === 1 ? '' : 's'} still out` : 'Send items back to inventory'}
                                    trailing={summary.itemsOut > 0 ? (
                                        <span className="n-count" data-tone="brand" aria-hidden>{summary.itemsOut}</span>
                                    ) : null}
                                />
                            </div>
                        </section>

                        <section className="n-section n-enter" aria-labelledby="portal-recent">
                            <h2 id="portal-recent" className="n-section__title">
                                Recent activity
                                {summary.total > 0 ? (
                                    <Link to={"/materials/history"} onClick={markHistorySeen}>See all</Link>
                                ) : null}
                            </h2>
                            {transactionsLoading && !summary.total && !transactionsError ? (
                                <div className="n-group" aria-hidden>
                                    {[0, 1].map((i) => (
                                        <div key={i} className="n-row">
                                            <div className="n-skel n-skel--icon" />
                                            <div className="grid flex-1 gap-2">
                                                <div className="n-skel n-skel--title" style={{ width: '60%' }} />
                                                <div className="n-skel n-skel--line" style={{ width: '40%' }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : summary.recent.length === 0 ? (
                                <div className="n-group">
                                    <div className="n-state" style={{ padding: '24px 20px' }}>
                                        <span className="n-state__icon" aria-hidden>
                                            <ClipboardList className="h-7 w-7" strokeWidth={1.7} />
                                        </span>
                                        <h3 className="n-state__title">
                                            {transactionsError ? 'Couldn’t load activity' : 'No requests yet'}
                                        </h3>
                                        <p className="n-state__text">
                                            {transactionsError
                                                ? 'Check your connection. This will refresh automatically.'
                                                : 'Your take and return requests will appear here.'}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="n-group">
                                    {summary.recent.map((t) => {
                                        const isReturn = t.transaction_type === 'return';
                                        const names = (t.materials || []).map((m) => m.name).filter(Boolean);
                                        const title = names.length
                                            ? `${names[0]}${names.length > 1 ? ` +${names.length - 1} more` : ''}`
                                            : (isReturn ? 'Return request' : 'Take request');
                                        return (
                                            <NativeActionRow
                                                key={t.id}
                                                to={"/materials/history"}
                                                onClick={markHistorySeen}
                                                icon={isReturn ? RotateCcw : Package}
                                                tone={isReturn ? 'success' : 'brand'}
                                                title={title}
                                                hint={`${isReturn ? 'Return' : 'Take'} · ${formatDisplayDate(t.transaction_date)}${t.site_name ? ` · ${t.site_name}` : ''}`}
                                                trailing={<StatusPill status={t.approval_status} />}
                                                className="n-row--summary"
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </section>

                    </div>
                    ) : (
                    <motion.div
                        key="selection"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12, transition: { duration: 0.12 } }}
                        className="space-y-6"
                    >
                        <div className="space-y-1">
                            <h2 className="text-xl sm:text-2xl font-semibold text-slate-900">
                                Material Request
                            </h2>
                            <p className="text-sm text-muted-foreground max-w-lg">
                                Submit a request for materials to take or return.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <motion.div
                                whileHover={{ y: -3 }}
                                whileTap={{ scale: 0.99 }}
                                className="touch-pan-y"
                                style={{ touchAction: 'pan-y' }}
                            >
                                <Card
                                    onClick={() => setActiveForm('take')}
                                    className="cursor-pointer overflow-hidden group hover:border-brand/40 transition-colors h-full"
                                >
                                    <div className="p-6 sm:p-7">
                                        <div className="w-12 h-12 bg-brand-muted rounded-xl flex items-center justify-center mb-4">
                                            <Package className="w-6 h-6 text-brand" />
                                        </div>
                                        <h3 className="text-lg font-semibold text-slate-900 mb-1">
                                            Take Materials
                                        </h3>
                                        <p className="text-sm text-muted-foreground mb-5">
                                            Request materials from inventory
                                        </p>
                                        <div className="flex items-center text-brand font-medium text-sm">
                                            Start Request
                                            <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                                        </div>
                                    </div>
                                </Card>
                            </motion.div>

                            <motion.div
                                whileHover={{ y: -3 }}
                                whileTap={{ scale: 0.99 }}
                                className="touch-pan-y"
                                style={{ touchAction: 'pan-y' }}
                            >
                                <Card
                                    onClick={() => setActiveForm('return')}
                                    className="cursor-pointer overflow-hidden group hover:border-emerald-400/50 transition-colors h-full"
                                >
                                    <div className="p-6 sm:p-7">
                                        <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center mb-4">
                                            <RotateCcw className="w-6 h-6 text-emerald-600" />
                                        </div>
                                        <h3 className="text-lg font-semibold text-slate-900 mb-1">
                                            Return Materials
                                        </h3>
                                        <p className="text-sm text-muted-foreground mb-5">
                                            Return materials to inventory
                                        </p>
                                        <div className="flex items-center text-emerald-600 font-medium text-sm">
                                            Start Request
                                            <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                                        </div>
                                    </div>
                                </Card>
                            </motion.div>
                        </div>

                    </motion.div>
                    )
                ) : (
                    <MaterialForm
                        key={activeForm}
                        type={activeForm}
                        onBack={() => setActiveForm(null)}
                        onSuccess={handleSuccess}
                    />
                )}
            </AnimatePresence>
        </AppShell>
        {!activeForm && native ? (
            <NativeBottomNav
                items={[
                    { to: "/materials/request", icon: Package, label: 'Request' },
                    { to: "/materials/history", icon: History, label: 'History', badge: historyBadge, onClick: markHistorySeen },
                ]}
            />
        ) : null}
        </>
    );
}
