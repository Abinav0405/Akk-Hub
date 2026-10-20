import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

const LINE_WIDTHS = ['82%', '68%', '74%', '60%'];

/** Placeholder cards shaped like the list that is loading (native only). */
export function SkeletonList({ count = 4, label = 'Loading' }) {
  return (
    <div className="n-list" role="status" aria-live="polite">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="n-skel-card" aria-hidden>
          <div className="n-skel n-skel--icon" />
          <div className="n-skel-card__body">
            <div className="n-skel n-skel--title" style={{ width: '52%' }} />
            <div className="n-skel n-skel--line" style={{ width: LINE_WIDTHS[i % LINE_WIDTHS.length] }} />
            <div className="n-skel n-skel--line" style={{ width: '38%' }} />
          </div>
        </div>
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/** Placeholder for a row of stat tiles. */
export function SkeletonStats({ count = 3 }) {
  return (
    <div className="n-stats" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="n-stat">
          <div className="n-skel n-skel--title" style={{ width: '40%', height: 22 }} />
          <div className="n-skel n-skel--line" style={{ width: '70%', marginTop: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

export function NativeEmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="n-state" role="status">
      <span className="n-state__icon" aria-hidden>
        <Icon className="h-7 w-7" strokeWidth={1.7} />
      </span>
      <h3 className="n-state__title">{title}</h3>
      {description ? <p className="n-state__text">{description}</p> : null}
      {action}
    </div>
  );
}

/** A failed request, with a retry that re-runs it. Never hides the failure. */
export function NativeErrorState({
  title = 'Couldn’t load this',
  description = 'Check your connection and try again.',
  onRetry,
  retrying = false,
}) {
  return (
    <div className="n-state" data-tone="error" role="alert">
      <span className="n-state__icon" aria-hidden>
        <AlertTriangle className="h-7 w-7" strokeWidth={1.8} />
      </span>
      <h3 className="n-state__title">{title}</h3>
      <p className="n-state__text">{description}</p>
      {onRetry ? (
        <button
          type="button"
          className="n-btn n-btn--tinted n-btn--sm"
          onClick={onRetry}
          disabled={retrying}
          data-loading={retrying ? 'true' : undefined}
        >
          {retrying ? <span className="n-spinner" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
      ) : null}
    </div>
  );
}

/** Route-level placeholder while a lazily loaded page chunk arrives. */
export function RouteFallback() {
  return (
    <div className="n-route-fallback" aria-busy="true">
      <div className="n-skel n-skel--title" style={{ width: '46%', height: 28, marginBottom: 20 }} />
      <SkeletonList count={3} />
    </div>
  );
}
