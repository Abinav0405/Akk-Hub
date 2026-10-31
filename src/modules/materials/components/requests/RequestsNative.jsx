/**
 * Requests in the Capacitor app: search + filter sheet, summary strip, stacked cards and a
 * dedicated details screen with sticky approve / decline. Data and actions come from
 * AdminDashboard.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import {
    CheckCircle2, ChevronRight, Edit2, MapPin, Printer, StickyNote, Trash2, X, XCircle,
} from 'lucide-react';
import { formatDisplayDate, formatDisplayDateTime } from '@/modules/materials/lib/dates';
import { useProgressiveList } from '@/modules/materials/hooks/useProgressiveList';
import {
    activeMetric, formatUnitTotals, hasAnyFilter, METRIC_FACETS, summarize, DEFAULT_FILTERS,
} from './requestModel';
import {
    Avatar, CardSkeleton, ListEmpty, ListError, MaterialChips, MaterialLines, StatusBadge,
    SummaryCards, Timeline, TypeBadge,
} from './RequestParts';
import { FilterButton, FilterSheet, SearchField } from './RequestFilters';
import './requests.css';

const NativeRequestCard = memo(function NativeRequestCard({
    tx, caps, busy, processing, onOpen, onApprove, onDecline,
}) {
    const s = useMemo(() => summarize(tx), [tx]);
    const isPending = tx.approval_status === 'pending';
    const totals = formatUnitTotals(s.units);

    return (
        <article className="rq-ncard" data-status={tx.approval_status}>
            <button
                type="button"
                className="rq-ncard__open"
                onClick={() => onOpen(tx.id)}
                aria-label={`View request from ${tx.worker_name || 'worker'}, ${tx.transaction_type === 'return' ? 'return' : 'take'}, ${tx.approval_status}`}
            >
                <div className="rq-ncard__top">
                    <Avatar name={tx.worker_name} type={tx.transaction_type} />
                    <div className="rq-ncard__who">
                        <h3 className="rq-ncard__name">{tx.worker_name || 'Unknown worker'}</h3>
                        <p className="rq-ncard__id">ID {tx.worker_id || '—'}</p>
                    </div>
                    <StatusBadge status={tx.approval_status} />
                </div>
                <div className="rq-ncard__facts">
                    <TypeBadge type={tx.transaction_type} />
                    <span className="rq-ncard__when">
                        {formatDisplayDate(tx.transaction_date)}{tx.transaction_time ? ` · ${tx.transaction_time}` : ''}
                    </span>
                </div>
                {tx.site_name ? (
                    <p className="rq-ncard__site"><MapPin aria-hidden />{tx.site_name}</p>
                ) : null}
                <div className="rq-ncard__mat">
                    <p className="rq-card__summary">
                        <strong>{s.types} material{s.types === 1 ? '' : 's'}</strong>
                        {totals ? <span>{totals}</span> : null}
                    </p>
                    <MaterialChips tx={tx} max={2} />
                </div>
                <div className="rq-ncard__foot">
                    {s.returnState === 'returned' ? (
                        <span className="rq-flag" data-tone="success"><CheckCircle2 aria-hidden />All returned</span>
                    ) : s.outstandingItems > 0 ? (
                        <span className="rq-flag" data-tone="warning">{s.outstandingItems} outstanding</span>
                    ) : tx.approved_by && !isPending ? (
                        <span className="rq-ncard__by">{tx.approval_status === 'approved' ? 'Approved' : 'Declined'} by {tx.approved_by}</span>
                    ) : <span />}
                    <span className="rq-ncard__more">View details<ChevronRight aria-hidden /></span>
                </div>
            </button>
            {isPending && caps.canProcess ? (
                <div className="rq-ncard__decide">
                    <button type="button" className="rq-btn" data-variant="danger-soft" disabled={processing} onClick={() => onDecline(tx)}>
                        <XCircle aria-hidden />
                        Decline
                    </button>
                    <button type="button" className="rq-btn" data-variant="success" disabled={processing} onClick={() => onApprove(tx)}>
                        {busy ? <span className="n-spinner" aria-hidden /> : <CheckCircle2 aria-hidden />}
                        Approve
                    </button>
                </div>
            ) : null}
        </article>
    );
});

function Group({ title, children, aside }) {
    return (
        <section className="rq-group">
            {title ? (
                <header className="rq-group__head">
                    <h2>{title}</h2>
                    {aside}
                </header>
            ) : null}
            <div className="rq-group__body">{children}</div>
        </section>
    );
}

function InfoRow({ label, children }) {
    return (
        <div className="rq-info">
            <dt>{label}</dt>
            <dd>{children}</dd>
        </div>
    );
}

/** Full-screen request details (app). */
export function RequestDetailScreen({
    tx, approvedReturns, caps, busy, processing, onApprove, onDecline, onEdit, onPrint, onDelete,
}) {
    const s = useMemo(() => summarize(tx), [tx]);
    const isPending = tx.approval_status === 'pending';
    const isTake = tx.transaction_type === 'take';
    const showDecide = isPending && caps.canProcess;

    return (
        <div className="rq rq--native rq-detail" data-has-bar={showDecide ? 'true' : undefined}>
            <div className="rq-hero">
                <Avatar name={tx.worker_name} type={tx.transaction_type} size="lg" />
                <h2 className="rq-hero__name">{tx.worker_name || 'Unknown worker'}</h2>
                <p className="rq-hero__id">Employee ID {tx.worker_id || '—'}</p>
                <div className="rq-hero__badges">
                    <TypeBadge type={tx.transaction_type} />
                    <StatusBadge status={tx.approval_status} />
                </div>
            </div>

            {isTake && tx.approval_status === 'approved' && s.units.some((u) => u.qty) ? (
                <div className="rq-stats" role="group" aria-label="Quantities">
                    <div><span>Issued</span><strong>{formatUnitTotals(s.units) || '0'}</strong></div>
                    <div><span>Returned</span><strong>{formatUnitTotals(s.units, 'returned') || '0'}</strong></div>
                    <div data-tone={s.outstandingItems ? 'warning' : 'success'}>
                        <span>Outstanding</span>
                        <strong>{formatUnitTotals(s.units, 'outstanding') || '0'}</strong>
                    </div>
                </div>
            ) : null}

            <Group title="Request">
                <dl className="rq-infolist">
                    <InfoRow label="Type">{isTake ? 'Take materials to site' : 'Return materials'}</InfoRow>
                    <InfoRow label="Date & time">
                        {formatDisplayDate(tx.transaction_date)}{tx.transaction_time ? ` · ${tx.transaction_time}` : ''}
                    </InfoRow>
                    {tx.site_name ? <InfoRow label="Site">{tx.site_name}</InfoRow> : null}
                    {tx.approved_by && !isPending ? (
                        <InfoRow label={tx.approval_status === 'approved' ? 'Approved by' : 'Declined by'}>
                            {tx.approved_by}
                            {tx.approval_date ? <span className="rq-info__sub">{formatDisplayDateTime(tx.approval_date)}</span> : null}
                        </InfoRow>
                    ) : null}
                </dl>
                {tx.notes ? (
                    <p className="rq-note rq-note--inset"><StickyNote aria-hidden />{tx.notes}</p>
                ) : null}
            </Group>

            <Group
                title={`Materials (${(tx.materials || []).length})`}
                aside={s.outstandingItems ? <span className="rq-flag" data-tone="warning">{s.outstandingItems} outstanding</span> : null}
            >
                <MaterialLines tx={tx} approvedReturns={approvedReturns} />
            </Group>

            <Group title="Activity">
                <Timeline tx={tx} />
            </Group>

            <Group>
                <div className="rq-actionlist">
                    <button type="button" className="rq-actionrow" onClick={() => onPrint(tx)}>
                        <Printer aria-hidden />Print request<ChevronRight aria-hidden className="rq-actionrow__chev" />
                    </button>
                    {showDecide ? (
                        <button type="button" className="rq-actionrow" onClick={() => onEdit(tx)}>
                            <Edit2 aria-hidden />Edit request<ChevronRight aria-hidden className="rq-actionrow__chev" />
                        </button>
                    ) : null}
                    {caps.canDelete ? (
                        <button type="button" className="rq-actionrow" data-tone="danger" onClick={() => onDelete(tx)}>
                            <Trash2 aria-hidden />Delete request
                        </button>
                    ) : null}
                </div>
            </Group>

            {showDecide ? (
                <div className="rq-dockbar">
                    <button type="button" className="rq-btn" data-variant="danger-soft" data-size="lg" disabled={processing} onClick={() => onDecline(tx)}>
                        <XCircle aria-hidden />
                        Decline
                    </button>
                    <button type="button" className="rq-btn" data-variant="success" data-size="lg" disabled={processing} onClick={() => onApprove(tx)}>
                        {busy ? <span className="n-spinner" aria-hidden /> : <CheckCircle2 aria-hidden />}
                        Approve
                    </button>
                </div>
            ) : null}
        </div>
    );
}

export default function RequestsNative({
    transactions,
    filtered,
    metrics,
    sites,
    isLoading,
    loadFailed,
    isFetching,
    onRetry,
    filters,
    setFilters,
    caps,
    processingId,
    processing,
    onOpen,
    onApprove,
    onDecline,
}) {
    const [sheetOpen, setSheetOpen] = useState(false);
    const set = useCallback((patch) => setFilters((f) => ({ ...f, ...patch })), [setFilters]);
    const clearAll = useCallback(() => setFilters({ ...DEFAULT_FILTERS }), [setFilters]);
    const metric = activeMetric(filters);

    const { visible, hasMore, sentinelRef } = useProgressiveList(filtered, {
        pageSize: 25,
        resetKey: JSON.stringify(filters),
    });

    return (
        <section className="rq rq--native" aria-label="Material requests">
            <div className="rq-nsearch">
                <SearchField value={filters.search} onChange={(search) => set({ search })} placeholder="Search requests" />
                <FilterButton filters={filters} onClick={() => setSheetOpen(true)} />
            </div>

            <SummaryCards
                className="rq-metrics--strip"
                keys={['pending', 'outstanding', 'approved', 'returned', 'total']}
                metrics={metrics}
                active={metric}
                loading={isLoading}
                onPick={(key) => set({ ...METRIC_FACETS[key] })}
            />

            {!isLoading && !loadFailed ? (
                <div className="rq-nresults">
                    <p aria-live="polite">
                        {filtered.length.toLocaleString()} request{filtered.length === 1 ? '' : 's'}
                    </p>
                    {hasAnyFilter(filters) ? (
                        <button type="button" className="rq-linkbtn" onClick={clearAll}>
                            <X aria-hidden />Clear filters
                        </button>
                    ) : null}
                </div>
            ) : null}

            {loadFailed ? (
                <ListError onRetry={onRetry} retrying={isFetching} />
            ) : isLoading ? (
                <CardSkeleton count={4} />
            ) : !filtered.length ? (
                <ListEmpty filtered={transactions.length > 0} onClear={clearAll} />
            ) : (
                <div className="rq-list">
                    {visible.map((tx) => (
                        <NativeRequestCard
                            key={tx.id}
                            tx={tx}
                            caps={caps}
                            busy={processingId === tx.id}
                            processing={processing}
                            onOpen={onOpen}
                            onApprove={onApprove}
                            onDecline={onDecline}
                        />
                    ))}
                    {hasMore ? (
                        <div ref={sentinelRef} className="n-more"><span className="n-spinner" aria-hidden /></div>
                    ) : null}
                </div>
            )}

            <FilterSheet
                open={sheetOpen}
                onClose={() => setSheetOpen(false)}
                filters={filters}
                set={set}
                sites={sites}
                resultCount={filtered.length}
            />
        </section>
    );
}
