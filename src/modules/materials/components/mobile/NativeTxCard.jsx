import { Calendar, CheckCircle2, ChevronDown, Clock, Clock3, MapPin, Package, RotateCcw, XCircle } from 'lucide-react';
import { formatDisplayDate, formatDisplayDateTime } from '@/modules/materials/lib/dates';

const STATUS = {
  approved: { tone: 'success', icon: CheckCircle2, label: 'Approved' },
  declined: { tone: 'danger', icon: XCircle, label: 'Declined' },
  pending: { tone: 'warning', icon: Clock3, label: 'Pending' },
};

/** Status capsule: icon + word, so status never relies on colour alone. */
export function StatusPill({ status }) {
  const info = STATUS[status] || STATUS.pending;
  const Icon = info.icon;
  return (
    <span className="n-pill" data-tone={info.tone}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />
      {info.label}
    </span>
  );
}

export function materialQuantity(tx, material) {
  return tx.transaction_type === 'return' && material.return_quantity
    ? `${material.return_quantity}/${material.quantity} ${material.unit}`
    : `${material.quantity} ${material.unit}`;
}

/** Return progress of a taken item, as the worker history describes it. */
export function workerItemStatus(tx, material) {
  if (tx.transaction_type !== 'take' || !material.reference_number) return null;
  if (material.returned) {
    return {
      tone: 'success',
      text: `Returned on ${formatDisplayDateTime(material.return_date) || material.return_date || ''}`,
    };
  }
  if (material.return_declined) {
    return {
      tone: 'danger',
      text: `Return declined by ${material.return_declined_by} on ${formatDisplayDateTime(material.return_declined_date) || material.return_declined_date || ''}`,
    };
  }
  if ((material.returned_quantity || 0) > 0) {
    return {
      tone: 'brand',
      text: `Partially returned (${material.returned_quantity}/${material.quantity} ${material.unit})`,
    };
  }
  return { tone: 'warning', text: 'Not returned' };
}

/** Return state of a taken item for the staff inbox. */
export function staffItemStatus(tx, material) {
  if (tx.transaction_type !== 'take') return null;
  if (material.returned) return { tone: 'success', text: 'Returned' };
  if ((material.returned_quantity || 0) > 0) {
    return { tone: 'brand', text: `Partially returned (${material.returned_quantity}/${material.quantity})` };
  }
  return { tone: 'warning', text: 'Taken to site · not returned' };
}

/**
 * Transaction card for the native app. Purely presentational — callers
 * memoise it and pass actions / expanded content.
 */
export default function NativeTxCard({
  tx,
  title,
  titleNote,
  showKind = true,
  itemStatus,
  expanded = false,
  onToggleExpand,
  expandLabel = 'return history',
  expandedContent,
  actions,
}) {
  const isReturn = tx.transaction_type === 'return';
  const TypeIcon = isReturn ? RotateCcw : Package;
  const materials = tx.materials || [];

  return (
    <article className="n-tx" data-type={isReturn ? 'return' : 'take'}>
      <div className="n-tx__head">
        <span className="n-tx__icon" aria-hidden>
          <TypeIcon className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="n-tx__heading">
          <h3 className="n-tx__title">
            {title}
            {titleNote ? <small>{titleNote}</small> : null}
          </h3>
          <div className="n-tx__meta">
            {showKind ? <span className="n-tx__kind">{isReturn ? 'Return' : 'Take'}</span> : null}
            <span>
              <Calendar className="h-3.5 w-3.5" aria-hidden />
              {formatDisplayDate(tx.transaction_date)}
            </span>
            {tx.transaction_time ? (
              <span>
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {tx.transaction_time}
              </span>
            ) : null}
            {tx.site_name ? (
              <span>
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {tx.site_name}
              </span>
            ) : null}
          </div>
        </div>
        <StatusPill status={tx.approval_status} />
      </div>

      {materials.length > 0 ? (
        <ul className="n-tx__items" aria-label="Materials">
          {materials.map((material, idx) => {
            const status = itemStatus?.(tx, material);
            return (
              <li key={`${material.reference_number || material.name}-${idx}`} className="n-tx__item">
                <div className="n-tx__item-main">
                  <span className="n-tx__item-name">{material.name}</span>
                  <span className="n-tx__qty">{materialQuantity(tx, material)}</span>
                </div>
                {material.reference_number || status ? (
                  <div className="n-tx__item-sub">
                    {material.reference_number ? (
                      <span className="n-ref">#{material.reference_number}</span>
                    ) : null}
                    {status ? (
                      <span className="n-tx__item-status" data-tone={status.tone}>
                        {status.text}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {tx.notes ? <p className="n-tx__notes">“{tx.notes}”</p> : null}

      {tx.approved_by && tx.approval_status !== 'pending' ? (
        <p className="n-tx__audit">
          {tx.approval_status === 'approved' ? 'Approved' : 'Declined'} by {tx.approved_by}
          {tx.approval_date ? ` on ${formatDisplayDateTime(tx.approval_date)}` : ''}
        </p>
      ) : null}

      {onToggleExpand ? (
        <button
          type="button"
          className="n-tx__expand"
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          {expanded ? `Hide ${expandLabel}` : `Show ${expandLabel}`}
          <ChevronDown
            className="h-4 w-4 transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
            aria-hidden
          />
        </button>
      ) : null}

      {expanded && expandedContent ? <div className="n-tx__expanded">{expandedContent}</div> : null}

      {actions ? <div className="n-tx__actions">{actions}</div> : null}
    </article>
  );
}
