import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import {
    TrendingUp, Package, RotateCcw, CheckCircle, XCircle,
    Clock, Users, BarChart2, AlertCircle,
} from 'lucide-react';
import { format, subDays, subMonths, parseISO } from 'date-fns';
import { motion } from 'framer-motion';
import { parseLocalDate, startOfTodayLocal } from '@/modules/materials/lib/dates';
import { isNativeApp } from '@/core/platform';

const BRAND_ORANGE = '#dc6b2f';
const SLATE_700 = '#334155';
const PIE_COLORS = [BRAND_ORANGE, SLATE_700, '#10b981', '#f59e0b', '#6366f1', '#ec4899'];

// ──────────────────────────────────────────────────────────────────────────────
// Small summary stat card
// ──────────────────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color = 'slate' }) {
    const colorMap = {
        orange: 'bg-orange-50 border-orange-200 text-orange-700',
        green: 'bg-green-50 border-green-200 text-green-700',
        yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
        red: 'bg-red-50 border-red-200 text-red-700',
        blue: 'bg-blue-50 border-blue-200 text-blue-700',
        slate: 'bg-slate-50 border-slate-200 text-slate-700',
    };
    const cls = colorMap[color] ?? colorMap.slate;

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <Card className={`border ${cls} shadow-sm`}>
                <CardContent className="p-4 flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${cls}`}>
                        <Icon className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
                        <p className="text-2xl font-bold text-slate-800">{value}</p>
                        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// Custom tooltip shared by bar/line charts
// ──────────────────────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-sm">
            <p className="font-semibold text-slate-700 mb-1">{label}</p>
            {payload.map((p) => (
                <p key={p.name} style={{ color: p.color }}>
                    {p.name}: <span className="font-bold">{p.value}</span>
                </p>
            ))}
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// Section heading
// ──────────────────────────────────────────────────────────────────────────────
function SectionTitle({ children }) {
    return (
        <h2 className="text-base font-semibold text-slate-700 mb-3 flex items-center gap-2">
            {children}
        </h2>
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// Date-range filter helper
// ──────────────────────────────────────────────────────────────────────────────
function filterByDateRange(transactions, range) {
    if (range === 'all') return transactions;
    const today = startOfTodayLocal();
    let cutoff = null;
    if (range === 'today') {
        cutoff = today;
    } else if (range === 'week') {
        cutoff = new Date(today);
        cutoff.setDate(cutoff.getDate() - 7);
    } else if (range === 'month') {
        cutoff = new Date(today);
        cutoff.setMonth(cutoff.getMonth() - 1);
    } else if (range === 'year') {
        cutoff = new Date(today);
        cutoff.setFullYear(cutoff.getFullYear() - 1);
    }
    if (!cutoff) return transactions;
    return transactions.filter((t) => {
        const local = parseLocalDate(t.transaction_date);
        if (local) return local >= cutoff;
        try {
            const created = parseISO(t.created_at);
            const createdLocal = new Date(created.getFullYear(), created.getMonth(), created.getDate());
            return createdLocal >= cutoff;
        } catch {
            return true;
        }
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// Main analytics component
// ──────────────────────────────────────────────────────────────────────────────
export default function AdminAnalytics({ transactions = [] }) {
    const [dateRange, setDateRange] = useState('month');

    const filtered = useMemo(() => filterByDateRange(transactions, dateRange), [transactions, dateRange]);

    // ── Summary stats ──────────────────────────────────────────────────────────
    const stats = useMemo(() => {
        const total = filtered.length;
        const pending = filtered.filter((t) => t.approval_status === 'pending').length;
        const approved = filtered.filter((t) => t.approval_status === 'approved').length;
        const declined = filtered.filter((t) => t.approval_status === 'declined').length;
        const takes = filtered.filter((t) => t.transaction_type === 'take').length;
        const returns = filtered.filter((t) => t.transaction_type === 'return').length;
        const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

        // Count unique workers
        const uniqueWorkers = new Set(filtered.map((t) => t.worker_id || t.worker_name)).size;

        return { total, pending, approved, declined, takes, returns, approvalRate, uniqueWorkers };
    }, [filtered]);

    // ── Requests over time (last N days grouped by day) ────────────────────────
    const timelineData = useMemo(() => {
        const days = dateRange === 'today' ? 1 : dateRange === 'week' ? 7 : dateRange === 'month' ? 30 : dateRange === 'year' ? 12 : 30;
        const isYearly = dateRange === 'year';

        const buckets = {};
        const now = new Date();

        if (isYearly) {
            for (let i = 11; i >= 0; i--) {
                const d = subMonths(now, i);
                const key = format(d, 'MM/yy');
                buckets[key] = { date: key, take: 0, return: 0 };
            }
        } else {
            for (let i = days - 1; i >= 0; i--) {
                const d = subDays(now, i);
                const key = format(d, 'dd/MM/yy');
                buckets[key] = { date: key, take: 0, return: 0 };
            }
        }

        filtered.forEach((t) => {
            try {
                const d = parseISO(t.created_at);
                const key = isYearly ? format(d, 'MM/yy') : format(d, 'dd/MM/yy');
                if (buckets[key]) {
                    if (t.transaction_type === 'take') buckets[key].take += 1;
                    else buckets[key].return += 1;
                }
            } catch {
                // skip unparseable dates
            }
        });

        return Object.values(buckets);
    }, [filtered, dateRange]);

    // ── Top workers ────────────────────────────────────────────────────────────
    const topWorkers = useMemo(() => {
        const map = {};
        filtered.forEach((t) => {
            const key = t.worker_name || t.worker_id || 'Unknown';
            if (!map[key]) map[key] = { name: key, requests: 0, approved: 0 };
            map[key].requests += 1;
            if (t.approval_status === 'approved') map[key].approved += 1;
        });
        return Object.values(map)
            .sort((a, b) => b.requests - a.requests)
            .slice(0, 8);
    }, [filtered]);

    // ── Top materials ──────────────────────────────────────────────────────────
    const topMaterials = useMemo(() => {
        const map = {};
        filtered.forEach((t) => {
            if (!Array.isArray(t.materials)) return;
            t.materials.forEach((m) => {
                const key = m.name || 'Unknown';
                if (!map[key]) map[key] = { name: key, count: 0, qty: 0 };
                map[key].count += 1;
                map[key].qty += Number(m.quantity) || 0;
            });
        });
        return Object.values(map)
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 8);
    }, [filtered]);

    // ── Approval breakdown for pie ─────────────────────────────────────────────
    const approvalPieData = useMemo(() => [
        { name: 'Approved', value: stats.approved },
        { name: 'Pending', value: stats.pending },
        { name: 'Declined', value: stats.declined },
    ].filter((d) => d.value > 0), [stats]);

    const approvalPieColors = ['#10b981', '#f59e0b', '#ef4444'];

    // ── Return status breakdown ────────────────────────────────────────────────
    const returnStatusData = useMemo(() => {
        let fullyReturned = 0;
        let partiallyReturned = 0;
        let notReturned = 0;

        filtered
            .filter((t) => t.transaction_type === 'take' && t.approval_status === 'approved')
            .forEach((t) => {
                if (!Array.isArray(t.materials)) return;
                t.materials.forEach((m) => {
                    if (m.returned) fullyReturned += 1;
                    else if ((m.returned_quantity ?? 0) > 0) partiallyReturned += 1;
                    else notReturned += 1;
                });
            });

        return [
            { name: 'Fully Returned', value: fullyReturned },
            { name: 'Partially Returned', value: partiallyReturned },
            { name: 'Not Returned', value: notReturned },
        ].filter((d) => d.value > 0);
    }, [filtered]);

    const returnPieColors = ['#10b981', '#f59e0b', '#dc6b2f'];

    const isNoData = filtered.length === 0;

    return (
        <motion.div
            key="analytics"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-6 pb-10"
        >
            {/* Date Range Filter */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                {isNativeApp() ? (
                    <div>
                        <h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                            <BarChart2 className="w-5 h-5 text-brand" />
                            Analytics Overview
                        </h1>
                        <p className="text-sm text-muted-foreground mt-0.5">Request volume, approvals, and material usage.</p>
                    </div>
                ) : null}
                <Tabs value={dateRange} onValueChange={setDateRange} className={isNativeApp() ? undefined : 'ml-auto'}>
                    <TabsList>
                        <TabsTrigger value="today">Today</TabsTrigger>
                        <TabsTrigger value="week">Week</TabsTrigger>
                        <TabsTrigger value="month">Month</TabsTrigger>
                        <TabsTrigger value="year">Year</TabsTrigger>
                        <TabsTrigger value="all">All</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {isNoData && (
                <Card className="border-dashed">
                    <CardContent className="p-10 text-center text-slate-400">
                        <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">No transaction data for this period.</p>
                        <p className="text-sm mt-1">Try selecting a wider date range.</p>
                    </CardContent>
                </Card>
            )}

            {!isNoData && (
                <>
                    {/* ── Summary Stat Cards ── */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard icon={TrendingUp} label="Total Requests" value={stats.total} color="slate" />
                        <StatCard icon={Clock} label="Pending" value={stats.pending} sub="awaiting review" color="yellow" />
                        <StatCard icon={CheckCircle} label="Approved" value={stats.approved} sub={`${stats.approvalRate}% rate`} color="green" />
                        <StatCard icon={XCircle} label="Declined" value={stats.declined} color="red" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <StatCard icon={Package} label="Take Requests" value={stats.takes} color="orange" />
                        <StatCard icon={RotateCcw} label="Return Requests" value={stats.returns} color="blue" />
                        <StatCard icon={Users} label="Active Workers" value={stats.uniqueWorkers} color="slate" />
                    </div>

                    {/* ── Requests Over Time ── */}
                    <Card className="shadow-sm border-slate-200">
                        <CardContent className="p-5">
                            <SectionTitle>
                                <TrendingUp className="w-4 h-4" style={{ color: BRAND_ORANGE }} />
                                Requests Over Time
                            </SectionTitle>
                            <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={timelineData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <Tooltip content={<ChartTooltip />} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Bar dataKey="take" name="Take" fill={BRAND_ORANGE} radius={[4, 4, 0, 0]} maxBarSize={32} />
                                    <Bar dataKey="return" name="Return" fill={SLATE_700} radius={[4, 4, 0, 0]} maxBarSize={32} />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    {/* ── Approval Status Pie + Return Status Pie ── */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Card className="shadow-sm border-slate-200">
                            <CardContent className="p-5">
                                <SectionTitle>
                                    <AlertCircle className="w-4 h-4" style={{ color: BRAND_ORANGE }} />
                                    Approval Breakdown
                                </SectionTitle>
                                {approvalPieData.length === 0 ? (
                                    <p className="text-slate-400 text-sm text-center py-8">No data</p>
                                ) : (
                                    <ResponsiveContainer width="100%" height={200}>
                                        <PieChart>
                                            <Pie
                                                data={approvalPieData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={50}
                                                outerRadius={80}
                                                paddingAngle={3}
                                                dataKey="value"
                                            >
                                                {approvalPieData.map((entry, i) => (
                                                    <Cell key={entry.name} fill={approvalPieColors[i % approvalPieColors.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip formatter={(val, name) => [val, name]} />
                                            <Legend wrapperStyle={{ fontSize: 12 }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="shadow-sm border-slate-200">
                            <CardContent className="p-5">
                                <SectionTitle>
                                    <RotateCcw className="w-4 h-4" style={{ color: BRAND_ORANGE }} />
                                    Material Return Status
                                </SectionTitle>
                                {returnStatusData.length === 0 ? (
                                    <p className="text-slate-400 text-sm text-center py-8">No approved take data</p>
                                ) : (
                                    <ResponsiveContainer width="100%" height={200}>
                                        <PieChart>
                                            <Pie
                                                data={returnStatusData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={50}
                                                outerRadius={80}
                                                paddingAngle={3}
                                                dataKey="value"
                                            >
                                                {returnStatusData.map((entry, i) => (
                                                    <Cell key={entry.name} fill={returnPieColors[i % returnPieColors.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip formatter={(val, name) => [val, name]} />
                                            <Legend wrapperStyle={{ fontSize: 12 }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* ── Top Workers ── */}
                    <Card className="shadow-sm border-slate-200">
                        <CardContent className="p-5">
                            <SectionTitle>
                                <Users className="w-4 h-4" style={{ color: BRAND_ORANGE }} />
                                Top Workers by Requests
                            </SectionTitle>
                            {topWorkers.length === 0 ? (
                                <p className="text-slate-400 text-sm text-center py-8">No data</p>
                            ) : (
                                <ResponsiveContainer width="100%" height={Math.max(180, topWorkers.length * 36)}>
                                    <BarChart
                                        data={topWorkers}
                                        layout="vertical"
                                        margin={{ top: 0, right: 20, left: 8, bottom: 0 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                        <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                        <YAxis
                                            type="category"
                                            dataKey="name"
                                            width={110}
                                            tick={{ fontSize: 11, fill: '#475569' }}
                                            tickLine={false}
                                            axisLine={false}
                                            tickFormatter={(v) => v.length > 14 ? v.slice(0, 13) + '…' : v}
                                        />
                                        <Tooltip content={<ChartTooltip />} />
                                        <Bar dataKey="requests" name="Requests" fill={BRAND_ORANGE} radius={[0, 4, 4, 0]} maxBarSize={20} />
                                        <Bar dataKey="approved" name="Approved" fill="#10b981" radius={[0, 4, 4, 0]} maxBarSize={20} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>

                    {/* ── Top Materials ── */}
                    <Card className="shadow-sm border-slate-200">
                        <CardContent className="p-5">
                            <SectionTitle>
                                <Package className="w-4 h-4" style={{ color: BRAND_ORANGE }} />
                                Most Requested Materials
                                <span className="ml-auto text-xs font-normal text-slate-400">by total quantity</span>
                            </SectionTitle>
                            {topMaterials.length === 0 ? (
                                <p className="text-slate-400 text-sm text-center py-8">No material data</p>
                            ) : (
                                <>
                                    <ResponsiveContainer width="100%" height={Math.max(180, topMaterials.length * 36)}>
                                        <BarChart
                                            data={topMaterials}
                                            layout="vertical"
                                            margin={{ top: 0, right: 20, left: 8, bottom: 0 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                            <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                                            <YAxis
                                                type="category"
                                                dataKey="name"
                                                width={110}
                                                tick={{ fontSize: 11, fill: '#475569' }}
                                                tickLine={false}
                                                axisLine={false}
                                                tickFormatter={(v) => v.length > 14 ? v.slice(0, 13) + '…' : v}
                                            />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Bar dataKey="qty" name="Qty" fill={SLATE_700} radius={[0, 4, 4, 0]} maxBarSize={20} />
                                            <Bar dataKey="count" name="Transactions" fill={BRAND_ORANGE} radius={[0, 4, 4, 0]} maxBarSize={20} />
                                        </BarChart>
                                    </ResponsiveContainer>

                                    {/* Material table for detail */}
                                    <div className="mt-4 overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-slate-100">
                                                    <th className="text-left py-2 px-2 text-xs font-semibold text-slate-500 uppercase">Material</th>
                                                    <th className="text-right py-2 px-2 text-xs font-semibold text-slate-500 uppercase">Transactions</th>
                                                    <th className="text-right py-2 px-2 text-xs font-semibold text-slate-500 uppercase">Total Qty</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {topMaterials.map((m, i) => (
                                                    <tr key={m.name} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                                                        <td className="py-2 px-2 flex items-center gap-2">
                                                            <span className="w-5 h-5 rounded-full text-white text-[10px] flex items-center justify-center font-bold" style={{ background: i === 0 ? BRAND_ORANGE : SLATE_700 }}>
                                                                {i + 1}
                                                            </span>
                                                            {m.name}
                                                        </td>
                                                        <td className="py-2 px-2 text-right font-medium text-slate-600">{m.count}</td>
                                                        <td className="py-2 px-2 text-right font-bold text-slate-800">{m.qty}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {/* ── Worker detail table ── */}
                    <Card className="shadow-sm border-slate-200">
                        <CardContent className="p-5">
                            <SectionTitle>
                                <Users className="w-4 h-4" style={{ color: BRAND_ORANGE }} />
                                Worker Summary Table
                            </SectionTitle>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100">
                                            <th className="text-left py-2 px-2 text-xs font-semibold text-slate-500 uppercase">Worker</th>
                                            <th className="text-right py-2 px-2 text-xs font-semibold text-slate-500 uppercase">Requests</th>
                                            <th className="text-right py-2 px-2 text-xs font-semibold text-slate-500 uppercase">Approved</th>
                                            <th className="text-right py-2 px-2 text-xs font-semibold text-slate-500 uppercase">Rate</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {topWorkers.map((w) => {
                                            const rate = w.requests > 0 ? Math.round((w.approved / w.requests) * 100) : 0;
                                            return (
                                                <tr key={w.name} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                                                    <td className="py-2 px-2 font-medium text-slate-700">{w.name}</td>
                                                    <td className="py-2 px-2 text-right text-slate-600">{w.requests}</td>
                                                    <td className="py-2 px-2 text-right text-green-700 font-medium">{w.approved}</td>
                                                    <td className="py-2 px-2 text-right">
                                                        <Badge
                                                            variant="outline"
                                                            className={
                                                                rate >= 80
                                                                    ? 'bg-green-50 border-green-200 text-green-700'
                                                                    : rate >= 50
                                                                    ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                                                                    : 'bg-red-50 border-red-200 text-red-700'
                                                            }
                                                        >
                                                            {rate}%
                                                        </Badge>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}
        </motion.div>
    );
}
