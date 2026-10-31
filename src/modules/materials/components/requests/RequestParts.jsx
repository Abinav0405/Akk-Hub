/**
 * Building blocks shared by the web and app Requests screens. Presentational only — data and
 * actions come from AdminDashboard.
 */
import { memo, useId } from 'react';
import {
    AlertTriangle, CheckCircle2, CircleDashed, Clock3, Inbox, Layers, MapPin,
    Package, PackageCheck, RotateCcw, Undo2, XCircle,
} from 'lucide-react';
import { formatDisplayDate, formatDisplayDateTime } from '@/modules/materials/lib/dates';
import {
    initials, itemStatus, lineQuantity, requestTimeline, returnRecordsFor, takeItemQuantities,
} from './requestModel';

const STATUS = {
    approved: { tone: 'success', icon: CheckCircle2, label: 'Approved' },
    declined: { tone: 'danger', icon: XCircle, label: 'Declined' },
    pending: { tone: 'warning', icon: Clock3, label: 'Pending' },
};

export function StatusBadge({ status, size }) {
    const info = STATUS[status] || STATUS.pending;
    const Icon = info.icon;
    return (
        <span className="rq-badge" data-tone={info.tone} data-size={size}>
            <Icon aria-hidden strokeWidth={2.4} />
            {info.label}
        </span>
    );
}

export function TypeBadge({ type }) {
    const isReturn = type === 'return';
    const Icon = isReturn ? RotateCcw : Package;
    return (
        <span className="rq-type" data-type={isReturn ? 'return' : 'take'}>
            <Icon aria-hidden strokeWidth={2.3} />
            {isReturn ? 'Return' : 'Take'}
        </span>
    );
}

export function Avatar({ name, type, size }) {
    return (
        <span className="rq-avatar" data-type={type === 'return' ? 'return' : 'take'} data-size={size} aria-hidden>
            {initials(name)}
        </span>
    );
}

const ITEM_ICON = {
    success: CheckCircle2,
    warning: AlertTriangle,
    danger: XCircle,
    neutral: CircleDashed,
};

export function ItemStatusTag({ status }) {
    const Icon = ITEM_ICON[status.tone] || CircleDashed;
    return (
        <span className="rq-itag" data-tone={status.tone}>
            <Icon aria-hidden strokeWidth={2.4} />
            {status.label}
        </span>
    );
}

/** First few materials as compact chips, then "+N more". */
export function MaterialChips({ tx, max = 3 }) {
    const materials = tx.materials || [];
    if (!materials.length) return <span className="rq-muted">No materials listed</span>;
    const shown = materials.slice(0, max);
    const rest = materials.length - shown.length;
    return (
        <ul className="rq-chips" aria-label="Materials">
            {shown.map((m, i) => {
                const st = itemStatus(tx, m);
                return (
                    <li key={`${m.reference_number || m.name}-${i}`} className="rq-chip" data-tone={st.tone}>
                        <span className="rq-chip__name">{m.name}</span>
                        <span className="rq-chip__qty">{lineQuantity(tx, m)}</span>
                    </li>
                );
            })}
            {rest > 0 ? <li className="rq-chip rq-chip--more">+{rest} more</li> : null}
        </ul>
    );
}

/** Material lines with return progress and recorded return transactions. */
export const MaterialLines = memo(function MaterialLines({ tx, approvedReturns }) {
    const materials = tx.materials || [];
    const isTake = tx.transaction_type === 'take';
    const approvedTake = isTake && tx.approval_status === 'approved';
    if (!materials.length) return <p className="rq-muted">No materials on this request.</p>;

    return (
        <div className="rq-lines" data-type={isTake ? 'take' : 'return'} role="table" aria-label="Materials on this request">
            <div className="rq-lines__head" role="row">
                <span role="columnheader">Material</span>
                <span role="columnheader">{isTake ? 'Issued' : 'Returning'}</span>
                {isTake ? <span role="columnheader">Returned</span> : null}
                {isTake ? <span role="columnheader">Outstanding</span> : null}
                <span role="columnheader">Status</span>
            </div>
            {materials.map((m, i) => {
                const st = itemStatus(tx, m);
                const q = isTake ? takeItemQuantities(m) : null;
                const showReturns = approvedTake && m.reference_number;
                const records = showReturns ? returnRecordsFor(tx, m, approvedReturns) : [];
                const unit = m.unit ? ` ${m.unit}` : '';
                return (
                    <div key={`${m.reference_number || m.name}-${i}`} className="rq-line" role="rowgroup">
                        <div className="rq-line__row" role="row">
                            <div className="rq-line__name" role="cell">
                                <span className="rq-line__title">{m.name || 'Unnamed material'}</span>
                                {m.reference_number ? <span className="rq-code">#{m.reference_number}</span> : null}
                            </div>
                            <div className="rq-line__num" role="cell" data-label={isTake ? 'Issued' : 'Returning'}>
                                {lineQuantity(tx, m)}
                            </div>
                            {isTake ? (
                                <div className="rq-line__num" role="cell" data-label="Returned">
                                    {showReturns ? `${q.returned}${unit}` : '—'}
                                </div>
                            ) : null}
                            {isTake ? (
                                <div className="rq-line__num" role="cell" data-label="Outstanding" data-strong={showReturns && q.outstanding > 0 ? 'true' : undefined}>
                                    {showReturns ? `${q.outstanding}${unit}` : '—'}
                                </div>
                            ) : null}
                            <div className="rq-line__status" role="cell">
                                <ItemStatusTag status={st} />
                            </div>
                        </div>
                        {showReturns && q.qty > 0 ? (
                            <div className="rq-progress" aria-hidden>
                                <span style={{ width: `${Math.round((q.returned / q.qty) * 100)}%` }} />
                            </div>
                        ) : null}
                        {m.return_declined ? (
                            <p className="rq-line__note" data-tone="danger">
                                Last return declined
                                {m.return_declined_by ? ` by ${m.return_declined_by}` : ''}
                                {m.return_declined_date ? ` · ${formatDisplayDateTime(m.return_declined_date)}` : ''}
                            </p>
                        ) : null}
                        {records.length ? (
                            <ul className="rq-returns" aria-label={`Return records for ${m.name}`}>
                                {records.map((r) => (
                                    <li key={r.id}>
                                        <Undo2 aria-hidden />
                                        <span>
                                            <strong>{r.qty}{r.unit ? ` ${r.unit}` : ''}</strong> returned
                                            {r.by ? <> by {r.by}</> : null}
                                        </span>
                                        <time>{[formatDisplayDate(r.date), r.time].filter(Boolean).join(' · ')}</time>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
});

const TL_ICON = { success: CheckCircle2, danger: XCircle, warning: Clock3, neutral: PackageCheck };

/** Recorded events only. */
export function Timeline({ tx }) {
    const events = requestTimeline(tx);
    return (
        <ol className="rq-timeline">
            {events.map((e) => {
                const Icon = TL_ICON[e.tone] || PackageCheck;
                const when = e.stamp
                    ? formatDisplayDateTime(e.stamp)
                    : [formatDisplayDate(e.date), e.time].filter(Boolean).join(' · ');
                return (
                    <li key={e.id} data-tone={e.tone} data-pending={e.pending ? 'true' : undefined}>
                        <span className="rq-timeline__dot"><Icon aria-hidden strokeWidth={2.4} /></span>
                        <div>
                            <p className="rq-timeline__title">{e.title}{e.detail ? <span> {e.detail}</span> : null}</p>
                            {when ? <time className="rq-timeline__time">{when}</time> : null}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

export function MetaLine({ tx }) {
    return (
        <p className="rq-meta">
            <time>{formatDisplayDate(tx.transaction_date)}{tx.transaction_time ? ` · ${tx.transaction_time}` : ''}</time>
            {tx.site_name ? (
                <span className="rq-meta__site"><MapPin aria-hidden />{tx.site_name}</span>
            ) : null}
        </p>
    );
}

const METRICS = [
    { key: 'total', label: 'Total requests', icon: Layers, tone: 'neutral' },
    { key: 'pending', label: 'Pending approval', icon: Clock3, tone: 'warning' },
    { key: 'approved', label: 'Approved', icon: CheckCircle2, tone: 'success' },
    { key: 'outstanding', label: 'Outstanding returns', icon: AlertTriangle, tone: 'warning' },
    { key: 'returned', label: 'Fully returned', icon: PackageCheck, tone: 'success' },
];

/** Summary cards; each one applies its filter. `keys` picks / orders cards. */
export function SummaryCards({ metrics, active, onPick, keys, loading, className }) {
    const list = keys ? keys.map((k) => METRICS.find((m) => m.key === k)).filter(Boolean) : METRICS;
    return (
        <div className={`rq-metrics ${className || ''}`} role="group" aria-label="Request summary">
            {list.map((m) => {
                const Icon = m.icon;
                const on = active === m.key;
                return (
                    <button
                        key={m.key}
                        type="button"
                        className="rq-metric"
                        data-tone={m.tone}
                        aria-pressed={on}
                        onClick={() => onPick(m.key)}
                    >
                        <span className="rq-metric__icon"><Icon aria-hidden strokeWidth={2.2} /></span>
                        <span className="rq-metric__value">
                            {loading ? <span className="rq-skel rq-skel--num" /> : metrics[m.key].toLocaleString()}
                        </span>
                        <span className="rq-metric__label">{m.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

/** iOS-style segmented control (radio group). */
export function Segmented({ label, value, options, onChange, size }) {
    const id = useId();
    return (
        <div className="rq-seg" role="radiogroup" aria-labelledby={label ? id : undefined} data-size={size}>
            {label ? <span id={id} className="sr-only">{label}</span> : null}
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    className="rq-seg__opt"
                    onClick={() => onChange(o.value)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export function ListEmpty({ filtered, onClear }) {
    return (
        <div className="rq-empty">
            <span className="rq-empty__icon"><Inbox aria-hidden /></span>
            <h3>{filtered ? 'No matching requests' : 'No requests yet'}</h3>
            <p>
                {filtered
                    ? 'Nothing matches the current search and filters. Try widening the date range or clearing filters.'
                    : 'Take and return requests from workers will appear here as soon as they are submitted.'}
            </p>
            {filtered && onClear ? (
                <button type="button" className="rq-btn" data-variant="secondary" onClick={onClear}>Clear filters</button>
            ) : null}
        </div>
    );
}

export function ListError({ onRetry, retrying }) {
    return (
        <div className="rq-empty" role="alert">
            <span className="rq-empty__icon" data-tone="danger"><AlertTriangle aria-hidden /></span>
            <h3>Couldn’t load requests</h3>
            <p>Check the connection and try again. Requests already on screen are unchanged.</p>
            <button type="button" className="rq-btn" data-variant="secondary" onClick={onRetry} disabled={retrying}>
                {retrying ? 'Retrying…' : 'Try again'}
            </button>
        </div>
    );
}

export function CardSkeleton({ count = 4 }) {
    return (
        <div className="rq-list" aria-busy="true" aria-label="Loading requests">
            {Array.from({ length: count }, (_, i) => (
                <div key={i} className="rq-card rq-card--skel">
                    <span className="rq-skel rq-skel--avatar" />
                    <div className="rq-skel-lines">
                        <span className="rq-skel" style={{ width: '38%' }} />
                        <span className="rq-skel" style={{ width: '24%' }} />
                        <span className="rq-skel" style={{ width: '62%' }} />
                    </div>
                </div>
            ))}
        </div>
    );
}
