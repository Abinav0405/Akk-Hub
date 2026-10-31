/**
 * Website Requests screen (desktop → phone browser). Data, permissions and actions come from
 * AdminDashboard; this component owns only selection and layout.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
    CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Edit2, FileSpreadsheet,
    Loader2, Printer, Trash2, X, XCircle,
} from 'lucide-react';
import { formatDisplayDateTime } from '@/modules/materials/lib/dates';
import {
    activeMetric, formatUnitTotals, hasAnyFilter, METRIC_FACETS, summarize, DEFAULT_FILTERS,
} from './requestModel';
import {
    Avatar, CardSkeleton, ListEmpty, ListError, MaterialChips, MaterialLines, MetaLine,
    StatusBadge, SummaryCards, Timeline, TypeBadge,
} from './RequestParts';
import { FilterButton, FilterSheet, FilterToolbar, OverflowMenu, SearchField } from './RequestFilters';
import './requests.css';

export const WEB_PAGE_SIZE = 20;

function ApprovalInfo({ tx }) {
    if (tx.approval_status === 'pending') {
        return <p className="rq-approval" data-tone="warning">Waiting for approval</p>;
    }
    const approved = tx.approval_status === 'approved';
    return (
        <p className="rq-approval" data-tone={approved ? 'success' : 'danger'}>
            {approved ? 'Approved' : 'Declined'}
            {tx.approved_by ? <> by <strong>{tx.approved_by}</strong></> : null}
            {tx.approval_date ? <time>{formatDisplayDateTime(tx.approval_date)}</time> : null}
        </p>
    );
}

const WebRequestCard = memo(function WebRequestCard({
    tx, expanded, selected, approvedReturns, caps, busy, processing,
    onToggle, onSelect, onApprove, onDecline, onEdit, onPrint, onDelete,
}) {
    const s = useMemo(() => summarize(tx), [tx]);
    const isPending = tx.approval_status === 'pending';
    const detailId = `rq-detail-${tx.id}`;
    const totals = formatUnitTotals(s.units);
    const outstanding = formatUnitTotals(s.units, 'outstanding');

    return (
        <article
            className="rq-card"
            data-status={tx.approval_status}
            data-selected={selected ? 'true' : undefined}
            data-expanded={expanded ? 'true' : undefined}
        >
            <div className="rq-card__main">
                <label className="rq-check">
                    <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onSelect(tx.id)}
                        aria-label={`Select request from ${tx.worker_name || 'worker'}`}
                    />
                </label>

                <div className="rq-card__identity">
                    <Avatar name={tx.worker_name} type={tx.transaction_type} />
                    <div className="min-w-0">
                        <div className="rq-card__badges">
                            <TypeBadge type={tx.transaction_type} />
                            <StatusBadge status={tx.approval_status} />
                        </div>
                        <h3 className="rq-card__name">
                            <span className="rq-card__nametext">{tx.worker_name || 'Unknown worker'}</span>
                            {tx.worker_id ? <span className="rq-id">ID {tx.worker_id}</span> : null}
                        </h3>
                        <MetaLine tx={tx} />
                    </div>
                </div>

                <div className="rq-card__materials">
                    <p className="rq-card__summary">
                        <strong>{s.types} material{s.types === 1 ? '' : 's'}</strong>
                        {totals ? <span>{tx.transaction_type === 'return' ? 'Returning ' : ''}{totals}</span> : null}
                    </p>
                    <MaterialChips tx={tx} max={3} />
                    {s.returnState === 'returned' ? (
                        <p className="rq-flag" data-tone="success"><CheckCircle2 aria-hidden />All items returned</p>
                    ) : s.outstandingItems > 0 ? (
                        <p className="rq-flag" data-tone="warning">
                            {s.outstandingItems} item{s.outstandingItems === 1 ? '' : 's'} outstanding
                            {outstanding ? <span> · {outstanding}</span> : null}
                        </p>
                    ) : null}
                </div>

                <div className="rq-card__side">
                    {isPending && caps.canProcess ? (
                        <div className="rq-decide">
                            <button
                                type="button"
                                className="rq-btn"
                                data-variant="success"
                                data-size="sm"
                                disabled={processing}
                                onClick={() => onApprove(tx)}
                            >
                                {busy ? <Loader2 className="rq-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}
                                Approve
                            </button>
                            <button
                                type="button"
                                className="rq-btn"
                                data-variant="danger-soft"
                                data-size="sm"
                                disabled={processing}
                                onClick={() => onDecline(tx)}
                            >
                                <XCircle aria-hidden />
                                Decline
                            </button>
                        </div>
                    ) : (
                        <ApprovalInfo tx={tx} />
                    )}
                    <div className="rq-card__tools">
                        {isPending && caps.canProcess ? (
                            <button type="button" className="rq-iconbtn" aria-label="Edit request" title="Edit" onClick={() => onEdit(tx)}>
                                <Edit2 aria-hidden />
                            </button>
                        ) : null}
                        <button type="button" className="rq-iconbtn" aria-label="Print request" title="Print" onClick={() => onPrint(tx)}>
                            <Printer aria-hidden />
                        </button>
                        {caps.canDelete ? (
                            <button type="button" className="rq-iconbtn" data-tone="danger" aria-label="Delete request" title="Delete" onClick={() => onDelete(tx)}>
                                <Trash2 aria-hidden />
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="rq-btn rq-expand"
                            data-variant="ghost"
                            data-size="sm"
                            aria-expanded={expanded}
                            aria-controls={detailId}
                            onClick={() => onToggle(tx.id)}
                        >
                            {expanded ? 'Hide' : 'Details'}
                            <ChevronDown aria-hidden />
                        </button>
                    </div>
                </div>
            </div>

            <div className="rq-card__detailwrap" data-open={expanded ? 'true' : undefined}>
                <div id={detailId} className="rq-card__detail" hidden={!expanded}>
                    {expanded ? (
                        <>
                            <section className="rq-detail__materials" aria-label="Materials">
                                <h4 className="rq-h4">Materials</h4>
                                <MaterialLines tx={tx} approvedReturns={approvedReturns} />
                            </section>
                            <aside className="rq-detail__side">
                                <h4 className="rq-h4">Activity</h4>
                                <Timeline tx={tx} />
                                {tx.notes ? (
                                    <>
                                        <h4 className="rq-h4">Worker note</h4>
                                        <p className="rq-note">{tx.notes}</p>
                                    </>
                                ) : null}
                            </aside>
                        </>
                    ) : null}
                </div>
            </div>
        </article>
    );
});

function Pager({ page, pages, onPage }) {
    if (pages <= 1) return null;
    const nums = [];
    const add = (n) => { if (!nums.includes(n) && n >= 1 && n <= pages) nums.push(n); };
    add(1);
    for (let n = page - 1; n <= page + 1; n++) add(n);
    add(pages);
    nums.sort((a, b) => a - b);
    const out = [];
    nums.forEach((n, i) => {
        if (i && n - nums[i - 1] > 1) out.push(<span key={`gap-${n}`} className="rq-pager__gap" aria-hidden>…</span>);
        out.push(
            <button
                key={n}
                type="button"
                className="rq-pager__num"
                aria-current={n === page ? 'page' : undefined}
                aria-label={`Page ${n}`}
                onClick={() => onPage(n)}
            >
                {n}
            </button>
        );
    });
    return (
        <nav className="rq-pager" aria-label="Pagination">
            <button type="button" className="rq-iconbtn" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
                <ChevronLeft aria-hidden />
            </button>
            {out}
            <button type="button" className="rq-iconbtn" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
                <ChevronRight aria-hidden />
            </button>
        </nav>
    );
}

export default function RequestsWeb({
    transactions,
    filtered,
    metrics,
    sites,
    approvedReturns,
    isLoading,
    loadFailed,
    isFetching,
    onRetry,
    filters,
    setFilters,
    page,
    setPage,
    caps,
    processingId,
    processing,
    onApprove,
    onDecline,
    onEdit,
    onPrint,
    onDelete,
    onExport,
    onPrintSelected,
    onOpenBulkPrint,
    onDeleteAll,
}) {
    const [expanded, setExpanded] = useState(() => new Set());
    const [selected, setSelected] = useState(() => new Set());
    const [sheetOpen, setSheetOpen] = useState(false);

    const set = useCallback((patch) => setFilters((f) => ({ ...f, ...patch })), [setFilters]);
    const clear = useCallback(() => setFilters((f) => ({ ...DEFAULT_FILTERS, search: f.search })), [setFilters]);
    const clearAll = useCallback(() => setFilters({ ...DEFAULT_FILTERS }), [setFilters]);

    const metric = activeMetric(filters);

    const pages = Math.max(1, Math.ceil(filtered.length / WEB_PAGE_SIZE));
    const current = Math.min(page, pages);
    const start = (current - 1) * WEB_PAGE_SIZE;
    const pageRows = filtered.slice(start, start + WEB_PAGE_SIZE);

    // Drop selections that are no longer in the filtered list.
    useEffect(() => {
        setSelected((prev) => {
            if (!prev.size) return prev;
            const ids = new Set(filtered.map((t) => t.id));
            const next = new Set([...prev].filter((id) => ids.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [filtered]);

    const toggle = useCallback((id) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);
    const select = useCallback((id) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const pageIds = pageRows.map((t) => t.id);
    const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    const pageSomeSelected = pageIds.some((id) => selected.has(id));
    const togglePage = () => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (pageAllSelected) pageIds.forEach((id) => next.delete(id));
            else pageIds.forEach((id) => next.add(id));
            return next;
        });
    };
    const selectedRows = useMemo(() => filtered.filter((t) => selected.has(t.id)), [filtered, selected]);

    const goPage = (n) => {
        setPage(n);
        document.getElementById('rq-list-top')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    const filteredView = hasAnyFilter(filters);

    return (
        <section className="rq rq--web" aria-label="Material requests">
            <div className="rq-command">
                <SearchField value={filters.search} onChange={(search) => set({ search })} />
                <div className="rq-command__actions">
                    <span className="rq-onlyphone">
                        <FilterButton filters={filters} onClick={() => setSheetOpen(true)} />
                    </span>
                    <button type="button" className="rq-btn" data-variant="secondary" onClick={() => onExport(filtered)} disabled={!filtered.length}>
                        <FileSpreadsheet aria-hidden />
                        <span className="rq-hide-sm">Export</span>
                    </button>
                    <button type="button" className="rq-btn" data-variant="secondary" onClick={onOpenBulkPrint}>
                        <Printer aria-hidden />
                        <span className="rq-hide-sm">Bulk print</span>
                    </button>
                    {caps.canDelete ? (
                        <OverflowMenu
                            label="More request actions"
                            items={[{ label: 'Delete all history', icon: Trash2, danger: true, onSelect: onDeleteAll }]}
                        />
                    ) : null}
                </div>
            </div>

            <SummaryCards
                metrics={metrics}
                active={metric}
                loading={isLoading}
                onPick={(key) => set({ ...METRIC_FACETS[key] })}
            />

            <div className="rq-hide-phone">
                <FilterToolbar filters={filters} set={set} sites={sites} onClear={clear} />
            </div>

            <div id="rq-list-top" className="rq-listhead">
                <label className="rq-check rq-check--all">
                    <input
                        type="checkbox"
                        checked={pageAllSelected}
                        ref={(el) => { if (el) el.indeterminate = !pageAllSelected && pageSomeSelected; }}
                        onChange={togglePage}
                        disabled={!pageRows.length}
                        aria-label="Select all requests on this page"
                    />
                </label>
                <p className="rq-listhead__count" aria-live="polite">
                    {isLoading
                        ? 'Loading requests…'
                        : filtered.length
                            ? <>Showing <strong>{start + 1}–{start + pageRows.length}</strong> of <strong>{filtered.length.toLocaleString()}</strong> request{filtered.length === 1 ? '' : 's'}</>
                            : 'No requests'}
                    {isFetching && !isLoading ? <Loader2 className="rq-spin rq-listhead__sync" aria-label="Refreshing" /> : null}
                </p>
                {filteredView ? (
                    <button type="button" className="rq-btn" data-variant="ghost" data-size="sm" onClick={clearAll}>
                        <X aria-hidden />
                        Reset view
                    </button>
                ) : null}
            </div>

            {loadFailed ? (
                <ListError onRetry={onRetry} retrying={isFetching} />
            ) : isLoading ? (
                <CardSkeleton count={5} />
            ) : !filtered.length ? (
                <ListEmpty filtered={transactions.length > 0} onClear={clearAll} />
            ) : (
                <div className="rq-list">
                    {pageRows.map((tx) => (
                        <WebRequestCard
                            key={tx.id}
                            tx={tx}
                            expanded={expanded.has(tx.id)}
                            selected={selected.has(tx.id)}
                            approvedReturns={approvedReturns}
                            caps={caps}
                            busy={processingId === tx.id}
                            processing={processing}
                            onToggle={toggle}
                            onSelect={select}
                            onApprove={onApprove}
                            onDecline={onDecline}
                            onEdit={onEdit}
                            onPrint={onPrint}
                            onDelete={onDelete}
                        />
                    ))}
                </div>
            )}

            <Pager page={current} pages={pages} onPage={goPage} />

            {selected.size ? (
                <div className="rq-bulkbar" role="region" aria-label="Selected requests">
                    <span className="rq-bulkbar__count"><strong>{selected.size}</strong> selected</span>
                    <button type="button" className="rq-btn" data-variant="on-dark" data-size="sm" onClick={() => onPrintSelected(selectedRows)}>
                        <Printer aria-hidden />
                        Print
                    </button>
                    <button type="button" className="rq-btn" data-variant="on-dark" data-size="sm" onClick={() => onExport(selectedRows)}>
                        <FileSpreadsheet aria-hidden />
                        Export
                    </button>
                    <button type="button" className="rq-iconbtn rq-iconbtn--on-dark" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
                        <X aria-hidden />
                    </button>
                </div>
            ) : null}

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
