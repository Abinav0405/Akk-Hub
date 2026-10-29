import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Printer, Images, Check, ThumbsDown, Trash2, Sheet, Files, ShieldCheck, FileDown, Undo2, FileText, CalendarDays, MapPin, UserRound, BadgeCheck, XCircle, LayoutGrid, List as ListIcon, Users } from 'lucide-react';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import PackageDetailDialog from '@/modules/progress/components/PackageDetailDialog';
import MoreMenu from '@/modules/progress/components/MoreMenu';
import DeclineReasonDialog from '@/modules/progress/components/DeclineReasonDialog';
import PackageProgressBar from '@/modules/progress/components/PackageProgressBar';
import SearchField, { matchesQuery } from '@/modules/progress/components/SearchField';
import StaffPanelIntro from '@/modules/progress/components/StaffPanelIntro';
import { cn } from '@/modules/progress/lib/utils';
import { packageVerifyHref } from '@/modules/progress/lib/packagePhotoVerify';
import { formatDate, formatDateTime } from '@/modules/progress/lib/dates';
import { formatSectionRef, packageHeading, packageTitle } from '@/modules/progress/lib/sectionLabel';
import { reviewAttribution } from '@/modules/progress/lib/reviewLabel';
import { listAllSites } from '@/modules/progress/lib/sites';
import { listAllPackages, getPackagesHeadTimestamp, approvePackage, deletePackage, reuseUnchangedPackages, sendPackagesToExport, unsendPackagesFromExport, setPackageExporters, listPackageRecipients, recipientsLabel } from '@/modules/progress/lib/staffPackages';
import SendToClientsDialog from '@/modules/progress/components/SendToClientsDialog';
import { managerCanDeletePackagePhotos } from '@/core/auth/progress/managerSession';
import { listApprovedPackages, getExporterPackagesHeadTimestamp } from '@/modules/progress/lib/exporterPackages';
import { useHeartbeat } from '@/modules/progress/hooks/useHeartbeat';
import { friendlyDbError } from '@/modules/progress/lib/networkError';
import { isNativeApp } from '@/core/platform';
import { storageKey } from '@/core/storage'

const PrintPackageDialog = lazy(() => import('@/modules/progress/components/PrintPackageDialog'));

/** Long lists render in pages so the screen stays smooth. */
const LIST_PAGE = 60;
const ExcelExportDialog = lazy(() => import('@/modules/progress/components/ExcelExportDialog'));
const MultiExportDialog = lazy(() => import('@/modules/progress/components/MultiExportDialog'));
const SummaryExportDialog = lazy(() => import('@/modules/progress/components/SummaryExportDialog'));

function DialogChunkFallback({ label }) {
    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30">
            <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow-md">
                <Loader2 className="h-4 w-4 animate-spin" />
                {label}
            </div>
        </div>
    );
}

const STATUS_BADGE = {
    pending: 'bg-amber-50 text-amber-800 border-amber-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    declined: 'bg-red-50 text-red-700 border-red-200',
};

const STAFF_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'approved', label: 'Approved' },
    { id: 'not_sent', label: 'Not sent' },
    { id: 'sent_to_export', label: 'Sent to export' },
    { id: 'declined', label: 'Declined' },
];

const ADMIN_FILTERS = STAFF_FILTERS;

function isSendableToExport(pkg) {
    return pkg?.approval_status === 'approved' && !pkg?.sent_to_export;
}

function isUnsendableFromExport(pkg) {
    return pkg?.approval_status === 'approved' && pkg?.sent_to_export;
}

const EXPORTER_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'not_exported', label: 'Not exported' },
    { id: 'exported', label: 'Exported' },
];

/** Site filter key: the site id; a deleted site falls under its name. */
/** Month filter key: "2026-10" from the package date. */
function monthKey(p) {
    const m = String(p.package_date || '').match(/^(\d{4})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : '';
}

function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    if (!y || !m) return 'No date';
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function siteKey(p) {
    return p.site?.id || `name:${p.site?.name || p.site_name || 'Deleted site'}`;
}

const PackageCard = memo(function PackageCard({
    pkg,
    recipients,
    isAdmin,
    isExporter,
    native,
    approving,
    deleting,
    sending,
    selected,
    onToggleSelect,
    onApprove,
    onDecline,
    onView,
    onPrint,
    onExport,
    onDelete,
    onVerify,
}) {
    const complete = pkg.has_completion || (pkg.has_before && pkg.has_after);
    const reviewLine = reviewAttribution(pkg);
    const exported = Boolean(pkg.exported_by_name);
    // Admin and Manager both see packages passed to Export Only (sent_to_export).
    const alreadySent = !isExporter && pkg.approval_status === 'approved' && pkg.sent_to_export;
    const siteName = pkg.site?.name || pkg.site_name || 'Deleted site';
    const description = String(pkg.description || '').trim();
    // Title: description, section, street name (as on the printed report and export).
    const title = packageTitle(pkg) || siteName;
    // The description's first line is in the title; show it again only if there is more.
    const descFirst = description.split('\n')[0].trim();
    const showDescription = Boolean(description)
        && (description !== descFirst || descFirst.length > 80 || !title.includes(descFirst));
    const actionBtn = cn('h-8 min-h-0 min-w-0 flex-1 basis-0 gap-1 px-1.5 text-xs', native && 'min-h-10');
    return (
        <Card
            className={cn(
                'relative flex min-w-0 flex-col gap-3 overflow-hidden p-4 shadow-xs transition-shadow hover:shadow-sm',
                complete ? 'bg-white' : 'bg-status-incomplete/35 border-status-incomplete-border',
                selected && 'ring-2 ring-brand/40'
            )}
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    {isAdmin && pkg.approval_status === 'approved' && (
                        <input
                            type="checkbox"
                            className={cn('h-4 w-4 shrink-0 accent-slate-900', native && 'h-5 w-5')}
                            checked={selected}
                            disabled={sending}
                            onChange={() => onToggleSelect?.(pkg.id)}
                            aria-label={alreadySent ? 'Select to unsend from export' : 'Select to send to export'}
                        />
                    )}
                    {pkg.display_id ? (
                        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
                            {pkg.display_id}
                        </span>
                    ) : null}
                    <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                        <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{formatDate(pkg.package_date)}</span>
                    </span>
                </div>
                {isExporter ? (
                    <span className={cn(
                        'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                        exported
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-border bg-slate-50 text-slate-500'
                    )}>
                        {exported ? 'Exported' : 'Not exported'}
                    </span>
                ) : alreadySent ? (
                    <span
                        className="flex min-w-0 shrink-0 flex-col items-end"
                        title={isAdmin ? `Clients who can see it: ${recipientsLabel(recipients)}` : undefined}
                    >
                        <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-800">
                            Sent to export
                        </span>
                        {isAdmin ? (
                            <span className="mt-0.5 flex max-w-[11rem] items-center gap-1 text-[10px] text-muted-foreground">
                                <Users className="h-3 w-3 shrink-0" aria-hidden />
                                <span className="truncate">{recipientsLabel(recipients)}</span>
                            </span>
                        ) : null}
                    </span>
                ) : (
                    <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize', STATUS_BADGE[pkg.approval_status])}>
                        {pkg.approval_status}
                    </span>
                )}
            </div>

            <div className="min-w-0 space-y-1">
                <button
                    type="button"
                    onClick={() => onView(pkg)}
                    className="line-clamp-2 break-words text-left text-[15px] font-semibold leading-snug tracking-tight text-slate-900 hover:text-brand hover:underline"
                    title={`Open ${packageHeading(pkg)}`}
                >
                    {title}
                </button>
                <p className="flex min-w-0 items-center gap-1 text-xs text-slate-600">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                    <span className="truncate" title={siteName}>{siteName}</span>
                </p>
            </div>

            {showDescription && (
                <p className="line-clamp-2 text-xs text-slate-600">{description}</p>
            )}

            <div className="space-y-1 border-t border-slate-100 pt-2.5 text-xs text-muted-foreground">
                <p className="flex min-w-0 items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                    <span className="truncate">
                        <span className="font-medium text-slate-700">{pkg.worker?.display_name || 'Deleted employee/technician'}</span>
                        {pkg.worker?.employee_code ? ` · ${pkg.worker.employee_code}` : ''}
                    </span>
                </p>
                {!isExporter && reviewLine && (
                    <p className="flex min-w-0 items-center gap-1.5">
                        {pkg.approval_status === 'declined' ? (
                            <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden />
                        ) : (
                            <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                        )}
                        <span className="truncate">{reviewLine}</span>
                    </p>
                )}
                {isExporter && exported && (
                    <p className="flex min-w-0 items-center gap-1.5">
                        <FileDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        <span className="truncate">
                            Exported by {pkg.exported_by_name}
                            {pkg.exported_at ? ` · ${formatDateTime(pkg.exported_at, { seconds: false })}` : ''}
                            {pkg.exported_format ? ` · ${String(pkg.exported_format).toUpperCase()}` : ''}
                        </span>
                    </p>
                )}
            </div>

            {pkg.approval_status === 'declined' && pkg.decline_reason && (
                <p className="rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700">{pkg.decline_reason}</p>
            )}

            <div className="space-y-2 rounded-lg bg-slate-50/80 p-2.5">
                <div className="flex flex-wrap gap-1 text-[11px]">
                    {['before', 'during', 'after', 'completion'].map((stage) => {
                        const has = pkg[`has_${stage}`];
                        return (
                            <span
                                key={stage}
                                className={cn(
                                    'flex min-w-fit flex-1 basis-0 items-center justify-center gap-0.5 rounded-md border px-1.5 py-1 capitalize',
                                    has ? 'border-brand/30 bg-brand-muted font-medium text-brand' : 'border-dashed border-slate-200 bg-white text-slate-400'
                                )}
                            >
                                {has ? <Check className="h-3 w-3 shrink-0" aria-hidden /> : null}
                                <span>{stage}</span>
                                {pkg[`${stage}_count`] ? <span className="tabular-nums opacity-70">{pkg[`${stage}_count`]}</span> : null}
                            </span>
                        );
                    })}
                </div>
                <PackageProgressBar pkg={pkg} />
            </div>

            {(!isExporter && (pkg.approval_status === 'pending' || pkg.approval_status === 'declined')) && (
                <div className="flex flex-row gap-2 pt-1">
                    <Button
                        size="sm"
                        className={cn('h-8 min-h-0 flex-1 bg-emerald-600 hover:bg-emerald-700', native && 'min-h-11')}
                        disabled={approving}
                        onClick={() => onApprove(pkg)}
                    >
                        {approving ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Check className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Approve
                    </Button>
                    <Button
                        size="sm"
                        variant="destructive"
                        className={cn('h-8 min-h-0 flex-1', native && 'min-h-11')}
                        disabled={approving}
                        onClick={() => onDecline(pkg)}
                    >
                        <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />
                        {pkg.approval_status === 'declined' ? 'Decline again' : 'Decline'}
                    </Button>
                </div>
            )}

            <div className="mt-auto grid min-w-0 grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1.5 pt-1">
                <Button
                    size="sm"
                    title="View photos"
                    className={cn(actionBtn, 'bg-brand text-white hover:bg-brand-hover')}
                    onClick={() => onView(pkg)}
                >
                    <Images className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Photos</span>
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    title="Print package"
                    aria-label="Print package"
                    className={cn(actionBtn, 'text-slate-700 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-800')}
                    onClick={() => onPrint(pkg)}
                >
                    <Printer className="h-3.5 w-3.5 shrink-0 text-slate-800" />
                    <span className="truncate">Print</span>
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    title="Export to Excel"
                    aria-label="Export to Excel"
                    className={cn(actionBtn, 'text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800')}
                    onClick={() => onExport(pkg)}
                >
                    <Sheet className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span className="truncate">Excel</span>
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    title="Verify photos"
                    className={cn(actionBtn, 'text-slate-700 hover:border-brand/35 hover:bg-brand-muted/50 hover:text-brand')}
                    onClick={() => onVerify(pkg)}
                >
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand" />
                    <span className="truncate">Verify</span>
                </Button>
                {isAdmin && !isExporter ? (
                    <Button
                        size="sm"
                        variant="outline"
                        title="Delete package"
                        aria-label="Delete package"
                        className={cn(
                            actionBtn,
                            'border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700'
                        )}
                        disabled={deleting}
                        onClick={() => onDelete(pkg)}
                    >
                        {deleting ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        ) : (
                            <Trash2 className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span className="truncate">Delete</span>
                    </Button>
                ) : null}
            </div>
        </Card>
    );
});

/** Employee filter key: the worker id; a deleted worker falls under their name. */
function workerKey(p) {
    return p.worker?.id || `name:${p.worker?.display_name || 'Deleted employee/technician'}`;
}

function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] || '')).toUpperCase();
}

const VIEW_KEY = storageKey('progress', 'spt_packageView');

function readView(fallback) {
    try {
        const v = localStorage.getItem(VIEW_KEY);
        return v === 'list' || v === 'grid' ? v : fallback;
    } catch {
        return fallback;
    }
}

const STAGE_SHORT = [['before', 'B', 'Before'], ['during', 'D', 'During'], ['after', 'A', 'After'], ['completion', 'C', 'Completion']];

/** One package as a table row (list view). Same actions as the card. */
const PackageRow = memo(function PackageRow({
    pkg,
    recipients,
    isAdmin,
    isExporter,
    approving,
    deleting,
    sending,
    selected,
    onToggleSelect,
    onApprove,
    onDecline,
    onView,
    onPrint,
    onExport,
    onDelete,
    onVerify,
}) {
    const siteName = pkg.site?.name || pkg.site_name || 'Deleted site';
    const title = packageTitle(pkg) || siteName;
    const workerName = pkg.worker?.display_name || 'Deleted employee/technician';
    const status = pkg.approval_status || 'pending';
    const exported = Boolean(pkg.exported_by_name);
    const selectable = isAdmin && status === 'approved';
    // Export column: Admin/Manager (sent_to_export) and Export Only (file export history).
    const showExport = true;
    const reviewedBy = pkg.reviewed_by_name
        ? `${pkg.reviewed_by_name}${pkg.reviewed_by_role === 'manager' ? ' (Manager)' : pkg.reviewed_by_role === 'admin' ? ' (Admin)' : ''}`
        : '';
    const statusStyle = {
        pending: 'bg-amber-50 text-amber-800 ring-amber-200',
        approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
        declined: 'bg-red-50 text-red-700 ring-red-200',
    }[status] || 'bg-slate-50 text-slate-600 ring-slate-200';
    return (
        <tr className={cn('border-b border-border align-top transition-colors hover:bg-slate-50/70', selected && 'bg-brand-muted/30')}>
            {isAdmin ? (
                <td className="w-10 py-3 pl-4 pr-2">
                    {selectable ? (
                        <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 accent-slate-900"
                            checked={selected}
                            disabled={sending}
                            onChange={() => onToggleSelect?.(pkg.id)}
                            aria-label={pkg.sent_to_export ? 'Select to unsend from export' : 'Select to send to export'}
                        />
                    ) : null}
                </td>
            ) : null}
            <td className="min-w-[16rem] py-3 pl-4 pr-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {pkg.display_id ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600">{pkg.display_id}</span>
                    ) : null}
                    <span>{formatDate(pkg.package_date)}</span>
                </div>
                <button
                    type="button"
                    onClick={() => onView(pkg)}
                    className="mt-1 line-clamp-2 text-left text-sm font-semibold leading-snug text-slate-900 hover:text-brand hover:underline"
                    title={`Open ${packageHeading(pkg)}`}
                >
                    {title}
                </button>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="line-clamp-1">{siteName}</span>
                </p>
                {status === 'declined' && pkg.decline_reason ? (
                    <p className="mt-1 line-clamp-2 text-xs text-red-700">Declined: {pkg.decline_reason}</p>
                ) : null}
            </td>
            <td className="py-3 pr-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                        {initials(workerName)}
                    </span>
                    <div className="min-w-0 text-xs">
                        <p className="truncate font-medium text-slate-800">{workerName}</p>
                        {pkg.worker?.employee_code ? <p className="text-muted-foreground">ID {pkg.worker.employee_code}</p> : null}
                    </div>
                </div>
            </td>
            <td className="py-3 pr-3">
                <div className="flex gap-1">
                    {STAGE_SHORT.map(([stage, short, label]) => {
                        const has = pkg[`has_${stage}`];
                        const count = pkg[`${stage}_count`];
                        return (
                            <span
                                key={stage}
                                title={`${label}: ${count || 0} photo${count === 1 ? '' : 's'}`}
                                className={cn(
                                    'flex w-7 flex-col items-center rounded-md py-1 text-[10px] leading-tight',
                                    has ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'
                                )}
                            >
                                <span className="font-medium">{short}</span>
                                <span className="text-xs font-semibold tabular-nums">{count || (has ? '✓' : '–')}</span>
                            </span>
                        );
                    })}
                </div>
            </td>
            {!isExporter ? (
                <td className="py-3 pr-3">
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ring-1', statusStyle)}>
                        {status === 'approved' ? <Check className="h-3 w-3" aria-hidden /> : null}
                        {status}
                    </span>
                    {reviewedBy && status !== 'pending' ? (
                        <p className="mt-1 text-[11px] leading-tight text-muted-foreground">by {reviewedBy}</p>
                    ) : null}
                    {status === 'pending' || status === 'declined' ? (
                        <div className="mt-1.5 flex gap-1">
                            <Button
                                size="sm"
                                className="h-7 min-h-0 bg-emerald-600 px-2 text-xs hover:bg-emerald-700"
                                disabled={approving}
                                onClick={() => onApprove(pkg)}
                            >
                                {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Approve'}
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 min-h-0 border-red-200 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                                disabled={approving}
                                onClick={() => onDecline(pkg)}
                            >
                                Decline
                            </Button>
                        </div>
                    ) : null}
                </td>
            ) : null}
            {showExport ? (
                <td className="py-3 pr-3">
                    {isExporter ? (
                        <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-semibold', exported ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                            {exported ? 'Exported' : 'Not exported'}
                        </span>
                    ) : status !== 'approved' ? (
                        <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                        <>
                            <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-semibold', pkg.sent_to_export ? 'bg-slate-100 text-slate-800' : 'bg-amber-50 text-amber-800')}>
                                {pkg.sent_to_export ? 'Sent to export' : 'Not sent'}
                            </span>
                            {isAdmin && pkg.sent_to_export ? (
                                <p className="mt-1 flex items-center gap-1 text-[11px] leading-tight text-muted-foreground" title="Clients who can see this package">
                                    <Users className="h-3 w-3 shrink-0" aria-hidden />
                                    <span className="line-clamp-2">{recipientsLabel(recipients)}</span>
                                </p>
                            ) : null}
                        </>
                    )}
                </td>
            ) : null}
            <td className="py-3 pl-2 pr-4">
                <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="outline" className="h-8 min-h-0 gap-1 px-2.5 text-xs" onClick={() => onView(pkg)}>
                        <Images className="h-3.5 w-3.5" /> View
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 w-8 min-h-0 p-0" title="Print" aria-label="Print package" onClick={() => onPrint(pkg)}>
                        <Printer className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 w-8 min-h-0 p-0" title="Excel" aria-label="Export to Excel" onClick={() => onExport(pkg)}>
                        <Sheet className="h-3.5 w-3.5" />
                    </Button>
                    <MoreMenu
                        items={[
                            { label: 'Verify photos', icon: <ShieldCheck className="h-4 w-4" />, onClick: () => onVerify(pkg) },
                            isAdmin && !isExporter
                                ? { label: deleting ? 'Deleting…' : 'Delete package', icon: <Trash2 className="h-4 w-4" />, danger: true, disabled: deleting, onClick: () => onDelete(pkg) }
                                : null,
                        ]}
                    />
                </div>
            </td>
        </tr>
    );
});

export default function PackageReviewBoard({ role }) {
    const isAdmin = role === 'admin';
    const isExporter = role === 'exporter';
    const native = isNativeApp();
    const navigate = useNavigate();
    const fromPage = isExporter ? 'ExporterDashboard' : isAdmin ? 'AdminDashboard' : 'ManagerDashboard';
    const filters = isExporter ? EXPORTER_FILTERS : isAdmin ? ADMIN_FILTERS : STAFF_FILTERS;
    const [packages, setPackages] = useState(null);
    const [sites, setSites] = useState([]);
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [siteFilter, setSiteFilter] = useState('all');
    const [monthFilter, setMonthFilter] = useState('all');
    const [workerFilter, setWorkerFilter] = useState('all');
    // List (table) or grid (cards). Remembered per browser; phones always get cards.
    const [view, setView] = useState(() => readView(native ? 'grid' : 'list'));
    const [pkgLimit, setPkgLimit] = useState(LIST_PAGE);
    const chooseView = (next) => {
        setView(next);
        try { localStorage.setItem(VIEW_KEY, next); } catch { /* ignore */ }
    };
    const [selected, setSelected] = useState(null);
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [printing, setPrinting] = useState(null);
    const [exporting, setExporting] = useState(null);
    const [multiExport, setMultiExport] = useState(false);
    const [summaryExport, setSummaryExport] = useState(null);
    const [declining, setDeclining] = useState(null);
    const [approvingId, setApprovingId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    const [sending, setSending] = useState(false);
    const [unsending, setUnsending] = useState(false);
    const [clientDialog, setClientDialog] = useState(null); // 'send' | 'change'
    const [recipients, setRecipients] = useState(() => new Map()); // packageId → chosen clients (missing = everyone)
    const queueBusy = sending || unsending;

    const refresh = useCallback(() => {
        const loader = isExporter ? listApprovedPackages : listAllPackages;
        loader()
            .then((next) => {
                setPackages((prev) => reuseUnchangedPackages(prev, next));
            })
            .catch((e) => {
                console.error(e);
                toast.error(friendlyDbError(e, 'Could not load packages'));
                setPackages([]);
            });
        // Admin only: which clients each sent package is limited to. Not fatal if it fails.
        if (isAdmin) listPackageRecipients().then(setRecipients).catch(() => setRecipients(new Map()));
    }, [isExporter, isAdmin]);

    useEffect(() => {
        refresh();
        if (!isExporter) listAllSites().then(setSites).catch(() => {});
    }, [refresh, isExporter]);

    // Smart heartbeat: poll a single cheap timestamp every 5s and only refetch
    // the full board when it actually moved (e.g. an employee/technician just submitted) —
    // mirrors AKK-Timesheet-Manager-main's shift-list polling. Paused while a
    // dialog is open so it doesn't yank the board out from under an edit.
    useHeartbeat({
        intervalMs: 5000,
        paused: !!selected || !!printing || !!exporting || multiExport || !!summaryExport || !!declining || !!deletingId || queueBusy,
        queryFn: isExporter ? getExporterPackagesHeadTimestamp : getPackagesHeadTimestamp,
        onChange: refresh,
    });

    const handleApprove = useCallback(async (pkg) => {
        setApprovingId(pkg.id);
        try {
            await approvePackage(pkg.id);
            toast.success('Package approved');
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not approve'));
        } finally {
            setApprovingId(null);
        }
    }, [refresh]);

    const handleVerify = useCallback((pkg) => {
        navigate(packageVerifyHref(pkg, fromPage));
    }, [navigate, fromPage]);

    const handleDelete = useCallback(async (pkg) => {
        const label = packageHeading(pkg);
        if (!window.confirm(`Permanently delete this package (${label}) and all its photos? This cannot be undone.`)) {
            return;
        }
        setDeletingId(pkg.id);
        try {
            await deletePackage(pkg.id);
            toast.success('Package deleted');
            setSelected((cur) => (cur?.id === pkg.id ? null : cur));
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not delete package'));
        } finally {
            setDeletingId(null);
        }
    }, [refresh]);

    // Keep every open dialog in sync with a fresh package list — and close (rather than
    // silently keep operating on) any dialog whose package disappeared elsewhere (e.g.
    // another admin deleted it while this one had it open).
    useEffect(() => {
        if (!packages) return;
        if (selected) {
            const updated = packages.find((p) => p.id === selected.id);
            if (!updated) {
                setSelected(null);
                toast.error('That package was removed');
            } else if (updated !== selected) {
                setSelected(updated);
            }
        }
        if (printing && !packages.some((p) => p.id === printing.id)) {
            setPrinting(null);
            toast.error('That package was removed');
        }
        if (exporting && !packages.some((p) => p.id === exporting.id)) {
            setExporting(null);
            toast.error('That package was removed');
        }
        if (declining && !packages.some((p) => p.id === declining.id)) {
            setDeclining(null);
            toast.error('That package was removed');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [packages]);

    // Sites that have packages, A–Z.
    const siteChoices = useMemo(() => {
        const seen = new Map();
        (packages || []).forEach((p) => {
            const key = siteKey(p);
            const entry = seen.get(key) || { key, name: p.site?.name || p.site_name || 'Deleted site', count: 0 };
            entry.count += 1;
            seen.set(key, entry);
        });
        return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [packages]);

    useEffect(() => {
        if (siteFilter !== 'all' && packages && !siteChoices.some((s) => s.key === siteFilter)) setSiteFilter('all');
    }, [siteChoices, siteFilter, packages]);

    // Months that have packages (for the chosen site), newest first.
    const monthChoices = useMemo(() => {
        const counts = new Map();
        (packages || []).forEach((p) => {
            if (siteFilter !== 'all' && siteKey(p) !== siteFilter) return;
            const key = monthKey(p);
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        return [...counts.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([key, count]) => ({ key, label: monthLabel(key), count }));
    }, [packages, siteFilter]);

    useEffect(() => {
        if (monthFilter !== 'all' && packages && !monthChoices.some((m) => m.key === monthFilter)) setMonthFilter('all');
    }, [monthChoices, monthFilter, packages]);

    // Employees who have packages for the chosen site + month, A–Z.
    const workerChoices = useMemo(() => {
        const seen = new Map();
        (packages || []).forEach((p) => {
            if (siteFilter !== 'all' && siteKey(p) !== siteFilter) return;
            if (monthFilter !== 'all' && monthKey(p) !== monthFilter) return;
            const key = workerKey(p);
            const entry = seen.get(key) || { key, name: p.worker?.display_name || 'Deleted employee/technician', count: 0 };
            entry.count += 1;
            seen.set(key, entry);
        });
        return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [packages, siteFilter, monthFilter]);

    useEffect(() => {
        if (workerFilter !== 'all' && packages && !workerChoices.some((w) => w.key === workerFilter)) setWorkerFilter('all');
    }, [workerChoices, workerFilter, packages]);

    const sitePackages = useMemo(
        () => (packages || []).filter((p) => (
            (siteFilter === 'all' || siteKey(p) === siteFilter)
            && (monthFilter === 'all' || monthKey(p) === monthFilter)
            && (workerFilter === 'all' || workerKey(p) === workerFilter)
        )),
        [packages, siteFilter, monthFilter, workerFilter]
    );

    const counts = useMemo(() => {
        if (isExporter) {
            return sitePackages.reduce(
                (acc, p) => {
                    acc.all += 1;
                    if (p.exported_by_name) acc.exported += 1;
                    else acc.not_exported += 1;
                    return acc;
                },
                { all: 0, exported: 0, not_exported: 0 }
            );
        }
        return sitePackages.reduce(
            (acc, p) => {
                acc.all += 1;
                acc[p.approval_status] = (acc[p.approval_status] || 0) + 1;
                if (p.approval_status === 'approved' && p.sent_to_export) acc.sent_to_export += 1;
                if (p.approval_status === 'approved' && !p.sent_to_export) acc.not_sent += 1;
                return acc;
            },
            { all: 0, pending: 0, approved: 0, declined: 0, not_sent: 0, sent_to_export: 0 }
        );
    }, [sitePackages, isExporter]);

    const filtered = useMemo(() => {
        const byFilter = sitePackages.filter((p) => {
            if (filter === 'all') return true;
            if (isExporter) {
                if (filter === 'exported') return Boolean(p.exported_by_name);
                if (filter === 'not_exported') return !p.exported_by_name;
                return true;
            }
            if (filter === 'not_sent') return isSendableToExport(p);
            if (filter === 'sent_to_export') return p.approval_status === 'approved' && p.sent_to_export;
            return p.approval_status === filter;
        });
        return byFilter.filter((p) =>
            matchesQuery(
                [
                    p.display_id,
                    p.site?.name,
                    p.site_name,
                    p.section_label,
                    p.lcb_id,
                    formatSectionRef(p.section_label, p.lcb_id),
                    packageHeading(p),
                    p.description,
                    p.worker?.display_name,
                    p.worker?.employee_code,
                    formatDate(p.package_date),
                    ...(isExporter ? [] : [reviewAttribution(p), p.reviewed_by_name]),
                    p.exported_by_name,
                ],
                search
            )
        );
    }, [sitePackages, filter, search, isExporter]);

    const searchActive = Boolean(search.trim()) || siteFilter !== 'all' || monthFilter !== 'all' || workerFilter !== 'all';

    const sendableVisible = useMemo(
        () => (isAdmin ? filtered.filter(isSendableToExport) : []),
        [filtered, isAdmin]
    );

    const unsendableVisible = useMemo(
        () => (isAdmin ? filtered.filter(isUnsendableFromExport) : []),
        [filtered, isAdmin]
    );

    const selectableVisible = useMemo(
        () => (isAdmin ? filtered.filter((p) => p.approval_status === 'approved') : []),
        [filtered, isAdmin]
    );

    useEffect(() => {
        if (!isAdmin) return;
        const allow = new Set(selectableVisible.map((p) => p.id));
        setSelectedIds((prev) => {
            let changed = false;
            const next = new Set();
            prev.forEach((id) => {
                if (allow.has(id)) next.add(id);
                else changed = true;
            });
            if (!changed && next.size === prev.size) return prev;
            return next;
        });
    }, [isAdmin, selectableVisible]);

    const toggleSelect = useCallback((id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
                return next;
            }
            if (!selectableVisible.some((p) => p.id === id)) return prev;
            next.add(id);
            return next;
        });
    }, [selectableVisible]);

    const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((p) => selectedIds.has(p.id));
    const selectedSendableIds = sendableVisible.filter((p) => selectedIds.has(p.id)).map((p) => p.id);
    const selectedUnsendableIds = unsendableVisible.filter((p) => selectedIds.has(p.id)).map((p) => p.id);
    const summaryPackages = isAdmin && selectedIds.size > 0
        ? filtered.filter((p) => selectedIds.has(p.id))
        : filtered;

    const toggleSelectVisible = () => {
        if (allVisibleSelected) {
            setSelectedIds(new Set());
            return;
        }
        setSelectedIds(new Set(selectableVisible.map((p) => p.id)));
    };

    const handleSendSelected = () => {
        if (!selectedSendableIds.length) {
            toast.error('Select at least one approved package that has not been sent');
            return;
        }
        setClientDialog('send');
    };

    const handleChangeSelected = () => {
        if (!selectedUnsendableIds.length) {
            toast.error('Select at least one package that has already been sent');
            return;
        }
        setClientDialog('change');
    };

    // If every selected sent package has the same chosen clients, start the dialog from them.
    const changeInitialIds = useMemo(() => {
        const sets = selectedUnsendableIds.map((id) => (recipients.get(String(id)) || []).filter((e) => e.active).map((e) => e.id).sort().join(','));
        if (!sets.length || sets.some((x) => x !== sets[0]) || !sets[0]) return [];
        return sets[0].split(',');
    }, [selectedUnsendableIds, recipients]);

    const confirmClientDialog = async (exporterIds, exporterNames) => {
        const changing = clientDialog === 'change';
        const ids = changing ? selectedUnsendableIds : selectedSendableIds;
        setSending(true);
        try {
            const count = changing
                ? await setPackageExporters(ids, exporterIds, exporterNames)
                : await sendPackagesToExport(ids, exporterIds, exporterNames);
            const to = exporterIds.length ? (exporterNames.length === 1 ? exporterNames[0] : `${exporterNames.length} accounts`) : 'every Export Only account';
            toast.success(
                changing
                    ? `Updated ${count} package${count === 1 ? '' : 's'} — now visible to ${to}`
                    : `Sent ${count} package${count === 1 ? '' : 's'} to ${to}`
            );
            setClientDialog(null);
            setSelectedIds(new Set());
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not send packages to export'));
        } finally {
            setSending(false);
        }
    };

    const handleUnsendSelected = async () => {
        const ids = selectedUnsendableIds;
        if (!ids.length) {
            toast.error('Select at least one package that has already been sent');
            return;
        }
        if (!window.confirm('These packages will disappear from Export Only until sent again')) {
            return;
        }
        setUnsending(true);
        try {
            const count = await unsendPackagesFromExport(ids);
            toast.success(count === 1 ? 'Unsent 1 package from export' : `Unsent ${count} packages from export`);
            setSelectedIds(new Set());
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not unsend packages from export'));
        } finally {
            setUnsending(false);
        }
    };

    const summaryCards = !isExporter ? [
        {
            id: 'all',
            label: 'All packages',
            value: counts.all || 0,
            hint: 'total',
            tone: '',
        },
        {
            id: 'pending',
            label: 'Pending approval',
            value: counts.pending || 0,
            hint: (counts.pending || 0) ? 'needs action' : 'all clear',
            tone: (counts.pending || 0) ? 'text-amber-700' : '',
        },
        ...(isAdmin
            ? [{
                id: 'not_sent',
                label: 'Not sent to export',
                value: counts.not_sent || 0,
                hint: (counts.not_sent || 0) ? 'needs action' : 'all clear',
                tone: (counts.not_sent || 0) ? 'text-brand' : '',
            }]
            : [{
                id: 'approved',
                label: 'Approved',
                value: counts.approved || 0,
                hint: 'done',
                tone: 'text-emerald-700',
            }]),
        {
            id: 'sent_to_export',
            label: 'Sent to export',
            value: counts.sent_to_export || 0,
            hint: 'with Export Only',
            tone: 'text-slate-800',
        },
        {
            id: 'declined',
            label: 'Declined',
            value: counts.declined || 0,
            hint: (counts.declined || 0) ? 'review' : 'none',
            tone: (counts.declined || 0) ? 'text-red-700' : '',
        },
    ] : null;

    return (
        <div className="space-y-5">
            {!isExporter ? (
                <StaffPanelIntro
                    title="Site packages"
                    description="Review photo packages from site, approve them and send to export."
                    actions={
                        <>
                            <div className="relative">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className={cn('h-10 min-h-0', native && 'min-h-11')}
                                    disabled={!packages || filtered.length === 0}
                                    onClick={() => setSummaryExport('pdf')}
                                >
                                    <FileText className="mr-1.5 h-4 w-4" />
                                    Summary report
                                </Button>
                            </div>
                            {isAdmin ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    className={cn('h-10 min-h-0', native && 'min-h-11')}
                                    disabled={queueBusy || selectedSendableIds.length === 0}
                                    onClick={handleSendSelected}
                                >
                                    {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileDown className="mr-1.5 h-4 w-4" />}
                                    Send to clients…
                                </Button>
                            ) : null}
                        </>
                    }
                />
            ) : null}

            {summaryCards ? (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
                    {summaryCards.map((card) => {
                        const active = filter === card.id;
                        return (
                            <button
                                key={card.id}
                                type="button"
                                onClick={() => setFilter(card.id)}
                                aria-pressed={active}
                                className={cn(
                                    'rounded-xl border bg-white p-3.5 text-left transition-all hover:shadow-sm',
                                    active ? 'border-brand ring-1 ring-brand' : 'border-border'
                                )}
                            >
                                <p className="text-xs font-medium text-slate-600">{card.label}</p>
                                <p className="mt-1 flex items-baseline gap-1.5">
                                    <span className={cn('text-2xl font-semibold tabular-nums', card.tone)}>{card.value}</span>
                                    <span className="text-xs text-muted-foreground">{card.hint}</span>
                                </p>
                            </button>
                        );
                    })}
                </div>
            ) : null}

            <div className="space-y-3">
            <div className="flex flex-col gap-3">
                {isExporter ? (
                <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {filters.map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            onClick={() => setFilter(f.id)}
                            className={cn(
                                'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                                native && 'min-h-11 px-4',
                                filter === f.id
                                    ? 'border-slate-900 bg-slate-900 text-white'
                                    : 'border-border bg-white text-slate-600 hover:border-slate-300'
                            )}
                        >
                            {f.label}
                            {packages && (
                                <span className={cn('ml-1.5 text-xs', filter === f.id ? 'text-white/70' : 'text-slate-400')}>
                                    {counts[f.id] || 0}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                ) : null}
                <div className="flex w-full flex-col gap-2 rounded-xl border border-border bg-white p-3 sm:flex-row sm:flex-wrap sm:items-center">
                    <SearchField
                        id="package-search"
                        value={search}
                        onChange={setSearch}
                        placeholder="Search by package ID, site, title or employee"
                        native={native}
                        className="w-full sm:min-w-[16rem] sm:flex-1"
                    />
                    <select
                        aria-label="Filter by site"
                        value={siteFilter}
                        onChange={(e) => setSiteFilter(e.target.value)}
                        className={cn(
                            'h-10 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm text-slate-700 sm:w-48 lg:w-56',
                            siteFilter !== 'all' && 'border-brand/50 bg-brand-muted/40 font-medium text-brand',
                            native && 'h-11'
                        )}
                    >
                        <option value="all">All sites</option>
                        {siteChoices.map((s) => (
                            <option key={s.key} value={s.key}>{s.name} ({s.count})</option>
                        ))}
                    </select>
                    <select
                        aria-label="Filter by month"
                        value={monthFilter}
                        onChange={(e) => setMonthFilter(e.target.value)}
                        className={cn(
                            'h-10 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm text-slate-700 sm:w-44',
                            monthFilter !== 'all' && 'border-brand/50 bg-brand-muted/40 font-medium text-brand',
                            native && 'h-11'
                        )}
                    >
                        <option value="all">All months</option>
                        {monthChoices.map((m) => (
                            <option key={m.key || 'none'} value={m.key}>{m.label} ({m.count})</option>
                        ))}
                    </select>
                    <select
                        aria-label="Filter by employee"
                        value={workerFilter}
                        onChange={(e) => setWorkerFilter(e.target.value)}
                        className={cn(
                            'h-10 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm text-slate-700 sm:w-44',
                            workerFilter !== 'all' && 'border-brand/50 bg-brand-muted/40 font-medium text-brand',
                            native && 'h-11'
                        )}
                    >
                        <option value="all">All employees</option>
                        {workerChoices.map((w) => (
                            <option key={w.key} value={w.key}>{w.name} ({w.count})</option>
                        ))}
                    </select>
                    <div className="hidden shrink-0 rounded-lg border border-input bg-white p-0.5 md:flex" role="group" aria-label="Layout">
                        <button
                            type="button"
                            onClick={() => chooseView('list')}
                            aria-pressed={view === 'list'}
                            title="List view"
                            className={cn('flex h-8 w-8 items-center justify-center rounded-md', view === 'list' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}
                        >
                            <ListIcon className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => chooseView('grid')}
                            aria-pressed={view === 'grid'}
                            title="Card view"
                            className={cn('flex h-8 w-8 items-center justify-center rounded-md', view === 'grid' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}
                        >
                            <LayoutGrid className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn('w-full justify-start border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 hover:text-slate-800 sm:w-auto', native && 'min-h-11')}
                    disabled={!packages || filtered.length === 0}
                    onClick={() => setMultiExport(true)}
                >
                    <Files className="mr-1.5 h-4 w-4" />
                    Export multiple
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn('w-full justify-start border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 hover:text-slate-800 sm:w-auto', native && 'min-h-11')}
                    disabled={!packages || filtered.length === 0}
                    onClick={() => setSummaryExport('pdf')}
                >
                    <FileText className="mr-1.5 h-4 w-4" />
                    Summary PDF
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn('w-full justify-start border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900 sm:w-auto', native && 'min-h-11')}
                    disabled={!packages || filtered.length === 0}
                    onClick={() => setSummaryExport('excel')}
                >
                    <Sheet className="mr-1.5 h-4 w-4" />
                    Summary Excel
                </Button>
            </div>
            </div>

            {isAdmin && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                            {selectedIds.size === 0
                                ? 'No packages selected'
                                : selectedIds.size === 1
                                    ? '1 package selected'
                                    : `${selectedIds.size} packages selected`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Send unsent packages, or unsend ones already sent. Approval stays the same.
                        </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Button
                            type="button"
                            variant="outline"
                            className={cn('w-full sm:w-auto', native && 'min-h-11')}
                            disabled={queueBusy || selectableVisible.length === 0}
                            onClick={toggleSelectVisible}
                        >
                            {allVisibleSelected ? 'Clear selection' : 'Select these'}
                        </Button>
                        <Button
                            type="button"
                            className={cn('w-full sm:w-auto', native && 'min-h-11')}
                            disabled={queueBusy || selectedSendableIds.length === 0}
                            onClick={handleSendSelected}
                        >
                            {sending ? (
                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            ) : (
                                <FileDown className="mr-1.5 h-4 w-4" />
                            )}
                            Send selected to…
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className={cn('w-full sm:w-auto', native && 'min-h-11')}
                            disabled={queueBusy || selectedUnsendableIds.length === 0}
                            onClick={handleChangeSelected}
                            title="Change which clients can see the selected, already-sent packages"
                        >
                            <Users className="mr-1.5 h-4 w-4" />
                            Change clients
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className={cn(
                                'w-full border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100 sm:w-auto',
                                native && 'min-h-11'
                            )}
                            disabled={queueBusy || selectedUnsendableIds.length === 0}
                            onClick={handleUnsendSelected}
                        >
                            {unsending ? (
                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            ) : (
                                <Undo2 className="mr-1.5 h-4 w-4" />
                            )}
                            Unsend selected
                        </Button>
                    </div>
                </div>
            )}

            {packages === null ? (
                <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" /> Loading packages…
                </div>
            ) : filtered.length === 0 ? (
                <Card className="border-dashed py-16 text-center">
                    <p className="text-sm font-medium text-slate-900">
                        {searchActive ? 'No packages match this search.' : 'No packages here'}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {searchActive
                            ? 'Try a different site, section ID, or employee name.'
                            : 'Nothing matches this filter yet.'}
                    </p>
                </Card>
            ) : (
                <>
                {view === 'list' ? (
                    <div className="hidden overflow-x-auto rounded-xl border border-border bg-white md:block">
                        <table className="w-full min-w-[56rem] text-left">
                            <thead>
                                <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    {isAdmin ? (
                                        <th className="w-10 py-2.5 pl-4 pr-2">
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 accent-slate-900"
                                                checked={allVisibleSelected && selectableVisible.length > 0}
                                                disabled={queueBusy || selectableVisible.length === 0}
                                                onChange={toggleSelectVisible}
                                                aria-label="Select all approved packages shown"
                                            />
                                        </th>
                                    ) : null}
                                    <th className="py-2.5 pl-4 pr-3">Package</th>
                                    <th className="py-2.5 pr-3">Submitted by</th>
                                    <th className="py-2.5 pr-3">Photos</th>
                                    {!isExporter ? <th className="py-2.5 pr-3">Approval</th> : null}
                                    <th className="py-2.5 pr-3">Export</th>
                                    <th className="py-2.5 pl-2 pr-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.slice(0, pkgLimit).map((p) => (
                                    <PackageRow
                                        key={p.id}
                                        pkg={p}
                                        recipients={recipients.get(String(p.id))}
                                        isAdmin={isAdmin}
                                        isExporter={isExporter}
                                        approving={approvingId === p.id}
                                        deleting={deletingId === p.id}
                                        sending={queueBusy}
                                        selected={selectedIds.has(p.id)}
                                        onToggleSelect={toggleSelect}
                                        onApprove={handleApprove}
                                        onDecline={setDeclining}
                                        onView={setSelected}
                                        onPrint={setPrinting}
                                        onExport={setExporting}
                                        onDelete={handleDelete}
                                        onVerify={handleVerify}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : null}
                <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3', view === 'list' && 'md:hidden')}>
                    {filtered.slice(0, pkgLimit).map((p) => (
                        <PackageCard
                            key={p.id}
                            pkg={p}
                            recipients={recipients.get(String(p.id))}
                            isAdmin={isAdmin}
                            isExporter={isExporter}
                            native={native}
                            approving={approvingId === p.id}
                            deleting={deletingId === p.id}
                            sending={queueBusy}
                            selected={selectedIds.has(p.id)}
                            onToggleSelect={toggleSelect}
                            onApprove={handleApprove}
                            onDecline={setDeclining}
                            onView={setSelected}
                            onPrint={setPrinting}
                            onExport={setExporting}
                            onDelete={handleDelete}
                            onVerify={handleVerify}
                        />
                    ))}
                </div>
                {filtered.length > pkgLimit ? (
                    <button type="button" className="g-btn g-btn--secondary g-btn--block" onClick={() => setPkgLimit((n) => n + LIST_PAGE)}>
                        Show more ({filtered.length - pkgLimit} more)
                    </button>
                ) : null}
                </>
            )}

            {isAdmin ? (
                <SendToClientsDialog
                    open={clientDialog !== null}
                    mode={clientDialog === 'change' ? 'change' : 'send'}
                    count={clientDialog === 'change' ? selectedUnsendableIds.length : selectedSendableIds.length}
                    initialIds={clientDialog === 'change' ? changeInitialIds : []}
                    busy={sending}
                    onConfirm={confirmClientDialog}
                    onClose={() => setClientDialog(null)}
                />
            ) : null}

            {selected && (
                <PackageDetailDialog
                    pkg={selected}
                    isAdmin={isAdmin && !isExporter}
                    // Admin always. A manager needs Admin's permission, and never once the package is approved.
                    canDeletePhotos={
                        !isExporter && (
                            isAdmin
                            || (role === 'manager'
                                && selected.approval_status !== 'approved'
                                && managerCanDeletePackagePhotos())
                        )
                    }
                    photoDeleteNote={
                        role !== 'manager'
                            ? null
                            : selected.approval_status === 'approved'
                                ? "Photos can't be deleted once a package is approved."
                                : !managerCanDeletePackagePhotos()
                                    ? "Deleting photos isn't enabled for your account. Ask Admin to allow it."
                                    : null
                    }
                    sites={isExporter ? [] : sites}
                    readOnly={isExporter}
                    asExporter={isExporter}
                    onClose={() => setSelected(null)}
                    onChanged={refresh}
                />
            )}

            {printing && (
                <Suspense fallback={<DialogChunkFallback label="Loading print…" />}>
                    <PrintPackageDialog
                        pkg={printing}
                        onClose={() => setPrinting(null)}
                        onExported={isExporter ? refresh : undefined}
                        asExporter={isExporter}
                    />
                </Suspense>
            )}

            {exporting && (
                <Suspense fallback={<DialogChunkFallback label="Loading Excel…" />}>
                    <ExcelExportDialog
                        pkg={exporting}
                        onClose={() => setExporting(null)}
                        onExported={isExporter ? refresh : undefined}
                        asExporter={isExporter}
                    />
                </Suspense>
            )}

            {multiExport && (
                <Suspense fallback={<DialogChunkFallback label="Loading export…" />}>
                    <MultiExportDialog
                        packages={filtered}
                        onClose={() => setMultiExport(false)}
                        onExported={isExporter ? refresh : undefined}
                        asExporter={isExporter}
                    />
                </Suspense>
            )}

            {summaryExport && (
                <Suspense fallback={<DialogChunkFallback label="Loading summary…" />}>
                    <SummaryExportDialog
                        packages={summaryPackages}
                        format={summaryExport}
                        onClose={() => setSummaryExport(null)}
                        onExported={isExporter ? refresh : undefined}
                        asExporter={isExporter}
                    />
                </Suspense>
            )}

            {declining && (
                <DeclineReasonDialog
                    pkg={declining}
                    onClose={() => setDeclining(null)}
                    onDeclined={() => {
                        setDeclining(null);
                        refresh();
                    }}
                />
            )}
        </div>
    );
}
