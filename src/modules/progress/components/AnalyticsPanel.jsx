import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
    Loader2, RefreshCw, ClipboardList, Clock, Camera, FileDown, MapPin,
} from 'lucide-react';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ui/table';
import { defaultAnalyticsRange, getAnalyticsDashboard } from '@/modules/progress/lib/analytics';
import { listAllSites } from '@/modules/progress/lib/sites';
import { formatDate } from '@/modules/progress/lib/dates';
import { jsrStatusLabel } from '@/modules/progress/lib/jsrStatus';
import { friendlyDbError } from '@/modules/progress/lib/networkError';
import { isNativeApp } from '@/core/platform';
import { cn } from '@/modules/progress/lib/utils';

const NAVY = '#0f2440';
const BRAND = '#dc6b2f';
const EMERALD = '#059669';
const RED = '#dc2626';
const SKY = '#0284c7';
const STAGE_LABEL = { before: 'Before', during: 'During', after: 'After', completion: 'Completion' };
const STAGE_COLOR = { before: NAVY, during: '#16345c', after: BRAND, completion: SKY };
const PRESETS = [
    { id: '7', label: '7 days' },
    { id: '30', label: '30 days' },
    { id: '90', label: '90 days' },
    { id: 'all', label: 'All time' },
];

class ChartGuard extends React.Component {
    constructor(props) {
        super(props);
        this.state = { failed: false };
    }

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error) {
        console.error('[analytics chart]', error);
    }

    render() {
        if (this.state.failed) {
            return <p className="py-8 text-center text-sm text-muted-foreground">Could not draw this chart.</p>;
        }
        return this.props.children;
    }
}

class PanelBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { failed: false, nonce: 0 };
    }

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error) {
        console.error('[analytics panel]', error);
    }

    render() {
        if (this.state.failed) {
            return (
                <Card className="p-6 text-center">
                    <p className="text-base font-semibold text-navy">Analytics hit an error</p>
                    <p className="mt-1 text-sm text-muted-foreground">Other Admin tabs still work. Reload this tab to try again.</p>
                    <Button className="mt-4" onClick={() => this.setState((s) => ({ failed: false, nonce: s.nonce + 1 }))}>Try again</Button>
                </Card>
            );
        }
        return <React.Fragment key={this.state.nonce}>{this.props.children}</React.Fragment>;
    }
}

function formatHours(value) {
    if (value == null || value === '' || Number.isNaN(Number(value))) return '—';
    const n = Number(value);
    if (n < 1) return `${Math.max(1, Math.round(n * 60))} min`;
    if (n < 48) return `${n.toFixed(1)}h`;
    return `${(n / 24).toFixed(1)}d`;
}

function chartDateLabel(value, grain) {
    const label = formatDate(value);
    if (!label) return value || '';
    if (grain === 'month') return label.slice(3);
    return label.slice(0, 5);
}

function tooltipStyle() {
    return { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 8px 20px -8px rgb(15 23 42 / 0.15)' };
}

function StatTile({ label, value, hint, icon: Icon }) {
    return (
        <Card className="p-4 shadow-xs">
            <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                {Icon && <Icon className="h-4 w-4 shrink-0 text-brand" />}
            </div>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-navy">{value}</p>
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </Card>
    );
}

function StackBar({ segments }) {
    const total = segments.reduce((sum, s) => sum + Number(s.value || 0), 0);
    if (!total) return <p className="text-sm text-muted-foreground">No data in this range.</p>;
    return (
        <div>
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                {segments.map((s) => (
                    <div
                        key={s.label}
                        className="h-full"
                        style={{ width: `${(Number(s.value) / total) * 100}%`, background: s.color }}
                        title={`${s.label}: ${s.value}`}
                    />
                ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {segments.map((s) => (
                    <span key={s.label} className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                        {s.label} · {s.value}
                    </span>
                ))}
            </div>
        </div>
    );
}

function ChartFrame({ children, height, native, rows }) {
    const h = height || Math.min(420, Math.max(native ? 260 : 300, (rows || 0) * 28 + 48));
    return (
        <div className="w-full min-w-0" style={{ height: h }}>
            <ChartGuard>
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    {children}
                </ResponsiveContainer>
            </ChartGuard>
        </div>
    );
}

function EmptyNote({ children }) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export default function AnalyticsPanel() {
    return (
        <PanelBoundary>
            <AnalyticsBody />
        </PanelBoundary>
    );
}

function AnalyticsBody() {
    const native = isNativeApp();
    const initial = defaultAnalyticsRange('30');
    const [preset, setPreset] = useState('30');
    const [from, setFrom] = useState(initial.from);
    const [to, setTo] = useState(initial.to);
    const [siteId, setSiteId] = useState('all');
    const [sites, setSites] = useState([]);
    const [section, setSection] = useState('overview');
    const [data, setData] = useState(null);
    const [warning, setWarning] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        listAllSites().then(setSites).catch(() => setSites([]));
    }, []);

    const load = (nextFrom = from, nextTo = to, nextSite = siteId) => {
        if (!nextFrom || !nextTo) return;
        setLoading(true);
        setError(null);
        getAnalyticsDashboard({
            from: nextFrom,
            to: nextTo,
            siteId: nextSite === 'all' ? null : nextSite,
        })
            .then((result) => {
                setData(result.data);
                setWarning(result.warning || null);
                setError(null);
            })
            .catch((e) => {
                console.error(e);
                const message = friendlyDbError(e, 'Could not load analytics');
                setError(message);
                toast.error(message);
            })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load(from, to, siteId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [from, to, siteId]);

    const applyPreset = (id) => {
        const range = defaultAnalyticsRange(id);
        setPreset(id);
        setFrom(range.from);
        setTo(range.to);
    };

    const grain = data?.range?.grain || 'day';
    const status = data?.status_counts || {};
    const total = Number(data?.total_packages || 0);
    const chartDays = data?.submissions_by_day || [];
    const hasVolume = total > 0 || chartDays.some((row) => Number(row.count) > 0);
    const siteChart = (data?.by_site || []).filter((row) => Number(row.count) > 0).slice(0, 12);
    const workerChart = (data?.by_worker || []).slice(0, 12);
    const jsr = data?.jsr || { available: false };

    const axisProps = useMemo(() => ({
        tick: { fontSize: native ? 10 : 12, fill: '#64748b' },
        tickLine: false,
        axisLine: { stroke: '#e2e8f0' },
    }), [native]);

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading analytics…
            </div>
        );
    }

    if (error && !data) {
        return (
            <Card className="p-6 text-center">
                <p className="text-base font-semibold text-navy">Could not load analytics</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                <Button className="mt-4" onClick={() => load()}>
                    <RefreshCw className="mr-1.5 h-4 w-4" /> Try again
                </Button>
            </Card>
        );
    }

    return (
        <div className="space-y-5">
            {native ? (
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Analytics</h1>
                    <p className="mt-1 text-sm text-slate-500">Package volume, approvals and site activity for the selected date range.</p>
                </div>
            ) : null}
            <Card className="p-4 sm:p-5">
                <div className="flex flex-col gap-3">
                    <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {PRESETS.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => applyPreset(p.id)}
                                className={cn(
                                    'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                                    native && 'min-h-11 px-4',
                                    preset === p.id
                                        ? 'border-slate-900 bg-slate-900 text-white'
                                        : 'border-border bg-white text-slate-600 hover:border-slate-300'
                                )}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                            <Label htmlFor="analytics-from">From</Label>
                            <Input
                                id="analytics-from"
                                type="date"
                                className="mt-1.5"
                                value={from}
                                onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }}
                            />
                        </div>
                        <div>
                            <Label htmlFor="analytics-to">To</Label>
                            <Input
                                id="analytics-to"
                                type="date"
                                className="mt-1.5"
                                value={to}
                                onChange={(e) => { setPreset('custom'); setTo(e.target.value); }}
                            />
                        </div>
                        <div>
                            <Label>Site</Label>
                            <div className="mt-1.5">
                                <Select value={siteId} onValueChange={setSiteId}>
                                    <SelectTrigger aria-label="Filter by site">
                                        <SelectValue placeholder="All sites" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All sites</SelectItem>
                                        {sites.map((s) => (
                                            <SelectItem key={s.id} value={s.id}>
                                                {s.name}{s.is_active === false ? ' (inactive)' : ''}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <p>
                            {formatDate(from)} – {formatDate(to)} · Singapore time
                            {data?.drafts_excluded ? ` · ${data.drafts_excluded} draft${data.drafts_excluded === 1 ? '' : 's'} hidden` : ''}
                        </p>
                        <Button type="button" variant="outline" size="sm" onClick={() => load()} disabled={loading}>
                            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                            Refresh
                        </Button>
                    </div>
                </div>
            </Card>

            {error && data && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {error}
                </div>
            )}
            {warning && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {warning}
                </div>
            )}

            <Tabs value={section} onValueChange={setSection}>
                <TabsList className="w-full">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="sites">Sites &amp; team</TabsTrigger>
                    <TabsTrigger value="photos">Photos</TabsTrigger>
                    <TabsTrigger value="export">Export &amp; JSR</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-5">
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <StatTile label="Packages" value={total} hint="Submitted (not drafts)" icon={ClipboardList} />
                        <StatTile label="Pending" value={status.pending ?? 0} />
                        <StatTile label="Approved" value={status.approved ?? 0} />
                        <StatTile label="Declined" value={status.declined ?? 0} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <StatTile
                            label="Sent to export"
                            value={data?.sent_to_export ?? 0}
                            hint={`${data?.approved_not_sent ?? 0} approved not sent`}
                            icon={FileDown}
                        />
                        <StatTile
                            label="Avg. review lag"
                            value={formatHours(data?.avg_approval_hours)}
                            hint={data?.median_approval_hours != null ? `Median ${formatHours(data.median_approval_hours)}` : 'Submitted → approved'}
                            icon={Clock}
                        />
                        <StatTile
                            label="Avg. completion"
                            value={data?.avg_completion_pct != null ? `${data.avg_completion_pct}%` : '—'}
                        />
                        <StatTile
                            label="Photos"
                            value={data?.photo_total ?? 0}
                            icon={Camera}
                        />
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Package status</CardTitle>
                            <CardDescription>Pending, approved, declined, and sent-to-export in this range.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <StackBar segments={[
                                { label: 'Pending', value: status.pending || 0, color: '#3b82f6' },
                                { label: 'Approved', value: status.approved || 0, color: EMERALD },
                                { label: 'Declined', value: status.declined || 0, color: RED },
                            ]} />
                            <StackBar segments={[
                                { label: 'Sent to export', value: data?.sent_to_export || 0, color: BRAND },
                                { label: 'Approved, not sent', value: data?.approved_not_sent || 0, color: '#94a3b8' },
                            ]} />
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Submissions over time</CardTitle>
                            <CardDescription>
                                {grain === 'day' ? 'Each bar is one Singapore calendar day.' : grain === 'week' ? 'Weekly totals (Mon–Sun).' : 'Monthly totals.'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {!hasVolume ? (
                                <EmptyNote>No submitted packages in this range. Drafts (before-only) stay hidden, same as Packages.</EmptyNote>
                            ) : (
                                <ChartFrame native={native}>
                                    <BarChart data={chartDays} margin={{ top: 8, right: 8, left: 0, bottom: native ? 8 : 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <XAxis
                                            dataKey="date"
                                            {...axisProps}
                                            interval="preserveStartEnd"
                                            minTickGap={native ? 28 : 16}
                                            tickFormatter={(v) => chartDateLabel(v, grain)}
                                        />
                                        <YAxis allowDecimals={false} width={native ? 28 : 36} {...axisProps} />
                                        <Tooltip
                                            contentStyle={tooltipStyle()}
                                            labelFormatter={(v) => formatDate(v) || v}
                                        />
                                        <Legend />
                                        <Bar dataKey="pending" name="Pending" stackId="a" fill="#3b82f6" />
                                        <Bar dataKey="approved" name="Approved" stackId="a" fill={EMERALD} />
                                        <Bar dataKey="declined" name="Declined" stackId="a" fill={RED} radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ChartFrame>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Review lag</CardTitle>
                            <CardDescription>Time from first submission to approval. {data?.p90_approval_hours != null ? `90th percentile ${formatHours(data.p90_approval_hours)}.` : ''}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {(data?.review_lag_buckets || []).every((row) => !row.count) ? (
                                <EmptyNote>No approved packages with a review timestamp in this range.</EmptyNote>
                            ) : (
                                <ChartFrame native={native} height={native ? 240 : 260}>
                                    <BarChart data={data.review_lag_buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <XAxis dataKey="bucket" {...axisProps} />
                                        <YAxis allowDecimals={false} width={native ? 28 : 36} {...axisProps} />
                                        <Tooltip contentStyle={tooltipStyle()} />
                                        <Bar dataKey="count" name="Packages" fill={NAVY} radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ChartFrame>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="sites" className="space-y-5">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4 text-brand" /> Volume by site</CardTitle>
                            <CardDescription>Active sites stay listed even at zero, so nothing disappears from the table.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {siteChart.length === 0 ? (
                                <EmptyNote>No site volume in this range.</EmptyNote>
                            ) : (
                                <ChartFrame native={native} rows={siteChart.length}>
                                    <BarChart data={siteChart} layout="vertical" margin={{ left: 4, right: 16, top: 8, bottom: 8 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                        <XAxis type="number" allowDecimals={false} {...axisProps} />
                                        <YAxis
                                            type="category"
                                            dataKey="site_name"
                                            width={native ? 78 : 120}
                                            tick={{ fontSize: native ? 10 : 12, fill: '#334155' }}
                                            tickFormatter={(v) => (v && v.length > 16 ? `${v.slice(0, 14)}…` : v)}
                                        />
                                        <Tooltip contentStyle={tooltipStyle()} />
                                        <Bar dataKey="count" name="Packages" fill={BRAND} radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ChartFrame>
                            )}
                            {(data?.by_site || []).length > 0 && (
                                <div className="mt-4">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Site</TableHead>
                                                <TableHead className="text-right">Pkgs</TableHead>
                                                <TableHead className="text-right">Photos</TableHead>
                                                <TableHead className="hidden text-right sm:table-cell">Pending</TableHead>
                                                <TableHead className="hidden text-right sm:table-cell">Approved</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {data.by_site.map((row) => (
                                                <TableRow key={row.site_id || row.site_name}>
                                                    <TableCell className="font-medium text-navy">
                                                        {row.site_name}
                                                        {row.is_active === false ? <span className="ml-1 text-xs text-muted-foreground">(inactive)</span> : null}
                                                    </TableCell>
                                                    <TableCell className="text-right">{row.count}</TableCell>
                                                    <TableCell className="text-right">{row.photos}</TableCell>
                                                    <TableCell className="hidden text-right sm:table-cell">{row.pending}</TableCell>
                                                    <TableCell className="hidden text-right sm:table-cell">{row.approved}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Volume by employee/technician</CardTitle>
                            <CardDescription>Submitted packages and photos in this range.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {workerChart.length === 0 ? (
                                <EmptyNote>No employee volume in this range.</EmptyNote>
                            ) : (
                                <>
                                    <ChartFrame native={native} rows={workerChart.length}>
                                        <BarChart data={workerChart} layout="vertical" margin={{ left: 4, right: 16, top: 8, bottom: 8 }}>
                                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                            <XAxis type="number" allowDecimals={false} {...axisProps} />
                                            <YAxis
                                                type="category"
                                                dataKey="name"
                                                width={native ? 78 : 120}
                                                tick={{ fontSize: native ? 10 : 12, fill: '#334155' }}
                                                tickFormatter={(v) => (v && v.length > 16 ? `${v.slice(0, 14)}…` : v)}
                                            />
                                            <Tooltip contentStyle={tooltipStyle()} />
                                            <Bar dataKey="count" name="Packages" fill={NAVY} radius={[0, 4, 4, 0]} />
                                        </BarChart>
                                    </ChartFrame>
                                    <div className="mt-4">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Name</TableHead>
                                                    <TableHead className="text-right">Pkgs</TableHead>
                                                    <TableHead className="text-right">Photos</TableHead>
                                                    <TableHead className="hidden text-right sm:table-cell">Approved</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {(data.by_worker || []).map((row) => (
                                                    <TableRow key={row.worker_id || row.name}>
                                                        <TableCell className="font-medium text-navy">
                                                            {row.name}
                                                            {row.employee_code ? <span className="ml-1 text-xs text-muted-foreground">{row.employee_code}</span> : null}
                                                        </TableCell>
                                                        <TableCell className="text-right">{row.count}</TableCell>
                                                        <TableCell className="text-right">{row.photos}</TableCell>
                                                        <TableCell className="hidden text-right sm:table-cell">{row.approved}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="photos" className="space-y-5">
                    <Card>
                        <CardHeader>
                            <CardTitle>Photos by stage</CardTitle>
                            <CardDescription>Before, during, after, and completion photos on submitted packages.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {Number(data?.photo_total || 0) === 0 ? (
                                <EmptyNote>No photos in this range.</EmptyNote>
                            ) : (
                                <ChartFrame native={native} height={native ? 260 : 300}>
                                    <BarChart
                                        data={(data.photos_by_stage || []).map((row) => ({
                                            ...row,
                                            label: STAGE_LABEL[row.stage] || row.stage,
                                            fill: STAGE_COLOR[row.stage] || NAVY,
                                        }))}
                                        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <XAxis dataKey="label" {...axisProps} />
                                        <YAxis allowDecimals={false} width={native ? 28 : 36} {...axisProps} />
                                        <Tooltip contentStyle={tooltipStyle()} />
                                        <Bar dataKey="count" name="Photos" radius={[4, 4, 0, 0]}>
                                            {(data.photos_by_stage || []).map((row) => (
                                                <Cell key={row.stage} fill={STAGE_COLOR[row.stage] || NAVY} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ChartFrame>
                            )}
                            <div className="mt-3">
                                <StackBar
                                    segments={(data?.photos_by_stage || []).map((row) => ({
                                        label: STAGE_LABEL[row.stage] || row.stage,
                                        value: row.count,
                                        color: STAGE_COLOR[row.stage] || NAVY,
                                    }))}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Completion % distribution</CardTitle>
                            <CardDescription>Stored slider value when set; otherwise inferred from before/during/after.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {!hasVolume ? (
                                <EmptyNote>No packages to chart.</EmptyNote>
                            ) : (
                                <ChartFrame native={native} height={native ? 240 : 280}>
                                    <BarChart data={data.completion_distribution || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <XAxis dataKey="bucket" {...axisProps} />
                                        <YAxis allowDecimals={false} width={native ? 28 : 36} {...axisProps} />
                                        <Tooltip contentStyle={tooltipStyle()} />
                                        <Bar dataKey="count" name="Packages" fill={BRAND} radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ChartFrame>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Completions over time</CardTitle>
                            <CardDescription>Standalone completion-stage packages in each period.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {!hasVolume ? (
                                <EmptyNote>No completions in this range.</EmptyNote>
                            ) : (
                                <ChartFrame native={native}>
                                    <BarChart data={chartDays} margin={{ top: 8, right: 8, left: 0, bottom: native ? 8 : 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <XAxis
                                            dataKey="date"
                                            {...axisProps}
                                            interval="preserveStartEnd"
                                            minTickGap={native ? 28 : 16}
                                            tickFormatter={(v) => chartDateLabel(v, grain)}
                                        />
                                        <YAxis allowDecimals={false} width={native ? 28 : 36} {...axisProps} />
                                        <Tooltip contentStyle={tooltipStyle()} labelFormatter={(v) => formatDate(v) || v} />
                                        <Bar dataKey="completions" name="Completion packages" fill={SKY} radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ChartFrame>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="export" className="space-y-5">
                    <Card>
                        <CardHeader>
                            <CardTitle>Export Only downloads</CardTitle>
                            <CardDescription>PDF and Excel downloads logged from the Export Only portal.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {data?.downloads == null ? (
                                <EmptyNote>Download logging is not available on this database yet.</EmptyNote>
                            ) : (
                                <>
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                        <StatTile label="Downloads" value={data.downloads.events ?? 0} />
                                        <StatTile label="Packages" value={data.downloads.packages ?? 0} hint="Unique packages" />
                                        <StatTile label="PDF" value={data.downloads.pdf ?? 0} />
                                        <StatTile label="Excel" value={data.downloads.excel ?? 0} />
                                    </div>
                                    {(data.downloads_by_day || []).some((row) => row.count > 0) ? (
                                        <div className="mt-5">
                                            <ChartFrame native={native} height={native ? 240 : 280}>
                                                <BarChart data={data.downloads_by_day} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                                    <XAxis
                                                        dataKey="date"
                                                        {...axisProps}
                                                        interval="preserveStartEnd"
                                                        minTickGap={native ? 28 : 16}
                                                        tickFormatter={(v) => chartDateLabel(v, grain)}
                                                    />
                                                    <YAxis allowDecimals={false} width={native ? 28 : 36} {...axisProps} />
                                                    <Tooltip contentStyle={tooltipStyle()} labelFormatter={(v) => formatDate(v) || v} />
                                                    <Bar dataKey="count" name="Downloads" fill={BRAND} radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ChartFrame>
                                        </div>
                                    ) : (
                                        <EmptyNote>No Export Only downloads in this range.</EmptyNote>
                                    )}
                                </>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>JSR / claims</CardTitle>
                            <CardDescription>
                                {siteId !== 'all' ? 'JSRs for this site. Claims and invoices stay all-sites (they are not tagged per site).' : 'JSR date, claim date, and invoice date in this range.'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {!jsr.available ? (
                                <EmptyNote>JSR tables are not on this database yet. Run 0037_jsr_claims_client.sql, then refresh.</EmptyNote>
                            ) : (
                                <div className="space-y-5">
                                    <div className="grid grid-cols-3 gap-3">
                                        <StatTile label="JSRs" value={jsr.total ?? 0} />
                                        <StatTile label="Claims" value={jsr.claims_total ?? 0} />
                                        <StatTile label="Invoices" value={jsr.invoices_total ?? 0} />
                                    </div>
                                    {(jsr.by_status || []).length === 0 ? (
                                        <EmptyNote>No JSRs in this range.</EmptyNote>
                                    ) : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>JSR status</TableHead>
                                                    <TableHead className="text-right">Count</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {jsr.by_status.map((row) => (
                                                    <TableRow key={row.status}>
                                                        <TableCell>{jsrStatusLabel(row.status)}</TableCell>
                                                        <TableCell className="text-right">{row.count}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                    {(jsr.claims_by_status || []).length > 0 && (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Claim status</TableHead>
                                                    <TableHead className="text-right">Count</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {jsr.claims_by_status.map((row) => (
                                                    <TableRow key={row.status}>
                                                        <TableCell>{jsrStatusLabel(row.status)}</TableCell>
                                                        <TableCell className="text-right">{row.count}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
